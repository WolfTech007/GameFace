import { STORAGE_BEST_KEY } from "./constants";

export function readBlinkStackerBest(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE_BEST_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function writeBlinkStackerBest(score: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_BEST_KEY, String(Math.max(0, Math.floor(score))));
  } catch {
    /* ignore quota / private mode */
  }
}
