"use client";

import Link from "next/link";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { loadActivity } from "@/lib/gameface/socialStore";
import { GFBottomNav } from "@/components/gameface";
import styles from "./page.module.css";

export default function ProfilePage() {
  const { profile } = useGameFaceProfile();
  const recent = loadActivity().slice(0, 5);

  return (
    <div className={styles.shell}>
      <main className={styles.root}>
        <header className={styles.head}>
          <Link href="/" className={styles.back}>
            ← Games
          </Link>
          <p className={styles.brand}>GAMEFACE</p>
        </header>

        <div className={styles.hero}>
          <div className={styles.avatar} aria-hidden />
          <h1 className={styles.username}>@{profile.username}</h1>
          <p className={styles.display}>{profile.displayName}</p>
          <div className={styles.badges}>
            <span className={styles.badge}>Level {profile.level}</span>
            <span className={styles.badge}>{profile.rank}</span>
          </div>
        </div>

        <section className={styles.section}>
          <h2 className={styles.h2}>Lifetime</h2>
          <div className={styles.grid}>
            <div className={styles.cell}>
              <span className={styles.cellLabel}>Win %</span>
              <span className={styles.cellVal}>—</span>
            </div>
            <div className={styles.cell}>
              <span className={styles.cellLabel}>Games</span>
              <span className={styles.cellVal}>—</span>
            </div>
            <div className={styles.cell}>
              <span className={styles.cellLabel}>Friends</span>
              <span className={styles.cellVal}>—</span>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Favorite game</h2>
          <p className={styles.p}>{profile.favoriteGame ?? "Not set"}</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Recent matches</h2>
          <ul className={styles.mini}>
            {recent.map((e) => (
              <li key={e.id}>{e.title}</li>
            ))}
          </ul>
          <Link href="/activity" className={styles.link}>
            View all activity →
          </Link>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Badges</h2>
          <div className={styles.badgesRow}>
            <span className={styles.badgeSoft}>Unblinking</span>
            <span className={styles.badgeSoft}>Fast Guesser</span>
            <span className={styles.badgeSoft}>Mind Reader</span>
          </div>
          <p className={styles.hint}>Earn badges by playing — syncs with your account soon.</p>
        </section>

        <Link href="/login" className={styles.edit}>
          Edit profile / Sign in
        </Link>

        <div className={styles.spacer} />
      </main>
      <GFBottomNav activeHref="/profile" />
    </div>
  );
}
