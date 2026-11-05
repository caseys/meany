// The page: one button, and the two waveforms (the bot's voice above, the mic below) once the
// chat is on. The ring around the button shows the first load, then spins while the bot thinks.

import './style.css';
import { FluidAudioVisualizer } from './audio/visualizer.ts';
import { VoiceChat, type VoiceState } from './engine.ts';
import type { Route } from './runtimes/llm.ts';
import type { VoiceGender } from './runtimes/piper.ts';
import { TONES, toTone } from './runtimes/tone.ts';
import { loadSettings, saveSettings } from './core/settings.ts';

const button = document.getElementById('start') as HTMLButtonElement;
const ring = button.querySelector('.ring circle') as SVGCircleElement;
const note = document.getElementById('note') as HTMLParagraphElement;
const emojiEl = document.getElementById('emoji') as HTMLDivElement;
const routeEl = document.getElementById('route') as HTMLSpanElement;
const voiceInputs = [...document.querySelectorAll<HTMLInputElement>('#settings input[name="voice"]')];
/** The badge on the button while a turn is answered after a plan or a lookup */
const ROUTE_BADGE: Record<string, string> = { think: '💭', search: '🔎' };
const RING_LENGTH = 351.9;
(document.getElementById('version') as HTMLParagraphElement).textContent = `v${__APP_VERSION__}`;

const waveOut = new FluidAudioVisualizer(document.getElementById('wave-out') as HTMLCanvasElement, {
  barCount: 24,
  gain: 1.25, // the voice reads quieter than the mic
  gradientColors: ['#34d399', '#10b981', '#06b6d4'],
  glowColor: 'rgba(52, 211, 153, 0.45)',
});
const waveIn = new FluidAudioVisualizer(document.getElementById('wave-in') as HTMLCanvasElement, {
  barCount: 24,
  gradientColors: ['#38bdf8', '#3b82f6', '#6366f1'],
  glowColor: 'rgba(56, 189, 248, 0.45)',
});

/** The status line: a few words on what the chat is doing, and how this turn is being answered */
const ROUTE_NOTE: Record<Route, string> = {
  wait: 'Listening · waiting for you to finish',
  answer: 'Quick answer',
  think: 'Thinking it through',
  search: 'Looking it up',
};
let route: Route | null = null;
let shownState: VoiceState = 'idle';
let errorDetail = '';
function renderNote(): void {
  if (shownState === 'error') note.textContent = `Couldn't start: ${errorDetail || 'unknown error'}`;
  else if (shownState === 'loading') note.textContent = 'Getting ready…';
  else if (shownState === 'listening') note.textContent = route === 'wait' ? ROUTE_NOTE.wait : 'Listening';
  else if (shownState === 'thinking' || shownState === 'speaking') note.textContent = route && route !== 'wait' ? ROUTE_NOTE[route] : '';
  else note.textContent = errorDetail;
}

const chat = new VoiceChat({
  onState: (state, detail) => {
    document.body.className = state === 'idle' || state === 'error' ? state : `on ${state}`;
    // The voice is picked between chats (a new one loads on the next start); the tone, any time
    for (const input of voiceInputs) input.disabled = state !== 'idle' && state !== 'error';
    button.setAttribute('aria-label', state === 'idle' || state === 'error' ? 'Start talking' : 'Stop');
    if (state === 'listening' || state === 'idle') {
      routeEl.classList.remove('shown');
      // A new turn of the user's: how it will be answered isn't known yet
      route = null;
    }
    shownState = state;
    errorDetail = detail ?? '';
    renderNote();
  },
  onRoute: (decided) => {
    route = decided;
    renderNote();
    const badge = ROUTE_BADGE[decided];
    if (badge) routeEl.textContent = badge;
    routeEl.classList.toggle('shown', !!badge);
  },
  onEmoji: (emoji) => {
    emojiEl.classList.remove('shown');
    if (!emoji) return;
    // (a frame apart, so a new emoji pops in again)
    requestAnimationFrame(() => {
      emojiEl.textContent = emoji;
      emojiEl.classList.add('shown');
    });
  },
  onProgress: (fraction) => {
    ring.style.strokeDashoffset = String(RING_LENGTH * (1 - fraction));
  },
});

// Settings: the voice (female or male) and the tone (see runtimes/tone.ts), kept between visits
const settings = loadSettings();
const settingsEl = document.getElementById('settings') as HTMLElement;
const toneInput = document.getElementById('tone') as HTMLInputElement;
const toneName = document.getElementById('tone-name') as HTMLElement;
const toneBlurb = document.getElementById('tone-blurb') as HTMLElement;
function showTone(): void {
  const { name, blurb } = TONES[settings.tone];
  toneInput.value = String(settings.tone);
  toneInput.setAttribute('aria-valuetext', `${name}: ${blurb}`);
  toneName.textContent = name;
  toneBlurb.textContent = blurb;
  settingsEl.dataset.tone = String(settings.tone);
}
for (const input of voiceInputs) {
  input.checked = input.value === settings.voice;
  input.addEventListener('change', () => {
    if (!input.checked) return;
    settings.voice = input.value as VoiceGender;
    chat.setVoice(settings.voice);
    saveSettings(settings);
  });
}
toneInput.addEventListener('input', () => {
  settings.tone = toTone(toneInput.value);
  chat.setTone(settings.tone);
  showTone();
  saveSettings(settings);
});
chat.setVoice(settings.voice);
chat.setTone(settings.tone);
showTone();

button.addEventListener('click', () => {
  if (chat.state === 'idle' || chat.state === 'error') void chat.start();
  else chat.stop();
});

// The waves, drawn only while the chat is on and the page is visible
const inPcm = new Float32Array(128);
const outPcm = new Float32Array(128);
let frame: number | null = null;
const draw = () => {
  frame = null;
  if (document.hidden || chat.state === 'idle' || chat.state === 'error') return;
  waveOut.render(outPcm, chat.audio.getOutputWaveformData(outPcm), chat.state === 'speaking');
  waveIn.render(inPcm, chat.audio.getInputWaveformData(inPcm), chat.state === 'listening');
  frame = requestAnimationFrame(draw);
};
new MutationObserver(() => {
  if (frame === null) frame = requestAnimationFrame(draw);
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && frame === null) frame = requestAnimationFrame(draw);
});

// Dev builds, or ?debug: the chat and a resampler on window, for driving a turn without a mic
if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) {
  void import('./audio/audio-subsystem.ts').then(({ resampleTo16kHzMono }) => {
    Object.assign(window, { __voice: chat, __resample: resampleTo16kHzMono });
  });
}
