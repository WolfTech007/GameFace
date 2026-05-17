/** Profile view URL — same public page friends and you see. */
export function profileViewPath(username: string): string {
  return `/profile/${encodeURIComponent(username)}`;
}

export const PROFILE_EDIT_PATH = "/profile/edit";
