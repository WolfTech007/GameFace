import Link from "next/link";
import { GFButton, GFGameCard, GFBottomNav } from "@/components/gameface";
import styles from "./page.module.css";

export default function Page() {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.profile}>
            <div className={styles.avatar} aria-hidden />
            <div className={styles.profileText}>
              <div className={styles.handle}>@you</div>
              <div className={styles.levelRow}>
                <span className={styles.level}>Level 1</span>
                <span className={styles.dot} aria-hidden />
                <span className={styles.online}>Online</span>
              </div>
            </div>
          </div>
          <div className={styles.topRight}>
            <span className={styles.friendsOnline}>3 friends online</span>
            <GFButton variant="ghost" className={styles.challengeBtn} disabled title="Coming soon">
              Challenge
            </GFButton>
          </div>
        </header>

        <section className={styles.hero} aria-labelledby="quick-match-heading">
          <p className={styles.eyebrow}>Quick start</p>
          <h1 id="quick-match-heading" className={styles.heroTitle}>
            Quick match
          </h1>
          <p className={styles.heroSub}>Pick how you want to play — faces stay center stage.</p>
          <div className={styles.heroActions}>
            <Link href="/lipreader" className={styles.heroPrimary}>
              Random match
            </Link>
            <GFButton variant="ghost" className={styles.heroGhost} disabled title="Coming soon">
              Challenge friend
            </GFButton>
            <GFButton variant="ghost" className={styles.heroGhost} disabled title="Coming soon">
              Party match
            </GFButton>
          </div>
        </section>

        <section className={styles.section} id="games" aria-labelledby="library-heading">
          <div className={styles.sectionHead}>
            <h2 id="library-heading" className={styles.sectionTitle}>
              Game library
            </h2>
            <p className={styles.sectionHint}>Large cards · tap to play</p>
          </div>

          <GFGameCard
            href="/lipreader"
            title="Lip Reader"
            descriptor="Guess the muted word — fast, social, ridiculous."
            category="Most popular"
            accent="charades"
            playersOnline="Live"
          />
          <GFGameCard
            href="/staring-contest"
            title="Staring Contest"
            descriptor="Don&apos;t blink. Psychological duels."
            category="Fast match"
            accent="staring"
          />
          <GFGameCard
            href="/facepong"
            title="FacePong"
            descriptor="Nose-controlled pong — competitive chaos."
            category="Competitive"
            accent="facepong"
          />
          <GFGameCard
            href="/facecard"
            title="Face Card"
            descriptor="Guess who you are from clues on your forehead."
            category="Best with friends"
            accent="facecard"
          />
          <GFGameCard
            href="/facehockey"
            title="Face Hockey"
            descriptor="Air hockey with your face — kinetic & loud."
            category="Arcade"
            accent="hockey"
          />
          <GFGameCard
            href="/rankit"
            title="Rank It"
            descriptor="Rank the debate — reveal compatibility."
            category="Social"
            accent="rankit"
          />
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
