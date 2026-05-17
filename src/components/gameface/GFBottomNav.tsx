"use client";

import Link from "next/link";
import styles from "./GFBottomNav.module.css";

type NavItem = { href: string; label: string; icon: string };

const items: NavItem[] = [
  { href: "/", label: "Games", icon: "◇" },
  { href: "/friends", label: "Friends", icon: "◎" },
  { href: "/activity", label: "Activity", icon: "≋" },
  { href: "/profile", label: "Profile", icon: "○" },
];

export function GFBottomNav({ activeHref = "/" }: { activeHref?: string }) {
  return (
    <nav className={styles.nav} aria-label="Main">
      <div className={styles.inner}>
        {items.map((item) => {
          const active =
            item.href === activeHref ||
            (item.href === "/profile" &&
              (activeHref === "/profile" || activeHref.startsWith("/profile/")));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.link} ${active ? styles.active : ""}`}
            >
              <span className={styles.icon} aria-hidden>
                {item.icon}
              </span>
              <span className={styles.label}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
