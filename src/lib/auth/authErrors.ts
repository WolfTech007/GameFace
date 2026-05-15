import type { AuthError } from "@supabase/supabase-js";

const EMAIL_IN_USE = /already\s*registered|User\s+already\s+registered/i;
/** Supabase rejects weak passwords depending on project settings */
const PASSWORD_REJECTED = /^Password does not meet|password.*requirements|password\s*should/i;

export function describeSignUpError(err: AuthError): string {
  const raw = `${err.code ?? ""} ${err.message}`.trim();
  if (
    err.code === "user_already_exists" ||
    err.message?.toLowerCase().includes("already registered") ||
    EMAIL_IN_USE.test(err.message)
  ) {
    return "That email is already registered. Try signing in instead.";
  }
  if (PASSWORD_REJECTED.test(err.message) || err.code === "weak_password") {
    return "Password is too weak. Use a stronger password.";
  }
  return err.message || "Could not create account. Try again.";
}

export function describeSignInError(err: AuthError): string {
  if (
    err.code === "invalid_credentials" ||
    err.message?.toLowerCase().includes("invalid login credentials")
  ) {
    return "Email or password is incorrect.";
  }
  return err.message || "Sign-in failed. Try again.";
}

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, "");
}

export function validateUsernameFormat(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (!u.length) return "Choose a username.";
  if (u.length < 3) return "Username must be at least 3 characters.";
  if (u.length > 24) return "Username must be at most 24 characters.";
  if (!/^[a-z0-9_]+$/.test(u)) return "Use letters, numbers, and underscores only.";
  return null;
}
