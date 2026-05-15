# Blink Stacker Duel (archived)

This multiplayer mode was removed from the live app. Sources are preserved here so they can be restored or referenced later.

## What lived here

- `src/components/BlinkStackerDuel.tsx` + `BlinkStackerDuel.module.css` — client arena
- `src/lib/blinkStackerDuel/` — `netTypes.ts`, `hostSim.ts`
- `src/app/blink-stacker-duel/` — intro + play routes
- `src/app/api/blink-stacker-duel/queue/` — matchmaking queue API

Shared dependencies (still in the app): `@/lib/blinkStacker/*` (constants, camera, overlap, ear), `@/lib/peerRoom`, `GameplayDuelHud`, etc.

## Restoring

1. Copy paths back under `src/` mirroring this tree.
2. Re-register `blink-stacker-duel` in `src/lib/gameface/gameIntroRegistry.ts`.
3. Re-add the home `GFGameCard` link in `src/app/page.tsx`.
4. Remove `blinkstackerduel` from `RandomGameId` in `matchmaking.ts` only if you are sure no clients still hold a pending match for that id.

Stack Up (`/stack-up`) replaced this duel as the 1v1 stack experience; solo Blink Stacker (`/blink-stacker`) is unchanged.
