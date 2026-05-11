"use client";

import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import styles from "./FaceHockey.module.css";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import { createNoseTracker } from "@/lib/faceTracking";
import {
  cloneFaceHockeyState,
  initialFaceHockeyState,
  type FaceHockeyNetState,
  type GuestToHostFHMsg,
  type HostToGuestFHMsg,
} from "@/lib/facehockeyProtocol";
import {
  FH,
  guestMalletFromNoseVisual,
  hostMalletFromNose,
  hostStepPhysics,
} from "@/lib/facehockeyPhysics";

const QUEUE_POLL_MS = 600;
const WIN_SCORE = 3;
const FH_UI_DEBUG = process.env.NODE_ENV === "development";

type UiPhase = "menu" | "matchmaking" | "lobby" | "playing" | "gameover";
type Role = "host" | "guest";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function makeClientId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const k = "facearcade-fh-id";
  let id = window.sessionStorage.getItem(k);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(k, id);
  }
  return id;
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
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("connect timeout")), 12000),
        ),
      ]);
      return conn;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not connect to opponent.");
}

function nowMs() {
  return performance.now();
}

export default function FaceHockey() {
  const clientId = useMemo(() => makeClientId(), []);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [uiPhase, setUiPhase] = useState<UiPhase>("menu");
  const uiPhaseRef = useRef<UiPhase>("menu");
  useEffect(() => {
    uiPhaseRef.current = uiPhase;
  }, [uiPhase]);

  const [status, setStatus] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [micOk, setMicOk] = useState<boolean | null>(null);

  const roleRef = useRef<Role | null>(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const peerRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const destroyRef = useRef<null | (() => void)>(null);
  const matchPollRef = useRef<number | null>(null);

  const hostStateRef = useRef<FaceHockeyNetState>(initialFaceHockeyState());
  const hostSeqRef = useRef(0);
  const guestMalletRef = useRef({ x: 0.5, y: 0.22 });
  const prevMalletARef = useRef({ x: 0.5, y: 0.78 });
  const prevMalletBRef = useRef({ x: 0.5, y: 0.22 });

  const localNoseRef = useRef({ x: 0.5, y: 0.5 });
  const rallyStartMsRef = useRef<number | null>(null);

  const lastGuestSeqRef = useRef(-1);
  const lastStateRecvAtRef = useRef<number | null>(null);
  const lastSentAtRef = useRef<number | null>(null);
  const lastAuthSentAtFromHostRef = useRef<number | null>(null);
  const lastAuthoritativeWallClockRef = useRef<number | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);

  const scheduledTimersRef = useRef<number[]>([]);

  const [, bumpView] = useReducer((x: number) => x + 1, 0);
  const [, bumpLobby] = useReducer((x: number) => x + 1, 0);

  const [, setUiDebugTick] = useState(0);
  useEffect(() => {
    if (!FH_UI_DEBUG) return;
    const id = window.setInterval(() => setUiDebugTick((x) => x + 1), 200);
    return () => window.clearInterval(id);
  }, []);

  function clearScheduledTimers() {
    for (const id of scheduledTimersRef.current) window.clearTimeout(id);
    scheduledTimersRef.current = [];
  }

  function setCanvasSize() {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const rect = frame.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }

  async function ensureLocalCamera(opts?: { force?: boolean }) {
    if (localStreamRef.current && !opts?.force) {
      const hasAudio = localStreamRef.current.getAudioTracks().length > 0;
      setMicOk(hasAudio);
      return localStreamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: {
        facingMode: "user",
        width: { ideal: 480, max: 640 },
        height: { ideal: 480, max: 640 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
    localStreamRef.current = stream;
    setMicOk(stream.getAudioTracks().length > 0);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      await localVideoRef.current.play();
    }
    return stream;
  }

  const localStreamRef = useRef<MediaStream | null>(null);

  async function leaveQueue() {
    try {
      await fetch("/api/facehockey/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, action: "leave" }),
      });
    } catch {
      /* ignore */
    }
  }

  function cleanup() {
    clearScheduledTimers();
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    void leaveQueue();
    destroyRef.current?.();
    destroyRef.current = null;
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch {
        /* ignore */
      }
    }
    peerRef.current = null;
    dataRef.current = null;
    remotePeerIdRef.current = null;
    lastSentAtRef.current = null;
    lastAuthSentAtFromHostRef.current = null;
    const s = localStreamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
    localStreamRef.current = null;
    hostStateRef.current = initialFaceHockeyState();
    guestMalletRef.current = { x: 0.5, y: 0.22 };
    rallyStartMsRef.current = null;
  }

  function sendToGuest(msg: HostToGuestFHMsg) {
    const c = dataRef.current;
    if (c?.open) c.send(msg);
  }

  function sendToHost(msg: GuestToHostFHMsg) {
    const c = dataRef.current;
    if (c?.open) c.send(msg);
  }

  function broadcastAuthoritativeState() {
    if (roleRef.current !== "host") return;
    hostSeqRef.current += 1;
    const sentAt = performance.now();
    lastSentAtRef.current = sentAt;
    sendToGuest({
      t: "fh_state",
      state: cloneFaceHockeyState(hostStateRef.current),
      seq: hostSeqRef.current,
      sentAt,
    });
    lastAuthoritativeWallClockRef.current = Date.now();
    bumpView();
  }

  function resetPuckCenter(s: FaceHockeyNetState) {
    s.puck = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
  }

  function servePuck(s: FaceHockeyNetState) {
    const vx = (Math.random() - 0.5) * 0.38;
    const vy = (Math.random() > 0.5 ? 1 : -1) * (0.28 + Math.random() * 0.12);
    s.puck = { x: 0.5, y: 0.5, vx, vy };
    s.puckFrozen = false;
    rallyStartMsRef.current = nowMs();
  }

  /** Opening face-off or goal restart — same 3·2·1·GO chain (host-only timers). */
  function scheduleFaceOff(afterGoal: boolean, scorer?: "A" | "B") {
    clearScheduledTimers();
    const s = hostStateRef.current;
    resetPuckCenter(s);
    s.puckFrozen = true;

    if (afterGoal && scorer) {
      s.overlay = { kind: "goal", scorer };
      broadcastAuthoritativeState();
      const tFlash = window.setTimeout(() => {
        s.overlay = { kind: "count", n: 3 };
        broadcastAuthoritativeState();
      }, 1400);
      scheduledTimersRef.current.push(tFlash);
    } else {
      s.overlay = { kind: "count", n: 3 };
      broadcastAuthoritativeState();
    }

    const baseDelay = afterGoal ? 1400 : 0;

    const steps = [
      { delay: baseDelay + 1000, overlay: { kind: "count" as const, n: 2 } },
      { delay: baseDelay + 2000, overlay: { kind: "count" as const, n: 1 } },
      { delay: baseDelay + 3000, overlay: { kind: "go" as const } },
      {
        delay: baseDelay + 3800,
        overlay: { kind: "none" as const },
        serve: true,
      },
    ];

    for (const step of steps) {
      const tid = window.setTimeout(() => {
        if (step.serve) {
          servePuck(hostStateRef.current);
          hostStateRef.current.overlay = { kind: "none" };
        } else if ("n" in step.overlay || step.overlay.kind === "go") {
          hostStateRef.current.overlay = step.overlay as FaceHockeyNetState["overlay"];
        }
        broadcastAuthoritativeState();
      }, step.delay);
      scheduledTimersRef.current.push(tid);
    }
  }

  function hostHandleGoal(who: "A" | "B") {
    const s = hostStateRef.current;
    if (who === "A") s.scoreA += 1;
    else s.scoreB += 1;

    if (s.scoreA >= WIN_SCORE || s.scoreB >= WIN_SCORE) {
      s.phase = "gameover";
      s.winner = s.scoreA >= WIN_SCORE ? "A" : "B";
      s.puckFrozen = true;
      resetPuckCenter(s);
      s.overlay = { kind: "none" };
      broadcastAuthoritativeState();
      setUiPhase("gameover");
      clearScheduledTimers();
      return;
    }

    scheduleFaceOff(true, who);
  }

  function hostTick(dt: number) {
    const s = hostStateRef.current;
    if (s.phase !== "playing" || s.puckFrozen) return;

    const ma = hostMalletFromNose(localNoseRef.current.x, localNoseRef.current.y);
    const mb = guestMalletRef.current;

    const rallySec =
      rallyStartMsRef.current != null ? (nowMs() - rallyStartMsRef.current) / 1000 : 0;

    const pa = { ...prevMalletARef.current };
    const pb = { ...prevMalletBRef.current };

    const before = cloneFaceHockeyState(s);
    const canvas = canvasRef.current;
    const wy =
      canvas && canvas.width > 0 ? canvas.height / canvas.width : FH.PLAYFIELD_H_OVER_W;
    const hit = hostStepPhysics(s, dt, ma, mb, pa, pb, rallySec, wy);

    prevMalletARef.current = { ...ma };
    prevMalletBRef.current = { ...mb };

    if (hit.goal) {
      Object.assign(s.puck, before.puck);
      hostHandleGoal(hit.goal);
      return;
    }
  }

  function hostResetLobby() {
    clearScheduledTimers();
    hostStateRef.current = initialFaceHockeyState();
    rallyStartMsRef.current = null;
    prevMalletARef.current = { x: 0.5, y: 0.78 };
    prevMalletBRef.current = { x: 0.5, y: 0.22 };
    broadcastAuthoritativeState();
  }

  function hostTryStartWhenBothReady() {
    if (roleRef.current !== "host") return;
    const s = hostStateRef.current;
    if (s.phase !== "lobby") return;
    if (s.ready.host && s.ready.guest) {
      hostBeginMatch();
    }
  }

  function hostBeginMatch() {
    const s = hostStateRef.current;
    if (!s.ready.host || !s.ready.guest) return;
    s.phase = "playing";
    s.scoreA = 0;
    s.scoreB = 0;
    s.winner = null;
    s.ready = { host: false, guest: false };
    resetPuckCenter(s);
    s.puckFrozen = true;
    s.overlay = { kind: "none" };
    broadcastAuthoritativeState();
    setUiPhase("playing");
    scheduleFaceOff(false);
  }

  function toggleReady() {
    if (!opponentConnected || uiPhaseRef.current !== "lobby") return;
    if (role === "host") {
      hostStateRef.current.ready.host = !hostStateRef.current.ready.host;
      broadcastAuthoritativeState();
      bumpLobby();
      hostTryStartWhenBothReady();
    } else if (role === "guest") {
      sendToHost({ t: "fh_ready", ready: !hostStateRef.current.ready.guest });
    }
  }

  function getDrawState(): FaceHockeyNetState {
    return hostStateRef.current;
  }

  function draw(state: FaceHockeyNetState) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const ui = uiPhaseRef.current;
    if (ui === "menu" || ui === "matchmaking" || ui === "lobby") {
      return;
    }

    const sx = (x: number) => x * w;
    const sy = (y: number) => y * h;

    /* Light tint only — keep webcam feeds readable through the overlay */
    ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
    ctx.fillRect(0, 0, w, h);

    const inset = FH.WALL_INSET;
    ctx.strokeStyle = "rgba(120, 255, 220, 0.35)";
    ctx.lineWidth = Math.max(2, w * 0.008);
    const railR = Math.min(w, h) * FH.CORNER_FILLET_R;
    const ri = sx(1 - 2 * inset);
    const railH = sy(1 - 2 * inset);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(sx(inset), sy(inset), ri, railH, railR);
    } else {
      ctx.rect(sx(inset), sy(inset), ri, railH);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath();
    ctx.moveTo(sx(inset), sy(0.5));
    ctx.lineTo(sx(1 - inset), sy(0.5));
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sx(0.5), sy(0.5), Math.min(w, h) * 0.11, 0, Math.PI * 2);
    ctx.stroke();

    const gh = FH.GOAL_HALF_W;
    ctx.strokeStyle = "rgba(255, 90, 120, 0.55)";
    ctx.lineWidth = Math.max(2, w * 0.01);
    ctx.beginPath();
    ctx.moveTo(sx(0.5 - gh), sy(inset));
    ctx.lineTo(sx(0.5 + gh), sy(inset));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx(0.5 - gh), sy(1 - inset));
    ctx.lineTo(sx(0.5 + gh), sy(1 - inset));
    ctx.stroke();

    /** Pixel radius from normalized r01 — true circles on screen (use min dimension). */
    const rPx = (r01: number) => r01 * Math.min(w, h);

    const drawDisc = (mx: number, my: number, r01: number, col: string) => {
      const rad = rPx(r01);
      ctx.beginPath();
      ctx.fillStyle = col;
      ctx.arc(sx(mx), sy(my), rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(1, w * 0.004);
      ctx.stroke();
    };

    drawDisc(state.malletB.x, state.malletB.y, FH.MALLET_R, "rgba(95, 165, 255, 0.92)");
    drawDisc(state.malletA.x, state.malletA.y, FH.MALLET_R, "rgba(255, 92, 92, 0.92)");

    const pr = rPx(FH.PUCK_R);
    ctx.shadowColor = "rgba(100, 220, 255, 0.65)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.fillStyle = "rgba(245, 250, 255, 0.98)";
    ctx.arc(sx(state.puck.x), sy(state.puck.y), pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (state.overlay.kind === "goal") {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = `900 ${Math.round(w * 0.09)}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("GOAL!", sx(0.5), sy(0.52));
    } else if (state.overlay.kind === "count") {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = `900 ${Math.round(w * 0.14)}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(String(state.overlay.n), sx(0.5), sy(0.52));
    } else if (state.overlay.kind === "go") {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#7aedff";
      ctx.font = `900 ${Math.round(w * 0.11)}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("GO!", sx(0.5), sy(0.52));
    }
  }

  async function connectAsHost(desiredRoomId: string) {
    cleanup();
    setStatus("Creating room…");
    setRole("host");
    setOpponentConnected(false);
    hostResetLobby();

    const stream = await ensureLocalCamera({ force: true });
    const nose = await createNoseTracker();
    destroyRef.current = nose.start({
      videoEl: localVideoRef.current!,
      onNoseXY: (x, y) => {
        localNoseRef.current = { x, y };
      },
    });

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
    setStatus("Waiting for opponent…");

    peer.on("call", (call: any) => {
      call.answer(stream);
      call.on("stream", (remoteStream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play();
        }
      });
    });

    const conn = await waitForHostConnection(peer);
    dataRef.current = conn;
    remotePeerIdRef.current = typeof conn.peer === "string" ? conn.peer : null;
    setOpponentConnected(true);
    setStatus("Opponent connected");

    conn.on("data", (raw: unknown) => {
      const msg = raw as GuestToHostFHMsg;
      if (msg.t === "fh_mallet") {
        guestMalletRef.current = { x: clamp(msg.x, 0, 1), y: clamp(msg.y, 0, 1) };
      } else if (msg.t === "fh_ready") {
        hostStateRef.current.ready.guest = msg.ready;
        broadcastAuthoritativeState();
        bumpLobby();
        hostTryStartWhenBothReady();
      } else if (msg.t === "fh_play_again") {
        hostResetLobby();
        setUiPhase("lobby");
      }
    });

    conn.on("open", () => {
      broadcastAuthoritativeState();
    });
  }

  async function connectAsGuest(rid: string) {
    cleanup();
    lastGuestSeqRef.current = -1;
    lastAuthSentAtFromHostRef.current = null;
    setStatus("Joining…");
    setRole("guest");
    setOpponentConnected(false);
    setRoomId(rid);

    const stream = await ensureLocalCamera({ force: true });
    const nose = await createNoseTracker();
    destroyRef.current = nose.start({
      videoEl: localVideoRef.current!,
      onNoseXY: (x, y) => {
        localNoseRef.current = { x, y };
        const m = guestMalletFromNoseVisual(x, y);
        sendToHost({ t: "fh_mallet", x: m.x, y: m.y });
      },
    });

    const peer = await createGuestPeer();
    peerRef.current = peer;

    guestAnswerCalls(peer, stream, (incoming) => {
      incoming.on("stream", (remoteStream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play();
        }
      });
    });

    const conn = await connectGuestWithRetry(peer, rid);
    dataRef.current = conn;
    remotePeerIdRef.current = typeof conn.peer === "string" ? conn.peer : null;
    setOpponentConnected(true);
    setStatus("Opponent connected");

    conn.on("data", (raw: unknown) => {
      const msg = raw as HostToGuestFHMsg;
      if (msg.t === "fh_state") {
        if (msg.seq <= lastGuestSeqRef.current) return;
        lastGuestSeqRef.current = msg.seq;
        lastStateRecvAtRef.current = performance.now();
        hostStateRef.current = cloneFaceHockeyState(msg.state);
        lastAuthSentAtFromHostRef.current = msg.sentAt;
        lastAuthoritativeWallClockRef.current = Date.now();
        bumpView();
        guestMalletRef.current = { ...hostStateRef.current.malletB };
        if (msg.state.phase === "playing") setUiPhase("playing");
        if (msg.state.phase === "gameover") setUiPhase("gameover");
        if (msg.state.phase === "lobby") setUiPhase("lobby");
      }
    });

    const call = peer.call(rid, stream);
    call.on("stream", (remoteStream: MediaStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        void remoteVideoRef.current.play();
      }
    });
  }

  async function applyMatch(peerRoomId: string, r: Role) {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    setStatus("Connecting…");
    try {
      if (r === "host") {
        await connectAsHost(peerRoomId);
      } else {
        await connectAsGuest(peerRoomId);
      }
      setUiPhase("lobby");
      setStatus("Opponent connected.");
    } catch {
      cleanup();
      setStatus("Connection failed.");
      setUiPhase("menu");
    }
  }

  async function findMatch() {
    setUiPhase("matchmaking");
    setStatus("Searching…");

    const res = await fetch("/api/facehockey/queue", {
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
      const r = await fetch(`/api/facehockey/queue?clientId=${encodeURIComponent(clientId)}`);
      const j = await r.json();
      if (j.matched) {
        if (matchPollRef.current) clearInterval(matchPollRef.current);
        matchPollRef.current = null;
        await applyMatch(j.peerRoomId as string, j.role as Role);
      }
    }, QUEUE_POLL_MS);
  }

  function cancelMatchmaking() {
    if (matchPollRef.current) {
      clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    void leaveQueue();
    setUiPhase("menu");
    setStatus("");
  }

  function playAgain() {
    if (role === "host") {
      hostResetLobby();
      setUiPhase("lobby");
    } else {
      sendToHost({ t: "fh_play_again" });
    }
  }

  useEffect(() => {
    setCanvasSize();
    window.addEventListener("resize", setCanvasSize);
    return () => window.removeEventListener("resize", setCanvasSize);
  }, []);

  useEffect(() => {
    let raf: number | null = null;
    let last = nowMs();

    const loop = () => {
      const n = nowMs();
      const dt = clamp((n - last) / 1000, 0, 0.05);
      last = n;

      const isHost = roleRef.current === "host";
      const playing = uiPhaseRef.current === "playing";

      if (isHost && opponentConnected && playing && hostStateRef.current.phase === "playing") {
        hostTick(dt);
        broadcastAuthoritativeState();
      }

      draw(getDrawState());

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, opponentConnected]);

  const gs = hostStateRef.current;
  const showMenu = uiPhase === "menu";
  const showMm = uiPhase === "matchmaking";
  const showLobby = uiPhase === "lobby";
  const showGameOver = uiPhase === "gameover";

  const visualPerspective =
    role === "host"
      ? "A: canonical canvas, local bottom"
      : role === "guest"
        ? "B: canvas rotate 180°; mallet sent canonical (mapped)"
        : "—";

  const myScore = role === "host" ? gs.scoreA : role === "guest" ? gs.scoreB : 0;
  const theirScore = role === "host" ? gs.scoreB : role === "guest" ? gs.scoreA : 0;

  return (
    <main className={styles.root}>
      <div ref={frameRef} className={styles.frame}>
        <div className={`${styles.half} ${styles.topHalf}`}>
          <video ref={remoteVideoRef} className={styles.videoRemote} playsInline autoPlay />
        </div>
        <div className={`${styles.half} ${styles.bottomHalf}`}>
          <video ref={localVideoRef} className={styles.videoLocal} playsInline muted autoPlay />
        </div>

        <canvas
          ref={canvasRef}
          className={role === "guest" ? `${styles.canvas} ${styles.canvasRotate180}` : styles.canvas}
        />

        {role && opponentConnected ? (
          <>
            <div className={`${styles.playerTag} ${styles.playerTagTop}`} title="Opponent feed">
              {role === "host" ? "Player B · opponent" : "Player A · opponent"}
            </div>
            <div className={`${styles.playerTag} ${styles.playerTagBottom}`} title="Your feed">
              {role === "host" ? "Player A · you" : "Player B · you"}
            </div>
          </>
        ) : null}

        <div className={styles.scoreHud} aria-live="polite">
          <span className={styles.scoreSide}>A</span>
          <span className={styles.scoreNumCompact}>{gs.scoreA}</span>
          <span className={styles.scoreDot}>·</span>
          <span className={styles.scoreNumCompact}>{gs.scoreB}</span>
          <span className={styles.scoreSide}>B</span>
        </div>

        {FH_UI_DEBUG ? (
          <div className={styles.debugHud}>
            <div>amIHost: {role === "host" ? "true" : role === "guest" ? "false" : "—"}</div>
            <div>
              myRole: {role === "host" ? "Player A" : role === "guest" ? "Player B" : "—"}
            </div>
            <div>visualPerspective: {visualPerspective}</div>
            <div>
              puck: {gs.puck.x.toFixed(3)}, {gs.puck.y.toFixed(3)}
            </div>
            <div>
              localMallet (canonical):{" "}
              {role === "host"
                ? `${hostMalletFromNose(localNoseRef.current.x, localNoseRef.current.y).x.toFixed(3)}, ${hostMalletFromNose(localNoseRef.current.x, localNoseRef.current.y).y.toFixed(3)}`
                : `${guestMalletFromNoseVisual(localNoseRef.current.x, localNoseRef.current.y).x.toFixed(3)}, ${guestMalletFromNoseVisual(localNoseRef.current.x, localNoseRef.current.y).y.toFixed(3)}`}
            </div>
            <div>
              remoteMallet:{" "}
              {role === "host"
                ? `${gs.malletB.x.toFixed(3)}, ${gs.malletB.y.toFixed(3)}`
                : `${gs.malletA.x.toFixed(3)}, ${gs.malletA.y.toFixed(3)}`}
            </div>
            <div>roomCreatorId: {roomId ?? "—"}</div>
            <div>
              last auth perf.now (host sent / guest recv):{" "}
              {role === "host"
                ? lastSentAtRef.current?.toFixed(1) ?? "—"
                : lastStateRecvAtRef.current?.toFixed(1) ?? "—"}
            </div>
            <div>
              last authoritative wall clock:{" "}
              {lastAuthoritativeWallClockRef.current != null
                ? new Date(lastAuthoritativeWallClockRef.current).toISOString()
                : "—"}
            </div>
          </div>
        ) : null}

        {showMenu || showMm ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>FaceHockey</div>
              {showMm ? (
                <>
                  <button type="button" className={styles.buttonSecondary} onClick={cancelMatchmaking}>
                    Cancel
                  </button>
                  <div className={styles.status}>{status}</div>
                </>
              ) : (
                <>
                  <button type="button" className={styles.button} onClick={() => void findMatch()}>
                    Find Match
                  </button>
                  <div className={styles.status}>{status}</div>
                </>
              )}
              {micOk === false ? (
                <div className={styles.status}>Enable microphone for voice chat.</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {showLobby ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>Lobby</div>
              <div className={styles.sub}>Ready up to start game.</div>
              <div className={styles.subMuted}>First to {WIN_SCORE} goals wins.</div>
              {opponentConnected ? (
                <div className={styles.subMuted}>
                  {role === "host"
                    ? gs.ready.guest
                      ? "Opponent is ready."
                      : "Waiting for opponent to ready up…"
                    : gs.ready.host
                      ? "Opponent is ready."
                      : "Waiting for opponent to ready up…"}
                </div>
              ) : null}
              {opponentConnected ? (
                <button
                  type="button"
                  className={
                    (role === "host" ? gs.ready.host : gs.ready.guest) ? styles.buttonReady : styles.button
                  }
                  onClick={toggleReady}
                >
                  {(role === "host" ? gs.ready.host : gs.ready.guest) ? "READY ✓" : "READY"}
                </button>
              ) : null}
              <div className={styles.status}>{status}</div>
            </div>
          </div>
        ) : null}

        {showGameOver ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>
                {gs.winner === (role === "host" ? "A" : "B") ? "You Win!" : "You Lost"}
              </div>
              <div className={styles.sub}>
                Score: {myScore} — {theirScore}
              </div>
              <button type="button" className={styles.button} onClick={playAgain}>
                Play Again
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
