/** Weighted pool for universal random match (server + client labels must stay in sync). */

export type RandomGameId = "charades" | "staring" | "facepong" | "facecard" | "blinkstackerduel";

export type RandomGameMeta = {
  id: RandomGameId;
  label: string;
  path: string;
  weight: number;
};

/** Weighted pool for universal random match — weights sum to 1. */
export const RANDOM_GAME_POOL: RandomGameMeta[] = [
  { id: "charades", label: "Charades", path: "/charades/play", weight: 0.25 },
  { id: "staring", label: "Staring Contest", path: "/staring-contest/play", weight: 0.25 },
  { id: "facepong", label: "FacePong", path: "/facepong/play", weight: 0.25 },
  { id: "facecard", label: "Face Card", path: "/facecard/play", weight: 0.25 },
];

export function pickWeightedGame(): RandomGameMeta {
  const r = Math.random();
  let cum = 0;
  for (const g of RANDOM_GAME_POOL) {
    cum += g.weight;
    if (r <= cum) return g;
  }
  return RANDOM_GAME_POOL[RANDOM_GAME_POOL.length - 1]!;
}

export const PENDING_MATCH_KEY = "gameface_pending_match_v1";

export type PendingMatchPayload = {
  peerRoomId: string;
  role: "host" | "guest";
  gameId: RandomGameId;
  gamePath: string;
  gameLabel: string;
};
