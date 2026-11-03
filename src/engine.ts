// ============================================================================
// The voice chat: listening → thinking → speaking → listening. Whistle writes down what the mic
// heard once the speech detector says the user stopped; the model answers; Piper says the answer a
// sentence at a time, each one synthesized while the one before it plays.
//
// The bot is never interrupted (no barge-in, as in cardist's voice chat): while it thinks or
// speaks, what the mic hears is ignored, which also keeps its own voice from coming back as a turn.
// The three models load one after another, never together (the lesson from Chatty on iPhone).
// ============================================================================

import { SharedAudioSubsystem } from './audio/audio-subsystem.ts';
import { IncrementalPhraseSegmenter, normalizeTextForSpeech } from './core/speech-normalizer.ts';
import { MAX_REPLY_TOKENS, roughTokens, VoiceLlm, type ChatMessage } from './runtimes/llm.ts';
import { PiperVoice } from './runtimes/piper.ts';
import { WhistleSttProvider } from './runtimes/stt-provider.ts';

export type VoiceState = 'idle' | 'loading' | 'listening' | 'thinking' | 'speaking' | 'error';

const SYSTEM_PROMPT = [
  'You are a friendly assistant in a spoken conversation: the user talks to you out loud, and everything you write is read aloud to them.',
  'Answer in one to three short sentences of plain, natural spoken English.',
  'Never use lists, headings, markdown, emoji, symbols or code.',
  "If you don't know something, or it needs live information like news or the weather, say so briefly instead of guessing.",
].join('\n');

const GREETING = 'Hi! What would you like to talk about?';
/** Silence after each sentence, as native Piper's sentence_silence */
const SENTENCE_GAP_SEC = 0.2;
/** Utterances shorter than this are a cough or a click, not a turn */
const MIN_UTTERANCE_MS = 300;

export interface VoiceChatEvents {
  onState?: (state: VoiceState, detail?: string) => void;
  /** Loading, 0..1 over all three models */
  onProgress?: (fraction: number) => void;
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

  constructor(private readonly events: VoiceChatEvents = {}) {
    this.audio = new SharedAudioSubsystem({
      onSpeechStarted: () => {
        this.heardInTurn = this.state === 'listening';
      },
      onSpeechEnded: (samples16k, durationMs) => {
        if (this.state !== 'listening' || !this.heardInTurn || durationMs < MIN_UTTERANCE_MS) return;
        void this.takeTurn(samples16k);
      },
    });
  }

  /** Starts the chat. Call it inside the tap: that is where the browser lets audio start. */
  async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'error') return;
    this.audio.unlockInGesture();
    this.audio.setAudioSessionType('play-and-record');
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
        this.history.push({ role: 'assistant', content: GREETING });
        this.setState('speaking');
        await this.speak([GREETING], ++this.turn);
      }
      if (now() === 'speaking' || now() === 'loading') this.setState('listening');
    } catch (err) {
      console.error('[voice] start failed', err);
      this.audio.stopMicrophoneCapture();
      this.setState('error', err instanceof Error ? err.message : String(err));
    }
  }

  /** Ends the chat: the mic closes, the reply stops, the conversation is kept for the next start */
  stop(): void {
    this.abort?.abort();
    this.llm.interrupt();
    this.voice.cancel(`turn_${this.turn}`);
    this.turn++;
    this.audio.stopAllPlaybackImmediately();
    this.audio.stopMicrophoneCapture();
    this.setState('idle');
  }

  private async takeTurn(samples16k: Float32Array): Promise<void> {
    const turn = ++this.turn;
    this.setState('thinking');
    try {
      const heard = (await this.stt.transcribe(samples16k, 16000, 'en')).text.trim();
      if (turn !== this.turn) return;
      if (!/[A-Za-z0-9]/.test(heard)) {
        this.setState('listening');
        return;
      }
      console.info(`[voice] heard: ${heard}`);
      this.history.push({ role: 'user', content: heard });
      const reply = await this.answer(turn);
      if (turn !== this.turn) return;
      if (reply) this.history.push({ role: 'assistant', content: reply });
      else this.history.pop(); // nothing said: the turn didn't happen
      this.setState('listening');
    } catch (err) {
      if (turn !== this.turn) return;
      console.error('[voice] turn failed', err);
      this.history.splice(this.history.length - 1, this.history[this.history.length - 1]?.role === 'user' ? 1 : 0);
      this.setState('listening');
    }
  }

  /** Streams the reply into speech, a sentence at a time; returns what was said */
  private async answer(turn: number): Promise<string> {
    this.abort = new AbortController();
    const segmenter = new IncrementalPhraseSegmenter();
    const sentences: string[] = [];
    let text = '';
    const speaking = this.speakStream(sentences, turn);
    const wake = speaking.wake;
    for await (const piece of this.llm.reply(this.prompt(), this.abort.signal)) {
      if (turn !== this.turn) break;
      text += piece;
      sentences.push(...segmenter.push(piece));
      wake();
    }
    sentences.push(...segmenter.flush());
    speaking.close();
    await speaking.done;
    console.info(`[voice] said: ${text.trim()}`);
    return text.trim();
  }

  /** The system prompt and as much recent conversation as the context holds, with room for the reply */
  private prompt(): ChatMessage[] {
    let room = this.llm.contextLimit - MAX_REPLY_TOKENS - roughTokens(SYSTEM_PROMPT) - 64;
    const kept: ChatMessage[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
      room -= roughTokens(this.history[i].content);
      if (room < 0 && kept.length > 0) break;
      kept.unshift(this.history[i]);
    }
    // The chat template wants the user first after the system prompt
    while (kept.length > 1 && kept[0].role === 'assistant') kept.shift();
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
        playing.push(this.audio.schedulePcmPlayback(padded, speech.sampleRate));
      }
      await Promise.all(playing);
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

  private setState(state: VoiceState, detail?: string): void {
    this.state = state;
    this.events.onState?.(state, detail);
  }
}
