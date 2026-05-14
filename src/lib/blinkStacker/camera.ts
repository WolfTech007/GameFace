/**
 * Vertical follow camera for Blink Stacker.
 * World Y uses the same downward axis as canvas space; positive cameraY shifts the whole scene down on screen.
 *
 * Until the tower (base → active row) is ~60% of canvas tall, target offset stays 0 so early levels feel stable.
 * Above that, target aligns the active block’s vertical center near the upper-middle of the viewport.
 */

export type CameraLayout = {
  canvasH: number;
  floorY: number;
  blockH: number;
  gap: number;
  floatExtra: number;
  stackLen: number;
};

export function layoutFromCanvasHeight(canvasH: number) {
  const h = canvasH;
  const floorY = h - 40;
  const blockH = Math.max(18, Math.min(32, h * 0.045));
  const gap = Math.max(4, blockH * 0.18);
  const floatExtra = 12;
  return { h, floorY, blockH, gap, floatExtra };
}

/** World-space bottom edge of the active (moving) row slot. */
export function worldFloatBottom(floorY: number, blockH: number, gap: number, floatExtra: number, stackLen: number) {
  return floorY - stackLen * (blockH + gap) - floatExtra;
}

/**
 * Desired camera offset (screen = world + cameraY).
 * Returns 0 until the tower exceeds ~60% of canvas height, then ramps in over a short band so motion eases on.
 */
export function computeCameraTargetY(layout: CameraLayout): number {
  const { canvasH: h, floorY, blockH, gap, floatExtra, stackLen } = layout;
  const towerH = stackLen * (blockH + gap) + floatExtra + blockH;
  const threshold = h * 0.6;
  if (towerH <= threshold) return 0;

  const fb = worldFloatBottom(floorY, blockH, gap, floatExtra, stackLen);
  const worldCenterY = fb - blockH / 2;
  const targetScreenY = h * 0.38;
  const raw = targetScreenY - worldCenterY;

  const band = h * 0.08;
  const blend = Math.min(1, (towerH - threshold) / band);
  return raw * blend;
}

export function smoothCamera(current: number, target: number, dt: number, lambda = 12): number {
  const t = 1 - Math.exp(-lambda * dt);
  return current + (target - current) * Math.min(1, t);
}
