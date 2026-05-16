# Face Card (archived)

This 1v1 mode is removed from the live app. Sources are preserved here for later restore.

## What lived here

- `src/components/FaceCard.tsx` + `FaceCard.module.css` — client arena
- `src/lib/facecard*.ts` — deck, protocol, guess matching, forehead overlay, draw helpers
- `src/app/facecard/` — intro redirect + `/play` route
- `src/app/api/facecard/queue/` — matchmaking queue API

## Restoring

1. Copy paths back under `src/` mirroring this tree.
2. Re-add `facecard` to `GameIntroSlug` and `GAME_INTRO_REGISTRY` in `src/lib/gameface/gameIntroRegistry.ts`.
3. Re-add `facecard` to `PrivateRoomGameSlug` in `src/lib/gameface/privateRoomGames.ts`.
4. Re-add the home `GFGameCard` in `src/app/page.tsx`.
5. Re-add `/facecard` to `GAME_HUB_ROOTS` in `src/lib/auth/routeAccess.ts`.
6. Re-add Face Card to `RANDOM_GAME_POOL` in `src/lib/gameface/matchmaking.ts` (rebalance weights).
