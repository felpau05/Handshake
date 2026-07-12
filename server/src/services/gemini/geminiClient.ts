// Gemini = the gamemaster brain for ASL Word Battle. Jobs:
//   1. announcePrompt() → an energetic reveal line for a prompt word
//   2. judgeRound()     → ONE call that validates + scores BOTH words, decides
//                         the round winner, and writes the narration together
//                         (replaces the old separate validateWord()/narrate()
//                         pair, which cost 3 Gemini calls per round for 1).
//   3. suggestMove()    → a hint of a good word to sign ("says what move to use")
// All degrade gracefully: with no GEMINI_API_KEY they return canned/stub results
// so the game is fully playable offline. Fill in prompt tuning where marked TODO.
import type { LetterCapture, PlayerSlot, PlayerSpellFeedback } from '@app/shared';
import { env } from '../../config/env.js';
import { createGeminiClient } from './client.js';

const ai = createGeminiClient();

/** Gemini's judgment of a single player's word. */
export interface WordJudgment {
  word: string;
  /** A real word AND related to the prompt. Invalid words can't win the round. */
  valid: boolean;
  /** 0–10: how sophisticated/impressive the word is. 0 when invalid. */
  complexity: number;
  /** 0–10: how well the word relates to the prompt. 0 when invalid. */
  relatedness: number;
  /** One short punchy line judging this specific word. */
  verdict: string;
}

/** The full judged outcome of a round — one Gemini call produces all of this. */
export interface RoundJudgment {
  player1: WordJudgment;
  player2: WordJudgment;
  /** null means a genuine tie/toss-up → GameRoom triggers sudden death. */
  roundWinner: PlayerSlot | null;
  /** One hype sentence announcing the round outcome, naming both words. */
  narration: string;
}

/** Reveal line for a fresh prompt word (voiced by ElevenLabs). */
export async function announcePrompt(prompt: string, suddenDeath: boolean): Promise<string> {
  if (!ai) return cannedPromptLine(prompt, suddenDeath);
  const flavor = suddenDeath
    ? 'This is SUDDEN DEATH — the last round was a dead heat and you can barely believe it. Raise the stakes, sound a little unhinged. '
    : '';
  const res = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents:
      `You're the host of a fingerspelling word battle: quick-witted, theatrical, ` +
      `a little too invested — think a boxing announcer who moonlights at a spelling ` +
      `bee. ${flavor}The theme is "${prompt}". In ONE short sentence (under 25 words), ` +
      `reveal the theme with a specific, vivid jab or image drawn from the theme ` +
      `itself — not a generic "give me your best word" line — and dare the players ` +
      `to bring something impressive. Vary your rhythm; don't start with "Alright" ` +
      `or "Ladies and gentlemen". No emojis, no markdown/asterisks — this gets ` +
      `read aloud and shown as plain text.`,
  });
  return (res.text ?? cannedPromptLine(prompt, suddenDeath)).trim();
}

/**
 * ONE call that judges an entire round: validates both words against the
 * prompt, scores each on complexity + relatedness, decides the winner
 * (invalid/unrelated loses regardless of raw length), and writes the
 * narration — all in the same response, so a round costs one Gemini call
 * instead of three. Never throws: any failure (no key, bad JSON, network)
 * degrades to a deterministic offline stub so the match always resolves.
 */
export async function judgeRound(
  prompt: string,
  words: Record<PlayerSlot, string>,
  names?: Record<PlayerSlot, string>,
): Promise<RoundJudgment> {
  const stub = stubJudgment(prompt, words);
  if (!ai) return stub;

  const n1 = names?.p1 || 'Player 1';
  const n2 = names?.p2 || 'Player 2';
  try {
    const res = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents:
        `You are the judge and host of an ASL fingerspelling word battle — ` +
        `sharp, theatrical, and gleefully unimpressed by lazy word choices. ` +
        `Roast the WORD CHOICES, never the players themselves. ` +
        `The theme is "${prompt}". ` +
        `Player 1 is named ${n1} and signed "${words.p1 || '(nothing)'}". ` +
        `Player 2 is named ${n2} and signed "${words.p2 || '(nothing)'}". ` +
        `VALIDITY IS STRICT — a word is valid ONLY if ALL of these hold: ` +
        `(a) it is a real English word, ` +
        `(b) it has a genuine, explainable connection to the theme "${prompt}" ` +
        `— if you can't state the connection in a few words, it is NOT valid, ` +
        `(c) it is not a generic filler or function word (pronouns, articles, ` +
        `conjunctions, prepositions — "we", "the", "it", "and", "of" and the ` +
        `like are NEVER valid, no matter the theme). ` +
        `Merely being a real word is NOT enough; an off-theme word is invalid ` +
        `even if it is long and impressive. When in doubt about relatedness, ` +
        `rule it invalid. ` +
        `For each player, judge: valid (per the strict rules above), complexity ` +
        `(0-10, how sophisticated/impressive the word is; 0 if invalid), ` +
        `relatedness (0-10, how strong its connection to the theme is; 0 if ` +
        `invalid, and any valid word must score at least 4), and a short, ` +
        `punchy verdict line reacting to THAT specific word — name the ` +
        `connection when hyping a clever pick, and when roasting a dud, say ` +
        `WHY it failed (off-theme, filler, not a word). ` +
        `Then decide roundWinner ("p1" or "p2") by weighing validity first, ` +
        `then relatedness, then complexity — an invalid word always loses to a ` +
        `valid one regardless of length. If both are equally strong or both ` +
        `invalid, roundWinner is null. ` +
        `Finally write ONE sentence of narration (under 30 words) that reacts ` +
        `to what actually happened, using the players' NAMES and both words: ` +
        `crown the winner's pick with a specific compliment and needle the ` +
        `loser's with a specific dig; if roundWinner is null, milk the ` +
        `dead-even standoff and tease sudden death — do NOT declare a winner ` +
        `in that line. Every string value (verdict, narration) is plain text, ` +
        `read aloud and shown as-is — no markdown, no asterisks, no emojis. ` +
        `Respond with ONLY strict JSON, no prose, no markdown fences, in exactly ` +
        `this shape: {"player1":{"word":string,"valid":boolean,"complexity":number,` +
        `"relatedness":number,"verdict":string},"player2":{...same shape...},` +
        `"roundWinner":"p1"|"p2"|null,"narration":string}`,
    });
    return parseRoundJudgment(res.text ?? '', words) ?? stub;
  } catch (err) {
    console.warn(
      '[gemini] judgeRound failed, falling back to offline stub:',
      err instanceof Error ? err.message.split('\n')[0] : err,
    );
    return stub;
  }
}

/** Input for the match-end signing coach (see generateSpellFeedback). */
export interface SpellFeedbackRequest {
  playerId: string;
  displayName: string;
  prompt: string;
  word: string;
  captures: LetterCapture[];
}

/**
 * Match-end signing coach: given a player's submitted word, the round theme,
 * and the per-letter webcam captures (photo of the hand at the moment each
 * letter committed + detector confidence), one multimodal Gemini call works
 * out what word they were TRYING to spell, which letters missed, and concrete
 * handshape advice per problem letter. Never throws — degrades to a friendly
 * canned message so MATCH_END always has something to show.
 */
export async function generateSpellFeedback(
  input: SpellFeedbackRequest,
): Promise<PlayerSpellFeedback> {
  const { playerId, displayName, prompt, word, captures } = input;
  const fallback = stubSpellFeedback(input);
  if (!ai || !word) return fallback;

  // Letter roster for the text prompt; images attached after, in the same
  // order, so "photo N" unambiguously means captures[N] / word[N].
  const withImages = captures.filter((c) => c.image);
  const roster = captures
    .map((c, i) => {
      const conf = c.confidence !== null ? `${Math.round(c.confidence * 100)}% detector confidence` : 'typed on keyboard, no photo';
      return `${i}: "${c.letter}" (${conf}${c.image ? ', photo attached' : ''})`;
    })
    .join('\n');

  try {
    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
      {
        text:
          `You are a supportive but precise ASL fingerspelling coach reviewing one ` +
          `player's final round in a word battle. ` +
          `The round theme was "${prompt}". The player, ${displayName}, submitted the ` +
          `word "${word}" letter by letter using ASL handshapes read by a detector. ` +
          `Per-letter detector log (index: letter):\n${roster || '(no capture log — keyboard entry)'}\n` +
          `${withImages.length ? `The ${withImages.length} attached photo(s) show the player's actual hand at the moment each photographed letter committed, in the same order as the log entries marked "photo attached".` : 'No photos are attached.'}\n` +
          `Your job, in order: ` +
          `(1) Decide what real English word related to "${prompt}" they were most ` +
          `likely TRYING to spell — the submission may contain detector misreads ` +
          `(common confusions: A/S/T/N/M, U/V/R, D/F, E/O). If the submission is ` +
          `already a correctly spelled real word, the intended word is itself. If ` +
          `you genuinely cannot tell what they were going for, it is nonsense. ` +
          `(2) List the 0-based indices where the submitted word differs from the ` +
          `intended word (wrong, extra, or garbled letters — for missing letters, ` +
          `skip the index list rather than guessing). ` +
          `(3) For up to 4 letters that went wrong OR had low confidence, give a ` +
          `short concrete handshape tip (what the hand LIKELY did vs what the ` +
          `target letter needs — use the photos when attached; e.g. "your E is ` +
          `reading as A: curl your fingertips down to touch your thumb instead of ` +
          `closing a fist"). ` +
          `(4) Write ONE friendly headline sentence addressed to ${displayName} — ` +
          `celebrate a clean word, encourage a near-miss naming the intended word, ` +
          `or gently note an unreadable one. ` +
          `All strings are plain text, no markdown, no emojis. ` +
          `Respond with ONLY strict JSON, no fences: ` +
          `{"intendedWord":string|null,"nonsense":boolean,"misspelledIndices":number[],` +
          `"tips":[{"index":number,"letter":string,"tip":string}],"message":string}`,
      },
    ];
    for (const c of withImages) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: c.image!.split(',')[1] } });
    }

    const res = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: [{ role: 'user', parts }],
    });
    return parseSpellFeedback(res.text ?? '', input) ?? fallback;
  } catch (err) {
    console.warn(
      '[gemini] generateSpellFeedback failed, using canned feedback:',
      err instanceof Error ? err.message.split('\n')[0] : err,
    );
    return fallback;
  }
}

/** Canned feedback when Gemini is unavailable — a message always shows. */
function stubSpellFeedback(input: SpellFeedbackRequest): PlayerSpellFeedback {
  const { playerId, word, displayName } = input;
  return {
    playerId,
    word,
    intendedWord: word.length >= 2 ? word : null,
    nonsense: word.length < 2,
    misspelledIndices: [],
    tips: [],
    message: word
      ? `Nice signing, ${displayName} — "${word}" made it through cleanly.`
      : `No word made it in this round, ${displayName} — hold each letter steady until it commits.`,
  };
}

/** Parses generateSpellFeedback's JSON; null on mismatch → canned fallback. */
function parseSpellFeedback(text: string, input: SpellFeedbackRequest): PlayerSpellFeedback | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const j = JSON.parse(match[0]) as Record<string, unknown>;
    const message = typeof j.message === 'string' && j.message ? j.message : null;
    if (!message) return null;
    const nonsense = Boolean(j.nonsense);
    const intendedWord =
      !nonsense && typeof j.intendedWord === 'string' && j.intendedWord
        ? j.intendedWord.toUpperCase()
        : null;
    const inWord = (n: unknown): n is number =>
      typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < input.word.length;
    const misspelledIndices = Array.isArray(j.misspelledIndices)
      ? j.misspelledIndices.filter(inWord)
      : [];
    const tips = (Array.isArray(j.tips) ? j.tips : [])
      .map((t) => {
        const o = (t ?? {}) as Record<string, unknown>;
        if (!inWord(o.index) || typeof o.tip !== 'string' || !o.tip) return null;
        return {
          index: o.index,
          letter: typeof o.letter === 'string' && o.letter ? o.letter : input.word[o.index],
          tip: o.tip,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .slice(0, 4);
    return {
      playerId: input.playerId,
      word: input.word,
      intendedWord,
      nonsense,
      // Nonsense submissions get the message only — no letter-level nitpicks.
      misspelledIndices: nonsense ? [] : misspelledIndices,
      tips: nonsense ? [] : tips,
      message,
    };
  } catch {
    return null;
  }
}

/** Optional hint of a strong word to sign ("says what move to use"). */
export async function suggestMove(prompt: string): Promise<string | null> {
  if (!ai) return null;
  const res = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents:
      `Suggest ONE fairly long English word (no letters J or Z) that relates to ` +
      `"${prompt}". Reply with just the word.`,
  });
  const word = (res.text ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return word || null;
}

// ── Offline / stub helpers ───────────────────────────────────────────────────

function cannedPromptLine(prompt: string, suddenDeath: boolean): string {
  return suddenDeath
    ? `Sudden death! Biggest word for "${prompt}" wins it all!`
    : `Your prompt is "${prompt}" — sign the biggest related word you can!`;
}

/**
 * Deterministic offline judgment — used with no Gemini credential configured,
 * and as the fallback when a real call fails or returns unparseable JSON.
 * Accepts any word of 2+ letters (mirroring the old validateWord stub) and
 * picks the winner by length, same rule as shared/rules.ts's decideBattle.
 * Exported so tests can exercise this deterministic path directly rather than
 * through judgeRound(), which correctly calls the real API whenever a
 * credential IS configured — including in dev/test environments that happen
 * to have one in server/.env.
 */
export function stubJudgment(prompt: string, words: Record<PlayerSlot, string>): RoundJudgment {
  const mk = (word: string): WordJudgment => {
    const valid = word.length >= 2;
    return {
      word,
      valid,
      complexity: valid ? Math.min(10, word.length) : 0,
      relatedness: valid ? 10 : 0,
      verdict: valid ? 'Accepted (offline stub).' : 'Too short or empty.',
    };
  };
  const player1 = mk(words.p1);
  const player2 = mk(words.p2);
  const roundWinner: PlayerSlot | null =
    player1.valid !== player2.valid
      ? player1.valid
        ? 'p1'
        : 'p2'
      : player1.valid && player1.word.length !== player2.word.length
        ? player1.word.length > player2.word.length
          ? 'p1'
          : 'p2'
        : null;
  const narration = roundWinner
    ? `${roundWinner === 'p1' ? words.p1 : words.p2} takes it for "${prompt}"!`
    : "It's a tie — sudden death!";
  return { player1, player2, roundWinner, narration };
}

/** Generic filler/function words that can never win a theme round, no matter
 *  what the model says — the deterministic backstop for the prompt's rule. */
const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'i', 'we', 'he', 'she', 'it', 'they', 'you', 'me', 'us',
  'my', 'our', 'your', 'his', 'her', 'its', 'and', 'or', 'but', 'so', 'if',
  'of', 'to', 'in', 'on', 'at', 'by', 'as', 'is', 'am', 'are', 'was', 'be',
  'do', 'did', 'no', 'yes', 'not', 'this', 'that', 'them',
]);

/** Parses judgeRound's expected JSON shape; returns null on any mismatch so
 *  the caller falls back to the offline stub instead of trusting garbage. */
function parseRoundJudgment(text: string, words: Record<PlayerSlot, string>): RoundJudgment | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const j = JSON.parse(match[0]);
    // The actual word is authoritative — it's the exact string we submitted,
    // never Gemini's echo of it, which can drift (e.g. parroting back the
    // "(nothing)" placeholder we send for prompt context on an empty word).
    const toJudgment = (raw: unknown, actualWord: string): WordJudgment => {
      const o = (raw ?? {}) as Record<string, unknown>;
      // Enforce the strict rules even if the model waves a word through:
      // empty/one-letter submissions never pass (the model sometimes blesses
      // our "(nothing)" placeholder), filler/function words never pass, and
      // "valid but barely related" (relatedness < 4) resolves as invalid.
      const relatedness = clamp0to10(o.relatedness);
      const valid =
        Boolean(o.valid) &&
        actualWord.length >= 2 &&
        !FILLER_WORDS.has(actualWord.toLowerCase()) &&
        relatedness >= 4;
      return {
        word: actualWord,
        valid,
        complexity: valid ? clamp0to10(o.complexity) : 0,
        relatedness: valid ? relatedness : 0,
        verdict: typeof o.verdict === 'string' ? o.verdict : '',
      };
    };
    // Gemini sometimes returns the two judgments under swapped player1/player2
    // keys (e.g. it reasons about the winner first). Since toJudgment discards
    // the echoed word and staples validity onto OUR actual word by position, an
    // unnoticed swap lands "valid" on the wrong word (a real word ruled invalid
    // while nonsense passes). Realign using Gemini's echoed `word` when it
    // clearly cross-matches our slots — distinct words, clean cross only.
    const norm = (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase().replace(/[^a-z]/g, '') : '';
    const a1 = norm(words.p1);
    const a2 = norm(words.p2);
    const g1 = norm((j.player1 as { word?: unknown } | undefined)?.word);
    const g2 = norm((j.player2 as { word?: unknown } | undefined)?.word);
    const swapped = a1 !== a2 && !!g1 && !!g2 && g1 === a2 && g2 === a1;
    if (swapped) {
      console.warn(`[gemini] judgeRound returned swapped player keys — realigning ("${g1}"→p2, "${g2}"→p1)`);
    }

    const player1 = toJudgment(swapped ? j.player2 : j.player1, words.p1);
    const player2 = toJudgment(swapped ? j.player1 : j.player2, words.p2);
    let roundWinner: PlayerSlot | null =
      j.roundWinner === 'p1' || j.roundWinner === 'p2' ? j.roundWinner : null;
    // A swap also flips which slot the model's roundWinner refers to.
    if (swapped && roundWinner) roundWinner = roundWinner === 'p1' ? 'p2' : 'p1';
    // Our validity backstop may have overruled the model (e.g. it crowned a
    // filler word) — never let an invalid word keep a win over a valid one.
    if (roundWinner === 'p1' && !player1.valid) roundWinner = player2.valid ? 'p2' : null;
    if (roundWinner === 'p2' && !player2.valid) roundWinner = player1.valid ? 'p1' : null;
    return {
      player1,
      player2,
      roundWinner,
      narration: typeof j.narration === 'string' && j.narration ? j.narration : '',
    };
  } catch {
    return null;
  }
}

function clamp0to10(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}
