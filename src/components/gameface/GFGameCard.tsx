import Link from "next/link";
import React from "react";
import { WebcamFrame } from "./WebcamFrame";
import styles from "./GFGameCard.module.css";

export type GFGameCardProps = {
  href: string;
  title: string;
  descriptor: string;
  category: string;
  accent: "charades" | "staring" | "facepong";
  playersOnline?: string;
};

export function GFGameCard({
  href,
  title,
  descriptor,
  category,
  accent,
  playersOnline,
}: GFGameCardProps) {
  return (
    <Link href={href} className={styles.link}>
      <WebcamFrame accent={accent} label={title} className={styles.cardSurface}>
        <div className={styles.placeholder} aria-hidden />
      </WebcamFrame>
      <div className={styles.meta}>
        <div className={styles.row}>
          <span className={styles.category}>{category}</span>
          {playersOnline ? <span className={styles.live}>{playersOnline}</span> : null}
        </div>
        <div className={styles.desc}>{descriptor}</div>
      </div>
    </Link>
  );
}
