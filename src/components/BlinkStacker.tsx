"use client";

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GFBottomNav } from "@/components/gameface/GFBottomNav";
import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";
import {
  BASE_SCORE_PER_LEVEL,
  BLINK_COOLDOWN_MS,
  COUNTDOWN_SEC,
  EAR_BLINK_FALLBACK_THRESHOLD,
  EAR_BLINK_FRAC_OF_OPEN,
  EAR_CALIBRATION_FRAMES,
  OVERLAP_WIN_MIN,
  PERFECT_BONUS_SCORE,
  PERFECT_OVERLAP_MIN,
  SPEED_BASE_PX,
  SPEED_MAX_PX,
  SPEED_PER_LEVEL_PX,
} from "@/lib/blinkStacker/constants";
import { combinedEar, createBlinkEdgeDetector } from "@/lib/blinkStacker/ear";
import { horizontalOverlap, overlapFractionOfMoving, type HSegment } from "@/lib/blinkStacker/overlap";
import {
  computeCameraTargetY,
  layoutFromCanvasHeight,
  smoothCamera,
} from "@/lib/blinkStacker/camera";
import { readBlinkStackerBest, writeBlinkStackerBest } from "@/lib/blinkStacker/storage";
import styles from "./BlinkStacker.module.css";

type Phase = "menu" | "countdown" | "playing" | "gameover";

type NormSeg = { ln: number; wn: number };

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: "blue" | "red";
};

type GameModel = {
  stack: NormSeg[];
  movingCenterN: number;
  movingWn: number;
  vxSign: 1 | -1;
  speedPx: number;
  particles: Particle[];
  lost: boolean;
  /** Screen offset: drawn Y = world Y + cameraY (follows tall stacks). */
  cameraY: number;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function toHSegN(cn: number, wn: number): HSegment {
  return { left: cn - wn / 2, width: wn };
}

function pathRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  w: number,
  h: number,
  opts: { hot?: boolean; alpha?: number },
) {
  const a = opts.alpha ?? 1;
  const g = ctx.createLinearGradient(x, yTop, x + w, yTop + h);
  g.addColorStop(0, `rgba(30, 58, 90, ${0.92 * a})`);
  g.addColorStop(0.5, `rgba(12, 20, 40, ${0.95 * a})`);
  g.addColorStop(1, `rgba(40, 20, 28, ${0.9 * a})`);
  pathRoundRect(ctx, x, yTop, w, h, 6);
  ctx.fillStyle = g;
  ctx.fill();
  pathRoundRect(ctx, x, yTop, w, h, 6);
  ctx.strokeStyle = opts.hot
    ? `rgba(251, 81, 81, ${0.85 * a})`
    : `rgba(56, 189, 248, ${0.88 * a})`;
  ctx.lineWidth = opts.hot ? 3 : 2;
  ctx.shadowColor = opts.hot ? "rgba(251, 81, 81, 0.45)" : "rgba(56, 189, 248, 0.45)";
  ctx.shadowBlur = opts.hot ? 18 : 14;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

export default function BlinkStacker() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("menu");
  const phaseRef = useRef<Phase>("menu");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const [countdownDigit, setCountdownDigit] = useState(COUNTDOWN_SEC);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const [showPerfect, setShowPerfect] = useState(false);
  const [finalScore, setFinalScore] = useState(0);

  const [shake, setShake] = useState(false);
  const [pulse, setPulse] = useState(false);
  const shakeTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(null);
  const calibrationEarsRef = useRef<number[]>([]);
  const blinkDetectorRef = useRef<ReturnType<typeof createBlinkEdgeDetector> | null>(null);

  const gameRef = useRef<GameModel | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    setBest(readBlinkStackerBest());
    reduceMotionRef.current =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }, []);

  const triggerShake = useCallback(() => {
    if (reduceMotionRef.current) return;
    setShake(true);
    if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = window.setTimeout(() => setShake(false), 240);
  }, []);

  const triggerPulse = useCallback(() => {
    if (reduceMotionRef.current) return;
    setPulse(true);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulse(false), 360);
  }, []);

  const initGameModel = useCallback((): GameModel => {
    const baseWn = 0.72;
    const ln = (1 - baseWn) / 2;
    return {
      stack: [{ ln, wn: baseWn }],
      movingCenterN: 0.5,
      movingWn: baseWn,
      vxSign: Math.random() < 0.5 ? 1 : -1,
      speedPx: SPEED_BASE_PX,
      particles: [],
      lost: false,
      cameraY: 0,
    };
  }, []);

  const endGame = useCallback((final: number) => {
    setPhase("gameover");
    phaseRef.current = "gameover";
    setFinalScore(final);
    setBest((b) => {
      const next = Math.max(b, final);
      if (next > b) writeBlinkStackerBest(next);
      return next;
    });
  }, []);

  const tryStopRef = useRef<() => void>(() => {});

  const tryStop = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const gm = gameRef.current;
    const canvas = canvasRef.current;
    if (!gm || !canvas || gm.lost) return;

    const below = gm.stack[gm.stack.length - 1];
    if (!below) return;

    const moving = toHSegN(gm.movingCenterN, gm.movingWn);
    const target: HSegment = { left: below.ln, width: below.wn };
    const { overlapLen, overlapLeft } = horizontalOverlap(moving, target);
    const frac = overlapFractionOfMoving(overlapLen, gm.movingWn);

    if (frac < OVERLAP_WIN_MIN) {
      gm.lost = true;
      const arenaW = canvas.width * 0.88;
      const arenaLeft = (canvas.width - arenaW) / 2;
      const { floorY, blockH, gap, floatExtra } = layoutFromCanvasHeight(canvas.height);
      const floatBottom = floorY - gm.stack.length * (blockH + gap) - floatExtra;
      const cx = arenaLeft + gm.movingCenterN * arenaW;
      const mw = gm.movingWn * arenaW;
      const x0 = cx - mw / 2;
      for (let i = 0; i < 32; i++) {
        const t = (Math.PI * 2 * i) / 32;
        gm.particles.push({
          x: x0 + mw / 2,
          y: floatBottom - blockH / 2,
          vx: Math.cos(t) * (180 + Math.random() * 120),
          vy: Math.sin(t) * (180 + Math.random() * 120) - 40,
          life: 1,
          hue: i % 3 === 0 ? "red" : "blue",
        });
      }
      triggerShake();
      window.setTimeout(() => endGame(scoreRef.current), 900);
      return;
    }

    const perfect = frac >= PERFECT_OVERLAP_MIN;
    const newSeg: NormSeg = { ln: overlapLeft, wn: overlapLen };
    gm.stack.push(newSeg);
    gm.movingWn = overlapLen;
    gm.movingCenterN = overlapLeft + overlapLen / 2;
    gm.speedPx = Math.min(SPEED_MAX_PX, SPEED_BASE_PX + SPEED_PER_LEVEL_PX * (gm.stack.length - 1));
    gm.vxSign = Math.random() < 0.5 ? 1 : -1;

    setLevel(gm.stack.length);
    setScore((s) => s + BASE_SCORE_PER_LEVEL * (gm.stack.length - 1) + (perfect ? PERFECT_BONUS_SCORE : 0));

    if (perfect) {
      setShowPerfect(true);
      window.setTimeout(() => setShowPerfect(false), 750);
    }
    triggerPulse();
  }, [endGame, triggerPulse, triggerShake]);

  tryStopRef.current = tryStop;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (phaseRef.current !== "playing") return;
      e.preventDefault();
      tryStopRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visionStep = useCallback((now: number) => {
    const video = videoRef.current;
    const lm = landmarkerRef.current;
    if (!video || !lm || video.readyState < 2) return;

    const res = lm.detectForVideo(video, now);
    const pts = res.faceLandmarks?.[0] as NormalizedLandmark[] | undefined;
    const ear = combinedEar(pts);

    if (phaseRef.current === "countdown") {
      const cal = calibrationEarsRef.current;
      if (cal.length < EAR_CALIBRATION_FRAMES) cal.push(ear);
      return;
    }

    if (phaseRef.current !== "playing") return;
    const det = blinkDetectorRef.current;
    if (!det) return;
    if (det.tick(ear, now)) tryStopRef.current();
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const gm = gameRef.current;
    if (!canvas || !gm) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const arenaW = w * 0.88;
    const arenaLeft = (w - arenaW) / 2;
    const { floorY, blockH, gap, floatExtra } = layoutFromCanvasHeight(h);
    const cam = gm.cameraY;

    ctx.save();
    ctx.translate(0, cam);

    ctx.fillStyle = "rgba(56, 189, 248, 0.04)";
    ctx.fillRect(arenaLeft, -h * 2, arenaW, h * 5);

    gm.stack.forEach((seg, i) => {
      const bottomY = floorY - i * (blockH + gap);
      const x = arenaLeft + seg.ln * arenaW;
      const bw = seg.wn * arenaW;
      drawBlock(ctx, x, bottomY - blockH, bw, blockH, {});
    });

    if (!gm.lost) {
      const floatBottom = floorY - gm.stack.length * (blockH + gap) - floatExtra;
      const x = arenaLeft + (gm.movingCenterN - gm.movingWn / 2) * arenaW;
      const bw = gm.movingWn * arenaW;
      drawBlock(ctx, x, floatBottom - blockH, bw, blockH, { hot: true });
    }

    for (const p of gm.particles) {
      if (p.life <= 0) continue;
      const a = clamp(p.life, 0, 1);
      ctx.fillStyle = p.hue === "red" ? `rgba(251, 81, 81, ${0.75 * a})` : `rgba(56, 189, 248, ${0.75 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * a + 1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, []);

  const gameLoop = useCallback(
    (ts: number) => {
      const canvas = canvasRef.current;
      const gm = gameRef.current;
      if (!canvas || !gm) {
        rafRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      const last = lastTsRef.current ?? ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      lastTsRef.current = ts;

      visionStep(ts);

      if (phaseRef.current === "playing" && !gm.lost) {
        const arenaW = canvas.width * 0.88;
        const wn = gm.movingWn;
        const half = wn / 2;
        const c = gm.movingCenterN;
        const deltaN = (gm.speedPx / arenaW) * dt;
        let next = c + gm.vxSign * deltaN;
        if (next <= half) {
          next = half;
          gm.vxSign = 1;
        } else if (next >= 1 - half) {
          next = 1 - half;
          gm.vxSign = -1;
        }
        gm.movingCenterN = next;

        const { h, floorY, blockH, gap, floatExtra } = layoutFromCanvasHeight(canvas.height);
        const target = computeCameraTargetY({
          canvasH: h,
          floorY,
          blockH,
          gap,
          floatExtra,
          stackLen: gm.stack.length,
        });
        if (reduceMotionRef.current) gm.cameraY = target;
        else gm.cameraY = smoothCamera(gm.cameraY, target, dt, 12);
      }

      if (gm.lost && gm.particles.length) {
        for (const p of gm.particles) {
          if (p.life <= 0) continue;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 520 * dt;
          p.life -= dt * 1.35;
        }
      }

      drawFrame();
      rafRef.current = requestAnimationFrame(gameLoop);
    },
    [drawFrame, visionStep],
  );

  useEffect(() => {
    rafRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [gameLoop]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const apply = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(200, Math.floor(r.width * dpr));
      const ch = Math.max(240, Math.floor(r.height * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const beginPlaying = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    lastTsRef.current = null;
    gameRef.current = initGameModel();
    const ears = calibrationEarsRef.current;
    const openGuess = ears.length ? Math.max(...ears) : 0.26;
    const threshold = Math.max(
      0.12,
      Math.min(0.3, Math.max(EAR_BLINK_FALLBACK_THRESHOLD * 0.85, openGuess * EAR_BLINK_FRAC_OF_OPEN)),
    );
    blinkDetectorRef.current = createBlinkEdgeDetector({ threshold, cooldownMs: BLINK_COOLDOWN_MS });
    blinkDetectorRef.current.reset();

    setScore(0);
    setLevel(1);
    setPhase("playing");
    phaseRef.current = "playing";
  }, [initGameModel]);

  const startRun = useCallback(async () => {
    setCameraNote(null);
    calibrationEarsRef.current = [];

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 640 } },
      });
    } catch {
      setCameraNote("Camera unavailable — use Space or tap the stack.");
    }

    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      await video.play().catch(() => {});
      try {
        landmarkerRef.current = await createFaceLandmarker();
      } catch {
        landmarkerRef.current = null;
        setCameraNote("Face tracking unavailable — use Space or tap.");
      }
    } else {
      landmarkerRef.current = null;
    }

    setPhase("countdown");
    phaseRef.current = "countdown";
    setCountdownDigit(COUNTDOWN_SEC);
  }, []);

  useEffect(() => {
    if (phase !== "countdown") return;
    let step = 0;
    const id = window.setInterval(() => {
      step += 1;
      if (step >= COUNTDOWN_SEC) {
        window.clearInterval(id);
        beginPlaying();
        return;
      }
      setCountdownDigit(COUNTDOWN_SEC - step);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, beginPlaying]);

  const goMenu = useCallback(() => {
    gameRef.current = null;
    const c = canvasRef.current?.getContext("2d");
    const cv = canvasRef.current;
    if (c && cv) c.clearRect(0, 0, cv.width, cv.height);
    setPhase("menu");
    phaseRef.current = "menu";
    const v = videoRef.current;
    if (v?.srcObject) {
      const ms = v.srcObject as MediaStream;
      for (const t of ms.getTracks()) t.stop();
      v.srcObject = null;
    }
    landmarkerRef.current = null;
  }, []);

  return (
    <div className={styles.shell}>
      <video ref={videoRef} className={styles.hiddenVideo} playsInline muted autoPlay />

      <header className={styles.topBar}>
        <span className={styles.brand}>BLINK STACKER</span>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Score</span>
            <span className={styles.statValue}>{score}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Level</span>
            <span className={styles.statValue}>{level}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Best</span>
            <span className={styles.statValue}>{best}</span>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div
          ref={wrapRef}
          className={`${styles.stageWrap} ${shake ? styles.shake : ""} ${pulse ? styles.pulseGlow : ""}`}
        >
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            role="application"
            aria-label="Blink Stacker playfield"
            onClick={() => {
              if (phaseRef.current === "playing") tryStopRef.current();
            }}
          />

          {phase === "countdown" ? (
            <div className={styles.overlay}>
              <p className={styles.overlayTitle}>Ready</p>
              <div className={styles.countdownNum} aria-live="polite">
                {countdownDigit}
              </div>
              <p className={styles.overlayBody}>Keep eyes open for a moment — we calibrate your blink.</p>
            </div>
          ) : null}

          {phase === "menu" ? (
            <div className={styles.overlay}>
              <p className={styles.overlayTitle}>Blink Stacker</p>
              <p className={styles.overlayBody}>
                Stack the tower. When the neon block lines up, <strong>blink</strong> to lock it in. If the
                overlap is under half the moving block&apos;s width, you lose.
              </p>
              <div className={styles.actions}>
                <button type="button" className={styles.primaryBtn} onClick={() => void startRun()}>
                  Start game
                </button>
                <button type="button" className={styles.goHome} onClick={() => router.push("/")}>
                  GO HOME
                </button>
              </div>
            </div>
          ) : null}

          {phase === "gameover" ? (
            <div className={styles.overlay}>
              <p className={styles.overlayTitle}>Game over</p>
              <p className={styles.overlayBody}>
                Final score: <strong>{finalScore}</strong>
                <br />
                Best: <strong>{Math.max(best, finalScore)}</strong>
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => {
                    calibrationEarsRef.current = [];
                    setPhase("countdown");
                    phaseRef.current = "countdown";
                    setCountdownDigit(COUNTDOWN_SEC);
                  }}
                >
                  Play again
                </button>
                <button type="button" className={styles.goHome} onClick={() => router.push("/")}>
                  GO HOME
                </button>
              </div>
            </div>
          ) : null}

          {showPerfect ? <div className={styles.perfectBanner}>PERFECT</div> : null}
        </div>

        {phase === "playing" ? (
          <>
            <p className={styles.hint}>BLINK TO STOP</p>
            <p className={styles.subHint}>Space or tap — fallback controls</p>
          </>
        ) : null}
        {phase === "menu" && cameraNote ? <p className={styles.subHint}>{cameraNote}</p> : null}
      </main>

      {phase === "playing" ? (
        <div
          style={{
            position: "fixed",
            bottom: "calc(var(--safe-bottom, 0px) + 88px)",
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            zIndex: 6,
          }}
        >
          <button type="button" className={styles.goHome} onClick={goMenu}>
            Quit to menu
          </button>
        </div>
      ) : null}

      <GFBottomNav activeHref="/" />
    </div>
  );
}
