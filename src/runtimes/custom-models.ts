/**
 * The one model: Qwen3 0.6B with an English + JavaScript vocabulary (75,981 of its 151,936 tokens,
 * the rest almost all other scripts), cut from WebLLM's own q4f16_1 weights (335 → 292 MB), so it
 * is the same model on what it keeps. Built in Chatty (runtimes/custom-models.ts there) and hosted
 * in its R2 bucket, with its own WebGPU library: 512-token prefill chunk, 32 MB starting
 * WebAssembly memory.
 */

/** Where the converted weights are served from (a public R2 bucket) */
export const CUSTOM_MODEL_HOST = 'https://pub-2f0eea461d774d24861d400d343458bf.r2.dev';

export const MODEL_ID = 'Qwen3-0.6B-EN-q4f16_1-MLC';
/** The WebLLM model it was cut from, whose record (chat template, settings) it starts from */
const BASE_ID = 'Qwen3-0.6B-q4f16_1-MLC';
const MODEL_LIB = 'Qwen3-0.6B-EN-q4f16_1-webgpu.wasm';

/** WebLLM's record for it, from the base model's record */
export function customModelRecords<R extends { model: string; model_id: string; model_lib: string }>(prebuilt: ReadonlyArray<R>): R[] {
  const base = prebuilt.find((record) => record.model_id === BASE_ID);
  if (!base) return [];
  const folder = `${CUSTOM_MODEL_HOST}/${MODEL_ID}/`;
  return [{ ...base, model_id: MODEL_ID, model: folder, model_lib: folder + MODEL_LIB }];
}
