import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";

export type NoseTracker = {
  start: (opts: {
    videoEl: HTMLVideoElement;
    onNoseX: (x01: number) => void;
    isPaused?: () => boolean;
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
    start({ videoEl, onNoseX, isPaused }) {
      let raf: number | null = null;
      let lastDetectMs = 0;
      let smoothed = 0.5;

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
              // mirrored selfie display: invert X
              const raw = clamp(1 - nose.x, 0, 1);
              smoothed = lerp(smoothed, raw, 0.45);
              onNoseX(smoothed);
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

