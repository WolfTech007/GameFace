/** Friends, requests, activity — local-first (upgrade to API later). */

import type { GameFaceProfile } from "./profileStore";

export type FriendEntry = {
  userId: string;
  username: string;
  displayName: string;
  online: boolean;
  currentGame?: string;
};

export type FriendRequest = {
  id: string;
  fromUserId: string;
  fromUsername: string;
  fromDisplayName: string;
  createdAt: number;
};

export type ActivityEntry = {
  id: string;
  at: number;
  kind: "match_win" | "match_loss" | "match_played" | "friend_online" | "social";
  title: string;
  detail?: string;
};

const FRIENDS_KEY = "gameface_friends_v1";
const REQUESTS_KEY = "gameface_friend_requests_v1";
const ACTIVITY_KEY = "gameface_activity_v1";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, val: unknown) {
  localStorage.setItem(key, JSON.stringify(val));
}

export function loadFriends(): FriendEntry[] {
  return readJson<FriendEntry[]>(FRIENDS_KEY, []);
}

export function saveFriends(f: FriendEntry[]) {
  writeJson(FRIENDS_KEY, f);
}

export function seedDemoFriends(self: GameFaceProfile) {
  if (loadFriends().length > 0) return;
  saveFriends([
    {
      userId: "demo_ava",
      username: "star_gazer",
      displayName: "Ava",
      online: true,
      currentGame: "Charades",
    },
    {
      userId: "demo_milo",
      username: "troyquick",
      displayName: "Milo",
      online: false,
    },
    {
      userId: "demo_jun",
      username: "jun_codes",
      displayName: "Jun",
      online: true,
      currentGame: "Staring Contest",
    },
  ]);
  void self;
}

export function loadFriendRequests(): { incoming: FriendRequest[]; outgoing: FriendRequest[] } {
  return readJson(REQUESTS_KEY, { incoming: [], outgoing: [] });
}

export function saveFriendRequests(r: { incoming: FriendRequest[]; outgoing: FriendRequest[] }) {
  writeJson(REQUESTS_KEY, r);
}

export function loadActivity(): ActivityEntry[] {
  return readJson<ActivityEntry[]>(ACTIVITY_KEY, []);
}

export function prependActivity(entry: Omit<ActivityEntry, "id"> & { id?: string }) {
  const list = loadActivity();
  const id = entry.id ?? crypto.randomUUID();
  const next = [{ ...entry, id } as ActivityEntry, ...list].slice(0, 80);
  writeJson(ACTIVITY_KEY, next);
}

export function seedDemoActivity() {
  if (loadActivity().length > 0) return;
  const now = Date.now();
  writeJson(ACTIVITY_KEY, [
    {
      id: "a1",
      at: now - 3600000,
      kind: "match_win",
      title: "You beat @josh in Charades",
      detail: "8–5",
    },
    {
      id: "a2",
      at: now - 86400000,
      kind: "match_loss",
      title: "Lost to @sarah in Staring Contest",
      detail: "Round 2",
    },
    {
      id: "a3",
      at: now - 172800000,
      kind: "match_played",
      title: "Played 4 rounds with @mike",
      detail: "Face Card",
    },
    {
      id: "a4",
      at: now - 120000,
      kind: "friend_online",
      title: "Milo is online",
    },
  ] satisfies ActivityEntry[]);
}
