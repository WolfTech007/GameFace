"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FriendChallengeModal } from "@/components/gameface/FriendChallengeModal";
import { GFButton, GFBottomNav } from "@/components/gameface";
import { normalizeUsername, validateUsernameFormat } from "@/lib/auth/authErrors";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import {
  fetchFriendsState,
  respondFriendRequest,
  searchUsersByUsername,
  sendFriendRequest,
  type FriendUser,
  type IncomingFriendRequest,
  type OutgoingFriendRequest,
  type UserSearchHit,
} from "@/lib/gameface/friendsClient";
import { startPrivateFriendChallengeWithGameSlug } from "@/lib/gameface/privateRoomsClient";
import type { PrivateRoomGameSlug } from "@/lib/gameface/privateRoomGames";
import styles from "./page.module.css";

function isSignedInProfile(username: string | undefined): boolean {
  if (!username) return false;
  return !username.startsWith("guest_");
}

export default function FriendsPage() {
  const router = useRouter();
  const { profile } = useGameFaceProfile();
  const signedIn = isSignedInProfile(profile.username);

  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [incoming, setIncoming] = useState<IncomingFriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingFriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<UserSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [challengeFriend, setChallengeFriend] = useState<FriendUser | null>(null);

  const reload = useCallback(async () => {
    if (!signedIn) {
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const state = await fetchFriendsState();
      setFriends(state.friends);
      setIncoming(state.incoming);
      setOutgoing(state.outgoing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load friends.");
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!signedIn) {
      setSearchHits([]);
      return;
    }
    const fmt = validateUsernameFormat(query);
    if (fmt || normalizeUsername(query).length < 2) {
      setSearchHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      setSearching(true);
      void searchUsersByUsername(query)
        .then(setSearchHits)
        .catch(() => setSearchHits([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, signedIn]);

  async function onAddFriend(hit: UserSearchHit) {
    setActionMsg(null);
    setError(null);
    try {
      const res = await sendFriendRequest(hit.id);
      setActionMsg(
        res.autoAccepted ? `You and @${hit.username} are now friends.` : `Request sent to @${hit.username}.`,
      );
      setQuery("");
      setSearchHits([]);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send request.");
    }
  }

  async function onRespond(requestId: string, accept: boolean) {
    setActionMsg(null);
    setError(null);
    try {
      await respondFriendRequest(requestId, accept);
      setActionMsg(accept ? "Friend added." : "Request declined.");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update request.");
    }
  }

  async function onChallengePick(slug: PrivateRoomGameSlug) {
    setChallengeFriend(null);
    await startPrivateFriendChallengeWithGameSlug(router, slug);
  }

  if (!signedIn) {
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
          <p className={styles.empty}>Sign in to add friends and send challenges.</p>
          <GFButton variant="primary" type="button" onClick={() => router.push("/login?redirect=/friends")}>
            Sign in
          </GFButton>
        </main>
        <GFBottomNav activeHref="/friends" />
      </div>
    );
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

        {error ? <p className={styles.bannerErr}>{error}</p> : null}
        {actionMsg ? <p className={styles.bannerOk}>{actionMsg}</p> : null}

        <section className={styles.section}>
          <h2 className={styles.h2}>Add friend</h2>
          <div className={styles.row}>
            <input
              className={styles.input}
              placeholder="Username"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {searching ? <p className={styles.hint}>Searching…</p> : null}
          {searchHits.length > 0 ? (
            <ul className={styles.searchList}>
              {searchHits.map((hit) => (
                <li key={hit.id} className={styles.searchRow}>
                  <div>
                    <div className={styles.name}>{hit.displayName}</div>
                    <div className={styles.handle}>@{hit.username}</div>
                  </div>
                  <GFButton variant="primary" type="button" onClick={() => void onAddFriend(hit)}>
                    Add
                  </GFButton>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Friends {loading ? "" : `(${friends.length})`}</h2>
          {loading ? (
            <p className={styles.empty}>Loading…</p>
          ) : friends.length === 0 ? (
            <p className={styles.empty}>No friends yet. Search by username above.</p>
          ) : (
            <div className={styles.list}>
              {friends.map((f) => (
                <div key={f.userId} className={styles.friendRow}>
                  <div className={styles.avatar} aria-hidden />
                  <div className={styles.meta}>
                    <div className={styles.name}>{f.displayName}</div>
                    <div className={styles.handle}>@{f.username}</div>
                  </div>
                  <GFButton variant="primary" type="button" onClick={() => setChallengeFriend(f)}>
                    Challenge
                  </GFButton>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Incoming requests</h2>
          {incoming.length === 0 ? (
            <p className={styles.empty}>No incoming requests.</p>
          ) : (
            <div className={styles.list}>
              {incoming.map((r) => (
                <div key={r.id} className={styles.requestRow}>
                  <div>
                    <div className={styles.name}>{r.displayName}</div>
                    <div className={styles.handle}>@{r.username}</div>
                  </div>
                  <div className={styles.requestActions}>
                    <GFButton variant="primary" type="button" onClick={() => void onRespond(r.id, true)}>
                      Accept
                    </GFButton>
                    <GFButton variant="ghost" type="button" onClick={() => void onRespond(r.id, false)}>
                      Decline
                    </GFButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Outgoing requests</h2>
          {outgoing.length === 0 ? (
            <p className={styles.empty}>No outgoing requests.</p>
          ) : (
            <div className={styles.list}>
              {outgoing.map((r) => (
                <OutgoingRequestRow key={r.id} request={r} />
              ))}
            </div>
          )}
        </section>

        <button type="button" className={styles.refresh} onClick={() => void reload()}>
          Refresh
        </button>

        <div className={styles.spacer} />
      </main>

      {challengeFriend ? (
        <FriendChallengeModal
          friendUsername={challengeFriend.username}
          onPick={(slug) => void onChallengePick(slug)}
          onClose={() => setChallengeFriend(null)}
        />
      ) : null}

      <GFBottomNav activeHref="/friends" />
    </div>
  );
}

function OutgoingRequestRow({ request: r }: { request: OutgoingFriendRequest }) {
  return (
    <div className={styles.requestRowMuted}>
      <div>
        <div className={styles.name}>{r.displayName}</div>
        <div className={styles.handle}>@{r.username}</div>
      </div>
      <span className={styles.pendingBadge}>Pending</span>
    </div>
  );
}
