/**
 * Blink detection via Eye Aspect Ratio (EAR) on MediaPipe Face Landmarker topology.
 *
 * EAR ≈ (vertical eye opening) / (horizontal eye span). It drops sharply when the eyelids close.
 * We fire a “blink” on a downward threshold crossing with a cooldown so one physical blink
 * does not emit multiple stop events.
 */

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/** MediaPipe Face Landmarker indices — one classic 6-point set per eye. */
const R_OUTER = 33;
const R_TOP_O = 160;
const R_TOP_I = 158;
const R_INNER = 133;
const R_BOT_I = 153;
const R_BOT_O = 144;

const L_OUTER = 362;
const L_TOP_O = 385;
const L_TOP_I = 387;
const L_INNER = 263;
const L_BOT_I = 373;
const L_BOT_O = 380;

function dist2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Computes EAR for one eye from six contour points (Soukupová–Čech style).
 * Higher values mean the eye is more open.
 */
export function eyeAspectRatio6(pts: NormalizedLandmark[], spec: readonly number[]): number {
  const [p1, p2, p3, p4, p5, p6] = spec.map((i) => pts[i]);
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0.35;
  const v1 = dist2D(p2, p6);
  const v2 = dist2D(p3, p5);
  const h = dist2D(p1, p4);
  if (h < 1e-6) return 0.35;
  return (v1 + v2) / (2 * h);
}

/** Average EAR across both eyes (mirrored selfie video still yields consistent geometry). */
export function combinedEar(pts: NormalizedLandmark[] | undefined): number {
  if (!pts?.length) return 0.35;
  const right = eyeAspectRatio6(pts, [R_OUTER, R_TOP_O, R_TOP_I, R_INNER, R_BOT_I, R_BOT_O]);
  const left = eyeAspectRatio6(pts, [L_OUTER, L_TOP_O, L_TOP_I, L_INNER, L_BOT_I, L_BOT_O]);
  return (right + left) / 2;
}

export type BlinkEdgeDetector = {
  reset: () => void;
  /** Returns true once when a blink edge is detected (subject to cooldown). */
  tick: (ear: number, nowMs: number) => boolean;
};

/**
 * Blink = EAR crosses from at/above `threshold` down below `threshold`.
 * Cooldown suppresses double-fires from a single blink waveform.
 */
export function createBlinkEdgeDetector(opts: { threshold: number; cooldownMs: number }): BlinkEdgeDetector {
  let prevEar = 1;
  let lastFireMs = -Infinity;

  return {
    reset() {
      prevEar = 1;
      lastFireMs = -Infinity;
    },
    tick(ear: number, nowMs: number): boolean {
      const crossed = ear < opts.threshold && prevEar >= opts.threshold;
      prevEar = ear;
      if (!crossed) return false;
      if (nowMs - lastFireMs < opts.cooldownMs) return false;
      lastFireMs = nowMs;
      return true;
    },
  };
}
