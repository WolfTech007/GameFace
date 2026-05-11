"use client";

import { useEffect, useRef } from "react";
import {
  PENDING_MATCH_KEY,
  type PendingMatchPayload,
  type RandomGameId,
} from "@/lib/gameface/matchmaking";

/** One-shot: if universal random match queued this game, fire callback and clear storage. */
export function useConsumePendingMatch(
  gameId: RandomGameId,
  onMatch: (payload: PendingMatchPayload) => void,
) {
  const cb = useRef(onMatch);
  cb.current = onMatch;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(PENDING_MATCH_KEY);
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as PendingMatchPayload;
      if (p.gameId !== gameId) return;
      sessionStorage.removeItem(PENDING_MATCH_KEY);
      cb.current(p);
    } catch {
      /* ignore */
    }
  }, [gameId]);
}
