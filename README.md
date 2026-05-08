# Face Arcade

Mobile-first web prototype arcade: **play games with your face**.

Built with **Next.js + React**, **MediaPipe Face Landmarker**, and **PeerJS/WebRTC** (for FacePong prototype).

## Requirements

- Node.js 18+ (recommended)
- iPhone Safari (or iOS Simulator) for the target experience

## Setup

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

### iPhone testing tip

To test on-device, run your dev server so it’s reachable on your LAN and open it from your iPhone Safari:

- Your Mac’s LAN IP is usually something like `http://192.168.x.x:3000`.

## Routes

- `/`: **Face Arcade** (menu)
- `/facebreaker`: **FaceBreaker** (brick breaker controlled by nose)
- `/facepong`: **FacePong** (2-player webcam pong prototype)

## FaceBreaker (how to play)

1. Tap **Start Game** (this requests camera permission and starts face tracking).
2. **Move your nose left/right** to control the paddle.
3. Break all bricks to win. If the ball falls below the paddle, you lose a life (3 lives total).

## FacePong (how to play)

1. Open `/facepong`.
2. Tap **Create Room** to generate a share link.
3. Send the link to a friend.
4. When they open it, you’ll see **Opponent connected**.
5. Tap **Start Game** (host only).
6. Both players move their noses left/right to rally the ball.

Notes:
- FacePong is a prototype and uses PeerJS’s default broker for signaling. For production reliability, you’d host your own PeerServer or move to a managed realtime stack.
- WebRTC requires HTTPS on mobile (Vercel provides this automatically).

## Scripts

- `npm run dev`: start Next.js dev server
- `npm run build`: production build
- `npm run start`: run production server
- `npm run lint`: run Next.js lint rules

## Files created (and what they do)

- `next.config.mjs`: Next.js configuration.
- `next-env.d.ts`: TypeScript type references required by Next.js.
- `src/app/layout.tsx`: App shell + iPhone-friendly viewport settings (`viewport-fit=cover`).
- `src/app/page.tsx`: Face Arcade homepage.
- `src/app/facebreaker/page.tsx`: FaceBreaker route.
- `src/app/facepong/page.tsx`: FacePong route.
- `src/app/page.module.css`: Face Arcade styling.
- `src/app/globals.css`: Global styles and safe-area variables.
- `src/components/FaceBreakerGame.tsx`: Camera background, face tracking loop, game loop, UI flow (Start / Playing / Game Over / Win).
- `src/components/FaceBreakerGame.module.css`: Mobile-first arcade UI styling.
- `src/components/FacePong.tsx`: FacePong UI + game + peer connections.
- `src/components/FacePong.module.css`: FacePong styling.
- `src/lib/mediapipeFaceLandmarker.ts`: Loads and caches the MediaPipe Face Landmarker (WASM + model).
- `src/lib/faceTracking.ts`: Shared “nose X” tracker used by FacePong.
- `src/lib/peerRoom.ts`: Minimal PeerJS helpers + network message types for FacePong.


