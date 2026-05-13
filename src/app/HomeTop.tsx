"use client";

import Link from "next/link";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { GFButton } from "@/components/gameface";
import styles from "./page.module.css";

export function HomeTop() {
  const { profile } = useGameFaceProfile();
  const xp = profile.xp ?? 120;

  return (
    <header className={styles.homeTopStrip}>
      <div className={styles.homeLockup} aria-label="GAMEFACE">
        <span className={styles.homeLogoGame}>GAME</span>
        <span className={styles.homeLogoFace}>FACE</span>
      </div>
      <p className={styles.homeTagline}>Face to face gaming</p>

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
        <div className={styles.homeTopRight}>
          <span className={styles.homeFriendsOnline}>3 friends online</span>
          <GFButton variant="ghost" className={styles.homeChallengeBtn} disabled title="Coming soon">
            Challenge
          </GFButton>
          <Link href="/login" className={styles.homeAccountLink}>
            Account
          </Link>
        </div>
      </div>

      <div className={styles.homeTopDivider} aria-hidden />
    </header>
  );
}
