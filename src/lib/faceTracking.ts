import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";

export type NoseTracker = {
  start: (opts: {
    videoEl: HTMLVideoElement;
    /** Legacy single-axis (FacePong). */
    onNoseX?: (x01: number) => void;
    /** Optional XY for games like FaceHockey (normalized 0–1). */
    onNoseXY?: (x01: number, y01: number) => void;
    isPaused?: () => boolean;
    mirrorSelfie?: boolean;
    /**
     * EMA blend toward raw landmark each frame (0–1). Use 0 for raw nose (e.g. FaceHockey mallet).
     * Default matches historical FacePong smoothing.
     */
    noseSmooth?: number;
  }) => () => void;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export async function createNoseTracker(): Promise<NoseTracker> {
  const landmarker = await createFaceLandmarker();

  return {
    start({ videoEl, onNoseX, onNoseXY, isPaused, mirrorSelfie = true, noseSmooth = 0.42 }) {
      let raf: number | null = null;
      let lastDetectMs = 0;
      let smoothedX = 0.5;
      let smoothedY = 0.5;

      const step = () => {
        const now = performance.now();
        const paused = isPaused?.() ?? false;
        if (!paused && videoEl.readyState >= 2 && now - lastDetectMs >= 16) {
          lastDetectMs = now;
          const res = landmarker.detectForVideo(videoEl, now);
          const faces = res.faceLandmarks;
          if (faces && faces.length > 0) {
            const pts = faces[0];
            const nose = pts[1] ?? pts[4] ?? pts[0];
            if (nose) {
              const rawX = clamp(mirrorSelfie ? 1 - nose.x : nose.x, 0, 1);
              const rawY = clamp(mirrorSelfie ? nose.y : 1 - nose.y, 0, 1);
              const a = clamp(noseSmooth, 0, 1);
              if (a <= 0) {
                smoothedX = rawX;
                smoothedY = rawY;
              } else {
                smoothedX = lerp(smoothedX, rawX, a);
                smoothedY = lerp(smoothedY, rawY, a);
              }
              if (onNoseXY) onNoseXY(smoothedX, smoothedY);
              else onNoseX?.(smoothedX);
            }
          }
        }
        raf = requestAnimationFrame(step);
      };

      raf = requestAnimationFrame(step);
      return () => {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
      };
    },
  };
}

