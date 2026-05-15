"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { GFButton } from "@/components/gameface";
import styles from "./page.module.css";

export function HomeTop() {
  const router = useRouter();
  const { profile } = useGameFaceProfile();
  const { user, isLoading, signOut } = useAuth();
  const xp = profile.xp ?? 120;

  return (
    <header className={styles.homeTopStrip}>
      <div className={styles.headerLogoWrap}>
        <img
          src="/assets/gameface-header.png"
          alt="GAMEFACE — face to face gaming"
          className={styles.headerLogo}
          width={1024}
          height={257}
          fetchPriority="high"
          decoding="async"
          draggable={false}
        />
      </div>

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
          <GFButton
            variant="ghost"
            className={styles.homeChallengeBtn}
            type="button"
            title="Open Friends — then pick a game from home and use Challenge Friend on its intro"
            onClick={() => router.push("/friends")}
          >
            Challenge
          </GFButton>
          {isLoading ? (
            <span className={styles.homeAuthPlaceholder} aria-live="polite">
              …
            </span>
          ) : user ? (
            <button type="button" className={styles.homeLogoutBtn} onClick={() => void signOut()}>
              Log out
            </button>
          ) : (
            <span className={styles.homeAuthLinks}>
              <Link href="/login" className={styles.homeAccountLink}>
                Log in
              </Link>
              <span className={styles.homeAuthSep} aria-hidden>
                ·
              </span>
              <Link href="/signup" className={styles.homeAccountLink}>
                Sign up
              </Link>
            </span>
          )}
        </div>
      </div>

      <div className={styles.homeTopDivider} aria-hidden />
    </header>
  );
}
