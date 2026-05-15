import type { GameIntroSlug } from "@/lib/gameface/gameIntroRegistry";
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
      if (insErr.code === "23505") continue;
      throw insErr;
    }

    const { error: pErr } = await supabase.from("room_players").insert({
      room_id: row.id,
      user_id: session.user.id,
      role: "host",
    });
    if (pErr) throw pErr;

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
    return { ok: false, error: error.message || "rpc_error" };
  }
  const parsed = parseJoinPrivateRoomResult(data);
  if (!parsed) return { ok: false, error: "bad_response" };
  return parsed;
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
  try {
    const { inviteCode, playPath } = await createPrivateRoomAsHost(slug);
    router.push(`${playPath}?privateInvite=${encodeURIComponent(inviteCode)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "sign_in_required") {
      const path =
        typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/";
      router.push(`/login?redirect=${encodeURIComponent(path)}`);
      return;
    }
    console.error(e);
  }
}
