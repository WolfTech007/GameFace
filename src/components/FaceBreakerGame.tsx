import React, { useEffect, useMemo, useRef, useState } from "react";
import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";
import styles from "./FaceBreakerGame.module.css";

type GamePhase = "start" | "playing" | "gameover" | "win";

type Brick = { x: number; y: number; w: number; h: number; alive: boolean };

type GameState = {
  paddleX: number;
  paddleW: number;
  paddleH: number;
  paddleY: number;
  ballX: number;
  ballY: number;
  ballR: number;
  ballVx: number;
  ballVy: number;
  baseSpeed: number;
  speed: number;
  maxSpeed: number;
  lives: number;
  score: number;
  bricks: Brick[];
  bricksRemaining: number;
  awaitingServe: boolean;
  serveAtMs: number;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function circleRectHit(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
) {
  const closestX = clamp(cx, rx, rx + rw);
  const closestY = clamp(cy, ry, ry + rh);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}

function segmentAabbHit(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  // Ray/segment vs AABB using slab method. Returns earliest t in [0,1] and hit normal.
  const dx = x1 - x0;
  const dy = y1 - y0;

  let tMin = 0;
  let tMax = 1;
  let nx = 0;
  let ny = 0;

  const eps = 1e-9;

  // X slabs
  if (Math.abs(dx) < eps) {
    if (x0 < minX || x0 > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - x0) * inv;
    let t2 = (maxX - x0) * inv;
    let n1x = -1;
    let n2x = 1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      [n1x, n2x] = [n2x, n1x];
    }
    if (t1 > tMin) {
      tMin = t1;
      nx = n1x;
      ny = 0;
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  // Y slabs
  if (Math.abs(dy) < eps) {
    if (y0 < minY || y0 > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - y0) * inv;
    let t2 = (maxY - y0) * inv;
    let n1y = -1;
    let n2y = 1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      [n1y, n2y] = [n2y, n1y];
    }
    if (t1 > tMin) {
      tMin = t1;
      nx = 0;
      ny = n1y;
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  if (tMin < 0 || tMin > 1) return null;
  return { t: tMin, nx, ny };
}

function makeBricks(canvasW: number, topY: number) {
  const rows = 5;
  const cols = 8;
  const gap = Math.max(4, Math.round(canvasW * 0.01));
  const marginX = Math.round(canvasW * 0.06);
  const totalGap = gap * (cols - 1);
  const brickW = Math.floor((canvasW - marginX * 2 - totalGap) / cols);
  const brickH = Math.max(12, Math.round(brickW * 0.35));

  const bricks: Brick[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      bricks.push({
        x: marginX + c * (brickW + gap),
        y: topY + r * (brickH + gap),
        w: brickW,
        h: brickH,
        alive: true,
      });
    }
  }
  return bricks;
}

function initialState(canvasW: number, canvasH: number): GameState {
  const paddleW = Math.round(canvasW * 0.23);
  const paddleH = Math.max(10, Math.round(canvasH * 0.018));
  const paddleY = Math.round(canvasH * 0.86);
  const ballR = Math.max(5, Math.round(canvasW * 0.015));

  const baseSpeed = Math.max(220, Math.round(canvasH * 0.32)); // px/s
  const maxSpeed = Math.max(520, Math.round(canvasH * 0.78));

  const bricks = makeBricks(canvasW, Math.round(canvasH * 0.12));
  const bricksRemaining = bricks.length;

  const paddleX = (canvasW - paddleW) / 2;
  const ballX = paddleX + paddleW / 2;
  const ballY = paddleY - ballR - 2;

  return {
    paddleX,
    paddleW,
    paddleH,
    paddleY,
    ballX,
    ballY,
    ballR,
    ballVx: 0,
    ballVy: 0,
    baseSpeed,
    speed: baseSpeed,
    maxSpeed,
    lives: 3,
    score: 0,
    bricks,
    bricksRemaining,
    awaitingServe: true,
    serveAtMs: 0,
  };
}

export default function FaceBreakerGame() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [phase, setPhase] = useState<GamePhase>("start");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [trackingReady, setTrackingReady] = useState(false);
  const [uiScore, setUiScore] = useState(0);
  const [uiLives, setUiLives] = useState(3);
  const [uiSpeedPct, setUiSpeedPct] = useState(0);
  const [paused, setPaused] = useState(false);
  const [rotateVideoForPortrait, setRotateVideoForPortrait] = useState(false);

  const controlRef = useRef({
    noseX01: 0.5,
    smoothedX01: 0.5,
    hasNose: false,
    lastSeenMs: 0,
  });

  const landmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(
    null,
  );

  const gameRef = useRef<GameState | null>(null);
  const rafRef = useRef<number | null>(null);
  const trackerRafRef = useRef<number | null>(null);
  const pauseRef = useRef({ paused: false, startedAtMs: 0 });
  const viewRef = useRef({
    containerW: 0,
    containerH: 0,
  });
  const videoOrientationRef = useRef({ rotated: false });

  const overlayText = useMemo(() => {
    if (phase === "start") return "Move your nose left and right to control the paddle.";
    if (phase === "gameover") return "Game Over";
    if (phase === "win") return "You Win!";
    return null;
  }, [phase]);

  function setCanvasSize() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    viewRef.current.containerW = rect.width;
    viewRef.current.containerH = rect.height;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    // reset state to match new size (only if we haven't started yet)
    if (!gameRef.current || phase !== "playing") {
      gameRef.current = initialState(canvas.width, canvas.height);
      setUiScore(gameRef.current.score);
      setUiLives(gameRef.current.lives);
      setUiSpeedPct(0);
    }
  }

  async function ensureCameraAndTracking() {
    setCameraError(null);

    const video = videoRef.current;
    if (!video) throw new Error("Video element missing.");

    if (!landmarkerRef.current) {
      setTrackingReady(false);
      landmarkerRef.current = await createFaceLandmarker();
      setTrackingReady(true);
    }

    if (video.srcObject) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        // iOS Safari may try to give a landscape stream unless we nudge it hard.
        // Prefer a portrait 9:16 capture.
        width: { ideal: 720 },
        height: { ideal: 1280 },
        aspectRatio: { ideal: 9 / 16 },
        frameRate: { ideal: 60, max: 60 },
      },
    });

    // Try to apply stricter portrait constraints after we have a track.
    const [track] = stream.getVideoTracks();
    if (track?.applyConstraints) {
      try {
        await track.applyConstraints({
          aspectRatio: 9 / 16,
          width: { ideal: 720 },
          height: { ideal: 1280 },
          frameRate: { ideal: 60, max: 60 },
          advanced: [
            { aspectRatio: 9 / 16 },
            { width: 720, height: 1280 },
            { width: 1080, height: 1920 },
          ],
        });
      } catch {
        // If iOS rejects constraints, we'll still run with what we got.
      }
    }

    video.srcObject = stream;
    await video.play();

    // Detect if we received a landscape buffer in portrait UI; if so, rotate for display.
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    const rotated = vw > 0 && vh > 0 && vw > vh;
    videoOrientationRef.current.rotated = rotated;
    setRotateVideoForPortrait(rotated);
  }

  function cleanupCamera() {
    const video = videoRef.current;
    if (!video) return;
    const stream = video.srcObject as MediaStream | null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    video.srcObject = null;
  }

  function resetGame(keepPhase: GamePhase) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    gameRef.current = initialState(canvas.width, canvas.height);
    setUiScore(0);
    setUiLives(3);
    setUiSpeedPct(0);
    setPaused(false);
    pauseRef.current.paused = false;
    pauseRef.current.startedAtMs = 0;
    setPhase(keepPhase);
  }

  function serveBallNow(g: GameState) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const angle = (Math.random() * 0.55 + 0.2) * Math.PI; // 36°..135°
    const vx = Math.cos(angle) * g.speed * dir;
    const vy = -Math.abs(Math.sin(angle) * g.speed);
    g.ballVx = vx;
    g.ballVy = vy;
    g.awaitingServe = false;
  }

  function loseLife(g: GameState) {
    g.lives -= 1;
    setUiLives(g.lives);

    if (g.lives <= 0) {
      setPhase("gameover");
      return;
    }

    // reset ball on paddle and briefly wait before relaunching
    g.ballX = g.paddleX + g.paddleW / 2;
    g.ballY = g.paddleY - g.ballR - 2;
    g.ballVx = 0;
    g.ballVy = 0;
    g.awaitingServe = true;
    g.serveAtMs = performance.now() + 700;
  }

  function tick(dtSec: number, nowMs: number) {
    const canvas = canvasRef.current;
    const g = gameRef.current;
    if (!canvas || !g) return;
    if (phase !== "playing") return;
    if (pauseRef.current.paused) return;

    // map nose x (0..1) to paddle x in canvas px; smooth again at game-rate
    const ctrl = controlRef.current;
    const desiredX = clamp(ctrl.smoothedX01, 0, 1) * canvas.width - g.paddleW / 2;
    // Keep it responsive while still smooth.
    g.paddleX = lerp(g.paddleX, clamp(desiredX, 0, canvas.width - g.paddleW), 0.55);

    if (g.awaitingServe) {
      g.ballX = g.paddleX + g.paddleW / 2;
      g.ballY = g.paddleY - g.ballR - 2;
      if (g.serveAtMs > 0 && nowMs >= g.serveAtMs) {
        g.serveAtMs = 0;
        serveBallNow(g);
      }
      return;
    }

    const prevX = g.ballX;
    const prevY = g.ballY;

    // integrate
    g.ballX += g.ballVx * dtSec;
    g.ballY += g.ballVy * dtSec;

    // walls
    if (g.ballX - g.ballR < 0) {
      g.ballX = g.ballR;
      g.ballVx *= -1;
    } else if (g.ballX + g.ballR > canvas.width) {
      g.ballX = canvas.width - g.ballR;
      g.ballVx *= -1;
    }
    if (g.ballY - g.ballR < 0) {
      g.ballY = g.ballR;
      g.ballVy *= -1;
    }

    // below paddle => lose life
    if (g.ballY - g.ballR > canvas.height) {
      loseLife(g);
      return;
    }

    // paddle collision (only when moving down)
    if (
      g.ballVy > 0 &&
      circleRectHit(
        g.ballX,
        g.ballY,
        g.ballR,
        g.paddleX,
        g.paddleY,
        g.paddleW,
        g.paddleH,
      )
    ) {
      // reflect with angle based on hit position
      const hit01 = (g.ballX - g.paddleX) / g.paddleW; // 0..1
      const angle = (hit01 - 0.5) * (Math.PI / 2.5); // ~[-72°, 72°]
      const sp = g.speed;
      g.ballVx = Math.sin(angle) * sp;
      g.ballVy = -Math.cos(angle) * sp;
      g.ballY = g.paddleY - g.ballR - 1;
    }

    // brick collisions
    // Use swept collision against expanded brick AABB to prevent tunneling through multiple bricks.
    let best:
      | { brick: Brick; t: number; nx: number; ny: number }
      | null = null;
    for (const b of g.bricks) {
      if (!b.alive) continue;
      const hit = segmentAabbHit(
        prevX,
        prevY,
        g.ballX,
        g.ballY,
        b.x - g.ballR,
        b.y - g.ballR,
        b.x + b.w + g.ballR,
        b.y + b.h + g.ballR,
      );
      if (!hit) continue;
      if (!best || hit.t < best.t) best = { brick: b, t: hit.t, nx: hit.nx, ny: hit.ny };
    }

    if (best) {
      const b = best.brick;

      b.alive = false;
      g.bricksRemaining -= 1;
      g.score += 10;
      setUiScore(g.score);

      // speed up gradually as bricks break; capped
      const sped = g.baseSpeed + (g.bricks.length - g.bricksRemaining) * 6;
      g.speed = clamp(sped, g.baseSpeed, g.maxSpeed);
      setUiSpeedPct(Math.round(((g.speed - g.baseSpeed) / (g.maxSpeed - g.baseSpeed)) * 100));

      // place ball at impact point and reflect
      g.ballX = prevX + (g.ballX - prevX) * best.t;
      g.ballY = prevY + (g.ballY - prevY) * best.t;

      if (best.nx !== 0) g.ballVx *= -1;
      if (best.ny !== 0) g.ballVy *= -1;

      // Ensure a brick hit sends the ball away immediately; for the common case (ball moving up),
      // this means it comes back down right after hitting a brick.
      if (g.ballVy < 0) g.ballVy = Math.abs(g.ballVy);

      // normalize velocity to current speed
      const mag = Math.hypot(g.ballVx, g.ballVy) || 1;
      g.ballVx = (g.ballVx / mag) * g.speed;
      g.ballVy = (g.ballVy / mag) * g.speed;

      if (g.bricksRemaining <= 0) {
        setPhase("win");
      }
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    const g = gameRef.current;
    if (!canvas || !g) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // subtle vignette / arcade overlay
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, "rgba(0,0,0,0.10)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.10)");
    grad.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // bricks
    for (let i = 0; i < g.bricks.length; i++) {
      const b = g.bricks[i];
      if (!b.alive) continue;
      const row = Math.floor(i / 8);
      const hue = 200 + row * 12;
      ctx.fillStyle = `hsl(${hue} 90% 58% / 0.95)`;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(b.x, b.y, b.w, Math.max(2, Math.round(b.h * 0.18)));
    }

    // paddle
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    const r = Math.round(g.paddleH * 0.6);
    roundRect(ctx, g.paddleX, g.paddleY, g.paddleW, g.paddleH, r);
    ctx.fill();

    // ball
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.arc(g.ballX, g.ballY, g.ballR, 0, Math.PI * 2);
    ctx.fill();

    // ball glow
    ctx.beginPath();
    ctx.fillStyle = "rgba(130, 220, 255, 0.18)";
    ctx.arc(g.ballX, g.ballY, g.ballR * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function gameLoop() {
    let last = performance.now();
    const frame = () => {
      const now = performance.now();
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;
      tick(dt, now);
      draw();
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  }

  function trackerLoop() {
    let lastDetectMs = 0;
    const step = () => {
      const lm = landmarkerRef.current;
      const video = videoRef.current;
      const now = performance.now();
      if (
        lm &&
        video &&
        video.readyState >= 2 &&
        phase === "playing" &&
        !pauseRef.current.paused &&
        now - lastDetectMs >= 16
      ) {
        lastDetectMs = now;
        const res = lm.detectForVideo(video, now);
        const faces = res.faceLandmarks;
        if (faces && faces.length > 0) {
          const pts = faces[0];
          const nose = pts[1] ?? pts[4] ?? pts[0];
          if (nose) {
            // Map nose -> on-screen X, accounting for optional 90° rotation for portrait.
            // If we rotate(90deg) + mirror(scaleX(-1)) for display, the on-screen X corresponds to
            // the original landmark Y.
            const rotated = videoOrientationRef.current.rotated;
            const nx = rotated
              ? clamp(nose.y, 0, 1)
              : clamp(1 - nose.x, 0, 1);

            const c = controlRef.current;
            c.noseX01 = nx;
            c.smoothedX01 = lerp(c.smoothedX01, nx, 0.45);
            c.hasNose = true;
            c.lastSeenMs = now;
          }
        }
      }
      trackerRafRef.current = requestAnimationFrame(step);
    };
    trackerRafRef.current = requestAnimationFrame(step);
  }

  async function onStartPressed() {
    try {
      setCanvasSize();
      resetGame("playing");
      await ensureCameraAndTracking();
      setTrackingReady(true);

      const g = gameRef.current;
      if (g) {
        g.awaitingServe = true;
        g.serveAtMs = performance.now() + 300;
        setUiLives(g.lives);
        setUiScore(g.score);
      }
      setPhase("playing");
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : "Unable to start camera.");
      setPhase("start");
    }
  }

  function onPlayAgain() {
    resetGame("playing");
    const g = gameRef.current;
    if (g) {
      g.awaitingServe = true;
      g.serveAtMs = performance.now() + 300;
    }
    setPhase("playing");
  }

  function togglePause() {
    if (phase !== "playing") return;
    const g = gameRef.current;
    const p = pauseRef.current;
    const now = performance.now();

    if (!p.paused) {
      p.paused = true;
      p.startedAtMs = now;
      setPaused(true);
      return;
    }

    // resuming: shift pending serve timer forward by the paused duration
    const pausedFor = Math.max(0, now - p.startedAtMs);
    if (g && g.awaitingServe && g.serveAtMs > 0) {
      g.serveAtMs += pausedFor;
    }
    p.paused = false;
    p.startedAtMs = 0;
    setPaused(false);
  }

  useEffect(() => {
    setCanvasSize();
    window.addEventListener("resize", setCanvasSize);
    return () => window.removeEventListener("resize", setCanvasSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (trackerRafRef.current) cancelAnimationFrame(trackerRafRef.current);

    if (phase === "playing") {
      if (!gameRef.current && canvasRef.current) {
        gameRef.current = initialState(canvasRef.current.width, canvasRef.current.height);
      }
      gameLoop();
      trackerLoop();
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (trackerRafRef.current) cancelAnimationFrame(trackerRafRef.current);
      rafRef.current = null;
      trackerRafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    return () => {
      cleanupCamera();
    };
  }, []);

  return (
    <main className={styles.root}>
      <div ref={frameRef} className={styles.frame} onClick={togglePause}>
        <video
          ref={videoRef}
          className={`${styles.video} ${rotateVideoForPortrait ? styles.videoRotated : ""}`}
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} className={styles.canvas} />

        <div className={styles.hud} aria-hidden={phase !== "playing"}>
          <div className={styles.hudRow}>
            <div className={styles.hudPill}>Score: {uiScore}</div>
            <div className={styles.hudPill}>Lives: {uiLives}</div>
          </div>
          <div className={styles.hudSubtle}>
            Speed: {trackingReady ? `${uiSpeedPct}%` : "…"}
          </div>
        </div>

        {phase !== "playing" ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>FaceBreaker</div>
              <div className={styles.subtitle}>{overlayText}</div>

              {cameraError ? <div className={styles.error}>{cameraError}</div> : null}

              {phase === "start" ? (
                <button className={styles.primaryButton} onClick={onStartPressed}>
                  Start Game
                </button>
              ) : (
                <button className={styles.primaryButton} onClick={onPlayAgain}>
                  Play Again
                </button>
              )}

              <div className={styles.finePrint}>
                Tip: If the paddle feels jittery, keep your phone steady and face well-lit.
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.instructions}>
            Move your nose left and right to control the paddle.
          </div>
        )}

        {phase === "playing" && paused ? (
          <div className={styles.pauseOverlay} aria-label="Paused overlay">
            <div className={styles.pauseCard}>
              <div className={styles.pauseTitle}>Paused</div>
              <div className={styles.pauseSubtitle}>Tap anywhere to resume.</div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = clamp(r, 0, Math.min(w, h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

