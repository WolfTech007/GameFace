"use client";

import Link from "next/link";
import { GFButton } from "./GFButton";
import { WebcamFrame } from "./WebcamFrame";
import {
  GAME_INTRO_REGISTRY,
  type GameIntroSlug,
} from "@/lib/gameface/gameIntroRegistry";
import { GFBottomNav } from "./GFBottomNav";
import styles from "./GameIntro.module.css";

export type GameIntroProps = {
  slug: GameIntroSlug;
};

export function GameIntro({ slug }: GameIntroProps) {
  const cfg = GAME_INTRO_REGISTRY[slug];

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <Link href="/" className={styles.back}>
          ← Games
        </Link>

        <div className={styles.hero}>
          <WebcamFrame accent={cfg.accent}>
            <div className={styles.thumbPlaceholder} aria-hidden />
          </WebcamFrame>

          <h1 className={styles.title}>{cfg.title}</h1>
          <p className={styles.desc}>{cfg.description}</p>

          <div className={styles.actions}>
            <Link href={`${cfg.playPath}?queue=1`} className={styles.primary}>
              Find match
            </Link>
            <GFButton variant="ghost" className={styles.secondary} disabled title="Coming soon">
              Challenge friend
            </GFButton>
          </div>
        </div>
      </main>
      <GFBottomNav activeHref="/" />
    </div>
  );
}
