import type { FaceHockeyNetState } from "@/lib/facehockeyProtocol";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Normalized table constants (+y down). Radii are relative to min(canvas w,h); see scaledHypot. */
export const FH = {
  WALL_INSET: 0.022,
  A_Y_MIN: 0.54,
  A_Y_MAX: 0.92,
  B_Y_MIN: 0.08,
  B_Y_MAX: 0.46,
  X_MIN: 0.08,
  X_MAX: 0.92,
  PUCK_R: 0.036,
  /** Visual + hitbox (same); +30% vs prior size */
  MALLET_R: 0.054 * 1.3 * 1.3,
  GOAL_HALF_W: 0.11,
  /** Puck center crosses into slot → goal */
  TOP_GOAL_Y: 0.032,
  BOT_GOAL_Y: 0.968,
  /** Fillet at rail corners (same units as WALL_INSET); keeps puck from jamming */
  CORNER_FILLET_R: 0.045,
  /** Height / width of playfield (canvas); collision uses min-dimension radii like the draw loop */
  PLAYFIELD_H_OVER_W: 2,
  /** Normalized push inward after rail hit — keeps puck out of the boundary strip */
  WALL_PUSH_NORM: 0.002,
  /** Floor while puck is live (host physics only); avoids permanent crawl / exact zeros */
  MIN_PUCK_SPEED_ACTIVE: 0.032,
  /** Prevent puck from becoming "dead" after mallet hits */
  MIN_SPEED_AFTER_HIT: 0.22,
  FRICTION: 0.995,
  MAX_SPEED: 1.1,
  RALLY_RAMP_S: 48,
  MAX_SPEED_MULT: 1.55,
  MALLET_PUSH: 0.38,
  RESTITUTION_WALL: 0.94,
  RESTITUTION_MALLET: 1.06,
};

/** Empirical correction: MediaPipe nose landmark can skew slightly above the tip on some faces. */
const NOSE_TIP_Y_OFFSET = 0.08;

function length(x: number, y: number) {
  return Math.hypot(x, y);
}

/** Matches circular draw rPx(r01)=r01·min(w,h): compare distances in pixel-equivalent space. */
function scaledHypot(dx: number, dy: number, wy: number): number {
  return Math.hypot(dx, dy * wy);
}

/** Unit direction for separation push; ‖(nx, ny·wy)‖ = 1. */
function scaledSepDir(dx: number, dy: number, wy: number): { x: number; y: number } {
  const D = scaledHypot(dx, dy, wy);
  if (D < 1e-9) return { x: 1, y: 0 };
  return { x: dx / D, y: dy / D };
}

/** Mutable anti-stuck timers (host-side only; never synced). */
export type FaceHockeyAntiStuckScratch = {
  lowNearCornerSec: number;
  sameCornerSec: number;
  lastCornerKey: string;
};

function reflectVelocity(
  vx: number,
  vy: number,
  nx: number,
  ny: number,
  restitution: number,
): { vx: number; vy: number } {
  const vn = vx * nx + vy * ny;
  if (vn >= 0) return { vx, vy };
  const j = -(1 + restitution) * vn;
  return { vx: vx + j * nx, vy: vy + j * ny };
}

/**
 * Host-only integration. Mutates `s.puck` and mallet copies on `s`.
 * Does **not** mutate scores — caller applies goals.
 */
export function hostStepPhysics(
  s: FaceHockeyNetState,
  dt: number,
  malletA: { x: number; y: number },
  malletB: { x: number; y: number },
  prevA: { x: number; y: number },
  prevB: { x: number; y: number },
  rallyElapsedSec: number,
  playfieldHOverW: number = FH.PLAYFIELD_H_OVER_W,
  antiScratch?: FaceHockeyAntiStuckScratch | null,
): { goal: "A" | "B" | null } {
  s.malletA = { ...malletA };
  s.malletB = { ...malletB };

  if (s.phase !== "playing" || s.puckFrozen) {
    return { goal: null };
  }

  const wy = playfieldHOverW;
  const push = FH.WALL_PUSH_NORM;

  let { x, y, vx, vy } = s.puck;
  const pr = FH.PUCK_R;
  const wi = FH.WALL_INSET;

  const speedMult = clamp(
    1 + (rallyElapsedSec / FH.RALLY_RAMP_S) * (FH.MAX_SPEED_MULT - 1),
    1,
    FH.MAX_SPEED_MULT,
  );
  let maxSp = FH.MAX_SPEED * speedMult;

  vx *= Math.pow(FH.FRICTION, dt * 60);
  vy *= Math.pow(FH.FRICTION, dt * 60);

  let sp = length(vx, vy);
  if (sp > maxSp) {
    const sc = maxSp / sp;
    vx *= sc;
    vy *= sc;
    sp = maxSp;
  }

  x += vx * dt;
  y += vy * dt;

  const goalMouth = (gx: number) => Math.abs(gx - 0.5) <= FH.GOAL_HALF_W + pr * 0.5;

  // Goals (before wall bounce)
  if (y < FH.TOP_GOAL_Y && goalMouth(x)) {
    return { goal: "A" };
  }
  if (y > FH.BOT_GOAL_Y && goalMouth(x)) {
    return { goal: "B" };
  }

  const goalL = 0.5 - FH.GOAL_HALF_W;
  const goalR = 0.5 + FH.GOAL_HALF_W;

  const goalTopOpenAt = (gx: number) => gx > goalL - pr && gx < goalR + pr;
  const topRailBlocks = (gx: number, gy: number) => gy < wi + pr && !goalTopOpenAt(gx);
  const botRailBlocks = (gx: number, gy: number) => gy > 1 - wi - pr && !goalTopOpenAt(gx);

  const cornerKickPad = push * 2.2;
  const eWall = FH.RESTITUTION_WALL;

  // Two walls at once → diagonal escape from sharp corner (radius-aware puck center limits)
  const penL = x < wi + pr;
  const penR = x > 1 - wi - pr;
  const penT = topRailBlocks(x, y);
  const penB = botRailBlocks(x, y);

  if (penL && penT && x <= goalL - pr * 0.35) {
    x = wi + pr + cornerKickPad;
    y = wi + pr + cornerKickPad;
    const r = reflectVelocity(vx, vy, Math.SQRT1_2, Math.SQRT1_2, eWall);
    vx = r.vx;
    vy = r.vy;
  } else if (penR && penT && x >= goalR + pr * 0.35) {
    x = 1 - wi - pr - cornerKickPad;
    y = wi + pr + cornerKickPad;
    const r = reflectVelocity(vx, vy, -Math.SQRT1_2, Math.SQRT1_2, eWall);
    vx = r.vx;
    vy = r.vy;
  } else if (penL && penB && x <= goalL - pr * 0.35) {
    x = wi + pr + cornerKickPad;
    y = 1 - wi - pr - cornerKickPad;
    const r = reflectVelocity(vx, vy, Math.SQRT1_2, -Math.SQRT1_2, eWall);
    vx = r.vx;
    vy = r.vy;
  } else if (penR && penB && x >= goalR + pr * 0.35) {
    x = 1 - wi - pr - cornerKickPad;
    y = 1 - wi - pr - cornerKickPad;
    const r = reflectVelocity(vx, vy, -Math.SQRT1_2, -Math.SQRT1_2, eWall);
    vx = r.vx;
    vy = r.vy;
  }

  // Side walls
  if (x < wi + pr) {
    x = wi + pr + push;
    vx = Math.abs(vx) * eWall;
  } else if (x > 1 - wi - pr) {
    x = 1 - wi - pr - push;
    vx = -Math.abs(vx) * eWall;
  }

  // Top rail (outside goal mouth)
  if (topRailBlocks(x, y)) {
    y = wi + pr + push;
    vy = Math.abs(vy) * eWall;
  }

  // Bottom rail (outside goal mouth)
  if (botRailBlocks(x, y)) {
    y = 1 - wi - pr - push;
    vy = -Math.abs(vy) * eWall;
  }

  const Rf = FH.CORNER_FILLET_R;
  const cornerMin = Rf + pr;

  const resolveRailCorner = (
    ox: number,
    oy: number,
    active: boolean,
    inQuad: (dx: number, dy: number) => boolean,
  ) => {
    if (!active) return;
    const dx = x - ox;
    const dy = y - oy;
    if (!inQuad(dx, dy)) return;
    const D = scaledHypot(dx, dy, wy);
    if (D >= cornerMin || D < 1e-9) return;
    const n = scaledSepDir(dx, dy, wy);
    const overlap = cornerMin - D;
    x += n.x * overlap;
    y += n.y * overlap;
    const vn = vx * n.x + vy * n.y;
    if (vn < 0) {
      vx -= (1 + eWall) * vn * n.x;
      vy -= (1 + eWall) * vn * n.y;
    }
  };

  resolveRailCorner(wi + pr + Rf, wi + pr + Rf, x <= goalL - pr, (dx, dy) => dx < 0 && dy < 0);
  resolveRailCorner(1 - wi - pr - Rf, wi + pr + Rf, x >= goalR + pr, (dx, dy) => dx > 0 && dy < 0);
  resolveRailCorner(wi + pr + Rf, 1 - wi - pr - Rf, x <= goalL - pr, (dx, dy) => dx < 0 && dy > 0);
  resolveRailCorner(1 - wi - pr - Rf, 1 - wi - pr - Rf, x >= goalR + pr, (dx, dy) => dx > 0 && dy > 0);

  // Corner resolve can nudge past a rail plane — clamp again
  if (x < wi + pr) {
    x = wi + pr + push;
    vx = Math.abs(vx) * eWall;
  } else if (x > 1 - wi - pr) {
    x = 1 - wi - pr - push;
    vx = -Math.abs(vx) * eWall;
  }
  if (topRailBlocks(x, y)) {
    y = wi + pr + push;
    vy = Math.abs(vy) * eWall;
  }
  if (botRailBlocks(x, y)) {
    y = 1 - wi - pr - push;
    vy = -Math.abs(vy) * eWall;
  }

  const collide = (mx: number, my: number, mvx: number, mvy: number) => {
    const dx = x - mx;
    const dy = y - my;
    const dist = scaledHypot(dx, dy, wy);
    const minD = FH.MALLET_R + pr;
    if (dist >= minD || dist < 1e-6) return;
    const n = scaledSepDir(dx, dy, wy);
    const overlap = minD - dist;
    x += n.x * overlap;
    y += n.y * overlap;
    const rvx = vx - mvx;
    const rvy = vy - mvy;
    const vn = rvx * n.x + rvy * n.y;
    if (vn >= 0) return;
    const impulse = -(1 + FH.RESTITUTION_MALLET) * vn;
    vx += impulse * n.x * 0.55 + mvx * FH.MALLET_PUSH * 0.025;
    vy += impulse * n.y * 0.55 + mvy * FH.MALLET_PUSH * 0.025;

    // Failsafe: never let a mallet hit produce a "dead" puck that can be corner-trapped.
    const sp2 = vx * vx + vy * vy;
    const minSp = FH.MIN_SPEED_AFTER_HIT;
    if (sp2 < minSp * minSp) {
      vx = n.x * minSp;
      vy = n.y * minSp;
    }
  };

  const dtx = 1 / Math.max(dt, 1 / 120);
  collide(malletA.x, malletA.y, (malletA.x - prevA.x) * dtx, (malletA.y - prevA.y) * dtx);
  collide(malletB.x, malletB.y, (malletB.x - prevB.x) * dtx, (malletB.y - prevB.y) * dtx);

  resolveRailCorner(wi + pr + Rf, wi + pr + Rf, x <= goalL - pr, (dx, dy) => dx < 0 && dy < 0);
  resolveRailCorner(1 - wi - pr - Rf, wi + pr + Rf, x >= goalR + pr, (dx, dy) => dx > 0 && dy < 0);
  resolveRailCorner(wi + pr + Rf, 1 - wi - pr - Rf, x <= goalL - pr, (dx, dy) => dx < 0 && dy > 0);
  resolveRailCorner(1 - wi - pr - Rf, 1 - wi - pr - Rf, x >= goalR + pr, (dx, dy) => dx > 0 && dy > 0);

  if (x < wi + pr) {
    x = wi + pr + push;
    vx = Math.abs(vx) * eWall;
  } else if (x > 1 - wi - pr) {
    x = 1 - wi - pr - push;
    vx = -Math.abs(vx) * eWall;
  }
  if (topRailBlocks(x, y)) {
    y = wi + pr + push;
    vy = Math.abs(vy) * eWall;
  }
  if (botRailBlocks(x, y)) {
    y = 1 - wi - pr - push;
    vy = -Math.abs(vy) * eWall;
  }

  const classifyCornerKey = (): string => {
    const band = 0.062;
    const nearL = x < wi + pr + band;
    const nearR = x > 1 - wi - pr - band;
    const nearT = y < wi + pr + band && !goalTopOpenAt(x);
    const nearB = y > 1 - wi - pr - band && !goalTopOpenAt(x);
    if (nearL && nearT && x <= goalL - pr * 0.2) return "tl";
    if (nearR && nearT && x >= goalR + pr * 0.2) return "tr";
    if (nearL && nearB && x <= goalL - pr * 0.2) return "bl";
    if (nearR && nearB && x >= goalR + pr * 0.2) return "br";
    return "";
  };

  const kickTowardCenter = (speed: number, angleJitter: number) => {
    const dx = 0.5 - x;
    const dy = 0.5 - y;
    const base = Math.atan2(dy, dx);
    const ang = base + (Math.random() * 2 - 1) * angleJitter;
    vx += Math.cos(ang) * speed;
    vy += Math.sin(ang) * speed;
  };

  const scratch = antiScratch;
  if (scratch) {
    const ck = classifyCornerKey();
    const spNear = length(vx, vy);
    const inCorner = ck !== "";
    const crawl = spNear < 0.03;

    if (inCorner && crawl) scratch.lowNearCornerSec += dt;
    else scratch.lowNearCornerSec = 0;

    if (scratch.lowNearCornerSec > 0.5) {
      scratch.lowNearCornerSec = 0;
      kickTowardCenter(0.075, 0.42);
    }

    if (ck && inCorner) {
      if (ck === scratch.lastCornerKey) scratch.sameCornerSec += dt;
      else {
        scratch.lastCornerKey = ck;
        scratch.sameCornerSec = 0;
      }
    } else {
      scratch.sameCornerSec = 0;
      scratch.lastCornerKey = "";
    }

    if (scratch.sameCornerSec > 1 && ck && inCorner) {
      scratch.sameCornerSec = 0;
      scratch.lastCornerKey = "";
      const dx = 0.5 - x;
      const dy = 0.5 - y;
      const L = Math.hypot(dx, dy) || 1;
      x = clamp(x + (dx / L) * 0.024, wi + pr + push, 1 - wi - pr - push);
      y = clamp(y + (dy / L) * 0.024, wi + pr + push, 1 - wi - pr - push);
      kickTowardCenter(0.14, 0.65);
    }
  }

  let spFinal = length(vx, vy);
  const minLive = FH.MIN_PUCK_SPEED_ACTIVE;
  if (spFinal < 1e-7) {
    const ang = Math.random() * Math.PI * 2;
    vx = Math.cos(ang) * minLive;
    vy = Math.sin(ang) * minLive;
    spFinal = minLive;
  } else if (spFinal < minLive) {
    vx *= minLive / spFinal;
    vy *= minLive / spFinal;
    spFinal = minLive;
  }

  if (spFinal > maxSp) {
    const sc = maxSp / spFinal;
    vx *= sc;
    vy *= sc;
  }

  s.puck = { x, y, vx, vy };
  return { goal: null };
}

export function hostMalletFromNose(nx: number, ny: number): { x: number; y: number } {
  return hostMalletFromNoseInBounds(nx, ny, {
    xMin: FH.X_MIN,
    xMax: FH.X_MAX,
    yMin: FH.A_Y_MIN,
    yMax: FH.A_Y_MAX,
  });
}

export function hostMalletFromNoseInBounds(
  nx: number,
  ny: number,
  b: { xMin: number; xMax: number; yMin: number; yMax: number },
): { x: number; y: number } {
  const x = clamp(nx, b.xMin, b.xMax);
  /** Nose lower on screen (larger ny, +y down in world) → mallet moves toward bottom goal. */
  const nyTip = clamp(ny + NOSE_TIP_Y_OFFSET, 0, 1);
  const y = clamp(b.yMin + nyTip * (b.yMax - b.yMin), b.yMin, b.yMax);
  return { x, y };
}

export function guestMalletFromNoseVisual(
  nx: number,
  ny: number,
  b?: { xMin: number; xMax: number; yMin: number; yMax: number },
): { x: number; y: number } {
  const xv = clamp(1 - nx, 0, 1);
  const xMin = b?.xMin ?? FH.X_MIN;
  const xMax = b?.xMax ?? FH.X_MAX;
  const yMin = b?.yMin ?? FH.B_Y_MIN;
  const yMax = b?.yMax ?? FH.B_Y_MAX;

  const x = clamp(xv, xMin, xMax);
  /**
   * Align with Player A: nose lower in selfie (larger ny) → canonical +y (mallet toward center).
   * Player B’s overlay is CSS-rotated 180°; invert ny vs the naive linear map so vertical tracks nose.
   */
  const nyTip = clamp(ny + NOSE_TIP_Y_OFFSET, 0, 1);
  const y = clamp(yMax - nyTip * (yMax - yMin), yMin, yMax);
  return { x, y };
}
