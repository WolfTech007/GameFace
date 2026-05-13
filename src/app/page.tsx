import Link from "next/link";
import { GFGameCard, GFBottomNav } from "@/components/gameface";
import { HomeTop } from "./HomeTop";
import styles from "./page.module.css";

export default function Page() {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <HomeTop />

        <section className={styles.hero} aria-labelledby="quick-match-heading">
          <p className={styles.eyebrow}>Quick start</p>
          <h1 id="quick-match-heading" className={styles.heroTitle}>
            Quick match
          </h1>
          <p className={styles.heroSub}>Pick how you want to play — faces stay center stage.</p>
          <div className={styles.heroActions}>
            <Link href="/match/random" className={styles.heroPrimary}>
              Random match
            </Link>
          </div>
        </section>

        <section className={styles.section} id="games" aria-labelledby="library-heading">
          <div className={styles.sectionHead}>
            <h2 id="library-heading" className={styles.sectionTitle}>
              Game library
            </h2>
            <p className={styles.sectionHint}>Pick a game, then find a match</p>
          </div>

          <div className={styles.gameCardList}>
            <GFGameCard
              href="/friends"
              title="Challenge Friend"
              descriptor="Invite friends"
              accent="friends"
            />
            <GFGameCard
              href="/charades"
              title="Lip Reader"
              descriptor="Guess the muted word."
              accent="charades"
            />
            <GFGameCard
              href="/staring-contest"
              title="Staring Contest"
              descriptor="Don't blink."
              accent="staring"
            />
            <GFGameCard href="/facecard" title="FaceCard" descriptor="Guess who you are" accent="facecard" />
            <GFGameCard href="/facepong" title="FacePong" descriptor="1v1 webcam pong." accent="facepong" />
            <GFGameCard
              href="#"
              title="Tiptionary"
              descriptor="Draw with your nose."
              accent="tiptionary"
              disabled
            />
          </div>
        </section>

        <section className={styles.section} id="friends" aria-labelledby="social-heading">
          <div className={styles.sectionHead}>
            <h2 id="social-heading" className={styles.sectionTitle}>
              Friends
            </h2>
            <p className={styles.sectionHint}>Wanna hop on?</p>
          </div>
          <div className={styles.friendsRow}>
            {["Ava", "Milo", "Jun"].map((name) => (
              <button key={name} type="button" className={styles.friendChip} disabled title="Coming soon">
                <span className={styles.friendDot} aria-hidden />
                {name}
              </button>
            ))}
          </div>
        </section>

        <div className={styles.spacer} aria-hidden />
      </main>

      <GFBottomNav activeHref="/" />
    </div>
  );
}
