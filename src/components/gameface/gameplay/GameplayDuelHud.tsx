"use client";

import React from "react";
import styles from "./GameplayDuelHud.module.css";

export type DuelHudIdentity = {
  displayName: string;
  /** Plain handle without @; empty string shows a muted placeholder line */
  username: string;
  /** Presence dot; omit defaults to “live” for both sides */
  online?: boolean;
};

export type GameplayDuelHudProps = {
  gameBadge: string;
  opponent: DuelHudIdentity;
  you: DuelHudIdentity;
  /** FacePong arcade HUD — glass cards + gradient title; other games omit. */
  variant?: "default" | "facePong";
};

function UsernameLine({ plain, align }: { plain: string; align: "start" | "end" }) {
  const t = plain.trim();
  const placeholder = !t;
  return (
    <div
      className={`${styles.username} ${placeholder ? styles.usernamePlaceholder : ""} ${
        align === "end" ? styles.usernameEnd : ""
      }`}
    >
      {placeholder ? "@···" : `@${t}`}
    </div>
  );
}

export function GameplayDuelHud({ gameBadge, opponent, you, variant = "default" }: GameplayDuelHudProps) {
  const youOnline = you.online !== false;
  const oppOnline = opponent.online !== false;
  const fp = variant === "facePong";

  return (
    <header className={`${styles.bar} ${fp ? styles.barFacePong : ""}`} aria-label="Match players">
      <div
        className={`${styles.side} ${styles.sideOpponent} ${fp ? styles.sideFacePongOpp : ""}`}
      >
        <div className={styles.avatar} aria-hidden />
        <div className={styles.column}>
          <div className={`${styles.primaryRow} ${styles.primaryRowOpp}`}>
            <span className={`${styles.displayName} ${fp ? styles.displayNameFacePong : ""}`}>
              {opponent.displayName}
            </span>
            {oppOnline ? <span className={styles.liveDot} title="Online" /> : null}
          </div>
          <UsernameLine plain={opponent.username} align="start" />
        </div>
      </div>

      <div className={styles.center} aria-hidden>
        <span className={`${styles.badge} ${fp ? styles.badgeFacePong : ""}`}>{gameBadge}</span>
      </div>

      <div className={`${styles.side} ${styles.sideYou} ${fp ? styles.sideFacePongYou : ""}`}>
        <div className={styles.avatar} aria-hidden />
        <div className={styles.column}>
          <div className={`${styles.primaryRow} ${styles.primaryRowYou}`}>
            {youOnline ? <span className={styles.liveDot} title="Live" /> : null}
            <span className={`${styles.displayName} ${fp ? styles.displayNameFacePong : ""}`}>{you.displayName}</span>
          </div>
          <UsernameLine plain={you.username} align="end" />
        </div>
      </div>
    </header>
  );
}
