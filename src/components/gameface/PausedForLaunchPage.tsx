"use client";

import Link from "next/link";
import styles from "./ArchivedGamePage.module.css";

export type PausedForLaunchPageProps = {
  title: string;
};

/** Face Card and similar: not in launch lineup; code preserved for a later release. */
export function PausedForLaunchPage({ title }: PausedForLaunchPageProps) {
  return (
    <main className={styles.root}>
      <div className={styles.glow} aria-hidden />
      <div className={styles.card}>
        <p className={styles.badge}>Paused for launch</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>
          This game is on hold while we stabilize FacePong, Staring Contest, and Charades. Check back soon.
        </p>
        <Link href="/" className={styles.cta}>
          Back to GameFace
        </Link>
      </div>
    </main>
  );
}
