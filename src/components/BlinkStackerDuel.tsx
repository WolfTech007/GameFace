"use client";

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GFBottomNav } from "@/components/gameface/GFBottomNav";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { ensureProfile } from "@/lib/gameface/profileStore";
import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";
import { BLINK_COOLDOWN_MS } from "@/lib/blinkStacker/constants";
import { combinedEar, createBlinkEdgeDetector } from "@/lib/blinkStacker/ear";
import { layoutFromCanvasHeight } from "@/lib/blinkStacker/camera";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import {
  countdownSecondsLeft,
  createHostRuntime,
  hostAdvanceMoving,
  hostApplyStop,
  hostSpawnMissParticles,
  hostTickTimeTransitions,
  hostUpdateCamera,
  resetHostRuntime,
  type DuelParticle,
  type HostRuntime,
} from "@/lib/blinkStackerDuel/hostSim";
import type { DuelNetMsg, DuelStatePayload } from "@/lib/blinkStackerDuel/protocol";
import styles from "./BlinkStackerDuel.module.css";

type LocalPhase = "intro" | "queue" | "peer_setup" | "arena";
type Role = "host" | "guest";

const QUEUE_POLL_MS = 600;
const DEFAULT_INTRO = "/blink-stacker-duel";

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
  throw lastErr instanceof Error ? lastErr : new Error("Could not connect to host.");
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
  o: DuelStatePayload["tower"][0]["o"],
  opts: { pulse?: number; hot?: boolean },
) {
  const pulse = opts.pulse ?? 0;
  const hot = opts.hot ?? false;
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

function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: DuelStatePayload,
  particles: DuelParticle[],
  shake: boolean,
) {
  ctx.clearRect(0, 0, w, h);
  const arenaW = w * 0.88;
  const arenaLeft = (w - arenaW) / 2;
  const { floorY, blockH, gap, floatExtra } = layoutFromCanvasHeight(h);
  const cam = s.cam;

  ctx.save();
  if (shake) {
    const t = performance.now() / 1000;
    ctx.translate(Math.sin(t * 80) * 3, Math.cos(t * 73) * 2);
  }
  ctx.translate(0, cam);

  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.fillRect(arenaLeft, -h * 2, arenaW, h * 5);

  s.tower.forEach((seg, i) => {
    const bottomY = floorY - i * (blockH + gap);
    const x = arenaLeft + seg.ln * arenaW;
    const bw = seg.wn * arenaW;
    drawBrick(ctx, x, bottomY - blockH, bw, blockH, seg.o, {});
  });

  if (s.phase === "moving") {
    const floatBottom = floorY - s.tower.length * (blockH + gap) - floatExtra;
    const x = arenaLeft + (s.mcn - s.mwn / 2) * arenaW;
    const bw = s.mwn * arenaW;
    const owner = s.abi ? "blue" : "red";
    drawBrick(ctx, x, floatBottom - blockH, bw, blockH, owner, { hot: true, pulse: s.pp });
  }

  for (const p of particles) {
    if (p.life <= 0) continue;
    const a = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.hue === "red" ? `rgba(251, 99, 99, ${0.8 * a})` : `rgba(56, 189, 248, ${0.8 * a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * a + 1, 0, Math.PI * 2);
    ctx.fill();
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
  fromRandomMatch: _fromRandomMatch = false,
  introHref,
}: BlinkStackerDuelProps) {
  const router = useRouter();
  const { profile } = useGameFaceProfile();

  const [localPhase, setLocalPhase] = useState<LocalPhase>(() => (autoJoinPublicQueue ? "queue" : "intro"));
  const localPhaseRef = useRef(localPhase);
  useEffect(() => {
    localPhaseRef.current = localPhase;
  }, [localPhase]);
  const [status, setStatus] = useState("");
  const [opponentName, setOpponentName] = useState<string | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [uiShake, setUiShake] = useState(false);
  const [showPerfect, setShowPerfect] = useState(false);

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<{ destroy?: () => void } | null>(null);
  const dataRef = useRef<{ open?: boolean; send: (m: DuelNetMsg) => void } | null>(null);
  const roleRef = useRef<Role | null>(null);
  const nameRef = useRef(profile.displayName.trim().slice(0, 24) || "Player");
  useEffect(() => {
    nameRef.current = profile.displayName.trim().slice(0, 24) || "Player";
  }, [profile.displayName]);

  const [hostView, setHostView] = useState<DuelStatePayload | null>(null);
  const [guestView, setGuestView] = useState<DuelStatePayload | null>(null);

  const hostRtRef = useRef<HostRuntime | null>(null);
  const guestStateRef = useRef<DuelStatePayload | null>(null);
  const guestParticlesRef = useRef<DuelParticle[]>([]);
  const lastBroadcastRef = useRef(0);
  const allowBlinkRef = useRef(false);
  const [matchRole, setMatchRole] = useState<Role | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof createFaceLandmarker>> | null>(null);
  const blinkDetRef = useRef<ReturnType<typeof createBlinkEdgeDetector> | null>(null);
  const reduceMotionRef = useRef(false);

  const matchPollRef = useRef<number | null>(null);

  const sendNet = useCallback((m: DuelNetMsg) => {
    const c = dataRef.current as { open?: boolean; send?: (x: DuelNetMsg) => void } | null;
    if (c?.open && c.send) c.send(m);
  }, []);

  const broadcastIfHost = useCallback(() => {
    if (roleRef.current !== "host") return;
    const rt = hostRtRef.current;
    const conn = dataRef.current;
    if (!rt || !conn?.open) return;
    const now = performance.now();
    if (now - lastBroadcastRef.current < 33) return;
    lastBroadcastRef.current = now;
    const s = rt.state;
    if (s.phase === "countdown" && s.cde != null) {
      s.cd = countdownSecondsLeft(now, s.cde);
    }
    const snap = { ...s };
    setHostView(snap);
    sendNet({ t: "bsd_state", s: snap });
  }, [sendNet]);

  const cleanupPeer = useCallback(() => {
    if (matchPollRef.current) {
      clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    try {
      peerRef.current?.destroy?.();
    } catch {
      /* ignore */
    }
    peerRef.current = null;
    dataRef.current = null;
    const st = streamRef.current;
    if (st) {
      for (const t of st.getTracks()) t.stop();
    }
    streamRef.current = null;
    hostRtRef.current = null;
    guestParticlesRef.current = [];
    setHostView(null);
    setGuestView(null);
    guestStateRef.current = null;
    /** Do not clear `matchRole` here — `setupPeer` calls this while `applyMatch` is wiring a new session. */
  }, []);

  async function leaveQueue() {
    const clientId = ensureProfile().userId;
    try {
      await fetch("/api/blink-stacker-duel/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, action: "leave" }),
      });
    } catch {
      /* ignore */
    }
  }

  async function ensureCamera() {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
    });
    streamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      void localVideoRef.current.play();
    }
    return stream;
  }

  const tryStopRef = useRef<() => void>(() => {});

  const tryStopLocal = useCallback(() => {
    const role = roleRef.current;
    const conn = dataRef.current;
    if (!conn?.open || localPhase !== "arena") return;

    if (role === "host") {
      const rt = hostRtRef.current;
      if (!rt) return;
      const s = rt.state;
      if (s.phase !== "moving" || !s.abi) return;
      const r = hostApplyStop(rt, performance.now(), true);
      if (r.miss) {
        const cv = canvasRef.current;
        if (cv) {
          const arenaW = cv.width * 0.88;
          const arenaLeft = (cv.width - arenaW) / 2;
          hostSpawnMissParticles(rt, cv.height, arenaW, arenaLeft);
        }
        setUiShake(true);
        window.setTimeout(() => setUiShake(false), 320);
      } else if (r.perfect) {
        setShowPerfect(true);
        window.setTimeout(() => setShowPerfect(false), 700);
      }
      broadcastIfHost();
      return;
    }

    if (role === "guest") {
      const gs = guestStateRef.current;
      if (!gs || gs.phase !== "moving" || gs.abi) return;
      sendNet({ t: "bsd_stop_attempt" });
    }
  }, [broadcastIfHost, localPhase, sendNet]);

  tryStopRef.current = tryStopLocal;

  useEffect(() => {
    reduceMotionRef.current =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (localPhase !== "arena") return;
      e.preventDefault();
      tryStopRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [localPhase]);

  const visionStep = useCallback(
    (now: number) => {
      const video = localVideoRef.current;
      const lm = landmarkerRef.current;
      if (!video || !lm || video.readyState < 2) return;
      const res = lm.detectForVideo(video, now);
      const pts = res.faceLandmarks?.[0] as NormalizedLandmark[] | undefined;
      const ear = combinedEar(pts);
      const det = blinkDetRef.current;
      if (!det || localPhase !== "arena") return;
      if (!allowBlinkRef.current) return;
      if (det.tick(ear, now)) tryStopRef.current();
    },
    [localPhase],
  );

  const wireHost = useCallback(
    (conn: { on: (ev: string, fn: (raw: unknown) => void) => void }) => {
      conn.on("data", (raw: unknown) => {
        const msg = raw as DuelNetMsg;
        if (msg.t === "bsd_hello") {
          setOpponentName(msg.name);
          lastBroadcastRef.current = 0;
          broadcastIfHost();
          return;
        }
        if (msg.t === "bsd_ready") {
          setRemoteReady(msg.ready);
          const rt = hostRtRef.current;
          if (rt) rt.readyG = msg.ready;
          broadcastIfHost();
          return;
        }
        if (msg.t === "bsd_stop_attempt") {
          const rt = hostRtRef.current;
          if (!rt) return;
          const s = rt.state;
          if (s.phase !== "moving" || s.abi) return;
          const r = hostApplyStop(rt, performance.now(), false);
          if (r.miss) {
            const cv = canvasRef.current;
            if (cv) {
              const arenaW = cv.width * 0.88;
              const arenaLeft = (cv.width - arenaW) / 2;
              hostSpawnMissParticles(rt, cv.height, arenaW, arenaLeft);
            }
            setUiShake(true);
            window.setTimeout(() => setUiShake(false), 320);
          } else if (r.perfect) {
            setShowPerfect(true);
            window.setTimeout(() => setShowPerfect(false), 700);
          }
          broadcastIfHost();
          return;
        }
        if (msg.t === "bsd_rematch") {
          const rt = hostRtRef.current;
          if (!rt || rt.state.phase !== "ended") return;
          resetHostRuntime(rt, rt.matchEpoch + 1);
          setHostView({ ...rt.state });
          setLocalReady(false);
          setRemoteReady(false);
          setUiShake(false);
          setShowPerfect(false);
          blinkDetRef.current?.reset();
          sendNet({ t: "bsd_rematch_go", epoch: rt.matchEpoch });
          broadcastIfHost();
          return;
        }
      });
    },
    [broadcastIfHost],
  );

  const wireGuest = useCallback((conn: { on: (ev: string, fn: (raw: unknown) => void) => void }) => {
    conn.on("data", (raw: unknown) => {
      const msg = raw as DuelNetMsg;
      if (msg.t === "bsd_hello") {
        setOpponentName(msg.name);
        return;
      }
      if (msg.t === "bsd_ready") {
        setRemoteReady(msg.ready);
        return;
      }
      if (msg.t === "bsd_state") {
        const prev = guestStateRef.current?.phase;
        guestStateRef.current = msg.s;
        setGuestView({ ...msg.s });
        if (msg.s.phase === "ended" && msg.s.loser && prev !== "ended") {
          const cv = canvasRef.current;
          if (cv) {
            const arenaW = cv.width * 0.88;
            const arenaLeft = (cv.width - arenaW) / 2;
            const rt = { state: msg.s, particles: guestParticlesRef.current } as HostRuntime;
            hostSpawnMissParticles(rt, cv.height, arenaW, arenaLeft);
          }
        }
        return;
      }
      if (msg.t === "bsd_rematch_go") {
        guestParticlesRef.current = [];
        setLocalReady(false);
        setRemoteReady(false);
        blinkDetRef.current?.reset();
      }
    });
  }, []);

  async function setupPeer(roomId: string, r: Role) {
    cleanupPeer();
    await ensureCamera();
    const stream = streamRef.current!;

    if (r === "host") {
      const { peer } = await createHostRoom({ desiredRoomId: roomId });
      peerRef.current = peer;
      peer.on("call", (call: import("peerjs").MediaConnection) => {
        call.answer(stream);
        call.on("stream", (remoteStream: MediaStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            void remoteVideoRef.current.play();
          }
        });
      });
      const conn = await waitForHostConnection(peer as never);
      dataRef.current = conn as never;
      wireHost(conn as never);
      const sendHello = () => sendNet({ t: "bsd_hello", name: nameRef.current || "Player" });
      if (conn.open) sendHello();
      else conn.on("open", sendHello);
    } else {
      const peer = await createGuestPeer();
      peerRef.current = peer;
      guestAnswerCalls(peer as never, stream, (incoming: import("peerjs").MediaConnection) => {
        incoming.on("stream", (remoteStream: MediaStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            void remoteVideoRef.current.play();
          }
        });
      });
      const conn = await connectGuestWithRetry(peer as never, roomId);
      dataRef.current = conn as never;
      wireGuest(conn as never);
      const sendHello = () => sendNet({ t: "bsd_hello", name: nameRef.current || "Player" });
      if (conn.open) sendHello();
      else conn.on("open", sendHello);
      const call = (peer as { call: (id: string, s: MediaStream) => { on: (ev: string, fn: (x: MediaStream) => void) => void } }).call(
        roomId,
        stream,
      );
      call.on("stream", (remoteStream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play();
        }
      });
    }
  }

  async function applyMatch(roomId: string, r: Role) {
    roleRef.current = r;
    setMatchRole(r);
    setLocalPhase("peer_setup");
    setStatus("Connecting…");
    await setupPeer(roomId, r);
    try {
      landmarkerRef.current = await createFaceLandmarker();
    } catch {
      landmarkerRef.current = null;
    }
    blinkDetRef.current = createBlinkEdgeDetector({
      threshold: 0.19,
      cooldownMs: BLINK_COOLDOWN_MS,
    });
    blinkDetRef.current.reset();

    if (r === "host") {
      hostRtRef.current = createHostRuntime(1);
      hostRtRef.current.readyH = false;
      hostRtRef.current.readyG = false;
      setHostView({ ...hostRtRef.current.state });
      broadcastIfHost();
    } else {
      guestStateRef.current = null;
      setGuestView(null);
    }

    setLocalPhase("arena");
    setStatus("");
    setLocalReady(false);
    setRemoteReady(false);
  }

  async function findMatch() {
    const clientId = ensureProfile().userId;
    setLocalPhase("queue");
    setStatus("Finding opponent…");
    const res = await fetch("/api/blink-stacker-duel/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, action: "join" }),
    });
    const data = await res.json();
    if (data.matched) {
      await applyMatch(data.peerRoomId as string, data.role as Role);
      return;
    }
    matchPollRef.current = window.setInterval(async () => {
      const r = await fetch(`/api/blink-stacker-duel/queue?clientId=${encodeURIComponent(clientId)}`);
      const j = await r.json();
      if (j.matched) {
        if (matchPollRef.current) clearInterval(matchPollRef.current);
        matchPollRef.current = null;
        await applyMatch(j.peerRoomId as string, j.role as Role);
      }
    }, QUEUE_POLL_MS);
  }

  useEffect(() => {
    if (!autoJoinPublicQueue) return;
    void findMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot queue join from GameIntro
  }, [autoJoinPublicQueue]);

  useEffect(() => {
    const v = pipVideoRef.current;
    const s = streamRef.current;
    if (v && s) {
      v.srcObject = s;
      void v.play().catch(() => {});
    }
  }, [localPhase, matchRole]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(180, Math.floor(r.width * dpr));
      canvas.height = Math.max(320, Math.floor(r.height * dpr));
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  const lastSimTsRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const last = lastSimTsRef.current ?? ts;
      const dt = Math.min(0.05, (ts - last) / 1000);
      lastSimTsRef.current = ts;

      const role = roleRef.current;
      const sSync =
        role === "host" ? hostRtRef.current?.state : guestStateRef.current;
      if (sSync && role) {
        allowBlinkRef.current =
          localPhaseRef.current === "arena" &&
          sSync.phase === "moving" &&
          ((sSync.abi && role === "host") || (!sSync.abi && role === "guest"));
      } else {
        allowBlinkRef.current = false;
      }

      visionStep(ts);

      if (role === "host" && hostRtRef.current && localPhaseRef.current === "arena") {
        const rt = hostRtRef.current;
        const now = performance.now();
        hostTickTimeTransitions(rt, now);
        const s = rt.state;
        if (s.phase === "moving") {
          const arenaW = w * 0.88;
          hostAdvanceMoving(s, dt, arenaW);
        }
        if (s.phase === "moving" || s.phase === "turn_banner" || s.phase === "ended") {
          hostUpdateCamera(s, dt, h, reduceMotionRef.current);
        }
        for (const p of rt.particles) {
          if (p.life <= 0) continue;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 520 * dt;
          p.life -= dt * 1.35;
        }
        drawScene(ctx, w, h, s, rt.particles, uiShake && s.phase === "ended");
        broadcastIfHost();
      } else if (role === "guest") {
        const gs = guestStateRef.current;
        if (gs) {
          for (const p of guestParticlesRef.current) {
            if (p.life <= 0) continue;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 520 * dt;
            p.life -= dt * 1.35;
          }
          drawScene(ctx, w, h, gs, guestParticlesRef.current, uiShake && gs.phase === "ended");
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [broadcastIfHost, uiShake, visionStep]);

  function toggleReady() {
    const next = !localReady;
    setLocalReady(next);
    sendNet({ t: "bsd_ready", ready: next });
    if (roleRef.current === "host" && hostRtRef.current) {
      hostRtRef.current.readyH = next;
      broadcastIfHost();
    }
  }

  function rematch() {
    if (roleRef.current === "host" && hostRtRef.current) {
      const rt = hostRtRef.current;
      resetHostRuntime(rt, rt.matchEpoch + 1);
      setHostView({ ...rt.state });
      setLocalReady(false);
      setRemoteReady(false);
      setUiShake(false);
      setShowPerfect(false);
      blinkDetRef.current?.reset();
      sendNet({ t: "bsd_rematch_go", epoch: rt.matchEpoch });
      broadcastIfHost();
    } else {
      sendNet({ t: "bsd_rematch", want: true });
    }
  }

  function leaveMatch() {
    void leaveQueue();
    cleanupPeer();
    roleRef.current = null;
    setMatchRole(null);
    router.push(introHref ?? DEFAULT_INTRO);
  }

  const displayState = matchRole === "guest" ? guestView : hostView;
  const localIsBlue = matchRole === "host";
  const activeIsBlue = displayState?.abi;
  const isMyTurn =
    displayState?.phase === "moving" &&
    ((activeIsBlue && localIsBlue) || (!activeIsBlue && !localIsBlue));

  return (
    <div className={styles.shell}>
      <video className={styles.hidden} playsInline muted autoPlay ref={localVideoRef} />

      <header className={styles.topBar}>
        <span className={styles.brand}>BLINK STACKER DUEL</span>
        {localPhase === "arena" && displayState?.phase === "moving" ? (
          <div className={`${styles.turnPill} ${isMyTurn ? "" : styles.opponent}`}>
            {isMyTurn ? "YOUR TURN — BLINK TO STOP" : "OPPONENT'S TURN"}
          </div>
        ) : (
          <span />
        )}
      </header>

      <main className={styles.main}>
        {localPhase === "intro" ? (
          <div className={styles.lobbyPanel}>
            <p className={styles.lobbyTitle}>1v1 tower duel</p>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "rgba(226,232,240,0.88)" }}>
              Shared tower — blue vs red. Only the active player can stop the brick. First miss loses.
            </p>
            <button type="button" className={styles.btn} onClick={() => void findMatch()}>
              Find match
            </button>
            <button type="button" className={styles.btnGhost} onClick={() => router.push("/")}>
              GO HOME
            </button>
          </div>
        ) : null}

        {localPhase === "queue" || localPhase === "peer_setup" ? (
          <div className={styles.lobbyPanel}>
            <p className={styles.lobbyTitle}>{localPhase === "queue" ? "Matching…" : "Connecting…"}</p>
            <p style={{ margin: 0, fontSize: 13, color: "rgba(200,210,230,0.85)" }}>{status}</p>
          </div>
        ) : null}

        {localPhase === "arena" ? (
          <div ref={stageRef} className={`${styles.stage} ${uiShake ? styles.shake : ""}`}>
            <div className={styles.remoteShell}>
              <video ref={remoteVideoRef} className={styles.remote} playsInline autoPlay muted />
            </div>
            <canvas
              ref={canvasRef}
              className={styles.overlayCanvas}
              onClick={() => {
                if (isMyTurn) tryStopRef.current();
              }}
            />
            <div className={styles.pip}>
              <video ref={pipVideoRef} playsInline muted autoPlay className={styles.pipInner} />
            </div>

            {matchRole === "guest" && guestView == null ? (
              <div className={styles.layerUi}>
                <div className={styles.lobbyPanel}>
                  <p className={styles.lobbyTitle}>Connecting</p>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "rgba(200,210,230,0.9)" }}>
                    Syncing with host… If this lasts more than a few seconds, try leaving and finding a new match.
                  </p>
                </div>
              </div>
            ) : null}

            {displayState?.phase === "lobby" ? (
              <div className={styles.layerUi}>
                <div className={styles.lobbyPanel}>
                  <p className={styles.lobbyTitle}>Lobby</p>
                  <p style={{ margin: "0 0 8px", fontSize: 13 }}>Playing as {nameRef.current}</p>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: "rgba(180,190,210,0.85)" }}>
                    Opponent: {opponentName ?? "…"}
                  </p>
                  <p style={{ margin: "0 0 8px", fontSize: 12 }}>
                    You: {localIsBlue ? "BLUE" : "RED"} · Them: {localIsBlue ? "RED" : "BLUE"}
                  </p>
                  <button type="button" className={styles.btn} onClick={toggleReady}>
                    {localReady ? "Ready ✓" : "Ready"}
                  </button>
                  <p style={{ margin: "8px 0 0", fontSize: 11, color: "rgba(160,170,190,0.8)" }}>
                    Them: {remoteReady ? "Ready ✓" : "Waiting"}
                  </p>
                </div>
              </div>
            ) : null}

            {displayState?.phase === "countdown" ? (
              <div className={styles.layerUi}>
                <div className={styles.count}>{displayState.cd ?? 3}</div>
              </div>
            ) : null}

            {displayState?.phase === "turn_banner" && displayState.banner ? (
              <div className={styles.layerUi}>
                <div className={styles.banner}>{displayState.banner}</div>
              </div>
            ) : null}

            {displayState?.phase === "ended" && displayState.loser ? (
              <div className={styles.layerUi}>
                <div className={styles.lobbyPanel}>
                  <p className={styles.endTitle}>
                    {displayState.loser === "blue"
                      ? localIsBlue
                        ? "YOU LOSE"
                        : "YOU WIN"
                      : localIsBlue
                        ? "YOU WIN"
                        : "YOU LOSE"}
                  </p>
                  <button type="button" className={styles.btn} onClick={rematch}>
                    Rematch
                  </button>
                  <button type="button" className={styles.btnGhost} onClick={leaveMatch}>
                    GO HOME
                  </button>
                </div>
              </div>
            ) : null}

            {showPerfect ? <div className={styles.perfect}>PERFECT</div> : null}
          </div>
        ) : null}
      </main>

      <GFBottomNav activeHref="/" />
    </div>
  );
}
