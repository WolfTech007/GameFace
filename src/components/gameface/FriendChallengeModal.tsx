"use client";

import type { PrivateRoomGameSlug } from "@/lib/gameface/privateRoomGames";
import styles from "./FriendChallengeModal.module.css";

const GAMES: { slug: PrivateRoomGameSlug; label: string }[] = [
  { slug: "lipreader", label: "Charades" },
  { slug: "staring-contest", label: "Staring Contest" },
  { slug: "facepong", label: "FacePong" },
  { slug: "stack-up", label: "Stack Up" },
];

export type FriendChallengeModalProps = {
  friendUsername: string;
  onPick: (slug: PrivateRoomGameSlug) => void;
  onClose: () => void;
};

export function FriendChallengeModal({ friendUsername, onPick, onClose }: FriendChallengeModalProps) {
  return (
    <div className={styles.root} role="dialog" aria-modal="true" aria-labelledby="fcm-title">
      <button type="button" className={styles.backdrop} aria-label="Close" onClick={onClose} />
      <div className={styles.panel}>
        <h2 id="fcm-title" className={styles.title}>
          Challenge @{friendUsername}
        </h2>
        <p className={styles.hint}>Pick a game. You will get a private invite link to send them.</p>
        <ul className={styles.list}>
          {GAMES.map((g) => (
            <li key={g.slug}>
              <button type="button" className={styles.gameBtn} onClick={() => onPick(g.slug)}>
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
