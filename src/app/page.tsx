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
          <div className={styles.heroActions}>
            <Link href="/match/random" className={styles.heroQuickCard}>
              <span className={styles.heroQuickCardText}>
                <h1 id="quick-match-heading" className={styles.heroQuickTitle}>
                  Quick match
                </h1>
                <p className={styles.heroQuickMeta}>Random games against strangers</p>
              </span>
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
              href="/charades/play"
              title="Charades"
              descriptor="Guess the muted word."
              accent="charades"
            />
            <GFGameCard
              href="/staring-contest/play"
              title="Staring Contest"
              descriptor="Don't blink."
              accent="staring"
            />
            <GFGameCard href="/facepong/play" title="FacePong" descriptor="1v1 webcam pong." accent="facepong" />
            <GFGameCard
              href="/facecard/play"
              title="Face Card"
              descriptor="Guess the name on your forehead."
              accent="facecard"
            />
            <GFGameCard
              href="/blink-stacker"
              title="Blink Stacker"
              descriptor="Solo · blink timing tower."
              accent="blinkstacker"
              mode="solo"
            />
            <GFGameCard href="/stack-up/play" title="Stack Up" descriptor="1v1 · stack on your opponent." accent="blinkstackerduel" />
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
