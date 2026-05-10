/** Normalize for comparison: lowercase, collapse spaces, trim. */
export function normalizeGuessText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n]!;
}

/**
 * Fuzzy match for celebrity guesses: exact normalized match, or small Levenshtein distance
 * scaled by string length (minor typos OK).
 */
export function guessMatchesSecret(secret: string, guess: string): boolean {
  const A = normalizeGuessText(secret);
  const B = normalizeGuessText(guess);
  if (!B.length) return false;
  if (A === B) return true;
  const d = levenshtein(A, B);
  const len = Math.min(A.length, B.length);
  const maxDist = Math.max(1, Math.min(3, Math.floor(len / 4)));
  return d <= maxDist;
}
