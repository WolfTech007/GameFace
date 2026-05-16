/** When true, guests may open protected game/social routes without signing in (QA / demos). */
export function isGuestPlayAllowed(): boolean {
  return process.env.NEXT_PUBLIC_ALLOW_GUEST_PLAY?.trim().toLowerCase() === "true";
}

const PUBLIC_EXACT = new Set(["/", "/login", "/signup"]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/signup/")) return true;
  return false;
}

/** Game hubs and anything under them (including `/…/play`). */
const GAME_HUB_ROOTS = [
  "/charades",
  "/facepong",
  "/stack-up",
  "/staring-contest",
  "/lipreader",
  "/facebreaker",
  "/facehockey",
  "/rankit",
] as const;

function pathHasPlaySegment(pathname: string): boolean {
  return pathname.split("/").filter(Boolean).includes("play");
}

function matchesGameHub(pathname: string): boolean {
  return GAME_HUB_ROOTS.some((hub) => pathname === hub || pathname.startsWith(`${hub}/`));
}

/** Routes that require a signed-in user when `NEXT_PUBLIC_ALLOW_GUEST_PLAY` is not true. */
export function isProtectedPath(pathname: string): boolean {
  if (isPublicPath(pathname)) return false;
  if (pathHasPlaySegment(pathname)) return true;
  if (matchesGameHub(pathname)) return true;
  if (pathname === "/match/random" || pathname.startsWith("/match/")) return true;
  if (pathname === "/friends" || pathname.startsWith("/friends/")) return true;
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return true;
  if (pathname === "/activity" || pathname.startsWith("/activity/")) return true;
  return false;
}
