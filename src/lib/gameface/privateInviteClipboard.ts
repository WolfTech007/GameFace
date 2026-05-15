/** Full URL shared with a friend (same path + `privateInvite` the DB cares about). */
export function buildPrivateInviteUrl(playPath: string, inviteCode: string): string {
  if (typeof window === "undefined") return "";
  const origin = window.location.origin.replace(/\/$/, "");
  const path = playPath.startsWith("/") ? playPath : `/${playPath}`;
  return `${origin}${path}?privateInvite=${encodeURIComponent(inviteCode)}`;
}

export async function copyPrivateInviteLink(playPath: string, inviteCode: string): Promise<void> {
  await navigator.clipboard.writeText(buildPrivateInviteUrl(playPath, inviteCode));
}
