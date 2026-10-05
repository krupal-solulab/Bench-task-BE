/**
 * Module 10 gap-closure: deterministic "smart" duplicate detection (no embeddings/LLM - see
 * release-notes.util.ts for this codebase's "deterministic, labeled as suggested" convention).
 * Replaces a plain substring match: two differently-worded titles about the same thing ("Login
 * page crashes on Safari" vs "Safari crash when logging in") now score as similar.
 *
 * score = 0.7 x word overlap (Dice, on stemmed, stop-word-free tokens)
 *       + 0.3 x character-trigram overlap (tolerates typos and word-boundary differences)
 * Description words count at half weight, so a shared title dominates.
 */

const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can cannot do does for from has have how i if in into is it its ' +
    'of on or our should so that the their then there this to was we were when where which while ' +
    'will with without you your not no new add adding issue task bug please need needs'
  ).split(' '),
);

/** Very light stemming - enough to match crash/crashes/crashing/crashed. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
    .map(stem);
}

function dice<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function trigrams(text: string): Set<string> {
  const normalized = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 2; i++) grams.add(normalized.slice(i, i + 3));
  return grams;
}

export interface SimilarityCandidate {
  title: string;
  description?: string | null;
}

/** 0..1 - how similar a candidate issue is to the text being typed. */
export function similarityScore(query: string, candidate: SimilarityCandidate): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;

  const titleTokens = new Set(tokenize(candidate.title));
  const descriptionTokens = new Set(tokenize(candidate.description ?? ''));
  const titleOverlap = dice(queryTokens, titleTokens);
  const allOverlap = dice(queryTokens, new Set([...titleTokens, ...descriptionTokens]));
  const wordScore = Math.max(titleOverlap, allOverlap * 0.5);

  const charScore = dice(trigrams(query), trigrams(candidate.title));
  return Math.round((0.7 * wordScore + 0.3 * charScore) * 100) / 100;
}

/** Below this, a match is noise rather than a plausible duplicate. */
export const SIMILARITY_THRESHOLD = 0.35;
