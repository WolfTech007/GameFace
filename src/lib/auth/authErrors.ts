import type { AuthError, User } from "@supabase/supabase-js";

const EMAIL_IN_USE = /already\s*registered|User\s+already\s+registered/i;
/** Supabase rejects weak passwords depending on project settings */
const PASSWORD_REJECTED = /^Password does not meet|password.*requirements|password\s*should/i;

export function describeSignUpError(err: AuthError): string {
  if (isSignupDuplicateEmailAuthError(err)) {
    return "Email already in use.";
  }
  if (PASSWORD_REJECTED.test(err.message) || err.code === "weak_password") {
    return "Password is too weak. Use a stronger password.";
  }
  return err.message || "Could not create account. Try again.";
}

/** Explicit duplicate-email errors from `signUp()`. */
export function isSignupDuplicateEmailAuthError(err: AuthError): boolean {
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  if (code === "user_already_exists") return true;
  if (msg.includes("already registered")) return true;
  if (msg.includes("already been registered")) return true;
  if (msg.includes("user already exists")) return true;
  if (msg.includes("email address is already")) return true;
  if (msg.includes("email already")) return true;
  if (EMAIL_IN_USE.test(err.message ?? "")) return true;
  return false;
}

/**
 * Supabase may return `{ user, session: null }` with **empty `identities`** for an existing email
 * (anti-enumeration). That must not be treated as “check your email.”
 */
export function isSignupDuplicateEmailUser(user: User | null): boolean {
  if (!user) return false;
  return Array.isArray(user.identities) && user.identities.length === 0;
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

/** Postgres / PostgREST unique violation */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "23505") return true;
  const m = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return m.includes("duplicate") || m.includes("unique constraint");
}
