// ============================================================================
// Piper, the voice, in a worker (workers/tts.worker.ts): a sentence in, its samples out (moved,
// not copied). Ported from Chatty's WorkerTtsProvider, without its fallbacks to the page.
// ============================================================================

import type { WorkerRequestMessage, WorkerResponseMessage } from '../types/index.ts';

export const VOICE_ID = 'en_US-hfc_female-medium';

export interface Speech {
  samples: Float32Array;
  sampleRate: number;
}

export class PiperVoice {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 0;
  private readonly waiting = new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void; onProgress?: (loaded: number, total: number) => void }>();

  /** Loads the voice (downloading it the first time); onProgress gets 0..1 */
  load(onProgress?: (fraction: number) => void): Promise<void> {
    this.ready ??= this.ask<void>('init', 'init', { voiceId: VOICE_ID }, (loaded, total) => total > 0 && onProgress?.(loaded / total)).catch((err) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  /** One sentence spoken */
  async synthesize(text: string, turnId: string): Promise<Speech> {
    await this.load();
    const result = await this.ask<{ samples: Float32Array; sampleRate: number }>('synthesize', turnId, { text });
    return { samples: result.samples, sampleRate: result.sampleRate };
  }

  /** Drops what a turn still has waiting */
  cancel(turnId: string): void {
    this.worker?.postMessage({ requestId: `cancel_${++this.nextId}`, turnId, sequence: 0, type: 'cancel', payload: { turnId }, timestamp: performance.now() } satisfies WorkerRequestMessage);
  }

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponseMessage<any>>) => {
      const data = event.data;
      const entry = data && this.waiting.get(data.requestId);
      if (!entry) return;
      if (data.type === 'progress') entry.onProgress?.(data.payload.loaded, data.payload.total);
      else if (data.type === 'error') {
        this.waiting.delete(data.requestId);
        entry.reject(new Error(data.error ?? 'Piper failed'));
      } else if (data.type === 'initialized' || data.type === 'audio_chunk' || data.type === 'canceled') {
        this.waiting.delete(data.requestId);
        entry.resolve(data.payload);
      }
    };
    // A crashed worker fails what it had, and the next call starts a fresh one
    worker.onerror = () => {
      for (const entry of this.waiting.values()) entry.reject(new Error('Piper worker crashed'));
      this.waiting.clear();
      worker.terminate();
      this.worker = null;
      this.ready = null;
    };
    this.worker = worker;
    return worker;
  }

  private ask<T>(type: string, turnId: string, payload: unknown, onProgress?: (loaded: number, total: number) => void): Promise<T> {
    const worker = this.open();
    const requestId = `${type}_${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({ requestId, turnId, sequence: this.nextId, type, payload, timestamp: performance.now() } satisfies WorkerRequestMessage);
    });
  }
}
