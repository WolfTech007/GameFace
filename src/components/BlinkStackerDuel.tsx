"use client";

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import React, { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import { RematchBar } from "@/components/RematchBar";
import { rematchBothWant } from "@/lib/rematchSync";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { useConsumePendingMatch } from "@/hooks/useConsumePendingMatch";
import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";
import { combinedEar, createBlinkEdgeDetector } from "@/lib/blinkStacker/ear";
import { layoutFromCanvasHeight } from "@/lib/blinkStacker/camera";
import type { BlinkStackerDuelNetState, DuelTowerSeg, GuestToHostDuelMsg, HostToGuestDuelMsg } from "@/lib/blinkStackerDuel/netTypes";
import {
  cloneDuelState,
  countdownSecondsLeft,
  createHostRuntime,
  hostAdvanceMoving,
  hostApplyStop,
  hostTickTimeTransitions,
  hostUpdateCamera,
  resetHostRuntime,
  type HostRuntime,
} from "@/lib/blinkStackerDuel/hostSim";
import { GameplayDuelHud } from "@/components/gameface/gameplay/GameplayDuelHud";
import { GFBottomNav } from "@/components/gameface/GFBottomNav";
import { hudPlainUsername } from "@/lib/gameface/hudIdentity";
import gp from "@/components/gameface/gameplay/GameplaySurface.module.css";
import styles from "./BlinkStackerDuel.module.css";

const QUEUE_POLL_MS = 600;
const DEFAULT_INTRO = "/blink-stacker-duel";
const DUEL_BLINK_COOLDOWN_MS = 250;
const MIN_BRICK_PX = 40;
const MIN_BRICK_H_PX = 24;
const DEFAULT_START_WN = 0.65;

type UiPhase = "menu" | "matchmaking" | "lobby" | "playing" | "gameover";
type Role = "host" | "guest";

function log(...args: unknown[]) {
  console.log("[BlinkStackerDuel]", ...args);
}

function nowMs() {
  return performance.now();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function connectGuestWithRetry(peer: Parameters<typeof connectGuestToHost>[0], roomId: string) {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      await sleep(i === 0 ? 700 : 350);
      const conn = await Promise.race([
        connectGuestToHost(peer, roomId, { reliable: true }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("connect timeout")), 12000)),
      ]);
      return conn;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not connect to opponent.");
}

function pathRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawBrick(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  w: number,
  h: number,
  o: DuelTowerSeg["o"],
  opts: { hot?: boolean; pulse?: number },
) {
  const hot = opts.hot ?? false;
  const pulse = opts.pulse ?? 0;
  const g = ctx.createLinearGradient(x, yTop, x + w, yTop + h);
  if (o === "blue") {
    g.addColorStop(0, `rgba(30, 80, 120, ${0.92})`);
    g.addColorStop(1, `rgba(10, 40, 70, ${0.95})`);
  } else if (o === "red") {
    g.addColorStop(0, `rgba(120, 30, 50, ${0.92})`);
    g.addColorStop(1, `rgba(70, 10, 25, ${0.95})`);
  } else {
    g.addColorStop(0, "rgba(35, 38, 48, 0.95)");
    g.addColorStop(1, "rgba(12, 14, 22, 0.98)");
  }
  pathRoundRect(ctx, x, yTop, w, h, 6);
  ctx.fillStyle = g;
  ctx.fill();
  pathRoundRect(ctx, x, yTop, w, h, 6);
  let stroke = "rgba(56, 189, 248, 0.88)";
  let glow = "rgba(56, 189, 248, 0.45)";
  if (o === "red") {
    stroke = "rgba(251, 99, 99, 0.9)";
    glow = "rgba(251, 99, 99, 0.42)";
  } else if (o === "base") {
    stroke = "rgba(148, 163, 184, 0.55)";
    glow = "rgba(148, 163, 184, 0.2)";
  }
  if (hot) {
    const amp = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(pulse));
    ctx.strokeStyle = o === "red" ? `rgba(251, 99, 99, ${0.75 + 0.2 * amp})` : `rgba(56, 189, 248, ${0.75 + 0.2 * amp})`;
    ctx.shadowColor = o === "red" ? `rgba(251, 99, 99, ${0.35 * amp})` : `rgba(56, 189, 248, ${0.45 * amp})`;
    ctx.shadowBlur = 10 + 22 * amp;
    ctx.lineWidth = 2 + 2 * amp;
  } else {
    ctx.strokeStyle = stroke;
    ctx.shadowColor = glow;
    ctx.shadowBlur = o === "base" ? 8 : 14;
    ctx.lineWidth = o === "base" ? 1.5 : 2;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, s: BlinkStackerDuelNetState) {
  ctx.clearRect(0, 0, w, h);
  const arenaW = w * 0.88;
  const arenaLeft = (w - arenaW) / 2;
  const raw = layoutFromCanvasHeight(h);
  const floorY = raw.floorY;
  const blockH = Math.max(MIN_BRICK_H_PX, raw.blockH);
  const gap = Math.max(5, raw.gap);
  const floatExtra = raw.floatExtra;
  const cam = Number.isFinite(s.cam) ? s.cam : 0;

  ctx.save();
  ctx.translate(0, cam);

  ctx.fillStyle = "rgba(56, 189, 248, 0.04)";
  ctx.fillRect(arenaLeft, -h * 2, arenaW, h * 5);

  s.tower.forEach((seg, i) => {
    const bottomY = floorY - i * (blockH + gap);
    const x = arenaLeft + seg.ln * arenaW;
    const bw = Math.max(MIN_BRICK_PX, seg.wn * arenaW);
    drawBrick(ctx, x, bottomY - blockH, bw, blockH, seg.o, {});
  });

  if (s.phase === "moving") {
    const floatBottom = floorY - s.tower.length * (blockH + gap) - floatExtra;
    const bw = Math.max(MIN_BRICK_PX, s.mwn * arenaW);
    const x = arenaLeft + s.mcn * arenaW - bw / 2;
    const owner = s.activeBlue ? "blue" : "red";
    drawBrick(ctx, x, floatBottom - blockH, bw, blockH, owner, { hot: true, pulse: s.pulse });
  }

  ctx.restore();
}

export type BlinkStackerDuelProps = {
  autoJoinPublicQueue?: boolean;
  fromRandomMatch?: boolean;
  introHref?: string;
};

export default function BlinkStackerDuel({
  autoJoinPublicQueue = false,
  fromRandomMatch = false,
  introHref,
}: BlinkStackerDuelProps) {
  const router = useRouter();
  const { profile } = useGameFaceProfile();
  /** Same as FacePong: one stable queue id from GameFace profile (not ad-hoc ensureProfile calls). */
  const clientId = profile.userId;

  const initialPhase: UiPhase = autoJoinPublicQueue || fromRandomMatch ? "matchmaking" : "menu";
  const [uiPhase, setUiPhase] = useState<UiPhase>(initialPhase);
  const uiPhaseRef = useRef<UiPhase>(initialPhase);
  useEffect(() => {
    uiPhaseRef.current = uiPhase;
  }, [uiPhase]);

  const showArena = uiPhase === "playing" || uiPhase === "gameover";

  const [role, setRole] = useState<Role | null>(null);
  const roleRef = useRef<Role | null>(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState(() =>
    autoJoinPublicQueue ? "Searching for opponent…" : fromRandomMatch ? "Connecting…" : "Idle",
  );
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [opponentLeftMatch, setOpponentLeftMatch] = useState(false);

  const peerRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const matchPollRef = useRef<number | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const hostRtRef = useRef<HostRuntime | null>(null);
  const duelNetRef = useRef<BlinkStackerDuelNetState>(cloneDuelState(createHostRuntime().state));
  const hostSeqRef = useRef(0);
  const lastGuestSeqRef = useRef(-1);
  const lastPlayBroadcastMsRef = useRef(0);
  const lastBrickEpochStoppedRef = useRef(-1);
  const lastSeenBrickEpochRef = useRef(-1);
  const lastLoopRef = useRef<number | null>(null);
  const loggedCanvasSizeRef = useRef(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(null);
  const blinkDetRef = useRef<ReturnType<typeof createBlinkEdgeDetector> | null>(null);
  const guestBrickEpochRef = useRef(0);
  const reduceMotionRef = useRef(false);

  const [, bumpUi] = useReducer((x: number) => x + 1, 0);
  const lastGuestUiBumpRef = useRef(0);
  const lastHostUiBumpRef = useRef(0);
  const [frameSize, setFrameSize] = useState({ width: 360, height: 640 });

  function maybeBumpGuestUi(force = false) {
    const t = nowMs();
    if (!force && t - lastGuestUiBumpRef.current < 80) return;
    lastGuestUiBumpRef.current = t;
    bumpUi();
  }

  useEffect(() => {
    reduceMotionRef.current =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }, []);

  function getDrawState(): BlinkStackerDuelNetState {
    if (roleRef.current === "host" && hostRtRef.current) return hostRtRef.current.state;
    return duelNetRef.current;
  }

  async function ensureLocalCamera() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 720 },
        height: { ideal: 1280 },
      },
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      await localVideoRef.current.play().catch(() => {});
    }
    if (pipVideoRef.current) {
      pipVideoRef.current.srcObject = stream;
      void pipVideoRef.current.play().catch(() => {});
    }
    return stream;
  }

  async function leaveQueue() {
    try {
      await fetch("/api/blink-stacker-duel/queue", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, action: "leave" }),
      });
    } catch {
      /* ignore */
    }
  }

  function cleanup() {
    log("disconnect cleanup");
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    void leaveQueue();

    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch {
        /* ignore */
      }
    }
    peerRef.current = null;
    dataRef.current = null;

    const s = localStreamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
    localStreamRef.current = null;

    hostRtRef.current = null;
    landmarkerRef.current = null;
    blinkDetRef.current = null;
  }

  function sendToHost(msg: GuestToHostDuelMsg) {
    const conn = dataRef.current;
    if (conn && conn.open) conn.send(msg);
  }

  function sendToGuest(msg: HostToGuestDuelMsg) {
    const conn = dataRef.current;
    if (conn && conn.open) conn.send(msg);
  }

  function broadcastAuthoritativeState() {
    if (roleRef.current !== "host") return;
    const rt = hostRtRef.current;
    const conn = dataRef.current;
    if (!rt || !conn?.open) return;
    const s = rt.state;
    if (s.phase === "countdown" && s.cde != null) {
      s.cd = countdownSecondsLeft(nowMs(), s.cde);
    }
    hostSeqRef.current += 1;
    const sentAt = performance.now();
    const snap = cloneDuelState(s);
    duelNetRef.current = snap;
    sendToGuest({ t: "state", state: snap, seq: hostSeqRef.current, sentAt });
  }

  function hostTryStartWhenBothReady() {
    if (roleRef.current !== "host") return;
    const rt = hostRtRef.current;
    if (!rt) return;
    const s = rt.state;
    if (s.phase !== "lobby") return;
    if (s.ready.host && s.ready.guest) {
      log("both players ready — host will move to countdown on next tick");
    }
  }

  function hostTryRematchFromGameOver() {
    if (roleRef.current !== "host") return;
    const rt = hostRtRef.current;
    if (!rt) return;
    const s = rt.state;
    if (s.phase !== "gameover") return;
    if (!rematchBothWant(s.rematch)) return;
    const nextEpoch = (s.matchEpoch ?? 0) + 1;
    resetHostRuntime(rt, nextEpoch);
    setUiPhase("lobby");
    setOpponentLeftMatch(false);
    lastBrickEpochStoppedRef.current = -1;
    lastSeenBrickEpochRef.current = -1;
    log("rematch — lobby reset, epoch", nextEpoch);
    broadcastAuthoritativeState();
    bumpUi();
  }

  function toggleLobbyReady() {
    if (!opponentConnected || uiPhaseRef.current !== "lobby") return;
    if (role === "host") {
      const rt = hostRtRef.current;
      if (!rt) return;
      rt.state.ready.host = !rt.state.ready.host;
      broadcastAuthoritativeState();
      bumpUi();
      hostTryStartWhenBothReady();
    } else if (role === "guest") {
      const g = duelNetRef.current.ready.guest;
      sendToHost({ t: "ready", ready: !g });
    }
  }

  function requestRematch() {
    if (role === "host") {
      const rt = hostRtRef.current;
      if (!rt || rt.state.phase !== "gameover") return;
      rt.state.rematch.host = true;
      broadcastAuthoritativeState();
      bumpUi();
      hostTryRematchFromGameOver();
    } else {
      sendToHost({ t: "rematch", want: true });
    }
  }

  function leaveMatch() {
    cleanup();
    router.push(introHref ?? DEFAULT_INTRO);
  }

  function hostHandleStopFromNetwork(brickEpoch: number) {
    const rt = hostRtRef.current;
    if (!rt) return;
    const s = rt.state;
    if (s.phase !== "moving" || s.activeBlue) return;
    if (brickEpoch !== s.brickEpoch) {
      log("ignored stale stopAttempt", { brickEpoch, cur: s.brickEpoch });
      return;
    }
    if (brickEpoch === lastBrickEpochStoppedRef.current) return;
    lastBrickEpochStoppedRef.current = brickEpoch;
    log("host applies guest stopAttempt");
    hostApplyStop(rt, nowMs());
    if (rt.state.phase === "gameover") setUiPhase("gameover");
    broadcastAuthoritativeState();
    bumpUi();
  }

  function hostHandleLocalStop() {
    const rt = hostRtRef.current;
    if (!rt) return;
    const s = rt.state;
    if (s.phase !== "moving" || !s.activeBlue) return;
    if (s.brickEpoch === lastBrickEpochStoppedRef.current) return;
    lastBrickEpochStoppedRef.current = s.brickEpoch;
    log("host local stop (blue turn)");
    hostApplyStop(rt, nowMs());
    if (rt.state.phase === "gameover") setUiPhase("gameover");
    broadcastAuthoritativeState();
    bumpUi();
  }

  function trySendGuestStop() {
    if (roleRef.current !== "guest") return;
    const s = duelNetRef.current;
    if (s.phase !== "moving" || s.activeBlue) return;
    sendToHost({ t: "stopAttempt", brickEpoch: guestBrickEpochRef.current });
    log("guest sent stopAttempt", guestBrickEpochRef.current);
  }

  const tryStopRef = useRef<() => void>(() => {});

  const visionStep = (ts: number) => {
    const video = localVideoRef.current;
    const lm = landmarkerRef.current;
    if (!video || !lm || video.readyState < 2) return;
    const res = lm.detectForVideo(video, ts);
    const pts = res.faceLandmarks?.[0] as NormalizedLandmark[] | undefined;
    const ear = combinedEar(pts);
    const det = blinkDetRef.current;
    if (!det) return;
    const gs = getDrawState();
    if (gs.phase !== "moving") return;
    const iAmBlue = roleRef.current === "host";
    const myTurn = (gs.activeBlue && iAmBlue) || (!gs.activeBlue && !iAmBlue);
    if (!myTurn) return;
    if (det.tick(ear, ts)) {
      if (roleRef.current === "host") hostHandleLocalStop();
      else trySendGuestStop();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const gs = getDrawState();
      if (gs.phase !== "moving") return;
      e.preventDefault();
      tryStopRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  tryStopRef.current = () => {
    const gs = getDrawState();
    if (gs.phase !== "moving") return;
    const iAmBlue = roleRef.current === "host";
    const myTurn = (gs.activeBlue && iAmBlue) || (!gs.activeBlue && !iAmBlue);
    if (!myTurn) return;
    if (roleRef.current === "host") hostHandleLocalStop();
    else trySendGuestStop();
  };

  async function connectAsHost(desiredRoomId: string) {
    cleanup();
    log("host selected — creating room", desiredRoomId);
    setStatus("Creating room…");
    setRole("host");
    setOpponentConnected(false);

    const stream = await ensureLocalCamera();

    let rid: string;
    let peer: any;
    try {
      const created = await createHostRoom({ desiredRoomId });
      rid = created.roomId;
      peer = created.peer;
    } catch {
      throw new Error("Room unavailable");
    }

    peerRef.current = peer;
    setRoomId(rid);
    hostRtRef.current = createHostRuntime();
    log("room joined (host)", rid);

    setStatus("Waiting for opponent…");

    peer.on("call", (call: any) => {
      call.answer(stream);
      call.on("stream", (remoteStream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play();
        }
        log("opponent camera stream (host)");
      });
    });

    const conn = await waitForHostConnection(peer);
    dataRef.current = conn;
    setOpponentConnected(true);
    setStatus("Opponent connected");
    log("opponent connected (data channel)", conn.open);

    conn.on("data", (raw: unknown) => {
      const msg = raw as GuestToHostDuelMsg;
      const rt = hostRtRef.current;
      if (!rt) return;
      if (msg.t === "ready") {
        rt.state.ready.guest = msg.ready;
        broadcastAuthoritativeState();
        bumpUi();
        hostTryStartWhenBothReady();
      } else if (msg.t === "rematch") {
        if (rt.state.phase === "gameover") {
          rt.state.rematch.guest = msg.want;
          broadcastAuthoritativeState();
          bumpUi();
          hostTryRematchFromGameOver();
        }
      } else if (msg.t === "stopAttempt") {
        hostHandleStopFromNetwork(msg.brickEpoch);
      }
    });

    conn.on("close", () => {
      log("peer data channel closed (host)");
      setOpponentConnected(false);
      setOpponentLeftMatch(true);
    });

    const onDataOpen = () => {
      log("data channel open — initial state broadcast (host)");
      lastBrickEpochStoppedRef.current = -1;
      lastSeenBrickEpochRef.current = -1;
      broadcastAuthoritativeState();
    };
    if (conn.open) onDataOpen();
    else conn.on("open", onDataOpen);
  }

  async function connectAsGuest(rid: string) {
    cleanup();
    lastGuestSeqRef.current = -1;
    log("joining room as guest", rid);
    setStatus("Joining…");
    setRole("guest");
    setOpponentConnected(false);
    setRoomId(rid);

    const stream = await ensureLocalCamera();

    const peer = await createGuestPeer();
    peerRef.current = peer;

    const conn = await connectGuestWithRetry(peer as never, rid);
    dataRef.current = conn;
    setOpponentConnected(true);
    setStatus("Opponent connected");
    log("guest data channel open", conn.open);

    conn.on("data", (raw: unknown) => {
      const msg = raw as HostToGuestDuelMsg;
      if (msg.t !== "state") return;
      if (msg.seq <= lastGuestSeqRef.current) return;
      lastGuestSeqRef.current = msg.seq;
      const authoritative = cloneDuelState(msg.state);
      duelNetRef.current = authoritative;
      guestBrickEpochRef.current = authoritative.brickEpoch;
      log("state sync received", { seq: msg.seq, phase: authoritative.phase });
      maybeBumpGuestUi(authoritative.phase === "lobby" || authoritative.phase === "gameover");

      const ph = authoritative.phase;
      if (ph === "lobby") {
        setUiPhase("lobby");
        setOpponentLeftMatch(false);
      } else if (ph === "gameover") {
        setUiPhase("gameover");
      } else {
        setUiPhase("playing");
      }
    });

    conn.on("close", () => {
      log("peer data channel closed (guest)");
      setOpponentConnected(false);
      setOpponentLeftMatch(true);
    });

    const call = peer.call(rid, stream);
    call.on("stream", (remoteStream: MediaStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        void remoteVideoRef.current.play();
      }
    });

    guestAnswerCalls(peer as never, stream, (incoming) => {
      incoming.on("stream", (remoteStream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play();
        }
        log("opponent camera stream (guest, incoming call)");
      });
    });
  }

  async function applyMatch(peerRoomId: string, r: Role) {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    setStatus("Connecting…");
    log("player assigned", r, "peerRoomId", peerRoomId);
    try {
      if (r === "host") await connectAsHost(peerRoomId);
      else await connectAsGuest(peerRoomId);

      try {
        landmarkerRef.current = await createFaceLandmarker();
      } catch {
        landmarkerRef.current = null;
      }
      blinkDetRef.current = createBlinkEdgeDetector({
        threshold: 0.19,
        cooldownMs: DUEL_BLINK_COOLDOWN_MS,
      });
      blinkDetRef.current.reset();

      setOpponentLeftMatch(false);
      setUiPhase("lobby");
      log("game start — lobby (landmarker:", !!landmarkerRef.current, ")");
    } catch {
      cleanup();
      setStatus("Connection failed. Try again.");
      setUiPhase("menu");
      setRole(null);
    }
  }

  useConsumePendingMatch("blinkstackerduel", (p) => {
    log("pending random match for blinkstackerduel");
    void applyMatch(p.peerRoomId, p.role);
  });

  async function findMatch() {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    log("entering queue", { clientId });
    setStatus("Searching for opponent…");
    setUiPhase("matchmaking");

    const joinBody = JSON.stringify({ clientId, action: "join" });
    const res = await fetch("/api/blink-stacker-duel/queue", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: joinBody,
    });
    const data = await res.json();
    if (data.matched) {
      log("matched immediately");
      await applyMatch(data.peerRoomId as string, data.role as Role);
      return;
    }

    matchPollRef.current = window.setInterval(async () => {
      try {
        // POST (not GET): same code path as initial join (`existing` match), avoids cached GET responses on some CDNs/clients.
        const r = await fetch("/api/blink-stacker-duel/queue", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: joinBody,
        });
        const j = await r.json();
        if (j.matched) {
          if (matchPollRef.current) {
            window.clearInterval(matchPollRef.current);
            matchPollRef.current = null;
          }
          log("matched from poll");
          await applyMatch(j.peerRoomId as string, j.role as Role);
        }
      } catch (e) {
        log("queue poll error", e);
      }
    }, QUEUE_POLL_MS);
  }

  useEffect(() => {
    if (!autoJoinPublicQueue) return;
    void findMatch();
    return () => {
      if (matchPollRef.current) {
        window.clearInterval(matchPollRef.current);
        matchPollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoinPublicQueue]);

  /** Always clear queue poll on unmount (menu “Find Match” has no autoJoin effect cleanup). */
  useEffect(() => {
    return () => {
      if (matchPollRef.current) {
        window.clearInterval(matchPollRef.current);
        matchPollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const compute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let width = Math.min(vw * 0.92, 420);
      let height = width * (16 / 9);
      const availableHeight = Math.max(300, vh - 170);
      if (height > availableHeight) {
        height = availableHeight;
        width = height * (9 / 16);
      }
      setFrameSize({ width: Math.floor(width), height: Math.floor(height) });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  useEffect(() => {
    if (!showArena) return;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const measure = () => {
      const r = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(180, Math.floor(r.width * dpr));
      canvas.height = Math.max(320, Math.floor(r.height * dpr));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [showArena]);

  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const last = lastLoopRef.current ?? ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      lastLoopRef.current = ts;

      const canvas = canvasRef.current;
      const stage = stageRef.current;
      if (canvas && stage) {
        const r = stage.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const nextW = Math.max(180, Math.floor(r.width * dpr));
        const nextH = Math.max(320, Math.floor(r.height * dpr));
        if (canvas.width !== nextW || canvas.height !== nextH) {
          canvas.width = nextW;
          canvas.height = nextH;
          if (!loggedCanvasSizeRef.current) {
            log("canvas sized", { w: nextW, h: nextH, cssW: Math.floor(r.width), cssH: Math.floor(r.height), dpr });
            loggedCanvasSizeRef.current = true;
          }
        }
      }
      const ctx = canvas?.getContext("2d") ?? null;
      const w = canvas?.width ?? 360;
      const h = canvas?.height ?? 640;

      const isHost = roleRef.current === "host";
      const rt = hostRtRef.current;

      // Host sim must run even while lobby UI is up: `showArena` is false in lobby, so the canvas
      // is unmounted — FacePong keeps its surface mounted; here we tick time transitions without a canvas.
      if (isHost && rt && opponentConnected) {
        const s = rt.state;
        const arenaW = Math.max(1, (canvas?.width ?? w) * 0.88);
        const minWn = Math.min(0.95, MIN_BRICK_PX / arenaW);
        if (!Number.isFinite(s.mwn) || s.mwn <= 0) {
          log("invalid moving width detected — reset", { mwn: s.mwn });
          s.mwn = DEFAULT_START_WN;
          s.mcn = 0.5;
        }
        if (!Number.isFinite(s.mcn)) s.mcn = 0.5;
        s.mwn = Math.max(minWn, Math.min(0.95, s.mwn));
        s.mcn = Math.max(s.mwn / 2, Math.min(1 - s.mwn / 2, s.mcn));

        if (s.brickEpoch !== lastSeenBrickEpochRef.current) {
          lastSeenBrickEpochRef.current = s.brickEpoch;
          lastBrickEpochStoppedRef.current = -1;
          const l = layoutFromCanvasHeight(h);
          const blockH = Math.max(MIN_BRICK_H_PX, l.blockH);
          const gap = Math.max(5, l.gap);
          const floatBottom = l.floorY - s.tower.length * (blockH + gap) - l.floatExtra;
          const widthPx = Math.max(MIN_BRICK_PX, s.mwn * arenaW);
          const xPx = ((w - arenaW) / 2) + s.mcn * arenaW - widthPx / 2;
          log("new turn block", {
            x: Math.round(xPx),
            y: Math.round(floatBottom - blockH),
            width: Math.round(widthPx),
            height: Math.round(blockH),
            speed: Math.round(s.speedPx),
            activePlayer: s.activeBlue ? "blue" : "red",
          });
        }

        const now = nowMs();
        const phaseBeforeTick = s.phase;
        hostTickTimeTransitions(rt, now);
        if (phaseBeforeTick === "lobby" && s.phase !== "lobby") {
          log("lobby cleared — broadcasting first post-lobby state", s.phase);
          lastPlayBroadcastMsRef.current = now;
          broadcastAuthoritativeState();
          bumpUi();
        }
        if (
          (s.phase === "countdown" ||
            s.phase === "turn_banner" ||
            s.phase === "moving" ||
            s.phase === "gameover") &&
          uiPhaseRef.current === "lobby"
        ) {
          setUiPhase("playing");
        }
        if (s.phase === "countdown" && s.cde != null) {
          s.cd = countdownSecondsLeft(now, s.cde);
        }
        if (s.phase === "moving" && canvas) {
          hostAdvanceMoving(s, dt, arenaW);
        }
        if (s.phase === "moving" || s.phase === "turn_banner" || s.phase === "gameover" || s.phase === "countdown") {
          hostUpdateCamera(s, dt, h, reduceMotionRef.current);
        }
        if (s.phase === "gameover" && uiPhaseRef.current !== "gameover") {
          setUiPhase("gameover");
        }
        if (s.phase === "moving" || s.phase === "turn_banner" || s.phase === "gameover" || s.phase === "countdown") {
          if (now - lastPlayBroadcastMsRef.current >= 66) {
            lastPlayBroadcastMsRef.current = now;
            broadcastAuthoritativeState();
          }
        } else if (s.phase === "lobby") {
          if (now - lastPlayBroadcastMsRef.current >= 200) {
            lastPlayBroadcastMsRef.current = now;
            broadcastAuthoritativeState();
          }
        }
        if (uiPhaseRef.current === "playing" && now - lastHostUiBumpRef.current > 120) {
          lastHostUiBumpRef.current = now;
          bumpUi();
        }
      }

      visionStep(ts);

      if (!canvas || !ctx) return;
      const ds = getDrawState();
      drawScene(ctx, w, h, ds);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, opponentConnected]);

  useEffect(() => {
    const v = pipVideoRef.current;
    const s = localStreamRef.current;
    if (v && s) {
      v.srcObject = s;
      void v.play().catch(() => {});
    }
  }, [uiPhase, role]);

  const showMenu = uiPhase === "menu";
  const showMatchmaking = uiPhase === "matchmaking";
  const showLobby = uiPhase === "lobby";
  const showGameOver = uiPhase === "gameover";

  const net = getDrawState();
  const iAmBlue = role === "host";
  const turnPill =
    net.phase === "moving"
      ? net.activeBlue
        ? iAmBlue
          ? "YOUR TURN — BLINK TO STOP"
          : "OPPONENT'S TURN"
        : !iAmBlue
          ? "YOUR TURN — BLINK TO STOP"
          : "OPPONENT'S TURN"
      : "";

  const youWin =
    net.phase === "gameover" &&
    net.loser &&
    ((net.loser === "red" && iAmBlue) || (net.loser === "blue" && !iAmBlue));

  function cancelMatchmaking() {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    void leaveQueue();
    router.push(introHref ?? DEFAULT_INTRO);
  }

  const readyHost = role === "host" ? hostRtRef.current?.state.ready.host ?? false : duelNetRef.current.ready.host;
  const readyGuest = role === "host" ? hostRtRef.current?.state.ready.guest ?? false : duelNetRef.current.ready.guest;

  return (
    <div className={styles.shell}>
      <video ref={localVideoRef} className={styles.hidden} playsInline muted autoPlay />

      <GameplayDuelHud
        gameBadge="Blink Stacker Duel"
        opponent={{
          displayName: showMatchmaking ? "Finding match" : opponentConnected ? "Opponent" : "Arena",
          username: showMatchmaking ? "" : opponentConnected ? "rival" : "",
          online: opponentConnected || showMatchmaking,
        }}
        you={{
          displayName: profile.displayName.trim() || "Guest",
          username: hudPlainUsername(profile.username),
          online: true,
        }}
      />

      <main className={gp.surfaceRoot}>
        <div className={gp.surfaceVignette} aria-hidden />
        <div className={gp.surfaceMain} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          <header className={styles.topBar}>
            <span className={styles.brand}>BLINK STACKER DUEL</span>
            {showArena && net.phase === "moving" ? (
              <div className={`${styles.turnPill} ${turnPill.includes("OPPONENT") ? styles.turnPillOpponent : ""}`}>
                {turnPill}
              </div>
            ) : (
              <span />
            )}
          </header>

          <div className={styles.main} style={{ paddingBottom: showArena ? "12px" : undefined }}>
            {showArena ? (
              <div
                ref={stageRef}
                className={styles.stage}
                style={{ width: `${frameSize.width}px`, height: `${frameSize.height}px` }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  tryStopRef.current();
                }}
              >
                <div className={styles.remoteShell}>
                  <video ref={remoteVideoRef} className={styles.remote} playsInline autoPlay muted />
                </div>
                <canvas ref={canvasRef} className={styles.overlayCanvas} />
                <div className={styles.pip}>
                  <video ref={pipVideoRef} className={styles.pipInner} playsInline muted autoPlay />
                </div>

                {net.phase === "countdown" ? (
                  <div className={styles.layerUi}>
                    <div className={styles.count}>{net.cd ?? 3}</div>
                  </div>
                ) : null}

                {net.phase === "turn_banner" && net.banner ? (
                  <div className={styles.layerUi}>
                    <div className={styles.banner}>{net.banner}</div>
                  </div>
                ) : null}

                {showGameOver && net.loser ? (
                  <div className={styles.layerUi}>
                    <div className={styles.card}>
                      <p className={styles.endTitle}>{youWin ? "YOU WIN" : "YOU LOSE"}</p>
                      <RematchBar
                        iWantRematch={iAmBlue ? net.rematch.host : net.rematch.guest}
                        theyWantRematch={iAmBlue ? net.rematch.guest : net.rematch.host}
                        onRematch={requestRematch}
                        onLeave={leaveMatch}
                        opponentLeft={opponentLeftMatch}
                        onReturnArcade={leaveMatch}
                        onGoHome={() => router.push("/")}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showMenu || showMatchmaking ? (
              <div className={styles.layerUi} style={{ position: "relative", inset: "auto", flex: 1, width: "100%" }}>
                <div className={styles.card}>
                  <div className={styles.title}>Blink Stacker Duel</div>
                  {showMatchmaking ? (
                    <>
                      <p className={styles.sub}>Searching for an opponent…</p>
                      <div className={styles.row}>
                        <button type="button" className={styles.buttonSecondary} onClick={cancelMatchmaking}>
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className={styles.sub}>Shared tower — blue vs red. Only the active player can blink to stop the brick.</p>
                      <div className={styles.row}>
                        <button type="button" className={styles.button} onClick={() => void findMatch()}>
                          Find Match
                        </button>
                      </div>
                    </>
                  )}
                  <p className={styles.status}>{status}</p>
                  {roomId ? <p className={styles.status}>Room: {roomId}</p> : null}
                </div>
              </div>
            ) : null}

            {showLobby ? (
              <div className={styles.layerUi} style={{ position: "relative", inset: "auto", flex: 1, width: "100%" }}>
                <div className={styles.card}>
                  <div className={styles.title}>Lobby</div>
                  <p className={styles.sub}>Ready up — match starts when both players are ready.</p>
                  <p className={styles.subMuted}>
                    {opponentConnected
                      ? role === "host"
                        ? readyGuest
                          ? "Opponent is ready."
                          : "Waiting for opponent…"
                        : readyHost
                          ? "Opponent is ready."
                          : "Waiting for opponent…"
                      : "Waiting for opponent…"}
                  </p>
                  <div className={styles.row}>
                    {opponentConnected ? (
                      <button
                        type="button"
                        className={(role === "host" ? readyHost : readyGuest) ? styles.buttonReady : styles.button}
                        onClick={toggleLobbyReady}
                      >
                        {(role === "host" ? readyHost : readyGuest) ? "READY ✓" : "READY"}
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.row}>
                    <button type="button" className={styles.buttonSecondary} onClick={leaveMatch}>
                      Back
                    </button>
                  </div>
                  <p className={styles.status}>{status}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {uiPhase !== "playing" ? <GFBottomNav activeHref="/" /> : null}
    </div>
  );
}
