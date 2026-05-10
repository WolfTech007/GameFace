/** Peer messages for FaceCard (host-authoritative game state). */

export type FaceCardNetMsg =
  | { t: "fc_hello"; displayName: string }
  | { t: "fc_ready"; ready: boolean }
  | {
      t: "fc_begin";
      /** Wall-clock ms when the round timer starts (both clients). */
      startWallMs: number;
      /** Host’s card label — guest renders this on the remote (top) video only. */
      remoteCardLabel: string;
    }
  | { t: "fc_try"; text: string }
  | {
      t: "fc_try_result";
      correct: boolean;
      yourGuessesLeft: number;
      ended: boolean;
      /** Present when this guess ended the game (guest won). */
      youWon?: boolean;
    }
  | {
      t: "fc_sync";
      hostGuessesLeft: number;
      guestGuessesLeft: number;
    }
  | {
      t: "fc_end";
      outcome: "win_host" | "win_guest" | "draw";
      hostCard: string;
      guestCard: string;
      durationSec: number;
    };
