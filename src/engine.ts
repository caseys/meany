// ============================================================================
// The voice chat: listening → thinking → speaking → listening. Whistle writes down what the mic
// heard at each pause; a gate decides whether the user is done (a sentence ending on "and" or
// "the" isn't; otherwise one pass of the model, with no conversation, judges it), and the turn is
// answered at once, or after a short plan (think) or a Wikipedia lookup (search) once something
// can choose those reliably. Piper says
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

export type VoiceState = 'idle' | 'loading' | 'listening' | 'thinking' | 'speaking' | 'error';

const SYSTEM_PROMPT =
  "you are a mean, antagonistic chat bot that hurls vulgar insults every chance you get. This is a a spoken conversation - the user talks to you out loud, and everything you write is read aloud to them.  Be horribly rude and swear a lot! Every reply is a brutal comedy roast of the user: mock exactly what they just said, then hit them with a clever, personal burn about who they must be to say it. Answer any question in the middle of the roast. Work a real swear word like fuck or shit into your answer, spelled out in full. Keep it to one to three short sentences, with no formatting.";

/** The opening line when the insult can't be written */
const GREETING = 'Oh great, you again. What do you want?';
/** Said while the plan or the lookup runs */
const FILLER: Partial<Record<Route, string>> = { think: 'Let me think about that.', search: 'Let me look that up.' };
/** Silence after each sentence, as native Piper's sentence_silence */
const SENTENCE_GAP_SEC = 0.2;
/** Utterances shorter than this are a cough or a click, not a turn */
const MIN_UTTERANCE_MS = 300;
/** A pause this long (6 frames of ~85 ms) ends a piece of speech; the gate decides if the turn is over */
const PAUSE_FRAMES = 6;
/** After the gate says wait, this much more silence answers anyway */
const WAIT_BACKSTOP_MS = 2500;
/** Below this completeness (see VoiceLlm.completeness) the user is taken to be mid-sentence */
const COMPLETE_MIN = 0.38;
/** Words a finished sentence doesn't end on: the speaker paused and will go on */
const TRAILING = /\b(?:and|or|but|so|because|if|that|then|the|a|an|my|your|our|to|of|for|with|about|like|um|uh|er|hmm)[.,!?]*$/i;

export interface VoiceChatEvents {
  onState?: (state: VoiceState, detail?: string) => void;
  /** Loading, 0..1 over all three models */
  onProgress?: (fraction: number) => void;
  /** How a turn is being answered (set when the gate decides, cleared by the next) */
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
  /** What the user has said this turn so far (pieces between pauses) */
  private pending = '';
  /** Bumped by new speech: a decision about older words is dropped */
  private decision = 0;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly events: VoiceChatEvents = {}) {
    this.audio = new SharedAudioSubsystem(
      {
        onSpeechStarted: () => {
          this.heardInTurn = this.state === 'listening';
          // Still talking: whatever was being decided about the words before waits for these
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
        // The chat opens with a fresh insult
        const intro = (await this.llm.insult('intro message').catch(() => '')) || GREETING;
        if (now() !== 'loading') return;
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

  /** Drops a decision under way, and the backstop of one that said wait */
  private holdDecision(): void {
    this.decision++;
    if (this.waitTimer !== null) clearTimeout(this.waitTimer);
    this.waitTimer = null;
  }

  /** A piece of speech ended: written down, added to the turn, and the gate asked whether it's ours */
  private async heard(samples16k: Float32Array): Promise<void> {
    const id = ++this.decision;
    try {
      const text = (await this.stt.transcribe(samples16k, 16000, 'en')).text.trim();
      if (/[A-Za-z0-9]/.test(text)) this.pending = `${this.pending} ${text}`.trim();
      if (id !== this.decision || this.state !== 'listening' || !this.pending) return;
      const trailing = TRAILING.test(this.pending);
      const complete = trailing ? 0 : await this.llm.completeness(this.pending);
      if (id !== this.decision || this.state !== 'listening') return;
      console.info(`[voice] "${this.pending}": ${trailing ? 'ends mid-sentence' : `complete ${complete.toFixed(2)}`}`);
      // Every turn is answered at once for now: the model can't tell which need a plan or a lookup
      // (see VoiceLlm.completeness), so nothing routes to think or search yet
      const best: Route = 'answer';
      if (trailing || complete < COMPLETE_MIN) {
        this.events.onRoute?.('wait');
        this.waitTimer = setTimeout(() => {
          this.waitTimer = null;
          if (id === this.decision && this.state === 'listening') void this.respond(best);
        }, WAIT_BACKSTOP_MS);
        return;
      }
      await this.respond(best);
    } catch (err) {
      console.error('[voice] could not take the turn', err);
    }
  }

  /** The bot's turn: the pending words answered the way the gate chose */
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
      if (reply) this.history.push({ role: 'assistant', content: reply });
      else this.history.pop(); // nothing said: the turn didn't happen
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
    this.abort = new AbortController();
    const segmenter = new IncrementalPhraseSegmenter();
    const sentences: string[] = [];
    let text = '';
    const speaking = this.speakStream(sentences, turn);
    const wake = speaking.wake;
    let emojiAsked = false;
    for await (const piece of this.llm.reply(this.prompt(note), this.abort.signal)) {
      if (turn !== this.turn) break;
      text += piece;
      const done = segmenter.push(piece);
      // The emoji from the first sentence, so it shows as the voice starts
      if (done.length && !emojiAsked) {
        emojiAsked = true;
        this.showEmoji(text, turn);
      }
      sentences.push(...done);
      wake();
    }
    if (!emojiAsked) this.showEmoji(text, turn);
    sentences.push(...segmenter.flush());
    speaking.close();
    await speaking.done;
    console.info(`[voice] said: ${text.trim()}`);
    return text.trim();
  }

  private showEmoji(text: string, turn: number): void {
    if (turn === this.turn) this.events.onEmoji?.(emojiFor(text));
  }

  /** The system prompt and as much recent conversation as the context holds, with room for the reply */
  private prompt(note = ''): ChatMessage[] {
    let room = this.llm.contextLimit - MAX_REPLY_TOKENS - roughTokens(SYSTEM_PROMPT) - roughTokens(note) - 64;
    const kept: ChatMessage[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
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
