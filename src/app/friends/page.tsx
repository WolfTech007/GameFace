"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { GFButton, GFBottomNav } from "@/components/gameface";
import { loadFriendRequests, loadFriends, type FriendEntry } from "@/lib/gameface/socialStore";
import styles from "./page.module.css";

export default function FriendsPage() {
  const [friends, setFriends] = useState<FriendEntry[]>(() => loadFriends());
  const requests = useMemo(() => loadFriendRequests(), []);
  const [query, setQuery] = useState("");

  function refresh() {
    setFriends(loadFriends());
  }

  return (
    <div className={styles.shell}>
    <main className={styles.root}>
      <header className={styles.head}>
        <Link href="/" className={styles.back}>
          ← Games
        </Link>
        <p className={styles.brand}>GAMEFACE</p>
        <h1 className={styles.title}>Friends</h1>
      </header>

      <section className={styles.section}>
        <h2 className={styles.h2}>Add friend</h2>
        <div className={styles.row}>
          <input
            className={styles.input}
            placeholder="Username or friend code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <GFButton variant="primary" className={styles.addBtn} type="button" disabled title="Coming soon">
            Add
          </GFButton>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Online now</h2>
        <div className={styles.list}>
          {friends.filter((f) => f.online).map((f) => (
            <div key={f.userId} className={styles.friendRow}>
              <div className={styles.avatar} aria-hidden />
              <div className={styles.meta}>
                <div className={styles.name}>{f.displayName}</div>
                <div className={styles.handle}>@{f.username}</div>
                {f.currentGame ? <div className={styles.game}>In {f.currentGame}</div> : null}
              </div>
              <div className={styles.actions}>
                <GFButton variant="primary" type="button" disabled title="Coming soon">
                  Challenge
                </GFButton>
                <GFButton variant="ghost" type="button" disabled title="Coming soon">
                  Message
                </GFButton>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>All friends</h2>
        <div className={styles.list}>
          {friends.map((f) => (
            <div key={f.userId} className={styles.friendRowMuted}>
              <div className={styles.avatarMuted} aria-hidden />
              <div>
                <div className={styles.name}>{f.displayName}</div>
                <div className={styles.handle}>@{f.username}</div>
              </div>
              <span className={f.online ? styles.dotOn : styles.dotOff} />
            </div>
          ))}
        </div>
        <button type="button" className={styles.refresh} onClick={refresh}>
          Refresh list
        </button>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>Requests</h2>
        {requests.incoming.length === 0 && requests.outgoing.length === 0 ? (
          <p className={styles.empty}>No pending requests.</p>
        ) : (
          <p className={styles.empty}>Request UI wires to your backend next.</p>
        )}
      </section>

      <div className={styles.spacer} />
    </main>
    <GFBottomNav activeHref="/friends" />
    </div>
  );
}
