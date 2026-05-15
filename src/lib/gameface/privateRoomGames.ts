import type { GameIntroSlug } from "@/lib/gameface/gameIntroRegistry";

/** Stored in `private_rooms.game_slug` — matches PeerJS prefix conventions (`lipreader-*` on `/charades/play`). */
export type PrivateRoomGameSlug =
  | "facepong"
  | "facecard"
  | "stack-up"
  | "staring-contest"
  | "lipreader";

export const PRIVATE_ROOM_PEER_PREFIX: Record<PrivateRoomGameSlug, string> = {
  facepong: "facepong",
  facecard: "facecard",
  "stack-up": "stackup",
  "staring-contest": "staring",
  lipreader: "lipreader",
};

export function playPathForPrivateRoomGame(slug: PrivateRoomGameSlug): string {
  switch (slug) {
    case "facepong":
      return "/facepong/play";
    case "facecard":
      return "/facecard/play";
    case "stack-up":
      return "/stack-up/play";
    case "staring-contest":
      return "/staring-contest/play";
    case "lipreader":
      return "/charades/play";
    default: {
      const _: never = slug;
      return _;
    }
  }
}

/** Solo / unsupported intros fall back to legacy `/friends` navigation. */
export function introSlugToPrivateRoomGameSlug(intro: GameIntroSlug): PrivateRoomGameSlug | null {
  switch (intro) {
    case "charades":
      return "lipreader";
    case "facepong":
      return "facepong";
    case "facecard":
      return "facecard";
    case "stack-up":
      return "stack-up";
    case "staring-contest":
      return "staring-contest";
    default:
      return null;
  }
}
