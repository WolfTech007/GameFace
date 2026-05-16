# Blink Stacker (solo, archived)

Solo blink-timing tower mode is removed from the live app. Sources are preserved here for later restore.

## What lived here

- `src/components/BlinkStacker.tsx` + `BlinkStacker.module.css` — solo game UI
- `src/app/blink-stacker/page.tsx` — route
- `src/lib/blinkStacker/storage.ts` — local best-score persistence

## Still in the live app

Shared stack physics used by **Stack Up** remain under `src/lib/blinkStacker/`:

- `constants.ts`, `camera.ts`, `overlap.ts`, `ear.ts`

Do not archive those when restoring solo Blink Stacker.

## Restoring

1. Copy paths back under `src/` mirroring this tree.
2. Re-add `blink-stacker` to `GameIntroSlug` and `GAME_INTRO_REGISTRY` in `src/lib/gameface/gameIntroRegistry.ts`.
3. Re-add the home `GFGameCard` in `src/app/page.tsx`.
4. Re-add `/blink-stacker` to `GAME_HUB_ROOTS` in `src/lib/auth/routeAccess.ts`.

Multiplayer **Blink Stacker Duel** (if needed) is in `archive/blink-stacker-duel/`. Stack Up (`/stack-up`) is the live 1v1 stack mode.
