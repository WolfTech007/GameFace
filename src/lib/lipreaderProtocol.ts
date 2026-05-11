/** Lip Reader — separate from FacePong peerRoom types. Host-authoritative game state. */

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

export type LipReaderPhase = "lobby" | "countdown" | "playing" | "round_result";

export type LipReaderNetState = {
  phase: LipReaderPhase;
  hostName: string;
  guestName: string;
  /** True = host is communicator this round; false = guest is communicator. */
  communicatorIsHost: boolean;
  /** Authoritative word (host only in memory; stripped over wire for guesser). */
  secretWord: string;
  roundStartAt: number | null;
  /** Epoch ms when countdown began (optional UI). */
  countdownStartedAt: number | null;
  /** 3, 2, 1 — shown during countdown; null when not counting. */
  countdownN: number | null;
  guessesRemaining: number;
  /** Increments on each guess attempt during the round (synced). */
  attemptsThisRound: number;
  /** Set when round ends (correct or out of guesses). */
  roundDurationMs: number | null;
  roundEndReason: "correct" | "out_of_guesses" | null;
  /** Shown on result screen to both players. */
  lastRoundWord: string | null;
  lastRoundTimeMs: number | null;
  lastRoundAttempts: number;
  readyLobbyHost: boolean;
  readyLobbyGuest: boolean;
  readyNextHost: boolean;
  readyNextGuest: boolean;
  /** Ephemeral UI line for guesser after wrong guess (safe — no secret). */
  guesserHint: string | null;
};

export type GuestToHostLipMsg =
  | { t: "lr_name"; name: string }
  | { t: "lr_ready_lobby"; ready: boolean }
  | { t: "lr_guess"; text: string }
  | { t: "lr_ready_next"; ready: boolean };

export type HostToGuestLipMsg = {
  t: "lr_state";
  state: LipReaderNetState;
  seq: number;
  sentAt: number;
};

export function initialLipReaderState(): LipReaderNetState {
  return {
    phase: "lobby",
    hostName: "",
    guestName: "",
    communicatorIsHost: true,
    secretWord: "",
    roundStartAt: null,
    countdownStartedAt: null,
    countdownN: null,
    guessesRemaining: 3,
    attemptsThisRound: 0,
    roundDurationMs: null,
    roundEndReason: null,
    lastRoundWord: null,
    lastRoundTimeMs: null,
    lastRoundAttempts: 0,
    readyLobbyHost: false,
    readyLobbyGuest: false,
    readyNextHost: false,
    readyNextGuest: false,
    guesserHint: null,
  };
}

export function cloneLipReaderState(s: LipReaderNetState): LipReaderNetState {
  return {
    phase: s.phase,
    hostName: s.hostName,
    guestName: s.guestName,
    communicatorIsHost: s.communicatorIsHost,
    secretWord: s.secretWord,
    roundStartAt: s.roundStartAt,
    countdownStartedAt: s.countdownStartedAt,
    countdownN: s.countdownN,
    guessesRemaining: s.guessesRemaining,
    attemptsThisRound: s.attemptsThisRound,
    roundDurationMs: s.roundDurationMs,
    roundEndReason: s.roundEndReason,
    lastRoundWord: s.lastRoundWord,
    lastRoundTimeMs: s.lastRoundTimeMs,
    lastRoundAttempts: s.lastRoundAttempts,
    readyLobbyHost: s.readyLobbyHost,
    readyLobbyGuest: s.readyLobbyGuest,
    readyNextHost: s.readyNextHost,
    readyNextGuest: s.readyNextGuest,
    guesserHint: s.guesserHint,
  };
}

/**
 * Strip secret word for guest packets:
 * - guesser never receives the word during a round
 * - communicator only receives it once `phase === "playing"` (not during countdown)
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
