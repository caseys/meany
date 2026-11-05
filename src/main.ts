// The page: a Start button that says what the chat is doing (Listening, Thinking, Speaking) while
// it's on, and the two waveforms (the bot's voice above, the mic below). The button fills up during
// the first load. Below it, the settings: the voice and the attitude.

import './style.css';
import { FluidAudioVisualizer } from './audio/visualizer.ts';
import { VoiceChat, type VoiceState } from './engine.ts';
import type { Route } from './runtimes/llm.ts';
import type { VoiceGender } from './runtimes/piper.ts';
import { TONES, toTone } from './runtimes/tone.ts';
import { loadSettings, saveSettings } from './core/settings.ts';
import { deleteChat, describe, loadLibrary, newChatId, saveChat, setSummary, type SavedChat } from './core/library.ts';

const button = document.getElementById('start') as HTMLButtonElement;
const buttonLabel = document.getElementById('start-label') as HTMLSpanElement;
const hint = document.getElementById('hint') as HTMLParagraphElement;
const note = document.getElementById('note') as HTMLParagraphElement;
const emojiEl = document.getElementById('emoji') as HTMLDivElement;
const routeEl = document.getElementById('route') as HTMLSpanElement;
const voiceInputs = [...document.querySelectorAll<HTMLInputElement>('#settings input[name="voice"]')];
/** The badge on the button while a turn is answered after a plan or a lookup */
const ROUTE_BADGE: Record<string, string> = { think: '💭', search: '🔎' };
/** What the button says in each state */
const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Start',
  error: 'Try again',
  loading: 'Getting ready…',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};
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
  else if (shownState === 'loading') note.textContent = 'The first start downloads the voice and language models, which can take a minute.';
  else if (shownState === 'listening') note.textContent = route === 'wait' ? ROUTE_NOTE.wait : '';
  else if (shownState === 'thinking' || shownState === 'speaking') note.textContent = route && route !== 'wait' ? ROUTE_NOTE[route] : '';
  else note.textContent = errorDetail;
}

const chat = new VoiceChat({
  onState: (state, detail) => {
    document.body.className = state === 'idle' || state === 'error' ? state : `on ${state}`;
    // The voice is picked between chats (a new one loads on the next start); the tone, any time
    for (const input of voiceInputs) input.disabled = state !== 'idle' && state !== 'error';
    const on = state !== 'idle' && state !== 'error';
    buttonLabel.textContent = STATE_LABEL[state];
    button.setAttribute('aria-label', on ? `${STATE_LABEL[state]}. Tap to stop.` : STATE_LABEL[state]);
    hint.textContent = on ? 'Tap the button to stop' : 'Your microphone is used only while the chat is on';
    if (state === 'listening' || state === 'idle') {
      routeEl.classList.remove('shown');
      // A new turn of the user's: how it will be answered isn't known yet
      route = null;
    }
    shownState = state;
    errorDetail = detail ?? '';
    renderNote();
    // A chat that stops is saved to the library; while one is on, the library can't change it
    if (wasOn && !on) saveCurrent();
    wasOn = on;
    newChatButton.disabled = on;
    renderLibrary();
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
    button.style.setProperty('--progress', String(fraction));
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

// The library: recent chats, each saved when it stops, with a summary the chat model writes
const libraryToggle = document.getElementById('library-toggle') as HTMLButtonElement;
const libraryPanel = document.getElementById('library') as HTMLElement;
const libraryList = document.getElementById('library-list') as HTMLUListElement;
const libraryCount = document.getElementById('library-count') as HTMLSpanElement;
const newChatButton = document.getElementById('new-chat') as HTMLButtonElement;
const idleMsg = document.getElementById('idle-msg') as HTMLParagraphElement;
const when = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

let library: SavedChat[] = loadLibrary();
/** The conversation the chat is on: a new one, or one picked from the library */
let current = { id: newChatId(), startedAt: Date.now() };
let wasOn = false;
/** The chat whose summary is being written, and the one shown open */
let summarizingId: string | null = null;
let openId: string | null = null;
/** A delete waiting for its second tap */
let confirmingDelete: string | null = null;

function saveCurrent(): void {
  const messages = chat.transcript;
  if (!messages.some((m) => m.role === 'user')) return; // nothing said yet: nothing to keep
  const id = current.id;
  library = saveChat({ id, startedAt: current.startedAt, updatedAt: Date.now(), summary: '', messages });
  summarizingId = id;
  renderLibrary();
  void chat.summarize(messages).then((summary) => {
    if (summarizingId === id) summarizingId = null;
    library = summary ? setSummary(id, summary, messages.length) : loadLibrary();
    renderLibrary();
  });
}

function startFresh(note: string): void {
  chat.newConversation();
  current = { id: newChatId(), startedAt: Date.now() };
  idleMsg.textContent = note;
}

function setLibraryOpen(open: boolean): void {
  libraryPanel.hidden = !open;
  libraryToggle.setAttribute('aria-expanded', String(open));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderLibrary(): void {
  libraryCount.textContent = library.length ? String(library.length) : '';
  const idle = chat.state === 'idle' || chat.state === 'error';
  libraryList.replaceChildren(
    ...library.map((saved) => {
      const open = saved.id === openId;
      const item = el('li', open ? 'entry open' : 'entry');

      const head = el('button', 'entry-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      const meta = el('span', 'entry-meta', `${when.format(saved.updatedAt)} · ${saved.messages.length} messages`);
      if (saved.id === current.id) meta.append(el('span', 'badge', 'Current'));
      const pending = !saved.summary && saved.id === summarizingId;
      head.append(meta, el('span', pending ? 'entry-summary pending' : 'entry-summary', pending ? 'Writing a summary…' : describe(saved)));
      head.addEventListener('click', () => {
        openId = open ? null : saved.id;
        confirmingDelete = null;
        renderLibrary();
      });
      item.append(head);

      if (open) {
        const body = el('div', 'entry-body');
        const transcript = el('ol', 'transcript');
        for (const m of saved.messages) {
          const line = el('li', `msg ${m.role}`);
          line.append(el('span', 'who', m.role === 'user' ? 'You' : 'Meany'), el('p', undefined, m.content));
          transcript.append(line);
        }
        const actions = el('div', 'entry-actions');
        const resume = el('button', 'primary', saved.id === current.id ? 'Keep talking' : 'Continue chat');
        resume.type = 'button';
        resume.disabled = !idle;
        resume.title = idle ? '' : 'Stop the chat first';
        resume.addEventListener('click', () => {
          chat.loadConversation(saved.messages);
          current = { id: saved.id, startedAt: saved.startedAt };
          idleMsg.textContent = 'Picked up where you left off. Press Start to keep talking.';
          openId = null;
          setLibraryOpen(false);
          renderLibrary();
        });
        const remove = el('button', confirmingDelete === saved.id ? 'danger confirm' : 'danger', confirmingDelete === saved.id ? 'Tap again to delete' : 'Delete');
        remove.type = 'button';
        remove.disabled = !idle && saved.id === current.id;
        remove.addEventListener('click', () => {
          if (confirmingDelete !== saved.id) {
            confirmingDelete = saved.id;
            renderLibrary();
            return;
          }
          confirmingDelete = null;
          library = deleteChat(saved.id);
          if (saved.id === current.id) startFresh('Press Start, then just talk.');
          openId = null;
          renderLibrary();
        });
        actions.append(resume, remove);
        body.append(transcript, actions);
        item.append(body);
      }
      return item;
    })
  );
}

libraryToggle.addEventListener('click', () => setLibraryOpen(libraryToggle.getAttribute('aria-expanded') !== 'true'));
newChatButton.addEventListener('click', () => {
  if (chat.state !== 'idle' && chat.state !== 'error') return;
  startFresh('New chat. Press Start, then just talk.');
  openId = null;
  renderLibrary();
});
renderLibrary();

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
