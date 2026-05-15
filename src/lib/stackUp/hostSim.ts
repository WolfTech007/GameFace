import { OVERLAP_WIN_MIN, SPEED_BASE_PX, SPEED_MAX_PX, SPEED_PER_LEVEL_PX } from "@/lib/blinkStacker/constants";
import { computeCameraTargetY, layoutFromCanvasHeight, smoothCamera } from "@/lib/blinkStacker/camera";
import { horizontalOverlap, overlapFractionOfMoving } from "@/lib/blinkStacker/overlap";
import type { StackUpNetState, StackUpOwner } from "./netTypes";

const BASE_WN = 0.7;
const COUNTDOWN_TOTAL_MS = 3200;
const SPEED_MULT = 1.65;

export type StackUpHostRuntime = {
  state: StackUpNetState;
  pendingCountdown: boolean;
};

function toSeg(cn: number, wn: number) {
  return { left: cn - wn / 2, width: wn };
}

export function makeInitialStackUpState(): StackUpNetState {
  const ln = (1 - BASE_WN) / 2;
  return {
    phase: "lobby",
    matchEpoch: 0,
    rematch: { host: false, guest: false },
    ready: { host: false, guest: false },
    activeBlue: true,
    tower: [{ ln, wn: BASE_WN, o: "base" }],
    mcn: 0.5,
    mwn: BASE_WN,
    vx: Math.random() < 0.5 ? 1 : -1,
    speedPx: SPEED_BASE_PX * SPEED_MULT,
    level: 1,
    cam: 0,
    pulse: 0,
    brickEpoch: 0,
    fx: null,
  };
}

export function cloneStackUpState(s: StackUpNetState): StackUpNetState {
  return {
    ...s,
    rematch: { ...s.rematch },
    ready: { ...s.ready },
    tower: s.tower.map((x) => ({ ...x })),
    fx: s.fx ? { ...s.fx } : null,
  };
}

export function createStackUpHostRuntime(): StackUpHostRuntime {
  return { state: makeInitialStackUpState(), pendingCountdown: false };
}

export function resetStackUpRuntime(rt: StackUpHostRuntime, nextEpoch: number) {
  const next = makeInitialStackUpState();
  next.matchEpoch = nextEpoch;
  rt.state = next;
  rt.pendingCountdown = false;
}

export function countdownSecondsLeft(now: number, cde: number | undefined): number | undefined {
  if (cde == null) return undefined;
  return Math.max(0, Math.ceil((cde - now) / 1000));
}

export function hostTickTransitions(rt: StackUpHostRuntime, now: number) {
  const s = rt.state;
  if (s.phase === "lobby" && s.ready.host && s.ready.guest && !rt.pendingCountdown) {
    rt.pendingCountdown = true;
    s.ready = { host: false, guest: false };
    s.phase = "countdown";
    s.cd = 3;
    s.cde = now + COUNTDOWN_TOTAL_MS;
    s.banner = null;
    s.fx = null;
    return;
  }
  if (s.phase === "countdown" && s.cde != null && now >= s.cde) {
    rt.pendingCountdown = false;
    s.phase = "moving";
    s.banner = "GO";
    s.tbe = now + 550;
    s.cd = undefined;
    s.cde = undefined;
    s.activeBlue = true;
    s.vx = Math.random() < 0.5 ? 1 : -1;
    s.brickEpoch += 1;
    return;
  }
  if (s.tbe != null && now >= s.tbe) {
    s.tbe = undefined;
    s.banner = null;
  }
}

export function hostAdvanceMoving(s: StackUpNetState, dt: number, arenaW: number) {
  if (s.phase !== "moving") return;
  const wn = s.mwn;
  const half = wn / 2;
  const deltaN = (s.speedPx / arenaW) * dt;
  let next = s.mcn + s.vx * deltaN;
  if (next <= half) {
    next = half;
    s.vx = 1;
  } else if (next >= 1 - half) {
    next = 1 - half;
    s.vx = -1;
  }
  s.mcn = next;
  s.pulse = (s.pulse + dt * 4.5) % 6.28318;
}

export function hostUpdateCamera(s: StackUpNetState, dt: number, canvasH: number, reduceMotion: boolean) {
  if (s.phase !== "moving" && s.phase !== "gameover" && s.phase !== "countdown") return;
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

export function hostApplyStop(rt: StackUpHostRuntime, now: number): { miss: boolean; perfect: boolean } {
  const s = rt.state;
  if (s.phase !== "moving") return { miss: false, perfect: false };

  const below = s.tower[s.tower.length - 1]!;
  const moving = toSeg(s.mcn, s.mwn);
  const target = { left: below.ln, width: below.wn };
  const { overlapLen, overlapLeft } = horizontalOverlap(moving, target);
  const frac = overlapFractionOfMoving(overlapLen, s.mwn);
  if (!Number.isFinite(overlapLen) || !Number.isFinite(overlapLeft) || !Number.isFinite(frac)) {
    console.error("[StackUp] invalid overlap, resetting moving block", { overlapLen, overlapLeft, frac });
    s.mwn = BASE_WN;
    s.mcn = 0.5;
    s.vx = Math.random() < 0.5 ? 1 : -1;
    s.phase = "moving";
    s.fx = null;
    s.brickEpoch += 1;
    return { miss: false, perfect: false };
  }

  if (frac < OVERLAP_WIN_MIN) {
    s.loser = s.activeBlue ? "blue" : "red";
    s.phase = "gameover";
    s.rematch = { host: false, guest: false };
    s.fx = { kind: "miss", until: now + 900 };
    return { miss: true, perfect: false };
  }

  const owner: StackUpOwner = s.activeBlue ? "blue" : "red";
  s.tower.push({ ln: overlapLeft, wn: overlapLen, o: owner });
  const perfect = Math.abs(overlapLen - s.mwn) / Math.max(0.001, s.mwn) < 0.03;
  s.mwn = overlapLen;
  s.mcn = overlapLeft + overlapLen / 2;
  s.speedPx = Math.min(SPEED_MAX_PX * 1.25, (SPEED_BASE_PX + SPEED_PER_LEVEL_PX * (s.tower.length - 1)) * SPEED_MULT);
  s.activeBlue = !s.activeBlue;
  s.level = s.tower.length;
  s.phase = "moving";
  s.banner = null;
  s.tbe = undefined;
  s.vx = Math.random() < 0.5 ? 1 : -1;
  s.brickEpoch += 1;
  s.fx = perfect ? { kind: "perfect", until: now + 650 } : null;
  return { miss: false, perfect };
}
