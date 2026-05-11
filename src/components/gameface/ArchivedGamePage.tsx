"use client";

import Link from "next/link";
import styles from "./ArchivedGamePage.module.css";

export type ArchivedGamePageProps = {
  title: string;
};

export function ArchivedGamePage({ title }: ArchivedGamePageProps) {
  return (
    <main className={styles.root}>
      <div className={styles.glow} aria-hidden />
      <div className={styles.card}>
        <p className={styles.badge}>Archived</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>
          This mode is no longer part of the active GameFace lineup. Thanks for playing the prototype.
        </p>
        <Link href="/" className={styles.cta}>
          Back to GameFace
        </Link>
      </div>
    </main>
  );
}
