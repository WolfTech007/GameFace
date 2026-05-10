/** Landmarker forehead-ish anchor (mesh index varies; 10 is stable on MediaPipe face_mesh-style layouts). */
const FOREHEAD_LM = 10;

type Pt = { x: number; y: number };

export type ForeheadPlacement =
  | { kind: "tracked"; nx: number; ny: number }
  | { kind: "fallback"; nx: number; ny: number };

/**
 * Normalized coords (0–1) in video bitmap space (before CSS mirror).
 * For horizontally mirrored video display, mirror nx when drawing to match the preview.
 */
export function foreheadFromLandmarks(landmarks: Pt[] | undefined): ForeheadPlacement {
  if (!landmarks?.length) {
    return { kind: "fallback", nx: 0.5, ny: 0.22 };
  }
  const pt = landmarks[FOREHEAD_LM] ?? landmarks[1] ?? landmarks[0];
  if (!pt) {
    return { kind: "fallback", nx: 0.5, ny: 0.22 };
  }
  return { kind: "tracked", nx: pt.x, ny: pt.y };
}
