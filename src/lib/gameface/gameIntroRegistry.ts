/** Canonical slugs for copy + accent (used by GameIntroOverlay on `/play` routes). */
export type GameIntroSlug = "charades" | "staring-contest" | "facepong" | "stack-up";

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
  "stack-up": {
    slug: "stack-up",
    title: "STACK UP",
    description:
      "Build a shared tower directly on your opponent's live camera feed. Take turns blinking to stop the moving block.",
    accent: "blinkstackerduel",
    playPath: "/stack-up/play",
  },
};
