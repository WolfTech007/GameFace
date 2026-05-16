"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FriendChallengeModal } from "@/components/gameface/FriendChallengeModal";
import { GFButton, GFBottomNav } from "@/components/gameface";
import { normalizeUsername, validateUsernameFormat } from "@/lib/auth/authErrors";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import {
  cancelFriendChallenge,
  fetchFriendChallengesState,
  formatChallengeTimeRemaining,
  labelForPrivateGameSlug,
  navigateToPrivateInvite,
  respondFriendChallenge,
  type IncomingFriendChallenge,
  type OutgoingFriendChallenge,
} from "@/lib/gameface/friendChallengesClient";
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
import type { GameIntroSlug } from "@/lib/gameface/gameIntroRegistry";
import { startFriendChallenge } from "@/lib/gameface/privateRoomsClient";
import styles from "./page.module.css";

const CHALLENGE_POLL_MS = 4000;

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
  const [incomingChallenges, setIncomingChallenges] = useState<IncomingFriendChallenge[]>([]);
  const [outgoingChallenges, setOutgoingChallenges] = useState<OutgoingFriendChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<UserSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [challengeFriend, setChallengeFriend] = useState<FriendUser | null>(null);

  const reloadFriends = useCallback(async () => {
    if (!signedIn) return;
    const state = await fetchFriendsState();
    setFriends(state.friends);
    setIncoming(state.incoming);
    setOutgoing(state.outgoing);
  }, [signedIn]);

  const reloadChallenges = useCallback(async () => {
    if (!signedIn) {
      setIncomingChallenges([]);
      setOutgoingChallenges([]);
      return;
    }
    const state = await fetchFriendChallengesState();
    setIncomingChallenges(state.incoming);
    setOutgoingChallenges(state.outgoing);
  }, [signedIn]);

  const reload = useCallback(async () => {
    if (!signedIn) {
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      setIncomingChallenges([]);
      setOutgoingChallenges([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await Promise.all([reloadFriends(), reloadChallenges()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load friends.");
    } finally {
      setLoading(false);
    }
  }, [signedIn, reloadFriends, reloadChallenges]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!signedIn) return;
    const id = window.setInterval(() => {
      void reloadChallenges().catch(() => {});
    }, CHALLENGE_POLL_MS);
    return () => window.clearInterval(id);
  }, [signedIn, reloadChallenges]);

  const hasPendingChallenges = incomingChallenges.length > 0 || outgoingChallenges.length > 0;
  useEffect(() => {
    if (!hasPendingChallenges) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasPendingChallenges]);

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

  async function onChallengePick(introSlug: GameIntroSlug) {
    const target = challengeFriend;
    if (!target) return;
    setActionMsg(null);
    setError(null);
    try {
      await startFriendChallenge(router, introSlug, target.userId);
      setActionMsg(`Challenge sent to @${target.username}.`);
      await reloadChallenges();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send challenge.");
    } finally {
      setChallengeFriend(null);
    }
  }

  async function onAcceptChallenge(c: IncomingFriendChallenge) {
    setActionMsg(null);
    setError(null);
    try {
      const joined = await respondFriendChallenge(c.id, true);
      await reloadChallenges();
      if (joined) {
        navigateToPrivateInvite(router, joined.gameSlug, joined.inviteCode);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept challenge.");
      await reloadChallenges();
    }
  }

  async function onDeclineChallenge(challengeId: string) {
    setActionMsg(null);
    setError(null);
    try {
      await respondFriendChallenge(challengeId, false);
      setActionMsg("Challenge declined.");
      await reloadChallenges();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decline challenge.");
    }
  }

  async function onCancelChallenge(challengeId: string) {
    setActionMsg(null);
    setError(null);
    try {
      await cancelFriendChallenge(challengeId);
      setActionMsg("Challenge cancelled.");
      await reloadChallenges();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel challenge.");
    }
  }

  if (!signedIn) {
    return (
      <div className={styles.shell}>
        <main className={styles.root}>
          <FriendsHeader />
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
    <FriendsPageContent
      error={error}
      actionMsg={actionMsg}
      incomingChallenges={incomingChallenges}
      outgoingChallenges={outgoingChallenges}
      nowMs={nowMs}
      onAcceptChallenge={onAcceptChallenge}
      onDeclineChallenge={onDeclineChallenge}
      onCancelChallenge={onCancelChallenge}
      query={query}
      setQuery={setQuery}
      searching={searching}
      searchHits={searchHits}
      onAddFriend={onAddFriend}
      loading={loading}
      friends={friends}
      setChallengeFriend={setChallengeFriend}
      incoming={incoming}
      onRespond={onRespond}
      outgoing={outgoing}
      reload={reload}
      challengeFriend={challengeFriend}
      onChallengePick={onChallengePick}
    />
  );
}

function FriendsHeader() {
  return (
    <header className={styles.head}>
      <Link href="/" className={styles.back}>
        ← Games
      </Link>
      <p className={styles.brand}>GAMEFACE</p>
      <h1 className={styles.title}>Friends</h1>
    </header>
  );
}

function IncomingChallengeMeta({
  challenge: c,
  nowMs,
}: {
  challenge: IncomingFriendChallenge;
  nowMs: number;
}) {
  return (
    <div>
      <div className={styles.name}>@{c.username}</div>
      <div className={styles.handle}>{labelForPrivateGameSlug(c.gameSlug)}</div>
      <div className={styles.timeLeft}>{formatChallengeTimeRemaining(c.expiresAt, nowMs)}</div>
    </div>
  );
}

function OutgoingChallengeRow({
  challenge: c,
  nowMs,
  onCancel,
}: {
  challenge: OutgoingFriendChallenge;
  nowMs: number;
  onCancel: () => void;
}) {
  return (
    <div className={styles.challengeRowMuted}>
      <div>
        <div className={styles.name}>Waiting for @{c.username} to accept</div>
        <div className={styles.handle}>{labelForPrivateGameSlug(c.gameSlug)}</div>
        <div className={styles.timeLeft}>{formatChallengeTimeRemaining(c.expiresAt, nowMs)}</div>
      </div>
      <GFButton variant="ghost" type="button" onClick={onCancel}>
        Cancel
      </GFButton>
    </div>
  );
}

function FriendsPageContent(props: {
  error: string | null;
  actionMsg: string | null;
  incomingChallenges: IncomingFriendChallenge[];
  outgoingChallenges: OutgoingFriendChallenge[];
  nowMs: number;
  onAcceptChallenge: (c: IncomingFriendChallenge) => Promise<void>;
  onDeclineChallenge: (id: string) => Promise<void>;
  onCancelChallenge: (id: string) => Promise<void>;
  query: string;
  setQuery: (q: string) => void;
  searching: boolean;
  searchHits: UserSearchHit[];
  onAddFriend: (hit: UserSearchHit) => Promise<void>;
  loading: boolean;
  friends: FriendUser[];
  setChallengeFriend: (f: FriendUser | null) => void;
  incoming: IncomingFriendRequest[];
  onRespond: (id: string, accept: boolean) => Promise<void>;
  outgoing: OutgoingFriendRequest[];
  reload: () => Promise<void>;
  challengeFriend: FriendUser | null;
  onChallengePick: (slug: GameIntroSlug) => Promise<void>;
}) {
  const {
    error,
    actionMsg,
    incomingChallenges,
    outgoingChallenges,
    nowMs,
    onAcceptChallenge,
    onDeclineChallenge,
    onCancelChallenge,
    query,
    setQuery,
    searching,
    searchHits,
    onAddFriend,
    loading,
    friends,
    setChallengeFriend,
    incoming,
    onRespond,
    outgoing,
    reload,
    challengeFriend,
    onChallengePick,
  } = props;

  return (
    <div className={styles.shell}>
      <main className={styles.root}>
        <FriendsHeader />

        {error ? <p className={styles.bannerErr}>{error}</p> : null}
        {actionMsg ? <p className={styles.bannerOk}>{actionMsg}</p> : null}

        <section className={styles.section}>
          <h2 className={styles.h2}>Incoming challenges</h2>
          {incomingChallenges.length === 0 ? (
            <p className={styles.empty}>No incoming challenges.</p>
          ) : (
            <div className={styles.list}>
              {incomingChallenges.map((c) => (
                <IncomingChallengeRow
                  key={c.id}
                  challenge={c}
                  nowMs={nowMs}
                  onAccept={() => void onAcceptChallenge(c)}
                  onDecline={() => void onDeclineChallenge(c.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Outgoing challenges</h2>
          {outgoingChallenges.length === 0 ? (
            <p className={styles.empty}>No outgoing challenges.</p>
          ) : (
            <div className={styles.list}>
              {outgoingChallenges.map((c) => (
                <OutgoingChallengeRow
                  key={c.id}
                  challenge={c}
                  nowMs={nowMs}
                  onCancel={() => void onCancelChallenge(c.id)}
                />
              ))}
            </div>
          )}
        </section>

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
                  <Link href={`/profile/${encodeURIComponent(f.username)}`} className={styles.friendProfileLink}>
                    <div className={styles.avatar} aria-hidden />
                    <div className={styles.meta}>
                      <div className={styles.name}>{f.displayName}</div>
                      <div className={styles.handle}>@{f.username}</div>
                    </div>
                  </Link>
                  <GFButton
                    variant="primary"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setChallengeFriend(f);
                    }}
                  >
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
                <div key={r.id} className={styles.requestRowMuted}>
                  <div>
                    <div className={styles.name}>{r.displayName}</div>
                    <div className={styles.handle}>@{r.username}</div>
                  </div>
                  <span className={styles.pendingBadge}>Pending</span>
                </div>
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
          onPick={(introSlug) => void onChallengePick(introSlug)}
          onClose={() => setChallengeFriend(null)}
        />
      ) : null}

      <GFBottomNav activeHref="/friends" />
    </div>
  );
}

function IncomingChallengeRow(props: {
  challenge: IncomingFriendChallenge;
  nowMs: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { challenge, nowMs, onAccept, onDecline } = props;
  return (
    <div className={styles.challengeRow}>
      <IncomingChallengeMeta challenge={challenge} nowMs={nowMs} />
      <div className={styles.requestActions}>
        <GFButton variant="primary" type="button" onClick={onAccept}>
          Accept
        </GFButton>
        <GFButton variant="ghost" type="button" onClick={onDecline}>
          Decline
        </GFButton>
      </div>
    </div>
  );
}
