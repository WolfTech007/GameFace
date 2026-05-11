/** Network + authoritative state for FaceHockey (separate from FacePong peerRoom types). */

export type FaceHockeyUiPhase =
  | "lobby"
  | "countdown"
  | "playing"
  | "gameover";

/** Goal / countdown overlay driven only by host snapshots. */
export type FaceHockeyOverlay =
  | { kind: "none" }
  | { kind: "goal"; scorer: "A" | "B" }
  | { kind: "count"; n: number }
  | { kind: "go" };

export type FaceHockeyNetState = {
  phase: "lobby" | "playing" | "gameover";
  scoreA: number;
  scoreB: number;
  puck: { x: number; y: number; vx: number; vy: number };
  /** Player A (host) mallet — bottom half in canonical world. */
  malletA: { x: number; y: number };
  /** Player B (guest) mallet — top half in canonical world. */
  malletB: { x: number; y: number };
  /** When true host does not integrate puck (between face-off). */
  puckFrozen: boolean;
  overlay: FaceHockeyOverlay;
  winner: "A" | "B" | null;
  /** Lobby only — both must be true before host can start (synced for UI). */
  ready: { host: boolean; guest: boolean };
};

export type GuestToHostFHMsg =
  | { t: "fh_mallet"; x: number; y: number }
  | { t: "fh_ready"; ready: boolean }
  | { t: "fh_play_again" };

export type HostToGuestFHMsg = {
  t: "fh_state";
  state: FaceHockeyNetState;
  seq: number;
  sentAt: number;
};

export function initialFaceHockeyState(): FaceHockeyNetState {
  return {
    phase: "lobby",
    scoreA: 0,
    scoreB: 0,
    puck: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
    malletA: { x: 0.5, y: 0.78 },
    malletB: { x: 0.5, y: 0.22 },
    puckFrozen: true,
    overlay: { kind: "none" },
    winner: null,
    ready: { host: false, guest: false },
  };
}

export function cloneFaceHockeyState(s: FaceHockeyNetState): FaceHockeyNetState {
  const r = s.ready ?? { host: false, guest: false };
  return {
    phase: s.phase,
    scoreA: s.scoreA,
    scoreB: s.scoreB,
    puck: { ...s.puck },
    malletA: { ...s.malletA },
    malletB: { ...s.malletB },
    puckFrozen: s.puckFrozen,
    overlay:
      s.overlay.kind === "none"
        ? { kind: "none" }
        : s.overlay.kind === "goal"
          ? { kind: "goal", scorer: s.overlay.scorer }
          : s.overlay.kind === "go"
            ? { kind: "go" }
            : { kind: "count", n: s.overlay.n },
    winner: s.winner,
    ready: { ...r },
  };
}
