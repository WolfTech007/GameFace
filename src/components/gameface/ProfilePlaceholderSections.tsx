import styles from "./ProfilePlaceholderSections.module.css";

export function ProfilePlaceholderSections() {
  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.h2}>Stats</h2>
        <StatsPlaceholderGrid />
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Recent activity</h2>
        <p className={styles.empty}>Activity feed coming soon.</p>
      </section>
    </>
  );
}

function StatsPlaceholderGrid() {
  return (
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
  );
}
