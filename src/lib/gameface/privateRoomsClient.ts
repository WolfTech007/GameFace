import type { GameIntroSlug } from "@/lib/gameface/gameIntroRegistry";
import { createFriendChallengeRow } from "@/lib/gameface/friendChallengesClient";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  PRIVATE_ROOM_PEER_PREFIX,
  introSlugToPrivateRoomGameSlug,
  playPathForPrivateRoomGame,
  type PrivateRoomGameSlug,
} from "@/lib/gameface/privateRoomGames";

export type PrivateMatchPayload = {
  peerRoomId: string;
  role: "host" | "guest";
};

export type JoinPrivateRoomOk = {
  ok: true;
  peer_room_id: string;
  game_slug: string;
  role: "host" | "guest";
};

export type JoinPrivateRoomErr = { ok: false; error: string };

export type JoinPrivateRoomResult = JoinPrivateRoomOk | JoinPrivateRoomErr;

export function parseJoinPrivateRoomResult(raw: unknown): JoinPrivateRoomResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    o.ok === true &&
    typeof o.peer_room_id === "string" &&
    typeof o.game_slug === "string" &&
    (o.role === "host" || o.role === "guest")
  ) {
    return { ok: true, peer_room_id: o.peer_room_id, game_slug: o.game_slug, role: o.role };
  }
  if (o.ok === false && typeof o.error === "string") {
    return { ok: false, error: o.error };
  }
  return null;
}

const INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateInviteCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length]!;
  }
  return out;
}

export async function createPrivateRoomAsHost(
  slug: PrivateRoomGameSlug,
): Promise<{ inviteCode: string; playPath: string; peerRoomId: string }> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
    error: sessErr,
  } = await supabase.auth.getSession();
  if (sessErr || !session?.user) {
    throw new Error("sign_in_required");
  }

  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const peerRoomId = `${PRIVATE_ROOM_PEER_PREFIX[slug]}-${suffix}`;
  const playPath = playPathForPrivateRoomGame(slug);

  for (let attempt = 0; attempt < 8; attempt++) {
    const inviteCode = generateInviteCode();
    const { data: row, error: insErr } = await supabase
      .from("private_rooms")
      .insert({
        invite_code: inviteCode,
        game_slug: slug,
        host_user_id: session.user.id,
        peer_room_id: peerRoomId,
        status: "waiting",
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("PRIVATE_ROOM_ERROR", insErr);
      if (insErr.code === "23505") continue;
      throw insErr;
    }

    const { error: pErr } = await supabase.from("room_players").insert({
      room_id: row.id,
      user_id: session.user.id,
      role: "host",
    });
    if (pErr) {
      console.error("PRIVATE_ROOM_ERROR", pErr);
      throw pErr;
    }

    return { inviteCode, playPath, peerRoomId };
  }

  throw new Error("invite_collision");
}

export async function resolvePrivateInviteCode(
  inviteCode: string,
): Promise<JoinPrivateRoomResult> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("join_private_room", { p_invite: inviteCode.trim() });
  if (error) {
    console.error("PRIVATE_ROOM_ERROR", error);
    const codePart = error.code != null && error.code !== "" ? ` (code: ${error.code})` : "";
    return { ok: false, error: `${error.message || "rpc_error"}${codePart}` };
  }
  const parsed = parseJoinPrivateRoomResult(data);
  if (!parsed) return { ok: false, error: "bad_response" };
  return parsed;
}

function challengeErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

/** Temporary debug — surfaces PostgREST-style `code` when present. */
function supabaseErrorCode(e: unknown): string {
  if (typeof e !== "object" || e === null || !("code" in e)) return "";
  const c = (e as { code?: unknown }).code;
  if (typeof c === "string") return c;
  if (typeof c === "number" || typeof c === "boolean") return String(c);
  return "";
}

export async function startPrivateFriendChallengeWithGameSlug(
  router: { push: (href: string) => void },
  slug: PrivateRoomGameSlug,
  debugSource = "unknown",
): Promise<void> {
  console.log("[private-challenge] source:", debugSource, "privateRoomGameSlug:", slug);
  try {
    const { inviteCode, playPath, peerRoomId } = await createPrivateRoomAsHost(slug);
    const finalUrl = `${playPath}?privateInvite=${encodeURIComponent(inviteCode)}`;
    console.log("[private-challenge] inviteCode:", inviteCode);
    console.log("[private-challenge] playPath:", playPath);
    console.log("[private-challenge] peerRoomId:", peerRoomId);
    console.log("[private-challenge] finalUrl:", finalUrl);
    if (!inviteCode) {
      console.error("[private-challenge] inviteCode is undefined");
      window.alert("PRIVATE CHALLENGE DEBUG: inviteCode is undefined");
      return;
    }
    router.push(finalUrl);
  } catch (e) {
    console.error("[private-challenge] Supabase/create error:", e);
    const msg = challengeErrorMessage(e);
    if (msg === "sign_in_required") {
      const path =
        typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/";
      router.push(`/login?redirect=${encodeURIComponent(path)}`);
      return;
    }
    console.error("PRIVATE_ROOM_ERROR", e);
    const code = supabaseErrorCode(e);
    window.alert(
      `PRIVATE ROOM DEBUG (temporary)\nmessage: ${msg}\ncode: ${code.length ? code : "(none)"}`,
    );
  }
}

export async function startPrivateFriendChallenge(
  router: { push: (href: string) => void },
  introSlug: GameIntroSlug,
): Promise<void> {
  const slug = introSlugToPrivateRoomGameSlug(introSlug);
  if (!slug) {
    router.push("/friends");
    return;
  }
  await startPrivateFriendChallengeWithGameSlug(router, slug, `intro:${introSlug}`);
}

/** Friends page: create private room + challenge row, then host enters waiting lobby. */
export async function startFriendChallenge(
  router: { push: (href: string) => void },
  introSlug: GameIntroSlug,
  toUserId: string,
): Promise<void> {
  const slug = introSlugToPrivateRoomGameSlug(introSlug);
  if (!slug) {
    throw new Error("invalid_game");
  }
  try {
    const { inviteCode, playPath } = await createPrivateRoomAsHost(slug);
    await createFriendChallengeRow(toUserId, slug, inviteCode);
    const finalUrl = `${playPath}?privateInvite=${encodeURIComponent(inviteCode)}`;
    router.push(finalUrl);
  } catch (e) {
    const msg = challengeErrorMessage(e);
    if (msg === "sign_in_required") {
      const path =
        typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/";
      router.push(`/login?redirect=${encodeURIComponent(path)}`);
      return;
    }
    console.error("FRIEND_CHALLENGE_ERROR", e);
    const code = supabaseErrorCode(e);
    window.alert(
      `Could not start challenge.\n${msg}${code.length ? ` (code: ${code})` : ""}`,
    );
    throw e;
  }
}
