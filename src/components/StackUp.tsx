"use client";

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import React, { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
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
import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";
import { combinedEar, createBlinkEdgeDetector } from "@/lib/blinkStacker/ear";
import { layoutFromCanvasHeight } from "@/lib/blinkStacker/camera";
import { GameplayDuelHud } from "@/components/gameface/gameplay/GameplayDuelHud";
import { GFBottomNav } from "@/components/gameface/GFBottomNav";
import { hudPlainUsername } from "@/lib/gameface/hudIdentity";
import styles from "./StackUp.module.css";
import type { GuestToHostStackUpMsg, HostToGuestStackUpMsg, StackUpNetState, StackUpSeg } from "@/lib/stackUp/netTypes";
import {
  cloneStackUpState,
  countdownSecondsLeft,
  createStackUpHostRuntime,
  hostAdvanceMoving,
  hostApplyStop,
  hostTickTransitions,
  hostUpdateCamera,
  integrateMovingMcnSnapshot,
  resetStackUpRuntime,
  type StackUpHostRuntime,
} from "@/lib/stackUp/hostSim";

const QUEUE_POLL_MS = 600;
const DEFAULT_INTRO = "/stack-up";
const BLINK_COOLDOWN_MS = 250;
const MIN_BRICK_PX = 40;
const MIN_BRICK_H_PX = 24;

type UiPhase = "menu" | "matchmaking" | "lobby" | "playing" | "gameover";
type Role = "host" | "guest";

function log(...args: unknown[]) {
  console.log("[StackUp]", ...args);
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
  o: StackUpSeg["o"],
  opts: { hot?: boolean; pulse?: number; alpha?: number },
) {
  const hot = opts.hot ?? false;
  const pulse = opts.pulse ?? 0;
  const alpha = opts.alpha ?? 1;
  const g = ctx.createLinearGradient(x, yTop, x + w, yTop + h);
  if (o === "blue") {
    g.addColorStop(0, `rgba(30, 80, 120, ${0.96 * alpha})`);
    g.addColorStop(1, `rgba(10, 40, 70, ${0.98 * alpha})`);
  } else if (o === "red") {
    g.addColorStop(0, `rgba(130, 30, 52, ${0.96 * alpha})`);
    g.addColorStop(1, `rgba(78, 12, 28, ${0.98 * alpha})`);
  } else {
    g.addColorStop(0, `rgba(36, 40, 52, ${0.95 * alpha})`);
    g.addColorStop(1, `rgba(12, 15, 24, ${0.98 * alpha})`);
  }
  pathRoundRect(ctx, x, yTop, w, h, 8);
  ctx.fillStyle = g;
  ctx.fill();
  pathRoundRect(ctx, x, yTop, w, h, 8);
  if (hot) {
    const amp = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(pulse));
    const red = o === "red";
    ctx.strokeStyle = red ? `rgba(251, 99, 99, ${0.78 + 0.2 * amp})` : `rgba(56, 189, 248, ${0.8 + 0.2 * amp})`;
    ctx.shadowColor = red ? `rgba(251, 99, 99, ${0.36 * amp})` : `rgba(56, 189, 248, ${0.5 * amp})`;
    ctx.shadowBlur = 14 + 26 * amp;
    ctx.lineWidth = 2 + 2 * amp;
  } else {
    ctx.strokeStyle = o === "red" ? "rgba(251, 99, 99, 0.88)" : o === "blue" ? "rgba(56, 189, 248, 0.9)" : "rgba(148, 163, 184, 0.55)";
    ctx.shadowColor = o === "red" ? "rgba(251, 99, 99, 0.34)" : "rgba(56, 189, 248, 0.32)";
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, s: StackUpNetState) {
  ctx.clearRect(0, 0, w, h);
  const arenaW = w * 0.88;
  const arenaLeft = (w - arenaW) / 2;
  const raw = layoutFromCanvasHeight(h);
  const floorY = raw.floorY;
  const blockH = Math.max(MIN_BRICK_H_PX, raw.blockH * 1.2);
  const gap = Math.max(6, raw.gap);
  const floatExtra = raw.floatExtra;
  const cam = Number.isFinite(s.cam) ? s.cam : 0;

  ctx.save();
  ctx.translate(0, cam);

  s.tower.forEach((seg, i) => {
    const bottomY = floorY - i * (blockH + gap);
    const bw = Math.max(MIN_BRICK_PX, seg.wn * arenaW);
    const x = arenaLeft + seg.ln * arenaW;
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

export type StackUpProps = {
  autoJoinPublicQueue?: boolean;
  fromRandomMatch?: boolean;
  introHref?: string;
};

export default function StackUp({ autoJoinPublicQueue = false, fromRandomMatch = false, introHref }: StackUpProps) {
  const router = useRouter();
  const { profile } = useGameFaceProfile();
  const clientId = profile.userId;

  const initialPhase: UiPhase = autoJoinPublicQueue || fromRandomMatch ? "matchmaking" : "menu";
  const [uiPhase, setUiPhase] = useState<UiPhase>(initialPhase);
  const uiPhaseRef = useRef<UiPhase>(initialPhase);
  useEffect(() => {
    uiPhaseRef.current = uiPhase;
  }, [uiPhase]);

  const showArena = uiPhase === "lobby" || uiPhase === "playing" || uiPhase === "gameover";
  const [role, setRole] = useState<Role | null>(null);
  const roleRef = useRef<Role | null>(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState(() => (autoJoinPublicQueue ? "Searching for opponent…" : fromRandomMatch ? "Connecting…" : "Idle"));
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [opponentLeftMatch, setOpponentLeftMatch] = useState(false);
  const peerRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const matchPollRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hostRtRef = useRef<StackUpHostRuntime | null>(null);
  const netRef = useRef<StackUpNetState>(cloneStackUpState(createStackUpHostRuntime().state));
  const hostSeqRef = useRef(0);
  const lastGuestSeqRef = useRef(-1);
  const lastGuestStateSentAtRef = useRef(0);
  const lastPlayBroadcastMsRef = useRef(0);
  const lastBrickEpochStoppedRef = useRef(-1);
  const lastSeenBrickEpochRef = useRef(-1);
  const lastLoopRef = useRef<number | null>(null);
  const hideHintUntilRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const remoteAttachSeqRef = useRef(0);
  const pendingRemoteStreamRef = useRef<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(null);
  const blinkDetRef = useRef<ReturnType<typeof createBlinkEdgeDetector> | null>(null);
  const guestBrickEpochRef = useRef(0);
  const [centerInstrOpacity, setCenterInstrOpacity] = useState(0);

  const [, bumpUi] = useReducer((x: number) => x + 1, 0);
  const lastGuestUiBumpRef = useRef(0);
  const lastHostUiBumpRef = useRef(0);

  function attachRemoteStream(stream: MediaStream) {
    const local = localStreamRef.current;
    if (local && stream === local) {
      log("ignoring local stream assigned as remote");
      return;
    }
    remoteAttachSeqRef.current += 1;
    log("attach remote stream", {
      seq: remoteAttachSeqRef.current,
      streamId: stream.id,
      tracks: stream.getVideoTracks().map((t) => t.id),
    });
    const el = remoteVideoRef.current;
    if (el) {
      el.srcObject = stream;
      el.muted = true;
      void el.play().catch(() => {});
    } else {
      pendingRemoteStreamRef.current = stream;
      log("remote video not mounted yet; holding stream until arena mounts");
    }
  }

  function maybeBumpGuestUi(force = false) {
    const t = nowMs();
    if (!force && t - lastGuestUiBumpRef.current < 80) return;
    lastGuestUiBumpRef.current = t;
    bumpUi();
  }

  useEffect(() => {
    reduceMotionRef.current = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }, []);

  function getDrawState(): StackUpNetState {
    if (roleRef.current === "host" && hostRtRef.current) return hostRtRef.current.state;
    return netRef.current;
  }

  async function ensureLocalCamera() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
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
      await fetch("/api/stack-up/queue", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, action: "leave" }),
      });
    } catch {
      // ignore
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
        // ignore
      }
    }
    peerRef.current = null;
    dataRef.current = null;
    const s = localStreamRef.current;
    if (s) for (const t of s.getTracks()) t.stop();
    localStreamRef.current = null;
    hostRtRef.current = null;
    landmarkerRef.current = null;
    blinkDetRef.current = null;
    pendingRemoteStreamRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setCenterInstrOpacity(0);
  }

  function sendToHost(msg: GuestToHostStackUpMsg) {
    const conn = dataRef.current;
    if (conn && conn.open) conn.send(msg);
  }

  function sendToGuest(msg: HostToGuestStackUpMsg) {
    const conn = dataRef.current;
    if (conn && conn.open) conn.send(msg);
  }

  function broadcastAuthoritativeState() {
    if (roleRef.current !== "host") return;
    const rt = hostRtRef.current;
    const conn = dataRef.current;
    if (!rt || !conn?.open) return;
    const s = rt.state;
    if (s.phase === "countdown" && s.cde != null) s.cd = countdownSecondsLeft(nowMs(), s.cde);
    hostSeqRef.current += 1;
    const sentAt = performance.now();
    const snap = cloneStackUpState(s);
    netRef.current = snap;
    sendToGuest({ t: "state", state: snap, seq: hostSeqRef.current, sentAt });
  }

  function hostTryRematch() {
    if (roleRef.current !== "host") return;
    const rt = hostRtRef.current;
    if (!rt) return;
    const s = rt.state;
    if (s.phase !== "gameover" || !rematchBothWant(s.rematch)) return;
    const nextEpoch = (s.matchEpoch ?? 0) + 1;
    resetStackUpRuntime(rt, nextEpoch);
    setUiPhase("lobby");
    setOpponentLeftMatch(false);
    lastBrickEpochStoppedRef.current = -1;
    lastSeenBrickEpochRef.current = -1;
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
    } else if (role === "guest") {
      const g = netRef.current.ready.guest;
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
      hostTryRematch();
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
    if (brickEpoch !== s.brickEpoch || brickEpoch === lastBrickEpochStoppedRef.current) return;
    lastBrickEpochStoppedRef.current = brickEpoch;
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
    hostApplyStop(rt, nowMs());
    if (rt.state.phase === "gameover") setUiPhase("gameover");
    broadcastAuthoritativeState();
    bumpUi();
  }

  function trySendGuestStop() {
    if (roleRef.current !== "guest") return;
    const s = netRef.current;
    if (s.phase !== "moving" || s.activeBlue) return;
    sendToHost({ t: "stopAttempt", brickEpoch: guestBrickEpochRef.current });
  }

  const tryStopRef = useRef<() => void>(() => {});

  const visionStep = (ts: number) => {
    const video = localVideoRef.current;
    const lm = landmarkerRef.current;
    if (!video || !lm || video.readyState < 2) return;
    const gs = getDrawState();
    if (gs.phase !== "moving") return;
    const iAmBlue = roleRef.current === "host";
    const myTurn = (gs.activeBlue && iAmBlue) || (!gs.activeBlue && !iAmBlue);
    if (!myTurn) return;
    const res = lm.detectForVideo(video, ts);
    const pts = res.faceLandmarks?.[0] as NormalizedLandmark[] | undefined;
    const ear = combinedEar(pts);
    const det = blinkDetRef.current;
    if (!det) return;
    if (det.tick(ear, ts)) {
      hideHintUntilRef.current = performance.now() + 1200;
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
    hideHintUntilRef.current = performance.now() + 1200;
    if (roleRef.current === "host") hostHandleLocalStop();
    else trySendGuestStop();
  };

  async function connectAsHost(desiredRoomId: string) {
    cleanup();
    setStatus("Creating room…");
    setRole("host");
    setOpponentConnected(false);
    const stream = await ensureLocalCamera();
    const created = await createHostRoom({ desiredRoomId });
    const rid = created.roomId;
    const peer = created.peer;
    peerRef.current = peer;
    setRoomId(rid);
    hostRtRef.current = createStackUpHostRuntime();
    setStatus("Waiting for opponent…");

    peer.on("call", (call: any) => {
      call.answer(stream);
      call.on("stream", (remoteStream: MediaStream) => {
        attachRemoteStream(remoteStream);
      });
    });

    const conn = await waitForHostConnection(peer);
    dataRef.current = conn;
    setOpponentConnected(true);
    setStatus("Opponent connected");

    conn.on("data", (raw: unknown) => {
      const msg = raw as GuestToHostStackUpMsg;
      const rt = hostRtRef.current;
      if (!rt) return;
      if (msg.t === "ready") {
        rt.state.ready.guest = msg.ready;
        broadcastAuthoritativeState();
        bumpUi();
      } else if (msg.t === "rematch") {
        if (rt.state.phase === "gameover") {
          rt.state.rematch.guest = msg.want;
          broadcastAuthoritativeState();
          bumpUi();
          hostTryRematch();
        }
      } else if (msg.t === "stopAttempt") {
        hostHandleStopFromNetwork(msg.brickEpoch);
      }
    });

    conn.on("close", () => {
      setOpponentConnected(false);
      setOpponentLeftMatch(true);
    });

    if (conn.open) broadcastAuthoritativeState();
    else conn.on("open", broadcastAuthoritativeState);
  }

  async function connectAsGuest(rid: string) {
    cleanup();
    lastGuestSeqRef.current = -1;
    lastGuestStateSentAtRef.current = performance.now();
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

    conn.on("data", (raw: unknown) => {
      const msg = raw as HostToGuestStackUpMsg;
      if (msg.t !== "state") return;
      if (msg.seq <= lastGuestSeqRef.current) return;
      lastGuestSeqRef.current = msg.seq;
      lastGuestStateSentAtRef.current = msg.sentAt;
      const authoritative = cloneStackUpState(msg.state);
      netRef.current = authoritative;
      guestBrickEpochRef.current = authoritative.brickEpoch;
      maybeBumpGuestUi(authoritative.phase === "lobby" || authoritative.phase === "gameover");
      if (authoritative.phase === "lobby") {
        setUiPhase("lobby");
        setOpponentLeftMatch(false);
      } else if (authoritative.phase === "gameover") setUiPhase("gameover");
      else setUiPhase("playing");
    });

    conn.on("close", () => {
      setOpponentConnected(false);
      setOpponentLeftMatch(true);
    });

    const call = peer.call(rid, stream);
    call.on("stream", (remoteStream: MediaStream) => {
      attachRemoteStream(remoteStream);
    });

    guestAnswerCalls(peer as never, stream, (incoming) => {
      incoming.on("stream", (remoteStream: MediaStream) => {
        attachRemoteStream(remoteStream);
      });
    });
  }

  async function applyMatch(peerRoomId: string, r: Role) {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    setStatus("Connecting…");
    try {
      setOpponentLeftMatch(false);
      setUiPhase("lobby");
      if (r === "host") await connectAsHost(peerRoomId);
      else await connectAsGuest(peerRoomId);
      try {
        landmarkerRef.current = await createFaceLandmarker();
      } catch {
        landmarkerRef.current = null;
      }
      blinkDetRef.current = createBlinkEdgeDetector({ threshold: 0.19, cooldownMs: BLINK_COOLDOWN_MS });
      blinkDetRef.current.reset();
    } catch {
      cleanup();
      setStatus("Connection failed. Try again.");
      setUiPhase("menu");
      setRole(null);
    }
  }

  async function findMatch() {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    setStatus("Searching for opponent…");
    setUiPhase("matchmaking");
    const joinBody = JSON.stringify({ clientId, action: "join" });
    const res = await fetch("/api/stack-up/queue", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: joinBody,
    });
    const data = await res.json();
    if (data.matched) {
      await applyMatch(data.peerRoomId as string, data.role as Role);
      return;
    }
    matchPollRef.current = window.setInterval(async () => {
      const r = await fetch("/api/stack-up/queue", {
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
        await applyMatch(j.peerRoomId as string, j.role as Role);
      }
    }, QUEUE_POLL_MS);
  }

  useEffect(() => {
    if (!autoJoinPublicQueue && !fromRandomMatch) return;
    void findMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoinPublicQueue, fromRandomMatch]);

  useEffect(() => {
    if (!showArena) return;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(200, Math.floor(r.width * dpr));
      canvas.height = Math.max(360, Math.floor(r.height * dpr));
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
      const ctx = canvas
        ? (canvasCtxRef.current ?? (canvasCtxRef.current = canvas.getContext("2d", { alpha: true, desynchronized: true })))
        : null;
      const w = canvas?.width ?? 360;
      const h = canvas?.height ?? 640;

      const isHost = roleRef.current === "host";
      const rt = hostRtRef.current;
      if (isHost && rt && opponentConnected) {
        const s = rt.state;
        const arenaW = Math.max(1, (canvas?.width ?? w) * 0.88);
        if (s.brickEpoch !== lastSeenBrickEpochRef.current) {
          lastSeenBrickEpochRef.current = s.brickEpoch;
          lastBrickEpochStoppedRef.current = -1;
          const l = layoutFromCanvasHeight(h);
          const blockH = Math.max(MIN_BRICK_H_PX, l.blockH);
          const gap = Math.max(6, l.gap);
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
        hostTickTransitions(rt, now);
        if ((s.phase === "countdown" || s.phase === "moving" || s.phase === "gameover") && uiPhaseRef.current === "lobby") {
          setUiPhase("playing");
        }
        if (s.phase === "countdown" && s.cde != null) s.cd = countdownSecondsLeft(now, s.cde);
        if (s.phase === "moving" && canvas) hostAdvanceMoving(s, dt, arenaW);
        hostUpdateCamera(s, dt, h, reduceMotionRef.current);
        if (s.fx && now > s.fx.until) s.fx = null;
        if (s.phase === "gameover" && uiPhaseRef.current !== "gameover") setUiPhase("gameover");
        if (s.phase === "moving" || s.phase === "gameover" || s.phase === "countdown") {
          if (phaseBeforeTick === "lobby") {
            lastPlayBroadcastMsRef.current = now;
            broadcastAuthoritativeState();
          } else if (now - lastPlayBroadcastMsRef.current >= 16) {
            lastPlayBroadcastMsRef.current = now;
            broadcastAuthoritativeState();
          }
        } else if (s.phase === "lobby" && now - lastPlayBroadcastMsRef.current >= 160) {
          lastPlayBroadcastMsRef.current = now;
          broadcastAuthoritativeState();
        }
        if (uiPhaseRef.current === "playing" && now - lastHostUiBumpRef.current > 120) {
          lastHostUiBumpRef.current = now;
          bumpUi();
        }
      }

      if (!canvas || !ctx) return;
      const ds = getDrawState();
      const arenaWDraw = Math.max(1, w * 0.88);
      let toDraw = ds;
      if (roleRef.current === "guest" && ds.phase === "moving") {
        const elapsedSec = Math.max(0, Math.min(0.12, (performance.now() - lastGuestStateSentAtRef.current) / 1000));
        const blend = cloneStackUpState(ds);
        blend.mcn = integrateMovingMcnSnapshot(ds, arenaWDraw, elapsedSec);
        toDraw = blend;
      }
      drawScene(ctx, w, h, toDraw);
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

  useLayoutEffect(() => {
    if (!showArena) return;
    const el = remoteVideoRef.current;
    const pending = pendingRemoteStreamRef.current;
    if (!el || !pending) return;
    el.srcObject = pending;
    pendingRemoteStreamRef.current = null;
    el.muted = true;
    void el.play().catch(() => {});
  }, [showArena, opponentConnected]);

  useEffect(() => {
    if (!showArena) return;
    const id = window.setInterval(() => visionStep(performance.now()), 80);
    return () => window.clearInterval(id);
  }, [showArena]);

  const snapPhase = getDrawState().phase;
  const snapMatchEpoch = getDrawState().matchEpoch ?? 0;
  useEffect(() => {
    if (!showArena || uiPhase === "lobby") return;
    if (snapPhase !== "moving") return;
    setCenterInstrOpacity(1);
    const id = window.setTimeout(() => setCenterInstrOpacity(0), 3000);
    return () => {
      window.clearTimeout(id);
      setCenterInstrOpacity(0);
    };
  }, [showArena, uiPhase, snapPhase, snapMatchEpoch]);

  const showMenu = uiPhase === "menu";
  const showMatchmaking = uiPhase === "matchmaking";
  const showLobby = uiPhase === "lobby";
  const showGameOver = uiPhase === "gameover";

  const net = getDrawState();
  const iAmBlue = role === "host";
  const myTurn = net.phase === "moving" && ((net.activeBlue && iAmBlue) || (!net.activeBlue && !iAmBlue));
  const youWin = net.phase === "gameover" && net.loser && ((net.loser === "red" && iAmBlue) || (net.loser === "blue" && !iAmBlue));
  const sharedScore = Math.max(0, net.tower.length - 1);
  const readyHost = role === "host" ? hostRtRef.current?.state.ready.host ?? false : netRef.current.ready.host;
  const readyGuest = role === "host" ? hostRtRef.current?.state.ready.guest ?? false : netRef.current.ready.guest;
  const showFrameHud = showArena && uiPhase !== "lobby" && net.phase !== "lobby";
  const frameHudCenter =
    net.phase === "moving"
      ? myTurn
        ? "YOUR TURN"
        : "OPPONENT TURN"
      : net.phase === "countdown"
        ? "GET READY"
        : net.phase === "gameover"
          ? "GAME OVER"
          : "";

  function cancelMatchmaking() {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    void leaveQueue();
    router.push(introHref ?? DEFAULT_INTRO);
  }

  function goHome() {
    cleanup();
    router.push("/");
  }

  return (
    <div className={styles.shell}>
      <video ref={localVideoRef} className={styles.hidden} playsInline muted autoPlay />

      <div className={styles.playerHudWrap}>
        <GameplayDuelHud
          gameBadge="STACK UP"
          hideCenterBadge
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
      </div>

      <main className={styles.main}>
        {showArena ? (
          <div className={styles.stageFrame}>
            <div
              ref={stageRef}
              className={styles.stage}
              onPointerDown={(e) => {
                e.preventDefault();
                tryStopRef.current();
              }}
            >
              <div className={styles.remoteShell}>
                <video ref={remoteVideoRef} className={styles.remote} playsInline autoPlay muted />
              </div>
              <canvas ref={canvasRef} className={styles.overlayCanvas} />

              <div
                className={styles.centerInstruction}
                style={{ opacity: centerInstrOpacity }}
                aria-hidden
              >
                <p className={styles.centerInstructionLine}>TAKE TURNS BLINKING OR TAPPING TO STOP</p>
                <p className={styles.centerInstructionLine}>FIRST MISS LOSES</p>
              </div>

              {showFrameHud ? (
                <div className={styles.frameHud} aria-hidden>
                  <div className={styles.frameHudScore}>
                    <span className={styles.frameHudLabel}>SCORE</span>
                    <span className={styles.frameHudValue}>{sharedScore}</span>
                  </div>
                  <div
                    className={`${styles.frameHudCenter} ${
                      net.phase === "moving" && !myTurn ? styles.frameHudCenterOpp : ""
                    }`}
                  >
                    {frameHudCenter}
                  </div>
                  <div className={styles.frameHudSpacer} />
                </div>
              ) : null}

              <div className={styles.pip}>
                <video ref={pipVideoRef} className={styles.pipInner} playsInline muted autoPlay />
              </div>

              {net.phase === "countdown" ? (
                <div className={styles.layerUi}>
                  <div className={styles.count}>{net.cd ?? 3}</div>
                </div>
              ) : null}

              {showGameOver && net.loser ? (
                <div className={`${styles.layerUi} ${styles.layerUiInteractive}`}>
                  <div className={`${styles.focusCard} ${styles.focusCardInteractive}`}>
                    <p className={styles.focusTitle}>{youWin ? "YOU WIN" : "YOU LOSE"}</p>
                    <RematchBar
                      iWantRematch={iAmBlue ? net.rematch.host : net.rematch.guest}
                      theyWantRematch={iAmBlue ? net.rematch.guest : net.rematch.host}
                      onRematch={requestRematch}
                      onLeave={leaveMatch}
                      opponentLeft={opponentLeftMatch}
                      onReturnArcade={leaveMatch}
                      onGoHome={goHome}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {showMenu || showMatchmaking ? (
          <div className={styles.menuWrap}>
            <div className={styles.menuCard}>
              <div className={styles.title}>Stack Up</div>
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
                  <p className={styles.sub}>Take turns blinking to stop the moving block. First miss loses.</p>
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
          <div className={styles.lobbyLayer}>
            <div className={styles.menuWrap}>
              <div className={styles.menuCard}>
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
                      {(role === "host" ? readyHost : readyGuest) ? "Ready ✓" : "Ready"}
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
          </div>
        ) : null}
      </main>

      {!showArena ? <GFBottomNav activeHref="/" /> : null}
    </div>
  );
}
