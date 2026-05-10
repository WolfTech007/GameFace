import type { Tuple5 } from "@/lib/rankitProtocol";

function footruleDistance(a: Tuple5, b: Tuple5): number {
  let sum = 0;
  for (let item = 0; item < 5; item++) {
    const pa = a.indexOf(item);
    const pb = b.indexOf(item);
    sum += Math.abs(pa - pb);
  }
  return sum;
}

/** All permutations of 0..n-1 (n small). */
function allPermutations(n: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const used = new Set<number>();
  function dfs() {
    if (cur.length === n) {
      out.push([...cur]);
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      used.add(i);
      cur.push(i);
      dfs();
      cur.pop();
      used.delete(i);
    }
  }
  dfs();
  return out;
}

/** Maximum Spearman footrule distance between two full rankings of 5 items (same pool). */
export const MAX_FOOTRULE_5: number = (() => {
  const perms = allPermutations(5).map((p) => p as Tuple5);
  let max = 0;
  for (const p of perms) {
    for (const q of perms) {
      const d = footruleDistance(p, q);
      if (d > max) max = d;
    }
  }
  return max;
})();

/**
 * positionMatches: ranks where both players placed the **same item** in the **same slot** (1…5).
 * compatPct: 0–100 from normalized footrule distance (identical lists → 100%, maximally far → ~0%).
 */
export function computeRankSimilarity(hostOrder: Tuple5, guestOrder: Tuple5): {
  positionMatches: number;
  compatPct: number;
  footrule: number;
} {
  let positionMatches = 0;
  for (let i = 0; i < 5; i++) {
    if (hostOrder[i] === guestOrder[i]) positionMatches += 1;
  }
  const footrule = footruleDistance(hostOrder, guestOrder);
  const compatPct = Math.round(100 * (1 - footrule / Math.max(1, MAX_FOOTRULE_5)));
  return { positionMatches, compatPct, footrule };
}

export function isValidTuple5Order(o: readonly number[]): o is Tuple5 {
  if (o.length !== 5) return false;
  const seen = new Set<number>();
  for (const x of o) {
    if (!Number.isInteger(x) || x < 0 || x > 4) return false;
    if (seen.has(x)) return false;
    seen.add(x);
  }
  return seen.size === 5;
}
