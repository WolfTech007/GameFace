"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { loadActivity, type ActivityEntry } from "@/lib/gameface/socialStore";
import { GFBottomNav } from "@/components/gameface";
import styles from "./page.module.css";

function formatTime(at: number) {
  const d = new Date(at);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ActivityPage() {
  const [feed] = useState<ActivityEntry[]>(() => loadActivity());

  const grouped = useMemo(() => feed.slice(0, 40), [feed]);

  return (
    <div className={styles.shell}>
      <main className={styles.root}>
        <header className={styles.head}>
          <Link href="/" className={styles.back}>
            ← Games
          </Link>
          <p className={styles.brand}>GAMEFACE</p>
          <h1 className={styles.title}>Activity</h1>
          <p className={styles.sub}>Recent matches and social pulse.</p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.h2}>Match history</h2>
          <ul className={styles.list}>
            {grouped.map((e) => (
              <li key={e.id} className={styles.item}>
                <div className={styles.itemTitle}>{e.title}</div>
                {e.detail ? <div className={styles.itemDetail}>{e.detail}</div> : null}
                <div className={styles.time}>{formatTime(e.at)}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Stats snapshot</h2>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Favorite game</span>
              <span className={styles.statVal}>Charades</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Win streak</span>
              <span className={styles.statVal}>—</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Games played</span>
              <span className={styles.statVal}>—</span>
            </div>
          </div>
        </section>

        <div className={styles.spacer} />
      </main>
      <GFBottomNav activeHref="/activity" />
    </div>
  );
}
