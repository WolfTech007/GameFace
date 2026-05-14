/** Network + authoritative state for Blink Stacker Duel (host-owned). */

export type BrickOwner = "base" | "blue" | "red";

export type DuelTowerSeg = { ln: number; wn: number; o: BrickOwner };

export type DuelPhase = "lobby" | "countdown" | "turn_banner" | "moving" | "gameover";

export type BlinkStackerDuelNetState = {
  phase: DuelPhase;
  matchEpoch: number;
  rematch: { host: boolean; guest: boolean };
  ready: { host: boolean; guest: boolean };
  /** Whose turn it is to stop the moving brick (blue = matchmaking host). */
  activeBlue: boolean;
  tower: DuelTowerSeg[];
  mcn: number;
  mwn: number;
  vx: 1 | -1;
  speedPx: number;
  level: number;
  cam: number;
  pulse: number;
  cd?: number;
  cde?: number;
  banner?: "BLUE TURN" | "RED TURN" | null;
  tbe?: number;
  loser?: "blue" | "red";
  /** Increments when a new moving brick starts; stale stopAttempts are ignored. */
  brickEpoch: number;
};

/** Same wire envelope as FacePong: `state` + monotonic `seq` + host perf clock `sentAt`. */
export type HostToGuestDuelMsg = {
  t: "state";
  state: BlinkStackerDuelNetState;
  seq: number;
  sentAt: number;
};

/** Same names as FacePong for `ready` / `rematch`; `stopAttempt` is duel-specific input. */
export type GuestToHostDuelMsg =
  | { t: "ready"; ready: boolean }
  | { t: "rematch"; want: boolean }
  | { t: "stopAttempt"; brickEpoch: number };
