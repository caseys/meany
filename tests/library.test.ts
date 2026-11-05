import { beforeEach, describe as group, expect, it, vi } from 'vitest';

// (Node's own localStorage, which stands in for the browser's here, needs a file; this one is in memory)
const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
});
import { deleteChat, describe, loadLibrary, MAX_CHATS, saveChat, setSummary, type SavedChat } from '../src/core/library.ts';

const chat = (id: string, said = 'I work at a bakery', summary = ''): SavedChat => ({
  id,
  startedAt: 1,
  updatedAt: 2,
  summary,
  messages: [
    { role: 'assistant', content: 'Hi! What do you do for work?' },
    { role: 'user', content: said },
  ],
});

beforeEach(() => localStorage.clear());

group('the library', () => {
  it('keeps the newest chat first, and an updated chat moves to the top', () => {
    saveChat(chat('a'));
    saveChat(chat('b'));
    expect(loadLibrary().map((c) => c.id)).toEqual(['b', 'a']);
    saveChat(chat('a', 'Now I bake bread'));
    const chats = loadLibrary();
    expect(chats.map((c) => c.id)).toEqual(['a', 'b']);
    expect(chats[0].messages[1].content).toBe('Now I bake bread');
  });

  it(`keeps at most ${MAX_CHATS} chats`, () => {
    for (let i = 0; i < MAX_CHATS + 5; i++) saveChat(chat(`c${i}`));
    const chats = loadLibrary();
    expect(chats).toHaveLength(MAX_CHATS);
    expect(chats[0].id).toBe(`c${MAX_CHATS + 4}`);
  });

  it('sets a summary only while the chat still has the messages it summarized', () => {
    saveChat(chat('a'));
    expect(setSummary('a', 'Talked about baking.', 2)[0].summary).toBe('Talked about baking.');
    expect(setSummary('a', 'Old summary.', 5)[0].summary).toBe('Talked about baking.');
  });

  it('deletes a chat', () => {
    saveChat(chat('a'));
    saveChat(chat('b'));
    expect(deleteChat('a').map((c) => c.id)).toEqual(['b']);
    expect(loadLibrary().map((c) => c.id)).toEqual(['b']);
  });

  it('survives storage holding something unexpected', () => {
    localStorage.setItem('meany.library', '{not json');
    expect(loadLibrary()).toEqual([]);
  });
});

group('describe', () => {
  it('uses the summary when there is one', () => {
    expect(describe(chat('a', 'hi', 'Talked about baking.'))).toBe('Talked about baking.');
  });

  it('falls back to the start of what they said', () => {
    expect(describe(chat('a'))).toBe('You said: "I work at a bakery"');
    expect(describe(chat('a', 'x'.repeat(200))).length).toBeLessThan(110);
  });
});