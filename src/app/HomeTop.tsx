"use client";

import Link from "next/link";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import styles from "./page.module.css";

export function HomeTop() {
  const { profile } = useGameFaceProfile();
  const xp = profile.xp ?? 120;

  return (
    <header className={styles.homeTopStrip}>
      <div className={styles.homeTopRow}>
        <Link href="/profile" className={styles.homeProfile}>
          <div className={styles.homeAvatar} aria-hidden />
          <div className={styles.homeProfileText}>
            <div className={styles.homeHandle}>@{profile.username}</div>
            <div className={styles.homeLevelStats}>
              LEVEL {profile.level} • {xp} XP
            </div>
          </div>
        </Link>
        <span className={styles.homeWordmark}>gameface</span>
      </div>
      <div className={styles.homeTopDivider} aria-hidden />
    </header>
  );
}
