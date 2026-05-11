"use client";

import React from "react";
import styles from "./GameplayDuelHud.module.css";

export type GameplayDuelHudSide = {
  displayName: string;
  /** e.g. @handle */
  handle?: string;
  level?: number;
  /** Short live stat (score, guesses, streak…) */
  stat?: string;
  online?: boolean;
  variant: "you" | "opponent";
};

export type GameplayDuelHudProps = {
  gameBadge: string;
  opponent: GameplayDuelHudSide;
  you: GameplayDuelHudSide;
};

export function GameplayDuelHud({ gameBadge, opponent, you }: GameplayDuelHudProps) {
  return (
    <header className={styles.bar} aria-label="Match players">
      <div className={`${styles.side} ${styles.sideOpponent}`}>
        <div className={styles.avatar} aria-hidden />
        <div className={styles.meta}>
          <div className={styles.nameRow}>
            {opponent.online ? <span className={styles.liveDot} title="Online" /> : null}
            <span className={styles.name}>{opponent.displayName}</span>
          </div>
          <div className={styles.subRow}>
            {opponent.handle ? `${opponent.handle} · ` : ""}
            {opponent.level != null ? `Lv ${opponent.level}` : "Opponent"}
            {opponent.stat ? <span className={styles.score}> · {opponent.stat}</span> : null}
          </div>
        </div>
      </div>

      <div className={styles.center} aria-hidden>
        <span className={styles.badge}>{gameBadge}</span>
      </div>

      <div className={`${styles.side} ${styles.sideYou}`}>
        <div className={styles.avatar} aria-hidden />
        <div className={styles.meta}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{you.displayName}</span>
            {you.online !== false ? <span className={styles.liveDot} title="Live" /> : null}
          </div>
          <div className={styles.subRow}>
            {you.handle ? `${you.handle} · ` : ""}
            {you.level != null ? `Lv ${you.level}` : "You"}
            {you.stat ? <span className={styles.score}> · {you.stat}</span> : null}
          </div>
        </div>
      </div>
    </header>
  );
}
