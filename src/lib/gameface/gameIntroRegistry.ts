/** Routes under `/` that show the universal GameIntro (not the live arena). */
export type GameIntroSlug = "charades" | "staring-contest" | "facepong";

export type GameIntroAccent = "charades" | "staring" | "facepong";

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
      "Act out the word on screen and help your partner guess as many as possible before time runs out.",
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
};
