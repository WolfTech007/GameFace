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

function AccentIcon({ accent }: { accent: GFGameCardAccent }) {
  const common = { className: styles.iconSvg, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true as const };
  switch (accent) {
    case "charades":
      return (
        <svg {...common}>
          <path
            d="M7 16V8M12 16v-8M17 16V10"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
          />
        </svg>
      );
    case "staring":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12" rx="7" ry="4.5" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.85" />
        </svg>
      );
    case "facepong":
      return (
        <svg {...common}>
          <rect x="5" y="6" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="12" y1="6" x2="12" y2="18" stroke="currentColor" strokeWidth="1" opacity="0.35" />
          <circle cx="12" cy="10" r="1.25" fill="currentColor" />
          <line x1="7" y1="9" x2="7" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="17" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "facecard":
      return (
        <svg {...common}>
          <rect x="6" y="5" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 9h6M9 12h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
    case "friends":
      return (
        <svg {...common}>
          <circle cx="9" cy="10" r="2.75" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="15" cy="10" r="2.75" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M6 18c0-2.2 1.8-4 4-4h4c2.2 0 4 1.8 4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "tiptionary":
      return (
        <svg {...common}>
          <path
            d="M7 18l3-12M14 18l3-12M8.5 14h7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

export function GFGameCard({ href, title, descriptor, accent, disabled }: GFGameCardProps) {
  const ac = ACCENT_CLASS[accent];

  const body = (
    <>
      <span className={styles.iconWrap} aria-hidden>
        <AccentIcon accent={accent} />
      </span>
      <span className={styles.textCol}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardDesc}>{descriptor}</span>
      </span>
      <span className={styles.playPill} aria-hidden>
        <span className={styles.playLabel}>FIND MATCH</span>
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
    <Link href={href} className={rootClass} aria-label={`${title}. ${descriptor}. Find match.`}>
      {body}
    </Link>
  );
}
