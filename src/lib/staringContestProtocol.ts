export type StaringNetMsg =
  | { t: "hello"; name: string }
  | { t: "ready"; ready: boolean }
  | { t: "countdown"; n: number }
  | { t: "game_go"; startWallMs: number }
  | { t: "blink"; fromHost: boolean; atMs: number }
  | { t: "face_lost"; fromHost: boolean; atMs: number }
  | {
      t: "game_over";
      winnerIsHost: boolean;
      roundSeconds: number;
    };
