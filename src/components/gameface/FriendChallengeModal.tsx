"use client";

import type { GameIntroSlug } from "@/lib/gameface/gameIntroRegistry";
import styles from "./FriendChallengeModal.module.css";

/** Same slugs as game intro overlays (`introCfg.slug`) — maps to DB slug via `introSlugToPrivateRoomGameSlug`. */
const GAMES: { introSlug: GameIntroSlug; label: string }[] = [
  { introSlug: "charades", label: "Charades" },
  { introSlug: "staring-contest", label: "Staring Contest" },
  { introSlug: "facepong", label: "FacePong" },
  { introSlug: "stack-up", label: "Stack Up" },
];

export type FriendChallengeModalProps = {
  friendUsername: string;
  onPick: (introSlug: GameIntroSlug) => void;
  onClose: () => void;
};

export function FriendChallengeModal({ friendUsername, onPick, onClose }: FriendChallengeModalProps) {
  return (
    <div className={styles.root} role="dialog" aria-modal="true" aria-labelledby="fcm-title">
      <button type="button" className={styles.backdrop} aria-label="Close" onClick={onClose} />
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 id="fcm-title" className={styles.title}>
          Challenge @{friendUsername}
        </h2>
        <p className={styles.hint}>Pick a game. You will get a private invite link to send them.</p>
        <ul className={styles.list}>
          {GAMES.map((g) => (
            <li key={g.introSlug}>
              <button
                type="button"
                className={styles.gameBtn}
                onClick={() => {
                  console.log("[friends-challenge] picked introSlug:", g.introSlug);
                  onPick(g.introSlug);
                }}
              >
                {g.label}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className={styles.cancel} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
