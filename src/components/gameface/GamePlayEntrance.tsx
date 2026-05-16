"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { PrivateRoomGameSlug } from "@/lib/gameface/privateRoomGames";
import {
  type PrivateMatchPayload,
  resolvePrivateInviteCode,
} from "@/lib/gameface/privateRoomsClient";
import { PlayRouteFallback } from "./PlayRouteFallback";

type GamePlayEntranceProps = {
  /** Legacy prop — kept for call-site compatibility; arena always mounts on `/play`. */
  introHref?: string;
  expectedPrivateGameSlug?: PrivateRoomGameSlug;
  children: (opts: {
    autoJoinPublicQueue: boolean;
    fromRandomMatch: boolean;
    privateInviteLoading: boolean;
    privateInviteError: string | null;
    privateMatch: PrivateMatchPayload | null;
    privateInviteCode: string | null;
  }) => ReactNode;
};

function GamePlayEntranceInner({ children, expectedPrivateGameSlug }: GamePlayEntranceProps) {
  const sp = useSearchParams();
  const queue = sp.get("queue") === "1";
  const gf = sp.get("gf") === "1";
  const inviteRaw = sp.get("privateInvite")?.trim() ?? "";
  const needsPrivate = Boolean(inviteRaw && expectedPrivateGameSlug);
  const { user, isLoading: authLoading } = useAuth();

  const [priv, setPriv] = useState<{
    loading: boolean;
    error: string | null;
    match: PrivateMatchPayload | null;
  }>(() => ({
    loading: Boolean(needsPrivate),
    error: null,
    match: null,
  }));

  useEffect(() => {
    if (!needsPrivate || !expectedPrivateGameSlug) {
      setPriv({ loading: false, error: null, match: null });
      return;
    }
    if (authLoading) {
      setPriv((s) => ({ ...s, loading: true, error: null, match: null }));
      return;
    }
    if (!user) {
      setPriv({ loading: false, error: "Sign in to join this match.", match: null });
      return;
    }

    let cancelled = false;
    setPriv({ loading: true, error: null, match: null });

    void (async () => {
      const result = await resolvePrivateInviteCode(inviteRaw);
      if (cancelled) return;
      if (!result.ok) {
        const friendly =
          result.error === "not_found"
            ? "Invite not found or expired."
            : result.error === "full"
              ? "This room is full."
              : result.error === "not_authenticated"
                ? "Sign in to join this match."
                : result.error;
        setPriv({ loading: false, error: friendly, match: null });
        return;
      }
      if (result.game_slug !== expectedPrivateGameSlug) {
        setPriv({ loading: false, error: "That invite is for a different game.", match: null });
        return;
      }
      setPriv({
        loading: false,
        error: null,
        match: { peerRoomId: result.peer_room_id, role: result.role },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [needsPrivate, expectedPrivateGameSlug, inviteRaw, authLoading, user]);

  const privateInviteLoading = needsPrivate && (authLoading || priv.loading);
  const privateInviteError = needsPrivate ? priv.error : null;
  const privateMatch = needsPrivate ? priv.match : null;

  return (
    <>
      {children({
        autoJoinPublicQueue: queue,
        fromRandomMatch: gf,
        privateInviteLoading,
        privateInviteError,
        privateMatch,
        privateInviteCode: inviteRaw || null,
      })}
    </>
  );
}

/** Reads search params outside keyed inner so invite query changes remount resolver + games (fixes same-route `?privateInvite=` navigation). */
function GamePlayEntranceShell(props: GamePlayEntranceProps) {
  const sp = useSearchParams();
  const inviteRaw = sp.get("privateInvite")?.trim() ?? "";
  return (
    <GamePlayEntranceInner key={inviteRaw || "__no_private_invite__"} {...props} />
  );
}

export function GamePlayEntrance(props: GamePlayEntranceProps) {
  return (
    <Suspense fallback={<PlayRouteFallback />}>
      <GamePlayEntranceShell {...props} />
    </Suspense>
  );
}
