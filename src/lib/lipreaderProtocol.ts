/** Charades — host-authoritative co-op state (same team, two 60s clue segments). */

export const LIP_READER_WORD_DECK = [
  "Pizza",
  "Shark",
  "Robot",
  "Beyoncé",
  "Spider-Man",
  "Airplane",
  "Banana",
  "Basketball",
  "Vampire",
  "Cowboy",
  "Dinosaur",
  "Fireworks",
  "SpongeBob",
  "Guitar",
  "Dog",
  "Alien",
  "Ice Cream",
  "McDonald's",
  "Superman",
  "Zombie",
  "Mermaid",
  "Football",
  "Magic",
  "Ninja",
  "Drake",
] as const;

export type LipReaderPhase = "lobby" | "countdown" | "playing" | "role_swap" | "session_complete";

export type LipReaderNetState = {
  phase: LipReaderPhase;
  /** Bump when returning to lobby from session complete. */
  sessionEpoch: number;
  /** Both true → host resets session to lobby (PLAY AGAIN). */
  sessionRematch: { host: boolean; guest: boolean };
  /** Monotonic per playing segment (incremented when entering countdown or after role swap). */
  roundId: number;
  hostName: string;
  guestName: string;
  /** Segment 1: host clues. Segment 2: guest clues. */
  communicatorIsHost: boolean;
  /** 1 = first 60s, 2 = second after swap. */
  segmentIndex: 1 | 2;
  /** Authoritative word (host only in memory; stripped over wire for guesser). */
  secretWord: string;
  /** Wall ms when current playing segment began. */
  segmentStartedAt: number | null;
  /** Wall ms when current segment ends (host clock). */
  segmentEndsAt: number | null;
  countdownStartedAt: number | null;
  /** 3, 2, 1 before segment 1 only. */
  countdownN: number | null;
  /**
   * V1 scoring: one run = two 60s segments, combined `teamScore`.
   * For future leaderboards / weekly highs, persist: `sessionEpoch`, names, `teamScore`,
   * `scoreSegmentHost`, `scoreSegmentGuest`, and wall-clock session end (host-derived).
   */
  teamScore: number;
  /** Points earned while host was clueing (segment 1). */
  scoreSegmentHost: number;
  /** Points earned while guest was clueing (segment 2). */
  scoreSegmentGuest: number;
  readyLobbyHost: boolean;
  readyLobbyGuest: boolean;
  /** Short wrong-guess hint (cleared quickly). */
  guesserHint: string | null;
};

export type GuestToHostLipMsg =
  | { t: "lr_name"; name: string }
  | { t: "lr_ready_lobby"; ready: boolean }
  | { t: "lr_guess"; text: string; roundId: number }
  | { t: "lr_skip" }
  | { t: "lr_play_again"; want: boolean };

export type HostToGuestLipMsg = {
  t: "lr_state";
  state: LipReaderNetState;
  seq: number;
  sentAt: number;
};

export function initialLipReaderState(): LipReaderNetState {
  return {
    phase: "lobby",
    sessionEpoch: 0,
    sessionRematch: { host: false, guest: false },
    roundId: 0,
    hostName: "",
    guestName: "",
    communicatorIsHost: true,
    segmentIndex: 1,
    secretWord: "",
    segmentStartedAt: null,
    segmentEndsAt: null,
    countdownStartedAt: null,
    countdownN: null,
    teamScore: 0,
    scoreSegmentHost: 0,
    scoreSegmentGuest: 0,
    readyLobbyHost: false,
    readyLobbyGuest: false,
    guesserHint: null,
  };
}

export function cloneLipReaderState(s: LipReaderNetState): LipReaderNetState {
  const sr = s.sessionRematch ?? { host: false, guest: false };
  return {
    phase: s.phase,
    sessionEpoch: s.sessionEpoch ?? 0,
    sessionRematch: { ...sr },
    roundId: s.roundId,
    hostName: s.hostName,
    guestName: s.guestName,
    communicatorIsHost: s.communicatorIsHost,
    segmentIndex: s.segmentIndex === 2 ? 2 : 1,
    secretWord: s.secretWord,
    segmentStartedAt: s.segmentStartedAt,
    segmentEndsAt: s.segmentEndsAt,
    countdownStartedAt: s.countdownStartedAt,
    countdownN: s.countdownN,
    teamScore: s.teamScore,
    scoreSegmentHost: s.scoreSegmentHost,
    scoreSegmentGuest: s.scoreSegmentGuest,
    readyLobbyHost: s.readyLobbyHost,
    readyLobbyGuest: s.readyLobbyGuest,
    guesserHint: s.guesserHint,
  };
}

/**
 * Strip secret word for guest packets:
 * - guesser never receives the word during a round
 * - communicator only receives it once `phase === "playing"` (not during countdown / role_swap)
 */
export function redactLipStateForGuest(state: LipReaderNetState): LipReaderNetState {
  const guestIsCommunicator = !state.communicatorIsHost;
  const playing = state.phase === "playing";
  const c = cloneLipReaderState(state);
  if (!guestIsCommunicator || !playing) {
    c.secretWord = "";
  }
  return c;
}

export function pickRandomWord(exclude?: string | null): string {
  const deck = [...LIP_READER_WORD_DECK];
  const pool = exclude ? deck.filter((w) => w !== exclude) : deck;
  const use = pool.length ? pool : deck;
  return use[Math.floor(Math.random() * use.length)]!;
}
