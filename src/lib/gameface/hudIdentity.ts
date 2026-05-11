/** Helpers for GameplayDuelHud — plain @handles, no guest_ clutter. */

const PLACEHOLDER_DISPLAY =
  /^(finding\s*match|finding\s*player|matchmaking|arena|connecting|opponent|you|rival|live\s*duel)$/i;

/** Strip leading @ and optional `guest_` prefix from stored profile username. */
export function hudPlainUsername(stored: string): string {
  let u = stored.trim();
  if (u.startsWith("@")) u = u.slice(1);
  if (u.startsWith("guest_")) u = u.slice("guest_".length);
  return u;
}

/** Build a short @handle from a display name when no real username exists (remote peers). */
export function hudUsernameSlug(displayName: string): string {
  const s = displayName
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return s || "live";
}

/** Username line for the red-side player when we only know their display name. */
export function hudUsernameForRemote(displayName: string): string {
  const d = displayName.trim();
  if (!d || PLACEHOLDER_DISPLAY.test(d)) return "";
  return hudUsernameSlug(d);
}
