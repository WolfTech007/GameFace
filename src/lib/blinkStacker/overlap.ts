/**
 * Horizontal 1D overlap between the moving block and the block below (stack top).
 * Both blocks live in the same “arena” coordinate system: x increases left → right.
 */

export type HSegment = { left: number; width: number };

/**
 * Returns overlap segment length and its left edge.
 * If there is no intersection, overlapLen is 0 (loss when below 50% of moving width).
 */
export function horizontalOverlap(moving: HSegment, below: HSegment): { overlapLen: number; overlapLeft: number } {
  const mRight = moving.left + moving.width;
  const bRight = below.left + below.width;
  const lo = Math.max(moving.left, below.left);
  const hi = Math.min(mRight, bRight);
  const overlapLen = Math.max(0, hi - lo);
  return { overlapLen, overlapLeft: lo };
}

/** Fraction of the moving block’s width that is still supported by the block below. */
export function overlapFractionOfMoving(overlapLen: number, movingWidth: number): number {
  if (movingWidth <= 0) return 0;
  return overlapLen / movingWidth;
}
