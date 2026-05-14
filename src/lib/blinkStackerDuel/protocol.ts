/** Network messages for Blink Stacker Duel (host-authoritative). */

export type BrickOwner = "base" | "blue" | "red";

/** Compact state snapshot host → guest (and host draw source of truth). */
export type DuelStatePayload = {
  seq: number;
  phase: "lobby" | "countdown" | "turn_banner" | "moving" | "ended";
  /** Countdown seconds remaining (match start). */
  cd?: number;
  /** Turn transition banner copy. */
  banner?: "BLUE TURN" | "RED TURN" | null;
  tower: { ln: number; wn: number; o: BrickOwner }[];
  /** Moving brick center (normalized 0–1 across arena width). */
  mcn: number;
  mwn: number;
  abi: boolean;
  sp: number;
  vx: 1 | -1;
  /** Epoch ms when match countdown ends. */
  cde?: number;
  /** Epoch ms when turn banner ends. */
  tbe?: number;
  loser?: "blue" | "red";
  pf?: number;
  sh?: number;
  cam: number;
  pp: number;
  me: number;
};

export type DuelNetMsg =
  | { t: "bsd_hello"; name: string }
  | { t: "bsd_ready"; ready: boolean }
  | { t: "bsd_state"; s: DuelStatePayload }
  | { t: "bsd_stop_attempt" }
  | { t: "bsd_rematch"; want: boolean }
  | { t: "bsd_rematch_go"; epoch: number };
