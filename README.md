# Chatty Voice

A voice-only chat that runs entirely in the browser: tap the button and talk.

- **Ears:** Whistle (Cactus), on WebAssembly, after a simple speech detector hears you stop.
- **Brain:** Qwen3 0.6B EN on WebGPU via WebLLM: Qwen3 0.6B with its vocabulary cut to English and JavaScript (75,981 of 151,936 tokens), built in Chatty.
- **Voice:** Piper (`en_US-hfc_female-medium`) in a worker, a sentence at a time, each synthesized while the one before it plays.

The bot isn't interrupted: while it thinks or speaks, the mic is ignored. Models load one at a time on the first tap and are cached after that.

Started from Chatty (`~/src/chatty`, commit `e18a21c`): the audio subsystem, Whistle and Piper providers, WebLLM worker and context sizing are copied from there.

```bash
npm install
npm run dev
```

Deploy with `scripts/deploy.sh` to https://www.mudberry.com/chatty-voice/. The page needs cross-origin isolation (COOP `same-origin`, COEP `credentialless`), so nginx serves `/chatty-voice/` like `/chatty/`. Add `?debug` to the URL to get `window.__voice` in the console.
