export type RankItPhase = "lobby" | "ranking" | "reveal";

export type Tuple5 = [number, number, number, number, number];

export type RankItPromptPayload = {
  id: string;
  question: string;
  items: [string, string, string, string, string];
};

export type RankItSharedState = {
  phase: RankItPhase;
  /** Bump on full-session rematch from reveal (stale client messages guard). */
  matchEpoch: number;
  sessionRematch: { host: boolean; guest: boolean };
  roundId: number;
  prompt: RankItPromptPayload | null;
  names: { host: string; guest: string };
  lobbyReady: { host: boolean; guest: boolean };
  ranking: {
    hostOrder: Tuple5 | null;
    guestOrder: Tuple5 | null;
  };
  reveal: { positionMatches: number; compatPct: number } | null;
  nextRoundReady: { host: boolean; guest: boolean };
  opponentLeft: boolean;
};

export type RankItGuestMsg =
  | { t: "ri_g_hello"; name: string }
  | { t: "ri_g_lobby_ready"; ready: boolean }
  | { t: "ri_g_lock"; roundId: number; order: Tuple5 }
  | { t: "ri_g_next_ready"; roundId: number; ready: boolean }
  | { t: "ri_g_rematch"; want: boolean };

export type RankItNetMsg = RankItGuestMsg | { t: "ri_sync"; state: RankItSharedState };

export function cloneRankItState(s: RankItSharedState): RankItSharedState {
  const sr = s.sessionRematch ?? { host: false, guest: false };
  return {
    phase: s.phase,
    matchEpoch: s.matchEpoch ?? 0,
    sessionRematch: { ...sr },
    roundId: s.roundId,
    prompt: s.prompt
      ? {
          id: s.prompt.id,
          question: s.prompt.question,
          items: [...s.prompt.items] as RankItPromptPayload["items"],
        }
      : null,
    names: { ...s.names },
    lobbyReady: { ...s.lobbyReady },
    ranking: {
      hostOrder: s.ranking.hostOrder ? [...s.ranking.hostOrder] as Tuple5 : null,
      guestOrder: s.ranking.guestOrder ? [...s.ranking.guestOrder] as Tuple5 : null,
    },
    reveal: s.reveal ? { ...s.reveal } : null,
    nextRoundReady: { ...s.nextRoundReady },
    opponentLeft: s.opponentLeft,
  };
}

export function initialRankItState(): RankItSharedState {
  return {
    phase: "lobby",
    matchEpoch: 0,
    sessionRematch: { host: false, guest: false },
    roundId: 0,
    prompt: null,
    names: { host: "Player", guest: "Player" },
    lobbyReady: { host: false, guest: false },
    ranking: { hostOrder: null, guestOrder: null },
    reveal: null,
    nextRoundReady: { host: false, guest: false },
    opponentLeft: false,
  };
}
