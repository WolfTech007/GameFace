/** Weighted pool for universal random match (server + client labels must stay in sync). */

export type RandomGameId = "charades" | "staring" | "facepong" | "facecard";

export type RandomGameMeta = {
  id: RandomGameId;
  label: string;
  path: string;
  weight: number;
};

export const RANDOM_GAME_POOL: RandomGameMeta[] = [
  { id: "charades", label: "Charades", path: "/charades", weight: 0.34 },
  { id: "staring", label: "Staring Contest", path: "/staring-contest", weight: 0.26 },
  { id: "facepong", label: "FacePong", path: "/facepong", weight: 0.26 },
  { id: "facecard", label: "Face Card", path: "/facecard", weight: 0.14 },
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
