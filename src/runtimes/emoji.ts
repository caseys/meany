// An emoji for each reply, shown large above the bot's wave: the first one the model wrote itself.
// The prompt asks for none and they're never spoken, but a small model writes them now and then.

/** The first emoji in a reply, or null */
export function emojiFor(text: string): string | null {
  return text.match(/\p{Extended_Pictographic}(?:\u{FE0F})?/u)?.[0] ?? null;
}
