import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  playPathForPrivateRoomGame,
  type PrivateRoomGameSlug,
} from "@/lib/gameface/privateRoomGames";

export type IncomingFriendChallenge = {
  id: string;
  fromUserId: string;
  username: string;
  displayName: string;
  gameSlug: PrivateRoomGameSlug;
  inviteCode: string;
  expiresAt: string;
  createdAt: string;
};

export type OutgoingFriendChallenge = {
  id: string;
  toUserId: string;
  username: string;
  displayName: string;
  gameSlug: PrivateRoomGameSlug;
  inviteCode: string;
  expiresAt: string;
  createdAt: string;
};

export type FriendChallengesState = {
  incoming: IncomingFriendChallenge[];
  outgoing: OutgoingFriendChallenge[];
};

type RpcOk<T> = { ok: true } & T;
type RpcErr = { ok: false; error: string };

const PRIVATE_SLUGS = new Set<string>(["facepong", "stack-up", "staring-contest", "lipreader"]);

function parsePrivateGameSlug(raw: unknown): PrivateRoomGameSlug | null {
  if (typeof raw !== "string" || !PRIVATE_SLUGS.has(raw)) return null;
  return raw as PrivateRoomGameSlug;
}

function rpcErrorMessage(code: string): string {
  switch (code) {
    case "sign_in_required":
      return "Sign in to use challenges.";
    case "invalid_user":
      return "Invalid challenge target.";
    case "invalid_invite":
      return "Invalid invite code.";
    case "invalid_game":
      return "Invalid game.";
    case "user_not_found":
      return "User not found.";
    case "not_friends":
      return "You can only challenge friends.";
    case "not_found":
      return "Challenge not found.";
    case "forbidden":
      return "You cannot update this challenge.";
    case "not_pending":
      return "This challenge is no longer pending.";
    case "expired":
      return "This challenge has expired.";
    default:
      return code || "Something went wrong.";
  }
}

/** Human-readable game title from private room slug. */
export function labelForPrivateGameSlug(slug: PrivateRoomGameSlug): string {
  switch (slug) {
    case "lipreader":
      return "Charades";
    case "facepong":
      return "FacePong";
    case "stack-up":
      return "Stack Up";
    case "staring-contest":
      return "Staring Contest";
    default:
      return slug;
  }
}

export function formatChallengeTimeRemaining(expiresAtIso: string, nowMs = Date.now()): string {
  const expires = new Date(expiresAtIso).getTime();
  if (Number.isNaN(expires)) return "";
  const diffMs = expires - nowMs;
  if (diffMs <= 0) return "Expired";
  const totalSec = Math.floor(diffMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    const rm = min % 60;
    return `${hr}h ${rm}m left`;
  }
  if (min > 0) return `${min}m ${sec}s left`;
  return `${sec}s left`;
}

export async function createFriendChallengeRow(
  toUserId: string,
  gameSlug: PrivateRoomGameSlug,
  inviteCode: string,
): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("create_friend_challenge", {
    p_to_user_id: toUserId,
    p_game_slug: gameSlug,
    p_invite_code: inviteCode,
  });

  if (error) {
    console.error("FRIEND_CHALLENGE_ERROR", error);
    throw new Error(error.message || "create_failed");
  }

  const body = data as RpcOk<{ id?: string }> | RpcErr | null;
  if (!body || body.ok !== true) {
    const code = body && body.ok === false ? body.error : "create_failed";
    throw new Error(rpcErrorMessage(code));
  }

  return typeof body.id === "string" ? body.id : "";
}

export async function fetchFriendChallengesState(): Promise<FriendChallengesState> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_friend_challenges_state");

  if (error) {
    console.error("FRIEND_CHALLENGE_ERROR", error);
    throw new Error(error.message || "load_failed");
  }

  const body = data as
    | { ok: true; incoming?: unknown; outgoing?: unknown }
    | RpcErr
    | null;

  if (!body || body.ok !== true) {
    const code = body && "error" in body && body.ok === false ? body.error : "load_failed";
    if (code === "sign_in_required") {
      return { incoming: [], outgoing: [] };
    }
    throw new Error(rpcErrorMessage(code));
  }

  return {
    incoming: parseIncoming(body.incoming),
    outgoing: parseOutgoing(body.outgoing),
  };
}

export async function respondFriendChallenge(
  challengeId: string,
  accept: boolean,
): Promise<{ gameSlug: PrivateRoomGameSlug; inviteCode: string } | null> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("respond_friend_challenge", {
    p_challenge_id: challengeId,
    p_accept: accept,
  });

  if (error) {
    console.error("FRIEND_CHALLENGE_ERROR", error);
    throw new Error(error.message || "respond_failed");
  }

  const body = data as
    | RpcOk<{ game_slug?: string; invite_code?: string }>
    | RpcErr
    | null;

  if (!body || body.ok !== true) {
    const code = body && body.ok === false ? body.error : "respond_failed";
    throw new Error(rpcErrorMessage(code));
  }

  if (!accept) return null;

  const gameSlug = parsePrivateGameSlug(body.game_slug);
  const inviteCode = typeof body.invite_code === "string" ? body.invite_code : "";
  if (!gameSlug || !inviteCode) {
    throw new Error("bad_response");
  }

  return { gameSlug, inviteCode };
}

export async function cancelFriendChallenge(challengeId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("cancel_friend_challenge", {
    p_challenge_id: challengeId,
  });

  if (error) {
    console.error("FRIEND_CHALLENGE_ERROR", error);
    throw new Error(error.message || "cancel_failed");
  }

  const body = data as RpcOk<Record<string, never>> | RpcErr | null;
  if (!body || body.ok !== true) {
    const code = body && body.ok === false ? body.error : "cancel_failed";
    throw new Error(rpcErrorMessage(code));
  }
}

export function privateInvitePlayUrl(gameSlug: PrivateRoomGameSlug, inviteCode: string): string {
  const playPath = playPathForPrivateRoomGame(gameSlug);
  return `${playPath}?privateInvite=${encodeURIComponent(inviteCode)}`;
}

export function navigateToPrivateInvite(
  router: { push: (href: string) => void },
  gameSlug: PrivateRoomGameSlug,
  inviteCode: string,
): void {
  router.push(privateInvitePlayUrl(gameSlug, inviteCode));
}

function parseIncoming(raw: unknown): IncomingFriendChallenge[] {
  if (!Array.isArray(raw)) return [];
  const out: IncomingFriendChallenge[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    const fromUserId = typeof o.from_user_id === "string" ? o.from_user_id : null;
    const username = typeof o.username === "string" ? o.username : null;
    const gameSlug = parsePrivateGameSlug(o.game_slug);
    const inviteCode = typeof o.invite_code === "string" ? o.invite_code : null;
    const expiresAt = typeof o.expires_at === "string" ? o.expires_at : null;
    const createdAt = typeof o.created_at === "string" ? o.created_at : "";
    const displayName =
      typeof o.display_name === "string" && o.display_name.trim().length
        ? o.display_name
        : username;
    if (!id || !fromUserId || !username || !gameSlug || !inviteCode || !expiresAt) continue;
    out.push({
      id,
      fromUserId,
      username,
      displayName: displayName ?? username,
      gameSlug,
      inviteCode,
      expiresAt,
      createdAt,
    });
  }
  return out;
}

function parseOutgoing(raw: unknown): OutgoingFriendChallenge[] {
  if (!Array.isArray(raw)) return [];
  const out: OutgoingFriendChallenge[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    const toUserId = typeof o.to_user_id === "string" ? o.to_user_id : null;
    const username = typeof o.username === "string" ? o.username : null;
    const gameSlug = parsePrivateGameSlug(o.game_slug);
    const inviteCode = typeof o.invite_code === "string" ? o.invite_code : null;
    const expiresAt = typeof o.expires_at === "string" ? o.expires_at : null;
    const createdAt = typeof o.created_at === "string" ? o.created_at : "";
    const displayName =
      typeof o.display_name === "string" && o.display_name.trim().length
        ? o.display_name
        : username;
    if (!id || !toUserId || !username || !gameSlug || !inviteCode || !expiresAt) continue;
    out.push({
      id,
      toUserId,
      username,
      displayName: displayName ?? username,
      gameSlug,
      inviteCode,
      expiresAt,
      createdAt,
    });
  }
  return out;
}
