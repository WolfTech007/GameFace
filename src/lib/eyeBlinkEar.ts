/**
 * Eye aspect ratio (EAR) from MediaPipe Face Landmarker landmarks.
 * Uses six points per eye (standard blink-detection layout).
 */

export type NormPoint = { x: number; y: number; z?: number };

// Indices for MediaPipe Face Mesh–compatible topology (478 landmarks).
const LEFT_EYE = [362, 385, 387, 263, 373, 380] as const;
const RIGHT_EYE = [33, 160, 158, 133, 153, 144] as const;

function dist(a: NormPoint, b: NormPoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function earForEye(pts: NormPoint[], indices: readonly number[]) {
  const p = indices.map((i) => pts[i]).filter(Boolean);
  if (p.length < 6) return 1;
  const [p1, p2, p3, p4, p5, p6] = p;
  const v1 = dist(p2, p6);
  const v2 = dist(p3, p5);
  const h = dist(p1, p4);
  if (h < 1e-6) return 1;
  return (v1 + v2) / (2 * h);
}

export function computeEyeAspectRatio(landmarks: NormPoint[] | undefined): number | null {
  if (!landmarks || landmarks.length < 468) return null;
  const left = earForEye(landmarks, LEFT_EYE);
  const right = earForEye(landmarks, RIGHT_EYE);
  return (left + right) / 2;
}

export type BlinkSmoother = {
  update(ear: number | null, opts: { openThreshold: number }): { blinkFrames: number; isLikelyBlink: boolean };
  reset(): void;
};

export function createBlinkSmoother(consecutiveNeeded = 5) {
  let lowFrames = 0;
  return {
    update(ear: number | null, opts: { openThreshold: number }) {
      if (ear == null) {
        lowFrames = 0;
        return { blinkFrames: 0, isLikelyBlink: false };
      }
      if (ear < opts.openThreshold) lowFrames += 1;
      else lowFrames = 0;
      return {
        blinkFrames: lowFrames,
        isLikelyBlink: lowFrames >= consecutiveNeeded,
      };
    },
    reset() {
      lowFrames = 0;
    },
  };
}
