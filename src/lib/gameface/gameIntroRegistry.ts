/** Canonical slugs for copy + accent (used by GameIntroOverlay on `/play` routes). */
export type GameIntroSlug =
  | "charades"
  | "staring-contest"
  | "facepong"
  | "facecard"
  | "stack-up"
  | "blink-stacker";

export type GameIntroAccent =
  | "charades"
  | "staring"
  | "facepong"
  | "facecard"
  | "blinkstackerduel"
  | "blinkstacker";

export type GameIntroConfig = {
  slug: GameIntroSlug;
  /** Display title — typically uppercase */
  title: string;
  /** One-line pitch shown under the title */
  description: string;
  /** Frame accent for the hero thumbnail */
  accent: GameIntroAccent;
  /** Arena route — matchmaking & WebRTC live here */
  playPath: string;
};

export const GAME_INTRO_REGISTRY: Record<GameIntroSlug, GameIntroConfig> = {
  charades: {
    slug: "charades",
    title: "CHARADES",
    description:
      "Same team, two 60-second bursts: one player clues while the other guesses, then you swap. Rack up one combined score — skip anytime for a fresh word.",
    accent: "charades",
    playPath: "/charades/play",
  },
  "staring-contest": {
    slug: "staring-contest",
    title: "STARING CONTEST",
    description: "Hold eye contact with the camera — first player to blink loses.",
    accent: "staring",
    playPath: "/staring-contest/play",
  },
  facepong: {
    slug: "facepong",
    title: "FACEPONG",
    description:
      "Control your paddle with your face and outscore your opponent in a fast webcam arcade match.",
    accent: "facepong",
    playPath: "/facepong/play",
  },
  facecard: {
    slug: "facecard",
    title: "FACE CARD",
    description:
      "Each player wears a secret name on their forehead. Ask questions and guess who you are before your guesses run out.",
    accent: "facecard",
    playPath: "/facecard/play",
  },
  "stack-up": {
    slug: "stack-up",
    title: "STACK UP",
    description:
      "Build a shared tower directly on your opponent's live camera feed. Take turns blinking to stop the moving block.",
    accent: "blinkstackerduel",
    playPath: "/stack-up/play",
  },
  "blink-stacker": {
    slug: "blink-stacker",
    title: "BLINK STACKER",
    description:
      "Stack the tower: when the moving block lines up, blink (or press Space / tap) to lock it. Too little overlap and the run ends.",
    accent: "blinkstacker",
    playPath: "/blink-stacker",
  },
};
