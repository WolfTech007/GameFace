"use client";

import Link from "next/link";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { GFButton } from "@/components/gameface";
import styles from "./page.module.css";

export function HomeTop() {
  const { profile } = useGameFaceProfile();

  return (
    <>
      <div className={styles.lockup} aria-label="GameFace">
        <span className={styles.logoGame}>Game</span>
        <span className={styles.logoFace}>Face</span>
      </div>
      <p className={styles.tagline}>Webcam games · faces first</p>

      <header className={styles.topBar}>
        <div className={styles.profile}>
          <div className={styles.avatar} aria-hidden />
          <div className={styles.profileText}>
            <div className={styles.handle}>@{profile.username}</div>
            <div className={styles.levelRow}>
              <span className={styles.level}>Level {profile.level}</span>
              <span className={styles.dot} aria-hidden />
              <span className={styles.rankBadge}>{profile.rank}</span>
              <span className={styles.dot} aria-hidden />
              <span className={styles.online}>Online</span>
            </div>
          </div>
        </div>
        <div className={styles.topRight}>
          <span className={styles.friendsOnline}>3 friends online</span>
          <GFButton variant="ghost" className={styles.challengeBtn} disabled title="Coming soon">
            Challenge
          </GFButton>
          <Link href="/login" className={styles.loginLink}>
            Account
          </Link>
        </div>
      </header>
    </>
  );
}
