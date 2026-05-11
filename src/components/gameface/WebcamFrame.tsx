"use client";

import React from "react";
import styles from "./WebcamFrame.module.css";

export type WebcamFrameVariant = "you" | "opponent" | "neutral";

export type WebcamFrameProps = {
  variant?: WebcamFrameVariant;
  label?: string;
  /** Corner accent used by hero cards / library thumbnails (CSS variable name suffix optional). */
  accent?: "you" | "opponent" | "charades" | "staring" | "facepong" | "facecard" | "hockey" | "rankit";
  children?: React.ReactNode;
  className?: string;
};

const accentClass: Record<NonNullable<WebcamFrameProps["accent"]>, string> = {
  you: styles.accentYou,
  opponent: styles.accentOpponent,
  charades: styles.accentCharades,
  staring: styles.accentStaring,
  facepong: styles.accentFacepong,
  facecard: styles.accentFacecard,
  hockey: styles.accentHockey,
  rankit: styles.accentRankit,
};

export function WebcamFrame({
  variant = "neutral",
  label,
  accent,
  children,
  className,
}: WebcamFrameProps) {
  const v =
    variant === "you" ? styles.variantYou : variant === "opponent" ? styles.variantOpponent : styles.variantNeutral;
  const ac = accent ? accentClass[accent] : "";
  return (
    <div className={`${styles.wrap} ${v} ${ac} ${className ?? ""}`}>
      <span className={styles.cornerTL} aria-hidden />
      <span className={styles.cornerTR} aria-hidden />
      <span className={styles.cornerBL} aria-hidden />
      <span className={styles.cornerBR} aria-hidden />
      <div className={styles.inner}>{children}</div>
      {label ? <div className={styles.frameLabel}>{label}</div> : null}
    </div>
  );
}
