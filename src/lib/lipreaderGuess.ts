/** Fuzzy guess check: case/space insensitive, accent fold, Levenshtein tolerance. */

function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeGuess(s: string): string {
  return foldAccents(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[''`´]/g, "'")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

export function guessMatchesSecret(secret: string, guess: string): boolean {
  const A = normalizeGuess(secret);
  const B = normalizeGuess(guess);
  if (!B.length) return false;
  if (A === B) return true;
  const maxDist = A.length <= 4 ? 1 : A.length <= 10 ? 2 : 3;
  return levenshtein(A, B) <= maxDist;
}
