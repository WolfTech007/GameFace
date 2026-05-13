import Link from "next/link";
import React from "react";
import styles from "./GFGameCard.module.css";

export type GFGameCardAccent =
  | "charades"
  | "staring"
  | "facepong"
  | "facecard"
  | "friends"
  | "tiptionary";

export type GFGameCardProps = {
  href: string;
  title: string;
  descriptor: string;
  accent: GFGameCardAccent;
  /** When true, card is visual-only (no navigation) — e.g. unreleased game. */
  disabled?: boolean;
};

const ACCENT_CLASS: Record<GFGameCardAccent, string> = {
  charades: styles.accentCharades,
  staring: styles.accentStaring,
  facepong: styles.accentFacepong,
  facecard: styles.accentFacecard,
  friends: styles.accentFriends,
  tiptionary: styles.accentTiptionary,
};

const ACCENT_ICON: Record<GFGameCardAccent, string> = {
  charades: "💬",
  staring: "👁",
  facepong: "🏓",
  facecard: "🃏",
  friends: "👥",
  tiptionary: "✏️",
};

export function GFGameCard({ href, title, descriptor, accent, disabled }: GFGameCardProps) {
  const ac = ACCENT_CLASS[accent];
  const icon = ACCENT_ICON[accent];

  const body = (
    <>
      <span className={styles.iconWrap} aria-hidden>
        <span className={styles.iconGlyph}>{icon}</span>
      </span>
      <span className={styles.textCol}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardDesc}>{descriptor}</span>
      </span>
      <span className={styles.playPill} aria-hidden>
        <span className={styles.playLabel}>PLAY</span>
        <span className={styles.playArrow}>→</span>
      </span>
    </>
  );

  const rootClass = `${styles.rowCard} ${ac} ${disabled ? styles.rowDisabled : ""}`;

  if (disabled) {
    return (
      <div
        className={rootClass}
        role="group"
        aria-label={`${title}. ${descriptor}. Coming soon.`}
        aria-disabled
      >
        {body}
      </div>
    );
  }

  return (
    <Link href={href} className={rootClass} aria-label={`${title}. ${descriptor}. Play.`}>
      {body}
    </Link>
  );
}
