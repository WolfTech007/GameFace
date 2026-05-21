const KEY_PREFIX = "gameface.staring-contest.best-seconds.";

export function staringContestBestKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function readStaringContestBestSeconds(userId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(staringContestBestKey(userId));
    const n = raw != null ? parseFloat(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeStaringContestBestSeconds(userId: string, seconds: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(staringContestBestKey(userId), String(Math.max(0, seconds)));
  } catch {
    /* quota / private mode */
  }
}

/** Final / best durations for the winner screen (e.g. 65 → 1:05, 9 → 0:09). */
export function formatStaringDurationMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function recordStaringContestRound(
  userId: string,
  roundSeconds: number,
): { bestSeconds: number; isNewHighScore: boolean } {
  const sec = Math.max(0, roundSeconds);
  const prev = readStaringContestBestSeconds(userId);
  if (sec > prev) {
    writeStaringContestBestSeconds(userId, sec);
    return { bestSeconds: sec, isNewHighScore: true };
  }
  return { bestSeconds: prev, isNewHighScore: false };
}
