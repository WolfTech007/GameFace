import styles from "./PlayRouteFallback.module.css";

/** Shown while resolving search params for game play routes (inside Suspense). */
export function PlayRouteFallback() {
  return (
    <main className={styles.root}>
      <p className={styles.brand}>GAMEFACE</p>
      <p className={styles.sub}>Loading…</p>
    </main>
  );
}
