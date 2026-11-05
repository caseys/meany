// The library: recent chats, kept in this browser (newest first, at most MAX_CHATS). Each has what
// was said and a one-sentence summary, written by the chat model when the chat stops (until then, or
// without the model, the start of what the user said stands in). Storage can be missing or full:
// then the library just isn't kept.

import type { ChatMessage } from '../runtimes/llm.ts';

export interface SavedChat {
  id: string;
  /** When it started and when it was last talked in (ms since 1970) */
  startedAt: number;
  updatedAt: number;
  /** The model's summary, or '' until there is one */
  summary: string;
  messages: ChatMessage[];
}

const KEY = 'meany.library';
export const MAX_CHATS = 30;
/** Messages kept per chat (the latest ones) */
const MAX_MESSAGES = 200;

export function loadLibrary(): SavedChat[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages)) : [];
  } catch {
    return [];
  }
}

function store(chats: SavedChat[]): void {
  // Too big for storage: the oldest go until it fits
  for (let keep = chats.length; keep > 0; keep--) {
    try {
      localStorage.setItem(KEY, JSON.stringify(chats.slice(0, keep)));
      return;
    } catch {
      // Try with fewer
    }
  }
}

/** Saves a chat (new, or an update of one with its id) at the top of the library; returns the library */
export function saveChat(chat: SavedChat): SavedChat[] {
  const record = { ...chat, messages: chat.messages.slice(-MAX_MESSAGES) };
  const chats = [record, ...loadLibrary().filter((c) => c.id !== chat.id)].slice(0, MAX_CHATS);
  store(chats);
  return chats;
}

/** Sets a saved chat's summary, if the chat is still there (and still has those messages) */
export function setSummary(id: string, summary: string, messageCount: number): SavedChat[] {
  const chats = loadLibrary();
  const chat = chats.find((c) => c.id === id);
  if (chat && summary && chat.messages.length === Math.min(messageCount, MAX_MESSAGES)) {
    chat.summary = summary;
    store(chats);
  }
  return chats;
}

export function deleteChat(id: string): SavedChat[] {
  const chats = loadLibrary().filter((c) => c.id !== id);
  store(chats);
  return chats;
}

export const newChatId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** What describes a chat in the list: its summary, or the start of what the user said */
export function describe(chat: SavedChat): string {
  if (chat.summary) return chat.summary;
  const first = chat.messages.find((m) => m.role === 'user')?.content.trim() ?? '';
  if (!first) return 'No conversation yet';
  return `You said: "${first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first}"`;
}