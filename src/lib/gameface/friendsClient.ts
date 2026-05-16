import { normalizeUsername, validateUsernameFormat } from "@/lib/auth/authErrors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type FriendUser = {
  userId: string;
  username: string;
  displayName: string;
  since?: string;
};

export type IncomingFriendRequest = {
  id: string;
  fromUserId: string;
  username: string;
  displayName: string;
  createdAt: string;
};

export type OutgoingFriendRequest = {
  id: string;
  toUserId: string;
  username: string;
  displayName: string;
  createdAt: string;
};

export type UserSearchHit = {
  id: string;
  username: string;
  displayName: string;
};

export type FriendsState = {
  friends: FriendUser[];
  incoming: IncomingFriendRequest[];
  outgoing: OutgoingFriendRequest[];
};

type RpcOk<T> = { ok: true } & T;
type RpcErr = { ok: false; error: string };

function rpcErrorMessage(code: string): string {
  switch (code) {
    case "sign_in_required":
      return "Sign in to use friends.";
    case "invalid_user":
      return "You cannot add yourself.";
    case "user_not_found":
      return "No user with that username.";
    case "already_friends":
      return "You are already friends.";
    case "already_sent":
      return "Request already sent.";
    case "not_found":
      return "Request not found.";
    case "forbidden":
      return "You cannot respond to this request.";
    case "not_pending":
      return "This request is no longer pending.";
    default:
      return code || "Something went wrong.";
  }
}

export async function searchUsersByUsername(query: string): Promise<UserSearchHit[]> {
  const fmt = validateUsernameFormat(query);
  if (fmt) return [];

  const q = normalizeUsername(query);
  if (q.length < 2) return [];

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("search_users_by_username", {
    p_query: q,
    p_limit: 10,
  });

  if (error) {
    console.error("FRIENDS_ERROR", error);
    throw new Error(error.message || "search_failed");
  }

  if (!Array.isArray(data)) return [];

  return data
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : null;
      const username = typeof o.username === "string" ? o.username : null;
      const displayName =
        typeof o.display_name === "string" && o.display_name.trim().length
          ? o.display_name
          : username;
      if (!id || !username) return null;
      return { id, username, displayName: displayName ?? username };
    })
    .filter((x): x is UserSearchHit => x !== null);
}

export async function sendFriendRequest(toUserId: string): Promise<{ autoAccepted?: boolean }> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("send_friend_request", { p_to_user_id: toUserId });

  if (error) {
    console.error("FRIENDS_ERROR", error);
    throw new Error(error.message || "send_failed");
  }

  const body = data as RpcOk<{ auto_accepted?: boolean }> | RpcErr | null;
  if (!body || body.ok !== true) {
    const code = body && body.ok === false ? body.error : "send_failed";
    throw new Error(rpcErrorMessage(code));
  }

  return { autoAccepted: body.auto_accepted === true };
}

export async function respondFriendRequest(
  requestId: string,
  accept: boolean,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("respond_friend_request", {
    p_request_id: requestId,
    p_accept: accept,
  });

  if (error) {
    console.error("FRIENDS_ERROR", error);
    throw new Error(error.message || "respond_failed");
  }

  const body = data as RpcOk<Record<string, never>> | RpcErr | null;
  if (!body || body.ok !== true) {
    const code = body && body.ok === false ? body.error : "respond_failed";
    throw new Error(rpcErrorMessage(code));
  }
}

export async function fetchFriendsState(): Promise<FriendsState> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_friends_state");

  if (error) {
    console.error("FRIENDS_ERROR", error);
    throw new Error(error.message || "load_failed");
  }

  const body = data as
    | {
        ok: true;
        friends?: unknown;
        incoming?: unknown;
        outgoing?: unknown;
      }
    | RpcErr
    | null;

  if (!body || body.ok !== true) {
    const code = body && "error" in body && body.ok === false ? body.error : "load_failed";
    if (code === "sign_in_required") {
      return { friends: [], incoming: [], outgoing: [] };
    }
    throw new Error(rpcErrorMessage(code));
  }

  return {
    friends: parseFriends(body.friends),
    incoming: parseIncoming(body.incoming),
    outgoing: parseOutgoing(body.outgoing),
  };
}

function parseFriends(raw: unknown): FriendUser[] {
  if (!Array.isArray(raw)) return [];
  const out: FriendUser[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const userId = typeof o.user_id === "string" ? o.user_id : null;
    const username = typeof o.username === "string" ? o.username : null;
    const displayName =
      typeof o.display_name === "string" && o.display_name.trim().length
        ? o.display_name
        : username;
  if (!userId || !username) continue;
    const friend: FriendUser = {
      userId,
      username,
      displayName: displayName ?? username,
    };
    if (typeof o.since === "string") friend.since = o.since;
    out.push(friend);
  }
  return out;
}

function parseIncoming(raw: unknown): IncomingFriendRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : null;
      const fromUserId = typeof o.from_user_id === "string" ? o.from_user_id : null;
      const username = typeof o.username === "string" ? o.username : null;
      const displayName =
        typeof o.display_name === "string" && o.display_name.trim().length
          ? o.display_name
          : username;
      const createdAt = typeof o.created_at === "string" ? o.created_at : "";
      if (!id || !fromUserId || !username) return null;
      return {
        id,
        fromUserId,
        username,
        displayName: displayName ?? username,
        createdAt,
      };
    })
    .filter((x): x is IncomingFriendRequest => x !== null);
}

function parseOutgoing(raw: unknown): OutgoingFriendRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : null;
      const toUserId = typeof o.to_user_id === "string" ? o.to_user_id : null;
      const username = typeof o.username === "string" ? o.username : null;
      const displayName =
        typeof o.display_name === "string" && o.display_name.trim().length
          ? o.display_name
          : username;
      const createdAt = typeof o.created_at === "string" ? o.created_at : "";
      if (!id || !toUserId || !username) return null;
      return {
        id,
        toUserId,
        username,
        displayName: displayName ?? username,
        createdAt,
      };
    })
    .filter((x): x is OutgoingFriendRequest => x !== null);
}
