// Curated database of open-ended, evocative single-word prompts. The server
// picks one at random per round; Gemini narrates the reveal. These are chosen to
// be broad enough that players can always find a related word using the 24
// available ASL letters (no J/Z required).
export const PROMPT_WORDS: string[] = [
  'water',
  'fire',
  'music',
  'ocean',
  'storm',
  'dream',
  'light',
  'winter',
  'forest',
  'city',
  'space',
  'money',
  'family',
  'travel',
  'food',
  'sport',
  'color',
  'animal',
  'garden',
  'machine',
  'story',
  'power',
  'time',
  'heart',
];

/** Pick a random prompt, optionally avoiding the ones already used this match. */
export function pickPromptWord(exclude: string[] = []): string {
  const pool = PROMPT_WORDS.filter((w) => !exclude.includes(w));
  const from = pool.length ? pool : PROMPT_WORDS;
  return from[Math.floor(Math.random() * from.length)];
}
