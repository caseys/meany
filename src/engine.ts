// ============================================================================
// The voice chat: listening → thinking → speaking → listening. Whistle writes down what the mic
// heard once the user has been quiet for about a second, and the turn is answered at once (the
// paths to answer after a short plan, think, or a Wikipedia lookup, search, are built, but nothing
// chooses them yet). Piper says
// the answer a sentence at a time, each one synthesized while the one before it plays.
//
// The bot is never interrupted (no barge-in, as in cardist's voice chat): while it thinks or
// speaks, what the mic hears is ignored, which also keeps its own voice from coming back as a turn.
// The three models load one after another, never together (the lesson from Chatty on iPhone). The
// screen is kept on while the chat runs, any tap wakes the audio, and a mic iOS ended while the page
// was hidden is opened again (Chatty's lessons on devices).
// ============================================================================

import { SharedAudioSubsystem } from './audio/audio-subsystem.ts';
import { IncrementalPhraseSegmenter, normalizeTextForSpeech } from './core/speech-normalizer.ts';
import { MAX_REPLY_TOKENS, roughTokens, VoiceLlm, type ChatMessage, type Route } from './runtimes/llm.ts';
import { PiperVoice } from './runtimes/piper.ts';
import { WhistleSttProvider } from './runtimes/stt-provider.ts';
import { lookUp } from './runtimes/wikipedia.ts';
import { emojiFor } from './runtimes/emoji.ts';
import { keepAwake } from './core/keep-awake.ts';
import { nextRoast } from './runtimes/roasts.ts';
import { nextQuestion } from './runtimes/questions.ts';

export type VoiceState = 'idle' | 'loading' | 'listening' | 'thinking' | 'speaking' | 'error';

const SYSTEM_PROMPT =
  'You are a mean, vulgar roast bot in a spoken conversation. Everything you write is read aloud. Respond to what they just said and insult them. Swear a lot, like fuck and shit. Keep it to one or two short sentences, with no formatting.';

/** Said while the plan or the lookup runs */
const FILLER: Partial<Record<Route, string>> = { think: 'Let me think about that.', search: 'Let me look that up.' };
/** A reply is cut off after this many sentences (the app's question follows it) */
const MAX_SENTENCES = 2;
/** Silence after each sentence (native Piper's sentence_silence is 0.2 s; longer, the roast and the question land apart) */
const SENTENCE_GAP_SEC = 0.35;
/** Utterances shorter than this are a cough or a click, not a turn */
const MIN_UTTERANCE_MS = 300;
/** A pause this long (12 frames of ~85 ms, about 1 s) ends the user's turn: answered at once */
const PAUSE_FRAMES = 12;

/** How many of the bot's recent replies a new reply is checked against for copying */
const RECENT_REPLIES = 3;
/** A reply that copied one of the bot's recent ones (see VoiceChat.answer) */
const COPIED = Symbol('copied');

/** The words of a text, lowercase, in threes */
function wordTriples(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const triples = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) triples.add(words.slice(i, i + 3).join(' '));
  return triples;
}

/**
 * A sentence copied from `previous`: most of its three-word runs are in it (a short sentence, the
 * same words as the start of `previous`).
 */
function copies(sentence: string, previous: string): boolean {
  const mine = wordTriples(sentence);
  if (mine.size < 2) {
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return !!norm(sentence) && norm(previous).startsWith(norm(sentence));
  }
  const theirs = wordTriples(previous);
  let shared = 0;
  for (const t of mine) if (theirs.has(t)) shared++;
  return shared / mine.size >= 0.6;
}

export interface VoiceChatEvents {
  onState?: (state: VoiceState, detail?: string) => void;
  /** Loading, 0..1 over all three models */
  onProgress?: (fraction: number) => void;
  /** How a turn is being answered (set when the bot's turn starts) */
  onRoute?: (route: Route) => void;
  /** The emoji for the reply being said (null: none) */
  onEmoji?: (emoji: string | null) => void;
}

export class VoiceChat {
  state: VoiceState = 'idle';
  readonly audio: SharedAudioSubsystem;
  private readonly stt = new WhistleSttProvider();
  private readonly llm = new VoiceLlm();
  private readonly voice = new PiperVoice();
  private readonly history: ChatMessage[] = [];
  private loaded = false;
  private turn = 0;
  /** The utterance under way began while it was the user's turn */
  private heardInTurn = false;
  private abort: AbortController | null = null;
  /** What the user has said this turn so far (speech that went on while the last piece was written down) */
  private pending = '';
  /** Bumped by new speech: words still being written down join the next piece's turn */
  private decision = 0;

  constructor(private readonly events: VoiceChatEvents = {}) {
    this.audio = new SharedAudioSubsystem(
      {
        onSpeechStarted: () => {
          this.heardInTurn = this.state === 'listening';
          // Still talking: the words before join this piece's turn
          if (this.heardInTurn) this.holdDecision();
        },
        onSpeechEnded: (samples16k, durationMs) => {
          if (this.state !== 'listening' || !this.heardInTurn || durationMs < MIN_UTTERANCE_MS) return;
          void this.heard(samples16k);
        },
      },
      { silenceHangoverFrames: PAUSE_FRAMES }
    );
    // Browsers start or resume audio only in a tap or key press: every one, anywhere on the page,
    // wakes the one context (Safari grants it in click, touchend and keydown; Chrome in pointerdown)
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      document.addEventListener(type, () => this.audio.unlockInGesture(), true);
    }
    // Back on the page: iOS ends the mic's track while the page is hidden. Opened again, or if
    // the browser won't without a tap, the chat stops and says so.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.reopenMic();
    });
    // Leaving the page (not into the back/forward cache): mic and wake lock let go
    window.addEventListener('pagehide', (event) => {
      if (!event.persisted && this.state !== 'idle') this.stop();
    });
  }

  private async reopenMic(): Promise<void> {
    if (this.state === 'idle' || this.state === 'error' || this.state === 'loading' || this.audio.micLive()) return;
    console.warn('[voice] the mic stopped while the page was hidden: opening it again');
    try {
      this.audio.stopMicrophoneCapture();
      await this.audio.startMicrophoneCapture();
    } catch (err) {
      console.warn('[voice] mic not reopened', err);
      this.stop('Paused while the page was hidden. Tap to keep talking.');
    }
  }

  /** Starts the chat. Call it inside the tap: that is where the browser lets audio start. */
  async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'error') return;
    this.audio.unlockInGesture();
    this.audio.setAudioSessionType('play-and-record');
    keepAwake(true);
    this.setState('loading');
    try {
      // The mic first, so its permission is asked while the tap is fresh
      await this.audio.startMicrophoneCapture();
      if (!this.loaded) {
        // One at a time: the model (most of the memory), then the voice, then the ears
        await this.llm.load((f) => this.events.onProgress?.(f * 0.8));
        await this.voice.load((f) => this.events.onProgress?.(0.8 + f * 0.15));
        await this.stt.initialize((loaded, total) => total > 0 && this.events.onProgress?.(0.95 + (loaded / total) * 0.05));
        this.loaded = true;
        this.events.onProgress?.(1);
      }
      // (read fresh: stop() may have run while it loaded)
      const now = (): VoiceState => this.state;
      if (now() !== 'loading') return; // stopped while loading
      if (this.history.length === 0) {
        // The chat opens with a roast from the pool: no model call, so it starts at once
        const intro = `${nextRoast()} ${nextQuestion()}`;
        this.history.push({ role: 'assistant', content: intro });
        this.setState('speaking');
        await this.speak([intro], ++this.turn);
      }
      if (now() === 'speaking' || now() === 'loading') this.setState('listening');
    } catch (err) {
      console.error('[voice] start failed', err);
      this.audio.stopMicrophoneCapture();
      this.audio.setAudioSessionType('auto');
      keepAwake(false);
      this.setState('error', err instanceof Error ? err.message : String(err));
    }
  }

  /** Ends the chat: the mic closes, the reply stops, the conversation is kept for the next start; `why` is shown */
  stop(why?: string): void {
    this.holdDecision();
    this.pending = '';
    this.abort?.abort();
    this.llm.interrupt();
    this.voice.cancel(`turn_${this.turn}`);
    this.turn++;
    this.audio.stopAllPlaybackImmediately();
    this.audio.stopMicrophoneCapture();
    // (iOS: 'auto' again once the mic is off, as in Chatty, so other apps' sound isn't held)
    this.audio.setAudioSessionType('auto');
    keepAwake(false);
    this.setState('idle', why);
  }

  /** New speech: a piece still being written down doesn't start the bot's turn */
  private holdDecision(): void {
    this.decision++;
  }

  /** A second of silence: what was said is written down, and answered at once */
  private async heard(samples16k: Float32Array): Promise<void> {
    const id = ++this.decision;
    try {
      const text = (await this.stt.transcribe(samples16k, 16000, 'en')).text.trim();
      if (/[A-Za-z0-9]/.test(text)) this.pending = `${this.pending} ${text}`.trim();
      if (id !== this.decision || this.state !== 'listening' || !this.pending) return;
      // Every turn is answered at once: no plan or lookup route is chosen yet
      await this.respond('answer');
    } catch (err) {
      console.error('[voice] could not take the turn', err);
    }
  }

  /** The bot's turn: the pending words answered by `route` */
  private async respond(route: Route): Promise<void> {
    const turn = ++this.turn;
    const heard = this.pending;
    this.pending = '';
    this.setState('thinking');
    this.events.onRoute?.(route);
    console.info(`[voice] ${route}: ${heard}`);
    this.history.push({ role: 'user', content: heard });
    try {
      let note = '';
      const filler = FILLER[route];
      const saying = filler ? this.speak([filler], turn) : Promise.resolve();
      if (route === 'think') {
        const plan = await this.llm.plan(heard);
        if (plan) note = `A plan for your answer (do not read it out): ${plan}`;
      } else if (route === 'search') {
        const fact = await lookUp(heard).catch(() => null);
        note = fact
          ? `From Wikipedia, ${fact.title}: ${fact.extract}\nAnswer from this.`
          : "A Wikipedia search found nothing for this: say you couldn't look it up.";
      }
      if (turn !== this.turn) return;
      const reply = await this.answer(turn, note);
      await saying;
      if (turn !== this.turn) return;
      if (!reply) {
        this.history.pop(); // nothing said: the turn didn't happen
        this.setState('listening');
        return;
      }
      // Then the app's question, which steers the chat to their life (see questions.ts)
      const question = nextQuestion();
      await this.speak([question], turn);
      if (turn !== this.turn) return;
      this.history.push({ role: 'assistant', content: `${reply} ${question}` });
      this.setState('listening');
    } catch (err) {
      if (turn !== this.turn) return;
      console.error('[voice] turn failed', err);
      if (this.history[this.history.length - 1]?.role === 'user') this.history.pop();
      this.setState('listening');
    }
  }

  /** Streams the reply into speech, a sentence at a time; returns what was said */
  private async answer(turn: number, note = ''): Promise<string> {
    // The bot's last reply: a reply that starts by copying it is written again without it in view.
    // The model copies its own last reply when the user gives it little to answer ("okay
    // whatever"); without that reply in the prompt it never did, but then it can't follow up on
    // what it said, so it's left out only for the turn that copied.
    // (its last three replies: it also brings back older insults)
    const previous = this.history.filter((m) => m.role === 'assistant').slice(-RECENT_REPLIES).map((m) => m.content);
    const reply = await this.generate(turn, this.prompt(note), previous);
    if (reply !== COPIED && (reply || turn !== this.turn)) return reply;
    console.info('[voice] the reply copied the last one: written again without it in view');
    const again = await this.generate(turn, this.prompt(note, true), previous);
    if (again !== COPIED && again) return again;
    // Copied again, or nothing said: a roast from the pool instead
    if (turn !== this.turn) return '';
    const roast = nextRoast();
    console.info(`[voice] no usable reply: a roast from the pool instead`);
    await this.speak([roast], turn);
    return roast;
  }

  /**
   * One reply, streamed into speech a sentence at a time. The first sentence is held until it's
   * checked: a copy of one of the `previous` replies stops the reply before anything is said (COPIED).
   */
  private async generate(turn: number, messages: ChatMessage[], previous: string[]): Promise<string | typeof COPIED> {
    this.abort = new AbortController();
    const segmenter = new IncrementalPhraseSegmenter();
    const sentences: string[] = [];
    /** Every sentence of the reply so far (`sentences` is the queue the voice takes them from) */
    const said: string[] = [];
    let text = '';
    // (set inside startSpeaking: typed so TypeScript doesn't take it as always null)
    let speaking = null as ReturnType<VoiceChat['speakStream']> | null;
    const startSpeaking = () => {
      speaking = this.speakStream(sentences, turn);
      this.showEmoji(text, turn);
    };
    for await (const piece of this.llm.reply(messages, this.abort.signal)) {
      if (turn !== this.turn) break;
      text += piece;
      const done = segmenter.push(piece);
      said.push(...done);
      sentences.push(...done);
      // Long enough: the rest isn't written (a roast and a question fit in three sentences)
      const enough = said.length >= MAX_SENTENCES;
      if (enough) this.abort.abort();
      if (!speaking && sentences.length) {
        if (previous.some((reply) => copies(sentences[0], reply))) {
          this.abort.abort();
          return COPIED;
        }
        startSpeaking();
      }
      speaking?.wake();
      if (enough) break;
    }
    // (cut off at MAX_SENTENCES, the unfinished rest isn't said)
    if (said.length < MAX_SENTENCES) {
      const rest = segmenter.flush();
      said.push(...rest);
      sentences.push(...rest);
    }
    if (!speaking) {
      // (a reply shorter than one sentence is checked whole)
      if (text.trim() && previous.some((reply) => copies(text, reply))) return COPIED;
      startSpeaking();
    }
    speaking!.close();
    await speaking!.done;
    // What was said (a cut-off reply's unsaid rest isn't kept in the history either)
    const reply = said.join(' ').trim() || text.trim();
    console.info(`[voice] said: ${reply}`);
    return reply;
  }

  private showEmoji(text: string, turn: number): void {
    if (turn === this.turn) this.events.onEmoji?.(emojiFor(text));
  }

  /**
   * The system prompt and as much recent conversation as the context holds, with room for the
   * reply, in the alternating user/assistant form the model was trained on. `withoutLastReply`
   * leaves the bot's last reply out (only after a reply copied it).
   */
  private prompt(note = '', withoutLastReply = false): ChatMessage[] {
    let room = this.llm.contextLimit - MAX_REPLY_TOKENS - roughTokens(SYSTEM_PROMPT) - roughTokens(note) - 64;
    const lastReply = withoutLastReply ? this.history.map((m) => m.role).lastIndexOf('assistant') : -1;
    const kept: ChatMessage[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (i === lastReply) continue;
      room -= roughTokens(this.history[i].content);
      if (room < 0 && kept.length > 0) break;
      kept.unshift(this.history[i]);
    }
    // The chat template wants the user first after the system prompt
    while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
    // A plan or a looked-up fact goes with this turn's words only, never into the history
    if (note && kept.length) kept[kept.length - 1] = { ...kept[kept.length - 1], content: `${kept[kept.length - 1].content}\n\n(${note})` };
    return [{ role: 'system', content: SYSTEM_PROMPT }, ...kept];
  }

  private async speak(lines: string[], turn: number): Promise<void> {
    const stream = this.speakStream([...lines], turn);
    stream.close();
    await stream.done;
  }

  /**
   * Says sentences as they arrive in `queue`: each is synthesized while the one before plays, and
   * queued on the audio clock with a short gap. `done` settles once the last has played.
   */
  private speakStream(queue: string[], turn: number): { wake: () => void; close: () => void; done: Promise<void> } {
    let closed = false;
    let wakeUp: (() => void) | null = null;
    const wake = () => {
      wakeUp?.();
      wakeUp = null;
    };
    const done = (async () => {
      const playing: Promise<void>[] = [];
      while (turn === this.turn) {
        const next = queue.shift();
        if (next === undefined) {
          if (closed) break;
          await new Promise<void>((resolve) => (wakeUp = resolve));
          continue;
        }
        // (emoji too: the prompt asks for none, but a small model writes them anyway)
        const spoken = normalizeTextForSpeech(next.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ''));
        if (!spoken) continue;
        const speech = await this.voice.synthesize(spoken, `turn_${turn}`).catch((err) => {
          console.warn('[voice] sentence not spoken', err);
          return null;
        });
        if (!speech || turn !== this.turn) continue;
        if (this.state === 'thinking') this.setState('speaking');
        const gap = Math.round(SENTENCE_GAP_SEC * speech.sampleRate);
        const padded = new Float32Array(speech.samples.length + gap);
        padded.set(speech.samples);
        // (a context the OS paused, a call or Siri, is asked to run again first)
        const ctx = this.audio.getAudioContext();
        if (ctx && ctx.state !== 'running') await ctx.resume().catch(() => {});
        playing.push(this.audio.schedulePcmPlayback(padded, speech.sampleRate));
      }
      await this.played(Promise.all(playing));
    })();
    return {
      wake,
      close: () => {
        closed = true;
        wake();
      },
      done,
    };
  }

  /**
   * Waits for the queued speech to finish. A sentence ends on its audio clock, so a clock that
   * stops (the OS took the audio and never gave it back) would leave the chat speaking forever:
   * every 0.7 s the clock is looked at (and a paused context asked to run), and once it hasn't
   * moved for 15 s the speech is dropped so the user's turn comes back.
   */
  private async played(all: Promise<unknown>): Promise<void> {
    let finished = false;
    void all.then(() => (finished = true));
    let lastTime = -1;
    let stillSince = performance.now();
    while (!finished) {
      await Promise.race([all, new Promise((resolve) => setTimeout(resolve, 700))]);
      if (finished) return;
      const ctx = this.audio.getAudioContext();
      if (!ctx) return;
      if (ctx.state !== 'running') void ctx.resume().catch(() => {});
      if (ctx.currentTime !== lastTime) {
        lastTime = ctx.currentTime;
        stillSince = performance.now();
      } else if (performance.now() - stillSince > 15_000) {
        console.warn(`[voice] audio clock stuck for 15 s (context ${ctx.state}): speech dropped`);
        this.audio.stopAllPlaybackImmediately();
        return;
      }
    }
  }

  private setState(state: VoiceState, detail?: string): void {
    this.state = state;
    this.events.onState?.(state, detail);
  }
}
