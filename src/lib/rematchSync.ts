/** Shared rematch intent (host-authoritative games sync via net state or host ack). */

export type RematchIntent = { host: boolean; guest: boolean };

export function emptyRematchIntent(): RematchIntent {
  return { host: false, guest: false };
}

export function rematchBothWant(r: RematchIntent): boolean {
  return r.host && r.guest;
}
