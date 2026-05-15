/** Client-side profile persisted for GameFace (swap for server session later). */

export type GameFaceProfile = {
  userId: string;
  username: string;
  displayName: string;
  level: number;
  rank: string;
  /** XP toward next level (client-only until accounts sync). */
  xp?: number;
  avatarUrl?: string;
  favoriteGame?: string;
};

const PROFILE_KEY = "gameface_profile_v1";

export { PROFILE_KEY };

export function loadProfile(): GameFaceProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GameFaceProfile;
  } catch {
    return null;
  }
}

export function saveProfile(p: GameFaceProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

/** Guaranteed profile for matchmaking + HUD (creates guest profile if missing). */
export function ensureProfile(): GameFaceProfile {
  let p = loadProfile();
  if (!p) {
    const id = crypto.randomUUID();
    p = {
      userId: id,
      username: `guest_${id.slice(0, 8)}`,
      displayName: "Player",
      level: 1,
      rank: "Silver I",
      xp: 120,
    };
    saveProfile(p);
    return p;
  }
  if (p.xp === undefined) {
    p = { ...p, xp: 120 };
    saveProfile(p);
  }
  return p;
}

export function updateProfile(patch: Partial<GameFaceProfile>): GameFaceProfile {
  const cur = ensureProfile();
  const next = { ...cur, ...patch };
  saveProfile(next);
  return next;
}
