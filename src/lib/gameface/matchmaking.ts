/** Weighted pool for universal random match (server + client labels must stay in sync). */

export type RandomGameId = "charades" | "staring" | "facepong";

export type RandomGameMeta = {
  id: RandomGameId;
  label: string;
  path: string;
  weight: number;
};

/** Launch lineup only — weights sum to 1 (Face Card excluded until post-stabilization). */
export const RANDOM_GAME_POOL: RandomGameMeta[] = [
  { id: "charades", label: "Charades", path: "/charades/play", weight: 0.395 },
  { id: "staring", label: "Staring Contest", path: "/staring-contest/play", weight: 0.3025 },
  { id: "facepong", label: "FacePong", path: "/facepong/play", weight: 0.3025 },
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
