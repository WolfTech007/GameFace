"use client";

import React from "react";
import styles from "./RematchBar.module.css";

export type RematchBarProps = {
  iWantRematch: boolean;
  theyWantRematch: boolean;
  onRematch: () => void;
  onLeave: () => void;
  opponentLeft?: boolean;
  onReturnArcade?: () => void;
};

export function RematchBar({
  iWantRematch,
  theyWantRematch,
  onRematch,
  onLeave,
  opponentLeft,
  onReturnArcade,
}: RematchBarProps) {
  if (opponentLeft) {
    return (
      <div className={styles.wrap}>
        <p className={styles.wait}>Opponent left</p>
        <button type="button" className={styles.primary} onClick={onReturnArcade ?? onLeave}>
          Back to arcade
        </button>
      </div>
    );
  }

  const waiting = iWantRematch && !theyWantRematch;

  return (
    <div className={styles.wrap}>
      {waiting ? <p className={styles.wait}>Waiting for opponent…</p> : null}
      <button type="button" className={styles.primary} onClick={onRematch} disabled={iWantRematch}>
        {iWantRematch ? "Rematch ✓" : "Rematch"}
      </button>
      <button type="button" className={styles.secondary} onClick={onLeave}>
        Leave Match
      </button>
    </div>
  );
}
