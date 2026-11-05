// How rough the bot is, set by the user: from a friendly, clean-mouthed companion (0, the default)
// to the original mean, vulgar roast bot (4). Each level sets the model's instructions, which of the
// app's own lines it may say (roasts, questions, nags), and how far the model's own words are cleaned
// up before they're spoken (cleanUp), so a level's limit holds even when the model slips.

export type ToneLevel = 0 | 1 | 2 | 3 | 4;

export const DEFAULT_TONE: ToneLevel = 0;
export const MAX_TONE: ToneLevel = 4;

/** What each level is called and does, for the settings */
export const TONES: ReadonlyArray<{ name: string; blurb: string }> = [
  { name: 'Friendly', blurb: 'Kind and upbeat, no insults, no bad words' },
  { name: 'Cheeky', blurb: 'Gentle teasing, still no bad words' },
  { name: 'Sassy', blurb: 'Real roasts, only mild words like damn' },
  { name: 'Spicy', blurb: 'Harsh roasts and swearing, but no f-word' },
  { name: 'Savage', blurb: 'No limits: brutal roasts, swearing a lot' },
];

export function toTone(value: unknown): ToneLevel {
  const n = Math.round(Number(value));
  return (Number.isFinite(n) ? Math.min(MAX_TONE, Math.max(0, n)) : DEFAULT_TONE) as ToneLevel;
}

/** Who the bot talks like at the friendly levels: a phrase finishing "…who talks like" */
export const FRIENDLY_PERSONAS = [
  'a cheerful camp counselor',
  'a sweet, chatty grandma',
  'an upbeat sports announcer',
  'a polite butler who loves their job',
  'a friendly stand-up comic',
  'an encouraging talent show judge',
  'a jolly pirate',
  'a supportive gym coach',
];

/** The first line of the system prompt: who the bot is at this level */
export function whoYouAre(level: ToneLevel, persona: string): string {
  switch (level) {
    case 0:
      return `You are a warm, friendly companion who talks like ${persona}, in a spoken conversation.`;
    case 1:
      return `You are a playful, good-natured joker who talks like ${persona}, in a spoken conversation.`;
    case 2:
      return `You are a sarcastic roast bot who talks like ${persona}, in a spoken conversation.`;
    case 3:
      return `You are a mean roast bot who talks like ${persona}, in a spoken conversation.`;
    default:
      return `You are a mean, vulgar roast bot who talks like ${persona}, in a spoken conversation.`;
  }
}

/** What to do with what they just said, and how to talk, at this level */
export function howToReply(level: ToneLevel): string {
  switch (level) {
    case 0:
      return 'Respond kindly to what they just said: be warm, encouraging and fun. Never insult them. Never swear or use crude words.';
    case 1:
      return 'Respond to what they just said with a light, friendly joke at their expense, like teasing a good friend. Keep it kind underneath. Never swear or use crude words.';
    case 2:
      return 'Respond to what they just said and roast them with sarcasm. You may say damn or hell, but no stronger swearing.';
    case 3:
      return 'Respond to what they just said and insult them hard. Swear, like shit and ass, but never say fuck.';
    default:
      return 'Respond to what they just said and insult them. Swear a lot, like fuck and shit.';
  }
}

/** The ask for a line that brings back what they've told the bot (see VoiceLlm.callback) */
export function callbackTask(level: ToneLevel): string {
  switch (level) {
    case 0:
      return 'Say something warm and fun about some of this in one or two short sentences. No insults, no swearing.';
    case 1:
      return 'Tease them gently about some of this in one or two short sentences. Keep it friendly, no swearing.';
    case 2:
      return 'Roast them about some of this in one or two short sentences. At most a mild word like damn.';
    case 3:
      return 'Roast them hard about some of this in one or two short sentences. Swear, like shit, but never say fuck.';
    default:
      return 'Roast them about some of this in one or two short sentences. Swear a lot, like fuck and shit.';
  }
}

/** The f-word and its family */
const F_WORD = /\b(?:mother)?f+u+c+k/i;
/** Swearing and crude words beyond mild ones */
const STRONG = /\b(?:(?:mother)?f+u+c+k\w*|\w*shit\w*|shite|bitch\w*|piss\w*|(?:dumb|jack|smart|bad)?ass(?:es|hole\w*)?|dick(?:s|head\w*)?|cock(?:s|sucker\w*)?|cunt\w*|twat\w*|bastard\w*|whore\w*|slut\w*|pricks?|wank(?:er|ers|ing)?|bollocks|tits?)\b/i;
/** Mild words: fine from Sassy up */
const MILD = /\b(?:damn\w*|goddamn\w*|hell|crap\w*|crappy|sucks?)\b/i;

/** A canned line (roast, question, nag) the bot may say at this level */
export function allowedAt(level: ToneLevel, text: string): boolean {
  if (level >= 4) return true;
  if (level === 3) return !F_WORD.test(text);
  if (level === 2) return !STRONG.test(text);
  return !STRONG.test(text) && !MILD.test(text);
}

/** Replacements for words over the level's limit, most specific first; [pattern, clean word] */
type Swap = [RegExp, string];
const F_SWAPS: Swap[] = [
  [/\bmotherf+u+c+k(?:er|ers|ing)?\b/gi, 'jerk'],
  [/\bf+u+c+k(?:ing|in'?)\b/gi, 'freaking'],
  [/\bf+u+c+k(?:ed)\b/gi, 'messed'],
  [/\bf+u+c+k(?:er|ers)\b/gi, 'jerk'],
  [/\bf+u+c+k(?:s)?\b/gi, 'heck'],
];
const STRONG_SWAPS: Swap[] = [
  [/\bbullshit\w*\b/gi, 'nonsense'],
  [/\bshitty\b/gi, 'lousy'],
  [/\bshit(?:s|e)?\b/gi, 'junk'],
  [/\b\w*shit\w*\b/gi, 'junk'],
  [/\bbitch(?:ing|in'?)\b/gi, 'whining'],
  [/\bbitch(?:es|y)?\b/gi, 'jerk'],
  [/\bpissed\b/gi, 'ticked off'],
  [/\bpiss\w*\b/gi, 'pee'],
  [/\b(?:dumb|jack|smart|bad)ass(?:es)?\b/gi, 'goof'],
  [/\bass(?:hole\w*)\b/gi, 'jerk'],
  [/\basses\b/gi, 'butts'],
  [/\bass\b/gi, 'butt'],
  [/\b(?:dick(?:s|head\w*)?|cock(?:s|sucker\w*)?|cunt\w*|twat\w*|bastard\w*|whore\w*|slut\w*|pricks?|wank(?:er|ers|ing)?)\b/gi, 'jerk'],
  [/\bbollocks\b/gi, 'nonsense'],
  [/\btits?\b/gi, 'chest'],
];
const MILD_SWAPS: Swap[] = [
  [/\bgoddamn\w*\b/gi, 'gosh darn'],
  [/\bdamn(?:ed)?\b/gi, 'darn'],
  [/\bdamnit\b/gi, 'darn it'],
  [/\bhell\b/gi, 'heck'],
  [/\bcrappy\b/gi, 'lousy'],
  [/\bcrap\b/gi, 'junk'],
];

/** The replacement in the found word's case (all caps, or a capital first letter) */
function inCaseOf(found: string, clean: string): string {
  if (found.length > 1 && found === found.toUpperCase()) return clean.toUpperCase();
  if (found[0] === found[0].toUpperCase()) return clean[0].toUpperCase() + clean.slice(1);
  return clean;
}

/** The model's words with anything over this level's limit swapped for a clean word */
export function cleanUp(text: string, level: ToneLevel): string {
  if (level >= 4) return text;
  const swaps = level === 3 ? F_SWAPS : level === 2 ? [...F_SWAPS, ...STRONG_SWAPS] : [...F_SWAPS, ...STRONG_SWAPS, ...MILD_SWAPS];
  let out = text;
  for (const [pattern, clean] of swaps) out = out.replace(pattern, (found) => inCaseOf(found, clean));
  return out;
}
