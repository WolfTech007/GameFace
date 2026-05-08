# FaceBreaker

Mobile-first web prototype: **Brick Breaker controlled by your nose**, with the front camera feed as the background.

Built with **Next.js + React** and **MediaPipe Face Landmarker**.

## Requirements

- Node.js 18+ (recommended)
- iPhone Safari (or iOS Simulator) for the target experience

## Setup

```bash
npm install
npm run dev
```

Then open `http://localhost:3000` on your phone (same Wi‑Fi) or in iOS Simulator.

### iPhone testing tip

To test on-device, run your dev server so it’s reachable on your LAN and open it from your iPhone:

- Your Mac’s LAN IP is usually something like `http://192.168.x.x:3000`.

## How to play

1. Tap **Start Game** (this requests camera permission and starts face tracking).
2. **Move your nose left/right** to control the paddle.
3. Break all bricks to win. If the ball falls below the paddle, you lose a life (3 lives total).

## Scripts

- `npm run dev`: start Next.js dev server
- `npm run build`: production build
- `npm run start`: run production server
- `npm run lint`: run Next.js lint rules

## Files created (and what they do)

- `next.config.mjs`: Next.js configuration.
- `next-env.d.ts`: TypeScript type references required by Next.js.
- `src/app/layout.tsx`: App shell + iPhone-friendly viewport settings (`viewport-fit=cover`).
- `src/app/page.tsx`: Client entry that renders the game.
- `src/app/globals.css`: Global styles and safe-area variables.
- `src/components/FaceBreakerGame.tsx`: Camera background, face tracking loop, game loop, UI flow (Start / Playing / Game Over / Win).
- `src/components/FaceBreakerGame.module.css`: Mobile-first arcade UI styling.
- `src/lib/mediapipeFaceLandmarker.ts`: Loads and caches the MediaPipe Face Landmarker (WASM + model).


