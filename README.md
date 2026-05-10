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
- `/staring-contest`: **Staring Contest** (don’t blink — 1v1 via matchmaking + WebRTC)
- `/facecard`: **FaceCard** (Heads Up–style guess-your-celebrity; 1v1 matchmaking + WebRTC)
- `/rankit`: **Rank It** (same-time rankings vs a stranger; 1v1 matchmaking + WebRTC)

## FaceBreaker (how to play)

1. Tap **Start Game** (this requests camera permission and starts face tracking).
2. **Move your nose left/right** to control the paddle.
3. Break all bricks to win. If the ball falls below the paddle, you lose a life (3 lives total).

## FacePong (how to play)

1. Open `/facepong`.
2. Tap **Find Match**; when another player is waiting (or joins right after you), you’re paired over WebRTC (same in-memory queue pattern as Staring Contest).
3. When connected, tap **Start Game** (matchmaking host only — physics authority stays on that peer).
4. Both players move their noses left/right to rally the ball.

## Staring Contest (how to play)

1. Open `/staring-contest`, enter your name, tap **Find Match**.
2. When another player is already waiting (or joins right after you), you’re paired.
3. Tap **Ready** on both sides; host counts **3 · 2 · 1 · Stare!**
4. First blink (or face lost for more than about one second) loses; both see the same winner.

## FaceCard (how to play)

1. Open `/facecard`, enter your display name, tap **Find Match** (pairs the next two waiters on `/api/facecard/queue`, same pattern as FacePong).
2. After WebRTC connects, tap **Ready**; when both are ready, the **host** taps **Start Game**.
3. Each player gets a random **Popular Culture** name from the host (your own name is never shown on your camera — only a blank card — until the game ends).
4. Ask yes/no questions out loud; tap **I Know It** to guess (3 guesses each). First correct guess wins; if both run out of guesses, both names are revealed.

### Matchmaking note

The queue APIs (`/api/staring-contest/queue`, `/api/facepong/queue`, `/api/facecard/queue`, `/api/rankit/queue`) keep separate **in-memory** waiting lists. That works on a **single** Node/dev server; on **serverless** with many instances, pair two browsers using **the same deployment** at the same time, or replace the queues with Redis/KV later.

### Environment variables

**None required** for this prototype.

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
- `src/app/staring-contest/page.tsx`: Staring Contest route.
- `src/app/facecard/page.tsx`: FaceCard route.
- `src/app/api/staring-contest/queue/route.ts`: Simple matchmaking queue (pairs first two waiters).
- `src/app/api/facepong/queue/route.ts`: FacePong-only matchmaking queue (pairs first two waiters).
- `src/app/api/facecard/queue/route.ts`: FaceCard-only matchmaking queue (pairs first two waiters).
- `src/app/page.module.css`: Face Arcade styling.
- `src/app/globals.css`: Global styles and safe-area variables.
- `src/components/FaceBreakerGame.tsx`: Camera background, face tracking loop, game loop, UI flow (Start / Playing / Game Over / Win).
- `src/components/FaceBreakerGame.module.css`: Mobile-first arcade UI styling.
- `src/components/FacePong.tsx`: FacePong UI + game + peer connections.
- `src/components/FacePong.module.css`: FacePong styling.
- `src/components/StaringContest.tsx`: Staring Contest UI, blink detection, PeerJS sync.
- `src/components/StaringContest.module.css`: Staring Contest styling.
- `src/components/FaceCard.tsx`: FaceCard UI, PeerJS game flow, forehead card overlays.
- `src/components/FaceCard.module.css`: FaceCard styling.
- `src/lib/facecardDeck.ts`: Default “Popular Culture” name deck + random pair picker.
- `src/lib/facecardProtocol.ts`: Typed FaceCard peer messages (host-authoritative).
- `src/lib/facecardGuess.ts`: Normalization + fuzzy guess matching.
- `src/lib/facecardForehead.ts`: Forehead anchor from face landmarks (+ fallback position).
- `src/lib/facecardDraw.ts`: Canvas drawing for name cards on video overlays.
- `src/lib/staringContestFaceLandmarker.ts`: Separate Face Landmarker singleton (does not change FaceBreaker’s landmarker settings).
- `src/lib/eyeBlinkEar.ts`: Eye aspect ratio + blink smoothing helpers.
- `src/lib/staringContestProtocol.ts`: Message types for Staring Contest peer channel.
- `src/lib/mediapipeFaceLandmarker.ts`: Loads and caches the MediaPipe Face Landmarker (WASM + model).
- `src/lib/faceTracking.ts`: Shared “nose X” tracker used by FacePong.
- `src/lib/peerRoom.ts`: Minimal PeerJS helpers + network message types for FacePong.


