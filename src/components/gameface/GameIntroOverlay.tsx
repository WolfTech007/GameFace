"use client";

import type { GameIntroAccent } from "@/lib/gameface/gameIntroRegistry";
import styles from "./GameIntroOverlay.module.css";

export type GameIntroOverlayPlacement = "viewport" | "frame";

export type GameIntroOverlayProps = {
  gameTitle: string;
  howToPlayText: string;
  accent?: GameIntroAccent;
  /** Default "FIND MATCH" — use "START GAME" for solo modes */
  findMatchLabel?: string;
  showChallengeFriend?: boolean;
  onFindMatch: () => void;
  onChallengeFriend: () => void;
  onGoHome: () => void;
  /** `frame` = position absolute inside a positioned arena parent */
  placement?: GameIntroOverlayPlacement;
  className?: string;
};

const accentClass: Record<GameIntroAccent, string> = {
  charades: styles.accentCharades,
  staring: styles.accentStaring,
  facepong: styles.accentFacepong,
  facecard: styles.accentFacecard,
  blinkstackerduel: styles.accentBlinkstackerduel,
  blinkstacker: styles.accentBlinkstacker,
};

export function GameIntroOverlay({
  gameTitle,
  howToPlayText,
  accent = "facepong",
  findMatchLabel = "FIND MATCH",
  showChallengeFriend = true,
  onFindMatch,
  onChallengeFriend,
  onGoHome,
  placement = "viewport",
  className,
}: GameIntroOverlayProps) {
  const wrapClass = placement === "frame" ? styles.rootInFrame : styles.root;
  const ac = accentClass[accent] ?? styles.accentFacepong;

  return (
    <div className={`${wrapClass} ${className ?? ""}`} role="dialog" aria-modal="true" aria-labelledby="gio-title">
      <div className={styles.backdrop} aria-hidden />
      <div className={`${styles.panel} ${ac}`}>
        <h1 id="gio-title" className={styles.title}>
          {gameTitle}
        </h1>
        <p className={styles.body}>{howToPlayText}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.btnPrimary} onClick={onFindMatch}>
            {findMatchLabel}
          </button>
          {showChallengeFriend ? (
            <button type="button" className={styles.btnSecondary} onClick={onChallengeFriend}>
              CHALLENGE FRIEND
            </button>
          ) : null}
          <button type="button" className={styles.btnGhost} onClick={onGoHome}>
            GO HOME
          </button>
        </div>
      </div>
    </div>
  );
}
