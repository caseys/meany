// ============================================================================
// Dedicated TTS Synthesis Web Worker
// Runs Piper ONNX Runtime Web off the main thread and transfers PCM ArrayBuffers
// back to the main thread with zero copy.
// ============================================================================

import { HF_BASE, PATH_MAP } from '@realtimex/piper-tts-web';
import type { WorkerRequestMessage, WorkerResponseMessage } from '../types/index.ts';
import { PiperTtsProvider } from '../runtimes/tts-provider.ts';
import { CUSTOM_MODEL_HOST } from '../runtimes/custom-models.ts';
import { CUSTOM_VOICES, SPEED, VOICE_ID } from '../runtimes/piper.ts';

// Voices piper-tts-web doesn't list, hosted in our R2 bucket: each gets a place in its list of
// voice paths (it only knows its own Hugging Face mirror), and this worker's fetches of that place
// go to R2. The library still keeps the downloaded files under their names in its OPFS cache.
const customPrefix = `${HF_BASE}/custom/`;
for (const voice of CUSTOM_VOICES) (PATH_MAP as Record<string, string>)[voice] = `custom/${voice}.onnx`;
const fetchFromHost = self.fetch.bind(self);
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(customPrefix)) return fetchFromHost(input, init);
  const response = await fetchFromHost(`${CUSTOM_MODEL_HOST}/piper/${url.slice(customPrefix.length)}`, init);
  if (!url.endsWith('.onnx.json') || !response.ok) return response;
  // The voice's config, with its speaking rate set here (length_scale is 1 / speed)
  const config = await response.json();
  config.inference = { ...config.inference, length_scale: +(1 / SPEED).toFixed(3) };
  return new Response(JSON.stringify(config), { headers: { 'Content-Type': 'application/json' } });
};

/**
 * The library keeps a voice's config in OPFS after its first download, so a speed set here would
 * never reach a device that has it: the config (7 KB) is dropped before the voice loads, and
 * fetched (and set) again. The model itself stays stored.
 */
async function dropStoredConfig(voiceId: string): Promise<void> {
  if (!CUSTOM_VOICES.includes(voiceId)) return;
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('piper');
    await dir.removeEntry(`${voiceId}.onnx.json`);
  } catch {
    // Not stored yet
  }
}

let ttsProvider = new PiperTtsProvider(VOICE_ID);
const activeControllers = new Map<string, AbortController>();

self.onmessage = async (event: MessageEvent<WorkerRequestMessage<any>>) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  const { requestId, turnId, sequence, type, payload } = msg;

  const reply = (resType: string, resPayload: unknown, transfer?: Transferable[], error?: string) => {
    const response: WorkerResponseMessage = {
      requestId,
      turnId,
      sequence,
      type: resType,
      payload: resPayload,
      error,
      timestamp: performance.now(),
    };
    if (transfer && transfer.length > 0) {
      (self as unknown as Worker).postMessage(response, transfer);
    } else {
      self.postMessage(response);
    }
  };

  try {
    switch (type) {
      case 'init': {
        const voiceId = payload?.voiceId ?? 'en_US-hfc_female-medium';
        if (ttsProvider.voiceId !== voiceId) {
          await ttsProvider.dispose();
          ttsProvider = new PiperTtsProvider(voiceId);
        }
        await dropStoredConfig(voiceId);
        await ttsProvider.initialize((loaded, total) => {
          reply('progress', { loaded, total, voiceId });
        });
        reply('initialized', { voiceId });
        break;
      }

      case 'synthesize': {
        const controller = new AbortController();
        activeControllers.set(turnId, controller);
        try {
          const result = await ttsProvider.synthesize(
            payload.text,
            turnId,
            sequence,
            controller.signal
          );
          // Transfer the underlying ArrayBuffer to avoid copying PCM audio
          reply('audio_chunk', result, [result.samples.buffer]);
        } finally {
          activeControllers.delete(turnId);
        }
        break;
      }

      case 'cancel': {
        const targetTurnId = payload?.turnId ?? turnId;
        const ctrl = activeControllers.get(targetTurnId);
        if (ctrl) {
          ctrl.abort();
          activeControllers.delete(targetTurnId);
        }
        ttsProvider.cancel(targetTurnId);
        reply('canceled', { turnId: targetTurnId });
        break;
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    reply('error', null, undefined, errorMsg);
  }
};
