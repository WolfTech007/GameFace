import Link from "next/link";
import styles from "./page.module.css";

export default function Page() {
  return (
    <main className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>Face Arcade</div>
        <div className={styles.subtitle}>Play games with your face.</div>
      </div>

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardTitle}>FaceBreaker</div>
          <div className={styles.cardDesc}>Break bricks with your nose.</div>
          <Link className={styles.playButton} href="/facebreaker">
            Play
          </Link>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}>FacePong</div>
          <div className={styles.cardDesc}>1v1 webcam pong.</div>
          <Link className={styles.playButton} href="/facepong">
            Play
          </Link>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}>Staring Contest</div>
          <div className={styles.cardDesc}>Don&apos;t blink.</div>
          <Link className={styles.playButton} href="/staring-contest">
            Play
          </Link>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}>FaceCard</div>
          <div className={styles.cardDesc}>Guess who you are.</div>
          <Link className={styles.playButton} href="/facecard">
            Play
          </Link>
        </section>
      </div>
    </main>
  );
}

