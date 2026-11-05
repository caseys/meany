// The user's settings (voice and tone), kept in this browser between visits. Storage can be missing
// or throw (private modes, some embedded views): then the defaults are used and nothing is kept.

import { DEFAULT_VOICE, type VoiceGender } from '../runtimes/piper.ts';
import { DEFAULT_TONE, toTone, type ToneLevel } from '../runtimes/tone.ts';

export interface Settings {
  voice: VoiceGender;
  tone: ToneLevel;
}

const KEY = 'meany.settings';

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Settings, unknown>>;
    return {
      voice: saved.voice === 'female' || saved.voice === 'male' ? saved.voice : DEFAULT_VOICE,
      tone: saved.tone === undefined ? DEFAULT_TONE : toTone(saved.tone),
    };
  } catch {
    return { voice: DEFAULT_VOICE, tone: DEFAULT_TONE };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not kept
  }
}