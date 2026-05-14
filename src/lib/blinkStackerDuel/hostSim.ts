import {
  BLINK_COOLDOWN_MS,
  OVERLAP_WIN_MIN,
  PERFECT_OVERLAP_MIN,
  SPEED_BASE_PX,
  SPEED_MAX_PX,
  SPEED_PER_LEVEL_PX,
} from "@/lib/blinkStacker/constants";
import { computeCameraTargetY, layoutFromCanvasHeight, smoothCamera } from "@/lib/blinkStacker/camera";
import { horizontalOverlap, overlapFractionOfMoving, type HSegment } from "@/lib/blinkStacker/overlap";
import type { BrickOwner, DuelStatePayload } from "@/lib/blinkStackerDuel/protocol";

export type DuelParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: "blue" | "red";
};

export type HostRuntime = {
  state: DuelStatePayload;
  particles: DuelParticle[];
  lastStopBlue: number;
  lastStopRed: number;
  readyH: boolean;
  readyG: boolean;
  matchEpoch: number;
  pendingCountdown: boolean;
};

const BASE_WN = 0.72;

export function createHostRuntime(matchEpoch: number): HostRuntime {
  const ln = (1 - BASE_WN) / 2;
  return {
    state: {
      seq: 1,
      phase: "lobby",
      tower: [{ ln, wn: BASE_WN, o: "base" }],
      mcn: 0.5,
      mwn: BASE_WN,
      abi: true,
      sp: SPEED_BASE_PX,
      vx: Math.random() < 0.5 ? 1 : -1,
      cam: 0,
      pp: 0,
      me: matchEpoch,
    },
    particles: [],
    lastStopBlue: -1e12,
    lastStopRed: -1e12,
    readyH: false,
    readyG: false,
    matchEpoch,
    pendingCountdown: false,
  };
}

/** Reset runtime for rematch (host only). */
export function resetHostRuntime(rt: HostRuntime, epoch: number) {
  const next = createHostRuntime(epoch);
  rt.state = next.state;
  rt.particles = [];
  rt.lastStopBlue = next.lastStopBlue;
  rt.lastStopRed = next.lastStopRed;
  rt.readyH = false;
  rt.readyG = false;
  rt.matchEpoch = epoch;
  rt.pendingCountdown = false;
}

function toSeg(state: DuelStatePayload): HSegment {
  return { left: state.mcn - state.mwn / 2, width: state.mwn };
}

function belowSeg(state: DuelStatePayload): HSegment {
  const b = state.tower[state.tower.length - 1]!;
  return { left: b.ln, width: b.wn };
}

/** Host-only: apply a stop for the currently active color. */
export function hostApplyStop(
  rt: HostRuntime,
  now: number,
  activeIsBlue: boolean,
): { miss: boolean; perfect: boolean } {
  const s = rt.state;
  if (s.phase !== "moving") return { miss: false, perfect: false };

  const lastT = activeIsBlue ? rt.lastStopBlue : rt.lastStopRed;
  if (now - lastT < BLINK_COOLDOWN_MS) return { miss: false, perfect: false };

  const moving = toSeg(s);
  const target = belowSeg(s);
  const { overlapLen, overlapLeft } = horizontalOverlap(moving, target);
  const frac = overlapFractionOfMoving(overlapLen, s.mwn);

  if (frac < OVERLAP_WIN_MIN) {
    s.loser = activeIsBlue ? "blue" : "red";
    s.phase = "ended";
    s.seq += 1;
    s.sh = now + 600;
    if (activeIsBlue) rt.lastStopBlue = now;
    else rt.lastStopRed = now;
    return { miss: true, perfect: false };
  }

  const perfect = frac >= PERFECT_OVERLAP_MIN;
  const owner: BrickOwner = activeIsBlue ? "blue" : "red";
  s.tower.push({ ln: overlapLeft, wn: overlapLen, o: owner });
  s.mwn = overlapLen;
  s.mcn = overlapLeft + overlapLen / 2;
  s.abi = !s.abi;
  s.sp = Math.min(SPEED_MAX_PX, SPEED_BASE_PX + SPEED_PER_LEVEL_PX * (s.tower.length - 1));
  s.vx = Math.random() < 0.5 ? 1 : -1;
  s.phase = "turn_banner";
  s.banner = s.abi ? "BLUE TURN" : "RED TURN";
  s.tbe = now + 1100;
  s.seq += 1;
  if (perfect) s.pf = now + 750;
  if (activeIsBlue) rt.lastStopBlue = now;
  else rt.lastStopRed = now;
  return { miss: false, perfect };
}

export function hostSpawnMissParticles(rt: HostRuntime, canvasH: number, arenaW: number, arenaLeft: number) {
  const { floorY, blockH, gap, floatExtra } = layoutFromCanvasHeight(canvasH);
  const s = rt.state;
  const floatBottom = floorY - s.tower.length * (blockH + gap) - floatExtra;
  const cx = arenaLeft + s.mcn * arenaW;
  const mw = s.mwn * arenaW;
  const x0 = cx - mw / 2;
  for (let i = 0; i < 36; i++) {
    const t = (Math.PI * 2 * i) / 36;
    rt.particles.push({
      x: x0 + mw / 2,
      y: floatBottom - blockH / 2,
      vx: Math.cos(t) * (200 + Math.random() * 100),
      vy: Math.sin(t) * (200 + Math.random() * 100) - 40,
      life: 1,
      hue: s.abi ? "blue" : "red",
    });
  }
}

export function hostAdvanceMoving(s: DuelStatePayload, dt: number, arenaW: number) {
  if (s.phase !== "moving") return;
  const wn = s.mwn;
  const half = wn / 2;
  const deltaN = (s.sp / arenaW) * dt;
  let next = s.mcn + s.vx * deltaN;
  if (next <= half) {
    next = half;
    s.vx = 1;
  } else if (next >= 1 - half) {
    next = 1 - half;
    s.vx = -1;
  }
  s.mcn = next;
  s.pp = (s.pp + dt * 2.2) % 6.28318;
}

export function hostUpdateCamera(s: DuelStatePayload, dt: number, canvasH: number, reduceMotion: boolean) {
  const { h, floorY, blockH, gap, floatExtra } = layoutFromCanvasHeight(canvasH);
  const target = computeCameraTargetY({
    canvasH: h,
    floorY,
    blockH,
    gap,
    floatExtra,
    stackLen: s.tower.length,
  });
  if (reduceMotion) s.cam = target;
  else s.cam = smoothCamera(s.cam, target, dt, 12);
}

export function hostTickTimeTransitions(rt: HostRuntime, now: number) {
  const s = rt.state;
  if (s.phase === "lobby" && rt.readyH && rt.readyG && !rt.pendingCountdown) {
    rt.pendingCountdown = true;
    s.phase = "countdown";
    s.cd = 3;
    s.cde = now + 3100;
    s.seq += 1;
    return;
  }
  if (s.phase === "countdown" && s.cde != null && now >= s.cde) {
    s.phase = "turn_banner";
    s.banner = "BLUE TURN";
    s.tbe = now + 1200;
    s.cd = undefined;
    s.cde = undefined;
    s.seq += 1;
    return;
  }
  if (s.phase === "turn_banner" && s.tbe != null && now >= s.tbe) {
    s.phase = "moving";
    s.banner = null;
    s.tbe = undefined;
    s.seq += 1;
  }
}

export function countdownSecondsLeft(now: number, cde: number | undefined): number | undefined {
  if (cde == null) return undefined;
  return Math.max(0, Math.ceil((cde - now) / 1000));
}
