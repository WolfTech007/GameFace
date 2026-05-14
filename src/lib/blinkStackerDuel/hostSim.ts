import {
  OVERLAP_WIN_MIN,
  SPEED_BASE_PX,
  SPEED_MAX_PX,
  SPEED_PER_LEVEL_PX,
} from "@/lib/blinkStacker/constants";
import { computeCameraTargetY, layoutFromCanvasHeight, smoothCamera } from "@/lib/blinkStacker/camera";
import { horizontalOverlap, overlapFractionOfMoving } from "@/lib/blinkStacker/overlap";
import type { BlinkStackerDuelNetState, BrickOwner } from "./netTypes";

const BASE_WN = 0.72;
export const TURN_BANNER_MS = 1100;
const COUNTDOWN_TOTAL_MS = 3100;

export type HostRuntime = {
  state: BlinkStackerDuelNetState;
  pendingCountdown: boolean;
};

function toHSeg(cn: number, wn: number) {
  return { left: cn - wn / 2, width: wn };
}

export function makeInitialDuelNetState(): BlinkStackerDuelNetState {
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
    speedPx: SPEED_BASE_PX,
    level: 1,
    cam: 0,
    pulse: 0,
    brickEpoch: 0,
  };
}

export function cloneDuelState(s: BlinkStackerDuelNetState): BlinkStackerDuelNetState {
  return {
    ...s,
    rematch: { ...s.rematch },
    ready: { ...s.ready },
    tower: s.tower.map((x) => ({ ...x })),
  };
}

export function createHostRuntime(): HostRuntime {
  return { state: makeInitialDuelNetState(), pendingCountdown: false };
}

export function resetHostRuntime(rt: HostRuntime, nextEpoch: number) {
  const next = makeInitialDuelNetState();
  next.matchEpoch = nextEpoch;
  rt.state = next;
  rt.pendingCountdown = false;
}

export function countdownSecondsLeft(now: number, cde: number | undefined): number | undefined {
  if (cde == null) return undefined;
  return Math.max(0, Math.ceil((cde - now) / 1000));
}

export function hostTickTimeTransitions(rt: HostRuntime, now: number) {
  const s = rt.state;
  if (s.phase === "lobby" && s.ready.host && s.ready.guest && !rt.pendingCountdown) {
    rt.pendingCountdown = true;
    s.ready = { host: false, guest: false };
    s.phase = "countdown";
    s.cd = 3;
    s.cde = now + COUNTDOWN_TOTAL_MS;
    return;
  }
  if (s.phase === "countdown" && s.cde != null && now >= s.cde) {
    rt.pendingCountdown = false;
    s.phase = "turn_banner";
    s.banner = "BLUE TURN";
    s.tbe = now + TURN_BANNER_MS;
    s.cd = undefined;
    s.cde = undefined;
    s.activeBlue = true;
    return;
  }
  if (s.phase === "turn_banner" && s.tbe != null && now >= s.tbe) {
    s.phase = "moving";
    s.tbe = undefined;
    s.banner = null;
    s.vx = Math.random() < 0.5 ? 1 : -1;
    s.brickEpoch += 1;
  }
}

export function hostAdvanceMoving(s: BlinkStackerDuelNetState, dt: number, arenaW: number) {
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
  s.pulse = (s.pulse + dt * 2.2) % 6.28318;
}

export function hostUpdateCamera(s: BlinkStackerDuelNetState, dt: number, canvasH: number, reduceMotion: boolean) {
  if (s.phase !== "moving" && s.phase !== "turn_banner" && s.phase !== "gameover") return;
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

/** Host-only: apply stop for whoever is active (`activeBlue`). */
export function hostApplyStop(rt: HostRuntime, now: number): { miss: boolean } {
  const s = rt.state;
  if (s.phase !== "moving") return { miss: false };

  const below = s.tower[s.tower.length - 1]!;
  const moving = toHSeg(s.mcn, s.mwn);
  const target = { left: below.ln, width: below.wn };
  const { overlapLen, overlapLeft } = horizontalOverlap(moving, target);
  const frac = overlapFractionOfMoving(overlapLen, s.mwn);

  if (frac < OVERLAP_WIN_MIN) {
    s.loser = s.activeBlue ? "blue" : "red";
    s.phase = "gameover";
    s.rematch = { host: false, guest: false };
    return { miss: true };
  }

  const owner: BrickOwner = s.activeBlue ? "blue" : "red";
  s.tower.push({ ln: overlapLeft, wn: overlapLen, o: owner });
  s.mwn = overlapLen;
  s.mcn = overlapLeft + overlapLen / 2;
  s.speedPx = Math.min(SPEED_MAX_PX, SPEED_BASE_PX + SPEED_PER_LEVEL_PX * (s.tower.length - 1));
  s.activeBlue = !s.activeBlue;
  s.level = s.tower.length;
  s.phase = "turn_banner";
  s.banner = s.activeBlue ? "BLUE TURN" : "RED TURN";
  s.tbe = now + TURN_BANNER_MS;
  return { miss: false };
}
