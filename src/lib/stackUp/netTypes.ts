export type StackUpOwner = "base" | "blue" | "red";

export type StackUpSeg = { ln: number; wn: number; o: StackUpOwner };

export type StackUpPhase = "lobby" | "countdown" | "turn_banner" | "moving" | "gameover";

export type StackUpNetState = {
  phase: StackUpPhase;
  matchEpoch: number;
  rematch: { host: boolean; guest: boolean };
  ready: { host: boolean; guest: boolean };
  activeBlue: boolean;
  tower: StackUpSeg[];
  mcn: number;
  mwn: number;
  vx: 1 | -1;
  speedPx: number;
  level: number;
  cam: number;
  pulse: number;
  cd?: number;
  cde?: number;
  banner?: "BLUE TURN" | "RED TURN" | "GO" | null;
  tbe?: number;
  loser?: "blue" | "red";
  brickEpoch: number;
  fx?: { kind: "perfect" | "miss"; until: number } | null;
};

export type HostToGuestStackUpMsg = {
  t: "state";
  state: StackUpNetState;
  seq: number;
  sentAt: number;
};

export type GuestToHostStackUpMsg =
  | { t: "ready"; ready: boolean }
  | { t: "rematch"; want: boolean }
  | {
      t: "stopAttempt";
      brickEpoch: number;
      /** Guest's normalized center at tap (host may use for diagnostics; overlap remains host sim). */
      clientMcn?: number;
      clientStopAt?: number;
    };
