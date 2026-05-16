import { normalizeUsername } from "@/lib/auth/authErrors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PublicProfile = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type RpcOk<T> = { ok: true } & T;
type RpcErr = { ok: false; error: string };

function rpcErrorMessage(code: string): string {
  switch (code) {
    case "sign_in_required":
      return "Sign in to view profiles.";
    case "invalid_username":
      return "Invalid username.";
    case "not_found":
      return "Profile not found.";
    case "display_name_too_long":
      return "Display name must be at most 48 characters.";
    case "bio_too_long":
      return "Bio must be at most 280 characters.";
    default:
      return code || "Something went wrong.";
  }
}

function parsePublicProfile(raw: unknown): PublicProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  const username = typeof o.username === "string" ? o.username : null;
  const displayName =
    typeof o.display_name === "string" && o.display_name.trim().length
      ? o.display_name
      : username;
  const bio = typeof o.bio === "string" ? o.bio : "";
  const avatarUrl =
    typeof o.avatar_url === "string" && o.avatar_url.trim().length ? o.avatar_url : null;
  if (!id || !username) return null;
  return {
    id,
    username,
    displayName: displayName ?? username,
    bio,
    avatarUrl,
  };
}

export async function fetchProfileByUsername(username: string): Promise<PublicProfile> {
  const uname = normalizeUsername(username);
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_profile_by_username", { p_username: uname });

  if (error) {
    console.error("PROFILE_ERROR", error);
    throw new Error(error.message || "load_failed");
  }

  const body = data as RpcOk<{ profile?: unknown }> | RpcErr | null;
  if (!body || body.ok !== true) {
    const code = body && body.ok === false ? body.error : "load_failed";
    throw new Error(rpcErrorMessage(code));
  }

  const profile = parsePublicProfile(body.profile);
  if (!profile) throw new Error("bad_response");
  return profile;
}

export async function updateOwnProfile(input: {
  displayName: string;
  bio: string;
  avatarUrl?: string | null;
}): Promise<PublicProfile> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("update_own_profile", {
    p_display_name: input.displayName.trim(),
    p_bio: input.bio.trim(),
    p_avatar_url: input.avatarUrl ?? null,
  });

  if (error) {
    console.error("PROFILE_ERROR", error);
    throw new Error(error.message || "save_failed");
  }

  const body = data as RpcOk<{ profile?: unknown }> | RpcErr | null;
  if (!body || body.ok !== true) {
    const code = body && body.ok === false ? body.error : "save_failed";
    throw new Error(rpcErrorMessage(code));
  }

  const profile = parsePublicProfile(body.profile);
  if (!profile) throw new Error("bad_response");
  return profile;
}

function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export async function uploadAvatarPhoto(file: File, userId: string): Promise<string> {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error("Image must be 2MB or smaller.");
  }

  const supabase = getSupabaseBrowserClient();
  const ext = extForMime(file.type);
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });

  if (upErr) {
    console.error("PROFILE_ERROR", upErr);
    throw new Error(upErr.message || "upload_failed");
  }

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  if (!data.publicUrl) throw new Error("upload_failed");
  return data.publicUrl;
}
