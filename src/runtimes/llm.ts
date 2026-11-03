// ============================================================================
// The model, on WebGPU in a worker (workers/webllm.worker.ts). WebLLM loads weights in small
// shards straight onto the GPU, so peak memory while loading stays near the model's own size,
// which is what lets it load in mobile Safari. Downloads are kept in Cache Storage. The page never
// imports WebLLM (6 MB): it talks to the worker through WebLlmClient.
//
// Ported from Chatty's webllm-provider.ts, keeping its iPhone lessons (paced loading, a breath
// after the load, repair of a broken download) and leaving out its grammars: a spoken reply needs
// none, and without them WebLLM never starts its grammar engine.
// ============================================================================

import { isAppleMobile } from '../core/device.ts';
import { AFTER_LOAD_MS, settleOnIos } from '../core/settle.ts';
import { contextWindowFor, currentDevice, kvBytesPerToken, modelMaxContext, readModelConfig, workingMemoryBudget } from './context-size.ts';
import { MODEL_ID } from './custom-models.ts';
import type { WebLlmChatRequest } from '../workers/webllm-protocol.ts';
import { WebLlmClient } from './webllm-client.ts';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** About what the first load downloads, for the bar before WebLLM reports its own */
const MODEL_BYTES = 320_000_000;
/** The most context asked for: a voice chat's turns are short */
const CONTEXT_CAP = 4096;
/** A spoken reply is a few sentences; this stops one that runs on */
export const MAX_REPLY_TOKENS = 256;
/** How long the worker pauses before each weight piece on iPhone and iPad (see webllm.worker.ts) */
const IOS_LOAD_PACE_MS = 80;
/** Where WebLLM stores downloaded model files (Cache API) */
const WEBLLM_CACHE = 'webllm/model';

/**
 * How replies are sampled. Measured on the roast prompt over 8-turn conversations (2026-11-03):
 * Qwen's own 0.7 / top-p 0.8 kept echoing the prompt from turn to turn ("…such a mean bot!"),
 * 0.5 looped inside replies, and 0.85 / 0.9 alone drifted out of character. Warmer with a light
 * frequency penalty (it grows each time a word repeats in the reply) gave varied openings, no
 * loops, and kept the persona. The presence penalty stays against the loops small models fall
 * into; the cut vocabulary keeps it from drifting into another language.
 */
const SAMPLING = { temperature: 0.85, top_p: 0.9, presence_penalty: 1.0, frequency_penalty: 0.3 };

/**
 * The reply with any leading <think>...</think> block removed, or null while that block is
 * still being written (nothing should be said yet).
 */
export function withoutThinking(raw: string): string | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('<think>')) {
    // Could still become "<think>" once more characters arrive
    return '<think>'.startsWith(trimmed) && trimmed.length > 0 ? null : raw;
  }
  const end = trimmed.indexOf('</think>');
  return end === -1 ? null : trimmed.slice(end + '</think>'.length).trimStart();
}

/** The base URL of a model's files as WebLLM fetches and stores them */
const modelFilesUrl = (model: string) => `${model.replace(/\/+$/, '')}/resolve/main/`;

/**
 * Deletes the stored pieces of a model whose size doesn't match its index (tensor-cache.json), so
 * only those are downloaded again. Returns how many were deleted (an unreadable index counts).
 */
async function dropBrokenPieces(cache: Cache, baseUrl: string): Promise<number> {
  const indexUrl = `${baseUrl}tensor-cache.json`;
  const index = await cache.match(indexUrl);
  if (!index) return 0;
  let records: Array<{ dataPath: string; nbytes: number }>;
  try {
    records = (await index.json()).records ?? [];
  } catch {
    await cache.delete(indexUrl);
    return 1;
  }
  let dropped = 0;
  for (const { dataPath, nbytes } of records) {
    const url = baseUrl + dataPath;
    const stored = await cache.match(url);
    if (!stored) continue; // not downloaded yet
    // The header tells the size without reading the piece (tens of MB) into memory
    const length = Number(stored.headers.get('content-length'));
    const size = length > 0 ? length : (await stored.blob()).size;
    if (size !== nbytes) {
      await cache.delete(url);
      dropped++;
    }
  }
  return dropped;
}

/**
 * Where a WebLLM load report puts the bar, as a fraction of the whole load, or null for a report
 * that doesn't move it: the download up to 60%, the weights up to 85% (from 0 when they were all
 * stored already), the shaders up to 98%; the rest once the model is ready.
 */
function loadFraction(text: string, progress: number, downloaded: boolean): number | null {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (/^Fetching param cache/i.test(text)) return p * 0.6;
  if (/^Loading model from cache/i.test(text)) {
    const from = downloaded ? 0.6 : 0;
    return from + p * (0.85 - from);
  }
  if (/^Loading GPU shader modules/i.test(text)) return 0.85 + p * 0.13;
  if (/^Finish loading/i.test(text)) return 0.98;
  return null;
}

/** A load error from a broken stored copy ("Tensor-cache record range [0, 393216) exceeds shard size 0") */
const isBrokenCacheError = (err: unknown): boolean =>
  /exceeds shard size|(?:tensor|ndarray)-cache record/i.test(err instanceof Error ? err.message : String(err));

export class VoiceLlm {
  /** Tokens the model can hold: what this device's memory budget allows (see context-size.ts) */
  contextLimit = CONTEXT_CAP;
  private client: WebLlmClient | null = null;
  private ready: Promise<void> | null = null;

  /** Loads the model (downloading what isn't stored); onProgress gets 0..1 */
  load(onProgress?: (fraction: number) => void): Promise<void> {
    this.ready ??= this.loadOnce(onProgress).catch((err) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  private async loadOnce(onProgress?: (fraction: number) => void): Promise<void> {
    let client = this.open();
    const modelUrl = await client.modelUrl(MODEL_ID);
    await this.sizeContext(modelUrl);
    try {
      await this.loadInto(client, onProgress);
    } catch (err) {
      // A broken stored copy (a piece left by a download that stopped) fails the same way every
      // time: the pieces whose size doesn't match are deleted, so only those download again
      client.terminate();
      if (!isBrokenCacheError(err)) throw err;
      client = this.open();
      const dropped = modelUrl && typeof caches !== 'undefined' ? await dropBrokenPieces(await caches.open(WEBLLM_CACHE), modelFilesUrl(modelUrl)).catch(() => 0) : 0;
      if (dropped === 0) await client.deleteCache(MODEL_ID).catch(() => {});
      await this.loadInto(client, onProgress);
    }
    // A breath on iPhone before the first run, which commits the GPU memory
    await settleOnIos(AFTER_LOAD_MS);
    await client.warmUp({ messages: [{ role: 'user', content: 'Hi' }], ...SAMPLING, max_tokens: 1, extra_body: { enable_thinking: false } });
    onProgress?.(1);
  }

  private open(): WebLlmClient {
    this.client?.terminate();
    const client = new WebLlmClient(new Worker(new URL('../workers/webllm.worker.ts', import.meta.url), { type: 'module' }));
    // iPhone Safari gets pauses between the load's heavy steps (the worker reads this first)
    client.pace(isAppleMobile() ? IOS_LOAD_PACE_MS : 0);
    this.client = client;
    return client;
  }

  /** The context this device can hold: the KV cache's cost per token against its memory budget */
  private async sizeContext(modelUrl: string | undefined): Promise<void> {
    const config = modelUrl ? await readModelConfig(`${modelFilesUrl(modelUrl)}mlc-chat-config.json`) : null;
    const perToken = kvBytesPerToken(config);
    const budget = workingMemoryBudget(currentDevice());
    this.contextLimit = contextWindowFor(perToken, budget, CONTEXT_CAP, modelMaxContext(config));
    if (perToken) console.info(`[llm] ${this.contextLimit}-token context, ${((perToken * this.contextLimit) / 2 ** 20).toFixed(0)} MB of KV cache`);
  }

  private async loadInto(client: WebLlmClient, onProgress?: (fraction: number) => void): Promise<void> {
    // The bar only moves forward, through every step
    let downloaded = false;
    let shown = 0;
    onProgress?.(0);
    await client.load(MODEL_ID, this.contextLimit, (text, progress) => {
      if (/^Fetching param cache/i.test(text)) downloaded = true;
      const at = loadFraction(text, progress, downloaded);
      if (at === null || at <= shown) return;
      shown = at;
      onProgress?.(at);
    });
  }

  /** The reply to the conversation, piece by piece as it is written (thinking left out) */
  async *reply(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string, void> {
    await this.load();
    const client = this.client!;
    const request: WebLlmChatRequest = { messages, ...SAMPLING, max_tokens: MAX_REPLY_TOKENS, extra_body: { enable_thinking: false } };
    const onAbort = () => client.interrupt();
    signal?.addEventListener('abort', onAbort, { once: true });
    let raw = '';
    let said = 0;
    try {
      for await (const delta of client.stream(request)) {
        raw += delta;
        const visible = withoutThinking(raw);
        if (visible === null || visible.length <= said) continue;
        yield visible.slice(said);
        said = visible.length;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * One random insult to say out loud, written with no conversation, on `theme` when given (the
   * chat opens with one on "intro message"). Sampled a little hotter than replies, so it differs each time.
   */
  async insult(theme?: string): Promise<string> {
    await this.load();
    const { text } = await this.client!.complete({
      messages: [
        { role: 'system', content: INSULT_PROMPT },
        { role: 'user', content: theme ? `Theme: ${theme}` : 'Any theme.' },
      ],
      // (at 1.0 the model drifts into word salad; 0.8 keeps it coherent and still different each time)
      temperature: 0.8,
      top_p: 0.9,
      presence_penalty: 1.0,
      max_tokens: 60,
      extra_body: { enable_thinking: false },
    });
    return (withoutThinking(text) ?? '').trim().replace(/^["'“]+|["'”]+$/g, '');
  }

  /** A short plan for answering a request, written with no conversation (only the request) */
  async plan(request: string): Promise<string> {
    await this.load();
    const { text } = await this.client!.complete({
      messages: [
        { role: 'system', content: PLAN_PROMPT },
        { role: 'user', content: request },
      ],
      ...SAMPLING,
      max_tokens: 80,
      extra_body: { enable_thinking: false },
    });
    return (withoutThinking(text) ?? '').trim();
  }

  /** Stops the reply being written */
  interrupt(): void {
    this.client?.interrupt();
  }
}

/** How a turn is answered: wait (not yet), at once, after a short plan, or from Wikipedia */
export type Route = 'wait' | 'answer' | 'think' | 'search';

const INSULT_PROMPT =
  'Write one short, savage, derogatory roast of the person you are talking to, vulgar and personal, to say out loud. One or two sentences, no formatting, nothing else.';

const PLAN_PROMPT = [
  'Plan a brutal, derogatory roast of the user that also answers their request: two to four brief steps on one line.',
  'Do not write the roast yourself.',
].join('\n');

/** Rough token count of a text (English: about 4 characters a token) */
export const roughTokens = (text: string): number => Math.ceil(text.length / 4) + 4;
