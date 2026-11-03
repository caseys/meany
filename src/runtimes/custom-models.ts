/**
 * Our models, hosted in Chatty's R2 bucket, each cut from WebLLM's own q4f16_1 build by keeping only
 * some of its vocabulary (the embedding rows cut byte for byte, so on what it keeps it is the same
 * model) and run on its own WebGPU library (512-token prefill chunk, 32 MB starting WebAssembly
 * memory):
 *
 * - Qwen3.5 0.8B EN (the one used): spoken English only. 55,875 of 248,070 tokens: the 30,000
 *   commonest English words (wordfreq), acronyms, every bad word (LDNOOBW), punctuation and
 *   numbers. Weights 424 → 313 MB; 6 of its 24 layers keep a KV cache (about 50 KB a token).
 *   Its chat template's stop ids, Qwen3's in WebLLM's copy, point at its own end tokens.
 * - Qwen3 0.6B EN: English and JavaScript, 75,981 of 151,936 tokens, weights 335 → 292 MB.
 */

/** Where the converted weights are served from (a public R2 bucket) */
export const CUSTOM_MODEL_HOST = 'https://pub-2f0eea461d774d24861d400d343458bf.r2.dev';

const MODELS = [
  { id: 'Qwen3.5-0.8B-EN-q4f16_1-MLC', base: 'Qwen3.5-0.8B-q4f16_1-MLC', lib: 'Qwen3.5-0.8B-EN-q4f16_1-webgpu.wasm' },
  { id: 'Qwen3-0.6B-EN-q4f16_1-MLC', base: 'Qwen3-0.6B-q4f16_1-MLC', lib: 'Qwen3-0.6B-EN-q4f16_1-webgpu.wasm' },
];

/** The model the chat uses */
export const MODEL_ID = MODELS[0].id;

/** WebLLM's records for them, from their base models' records (chat template, settings) */
export function customModelRecords<R extends { model: string; model_id: string; model_lib: string }>(prebuilt: ReadonlyArray<R>): R[] {
  return MODELS.flatMap(({ id, base, lib }) => {
    const record = prebuilt.find((r) => r.model_id === base);
    const folder = `${CUSTOM_MODEL_HOST}/${id}/`;
    return record ? [{ ...record, model_id: id, model: folder, model_lib: folder + lib }] : [];
  });
}
