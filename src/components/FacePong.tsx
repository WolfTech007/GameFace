import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./FacePong.module.css";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
  type FacePongNetState,
  type GuestToHostMsg,
  type HostToGuestMsg,
} from "@/lib/peerRoom";
import { createNoseTracker } from "@/lib/faceTracking";

const QUEUE_POLL_MS = 600;

/** Set `true` briefly to verify net sync (host authority, seq, timestamps). Production: keep `false`. */
const FP_NET_DEBUG = false;

type UiPhase = "menu" | "matchmaking" | "lobby" | "playing" | "gameover";
type Role = "host" | "guest";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function makeClientId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const k = "facearcade-fp-id";
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

function makeInitialNetState(): FacePongNetState {
  return {
    phase: "lobby",
    rallyScore: 0,
    ball: { x: 0.5, y: 0.5, vx: 0.0, vy: 0.0 },
    paddles: { hostX: 0.5, guestX: 0.5 },
  };
}

function cloneNetState(s: FacePongNetState): FacePongNetState {
  return {
    phase: s.phase,
    rallyScore: s.rallyScore,
    ball: { ...s.ball },
    paddles: { ...s.paddles },
  };
}

/** Guest-only: interpolate between last two authoritative snapshots for smooth rendering (does not run physics). */
function blendNetState(a: FacePongNetState, b: FacePongNetState, u: number): FacePongNetState {
  const t = clamp(u, 0, 1);
  return {
    phase: b.phase,
    rallyScore: b.rallyScore,
    ball: {
      x: lerp(a.ball.x, b.ball.x, t),
      y: lerp(a.ball.y, b.ball.y, t),
      vx: lerp(a.ball.vx, b.ball.vx, t),
      vy: lerp(a.ball.vy, b.ball.vy, t),
    },
    paddles: {
      hostX: lerp(a.paddles.hostX, b.paddles.hostX, t),
      guestX: lerp(a.paddles.guestX, b.paddles.guestX, t),
    },
  };
}

function nowMs() {
  return performance.now();
}

type GuestSnap = { state: FacePongNetState; seq: number; recvAt: number };

export default function FacePong() {
  const clientId = useMemo(() => makeClientId(), []);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [uiPhase, setUiPhase] = useState<UiPhase>("menu");
  const [role, setRole] = useState<Role | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Idle");
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [rallyScore, setRallyScore] = useState(0);
  const [micOk, setMicOk] = useState<boolean | null>(null);

  const roleRef = useRef<Role | null>(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const peerRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const destroyRef = useRef<null | (() => void)>(null);
  const matchPollRef = useRef<number | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const hostStateRef = useRef<FacePongNetState>(makeInitialNetState());
  /** Monotonic per session; reset when host resets lobby state so guest can accept new epochs. */
  const hostSeqRef = useRef(0);
  const guestPaddleXRef = useRef(0.5);
  const lastHostTickRef = useRef(0);
  const hostStartedAtRef = useRef<number | null>(null);

  const localNoseXRef = useRef(0.5);
  const smoothedLocalPaddleRef = useRef(0.5);

  /** Guest-only: last two snapshots for render interpolation (physics never run here). */
  const guestSnapPrevRef = useRef<GuestSnap | null>(null);
  const guestSnapCurrRef = useRef<GuestSnap | null>(null);
  const lastGuestSeqRef = useRef(-1);
  const lastStateRecvAtRef = useRef<number | null>(null);
  const lastSentAtRef = useRef<number | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);

  const [, setNetDebugTick] = useState(0);
  useEffect(() => {
    if (!FP_NET_DEBUG) return;
    const id = window.setInterval(() => setNetDebugTick((x) => x + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  function setCanvasSize() {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const rect = parent.getBoundingClientRect();
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
        width: { ideal: 720 },
        height: { ideal: 1280 },
        frameRate: { ideal: 60, max: 60 },
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

  async function leaveQueue() {
    try {
      await fetch("/api/facepong/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, action: "leave" }),
      });
    } catch {
      /* ignore */
    }
  }

  function cleanup() {
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
        // ignore
      }
    }
    peerRef.current = null;
    dataRef.current = null;
    remotePeerIdRef.current = null;
    lastSentAtRef.current = null;

    const s = localStreamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
    localStreamRef.current = null;
  }

  function sendToHost(msg: GuestToHostMsg) {
    const conn = dataRef.current;
    if (conn && conn.open) conn.send(msg);
  }

  function sendToGuest(msg: HostToGuestMsg) {
    const conn = dataRef.current;
    if (conn && conn.open) conn.send(msg);
  }

  /** Host-only authoritative snapshot (seq + timestamp for guest interpolation / debug). */
  function broadcastAuthoritativeState() {
    if (roleRef.current !== "host") return;
    hostSeqRef.current += 1;
    const sentAt = performance.now();
    lastSentAtRef.current = sentAt;
    sendToGuest({
      t: "state",
      state: cloneNetState(hostStateRef.current),
      seq: hostSeqRef.current,
      sentAt,
    });
  }

  function hostResetState() {
    hostStateRef.current = makeInitialNetState();
    hostStartedAtRef.current = null;
    lastHostTickRef.current = 0;
    setRallyScore(0);
  }

  function hostStartGame() {
    const s = hostStateRef.current;
    s.phase = "playing";
    s.rallyScore = 0;
    s.ball = { x: 0.5, y: 0.5, vx: 0.0, vy: 0.22 }; // slow start downward
    s.paddles.hostX = smoothedLocalPaddleRef.current;
    s.paddles.guestX = guestPaddleXRef.current;
    hostStartedAtRef.current = nowMs();
    broadcastAuthoritativeState();
    setUiPhase("playing");
  }

  function hostTick(dt: number) {
    const s = hostStateRef.current;
    if (s.phase !== "playing") return;

    const elapsed = hostStartedAtRef.current ? (nowMs() - hostStartedAtRef.current) / 1000 : 0;
    const speed01 = clamp(elapsed / 20, 0, 1); // reach max at 20s
    const base = 0.22;
    const max = 0.62;
    const speed = lerp(base, max, speed01);

    // normalize velocity to target speed
    const mag = Math.hypot(s.ball.vx, s.ball.vy) || 1;
    s.ball.vx = (s.ball.vx / mag) * speed;
    s.ball.vy = (s.ball.vy / mag) * speed;

    // integrate
    s.ball.x += s.ball.vx * dt;
    s.ball.y += s.ball.vy * dt;

    // walls (left/right)
    if (s.ball.x < 0.02) {
      s.ball.x = 0.02;
      s.ball.vx *= -1;
    } else if (s.ball.x > 0.98) {
      s.ball.x = 0.98;
      s.ball.vx *= -1;
    }

    const paddleW = 0.26;
    const paddleYTop = 0.08;
    const paddleYBot = 0.92;

    // update paddles from latest controls
    s.paddles.hostX = smoothedLocalPaddleRef.current;
    s.paddles.guestX = guestPaddleXRef.current;

    // collide with top paddle (guest)
    if (s.ball.vy < 0 && s.ball.y <= paddleYTop + 0.02) {
      const px = s.paddles.guestX;
      if (Math.abs(s.ball.x - px) <= paddleW / 2) {
        // hit
        s.ball.y = paddleYTop + 0.02;
        s.ball.vy = Math.abs(s.ball.vy);
        const off = (s.ball.x - px) / (paddleW / 2);
        s.ball.vx += off * 0.18;
        s.rallyScore += 1;
      } else if (s.ball.y < 0) {
        s.phase = "gameover";
      }
    }

    // collide with bottom paddle (host)
    if (s.ball.vy > 0 && s.ball.y >= paddleYBot - 0.02) {
      const px = s.paddles.hostX;
      if (Math.abs(s.ball.x - px) <= paddleW / 2) {
        s.ball.y = paddleYBot - 0.02;
        s.ball.vy = -Math.abs(s.ball.vy);
        const off = (s.ball.x - px) / (paddleW / 2);
        s.ball.vx += off * 0.18;
        s.rallyScore += 1;
      } else if (s.ball.y > 1) {
        s.phase = "gameover";
      }
    }

    setRallyScore(s.rallyScore);
    if (s.phase === "gameover") {
      setUiPhase("gameover");
    }
  }

  /** Guest interpolates between last packets for smooth motion; host draws authoritative ref. */
  function getDrawState(): FacePongNetState {
    if (roleRef.current !== "guest") {
      return hostStateRef.current;
    }
    const prev = guestSnapPrevRef.current;
    const curr = guestSnapCurrRef.current;
    if (!curr) return hostStateRef.current;
    if (!prev || prev.recvAt === curr.recvAt) return curr.state;
    const now = performance.now();
    const interpDelayMs = 72;
    const target = now - interpDelayMs;
    let alpha = (target - prev.recvAt) / (curr.recvAt - prev.recvAt);
    if (!Number.isFinite(alpha)) alpha = 1;
    alpha = clamp(alpha, 0, 1);
    return blendNetState(prev.state, curr.state, alpha);
  }

  function draw(state: FacePongNetState) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Physics is host-centric: guest paddle at top (y≈0.08), host at bottom (y≈0.92).
    // Both players use guest-style screen mapping (bottom = you, flip Y like guest).
    const guestFlipped = true;
    const cy = (yPhys: number) => (guestFlipped ? 1 - yPhys : yPhys) * h;

    // subtle overlay
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(0,0,0,0.08)");
    grad.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // center line
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = Math.max(1, Math.round(w * 0.004));
    ctx.setLineDash([Math.max(6, Math.round(w * 0.03)), Math.max(6, Math.round(w * 0.03))]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const paddleW = w * 0.26;
    const paddleH = Math.max(10, Math.round(w * 0.03));
    const padR = Math.round(paddleH * 0.6);

    const paddleYTop = 0.08;
    const paddleYBot = 0.92;

    // Bottom half = local player; top half = opponent (same on both phones).
    const who = roleRef.current;
    const localX01 = who === "guest" ? state.paddles.guestX : state.paddles.hostX;
    const remoteX01 = who === "guest" ? state.paddles.hostX : state.paddles.guestX;
    const localX = localX01 * w;
    const remoteX = remoteX01 * w;

    // Local paddle: physics Y is top for guest, bottom for host — map to bottom of screen for both.
    const localCenterY = guestFlipped ? cy(paddleYTop) : cy(paddleYBot);
    const remoteCenterY = guestFlipped ? cy(paddleYBot) : cy(paddleYTop);

    // paddles
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    roundRect(ctx, localX - paddleW / 2, localCenterY - paddleH / 2, paddleW, paddleH, padR);
    ctx.fill();
    roundRect(ctx, remoteX - paddleW / 2, remoteCenterY - paddleH / 2, paddleW, paddleH, padR);
    ctx.fill();

    // ball
    const bx = state.ball.x * w;
    const by = cy(state.ball.y);
    const ballR = Math.max(6, Math.round(w * 0.018));
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.arc(bx, by, ballR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "rgba(130, 220, 255, 0.18)";
    ctx.arc(bx, by, ballR * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  async function connectAsHost(desiredRoomId: string) {
    cleanup();
    setStatus("Creating room…");
    setRole("host");
    setOpponentConnected(false);
    hostResetState();

    const stream = await ensureLocalCamera({ force: true });
    const nose = await createNoseTracker();
    destroyRef.current = nose.start({
      videoEl: localVideoRef.current!,
      mirrorSelfie: true,
      onNoseX: (x01) => {
        localNoseXRef.current = x01;
        smoothedLocalPaddleRef.current = x01;
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

    conn.on("data", (raw: any) => {
      const msg = raw as GuestToHostMsg;
      if (msg.t === "paddle") guestPaddleXRef.current = clamp(msg.x01, 0, 1);
    });

    conn.on("open", () => {
      conn.send({ t: "hello", roomId: rid } satisfies HostToGuestMsg);
    });
  }

  async function connectAsGuest(rid: string) {
    cleanup();
    lastGuestSeqRef.current = -1;
    guestSnapPrevRef.current = null;
    guestSnapCurrRef.current = null;
    setStatus("Joining…");
    setRole("guest");
    setOpponentConnected(false);
    setRoomId(rid);

    const stream = await ensureLocalCamera({ force: true });
    const nose = await createNoseTracker();
    destroyRef.current = nose.start({
      videoEl: localVideoRef.current!,
      mirrorSelfie: true,
      onNoseX: (x01) => {
        localNoseXRef.current = x01;
        smoothedLocalPaddleRef.current = x01;
        sendToHost({ t: "paddle", x01 });
      },
    });

    const peer = await createGuestPeer();
    peerRef.current = peer;

    const conn = await connectGuestWithRetry(peer, rid);
    dataRef.current = conn;
    remotePeerIdRef.current = typeof conn.peer === "string" ? conn.peer : null;
    setOpponentConnected(true);
    setStatus("Opponent connected");

    conn.on("data", (raw: any) => {
      const msg = raw as HostToGuestMsg;
      if (msg.t === "state") {
        if (msg.seq <= lastGuestSeqRef.current) return;
        lastGuestSeqRef.current = msg.seq;
        lastStateRecvAtRef.current = performance.now();

        const authoritative = cloneNetState(msg.state);
        hostStateRef.current = authoritative;

        const recvAt = performance.now();
        if (msg.state.phase === "lobby") {
          guestSnapPrevRef.current = null;
          guestSnapCurrRef.current = { state: authoritative, seq: msg.seq, recvAt };
        } else {
          guestSnapPrevRef.current = guestSnapCurrRef.current;
          guestSnapCurrRef.current = { state: authoritative, seq: msg.seq, recvAt };
        }

        setRallyScore(msg.state.rallyScore);
        if (msg.state.phase === "playing") setUiPhase("playing");
        if (msg.state.phase === "gameover") setUiPhase("gameover");
      }
    });

    const call = peer.call(rid, stream);
    call.on("stream", (remoteStream: MediaStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        void remoteVideoRef.current.play();
      }
    });

    guestAnswerCalls(peer, stream, (incoming) => {
      incoming.on("stream", (remoteStream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play();
        }
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
      if (r === "host") {
        await connectAsHost(peerRoomId);
      } else {
        await connectAsGuest(peerRoomId);
      }
      setUiPhase("lobby");
    } catch {
      cleanup();
      setStatus("Connection failed. Try again.");
      setUiPhase("menu");
    }
  }

  async function findMatch() {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    setStatus("Searching for opponent…");
    setUiPhase("matchmaking");

    const res = await fetch("/api/facepong/queue", {
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
      const r = await fetch(`/api/facepong/queue?clientId=${encodeURIComponent(clientId)}`);
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

  function cancelMatchmaking() {
    if (matchPollRef.current) {
      window.clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
    void leaveQueue();
    setUiPhase("menu");
    setStatus("Idle");
  }

  function onPlayAgain() {
    if (role === "host") {
      hostResetState();
      setUiPhase("lobby");
      broadcastAuthoritativeState();
    } else {
      setUiPhase("lobby");
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

      // Host: sole physics + collision + score + game over. Broadcast ~display rate (raf ≈ 60 Hz).
      if (roleRef.current === "host" && opponentConnected) {
        if (!lastHostTickRef.current) lastHostTickRef.current = n;
        hostTick(dt);
        broadcastAuthoritativeState();
      }

      // Guest must not simulate; render interpolated authoritative state from host.
      draw(getDrawState());

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, opponentConnected]);

  const canStart = role === "host" && opponentConnected && uiPhase === "lobby";
  const showMenu = uiPhase === "menu";
  const showMatchmaking = uiPhase === "matchmaking";
  const showLobby = uiPhase === "lobby";
  const showGameOver = uiPhase === "gameover";

  return (
    <main className={styles.root}>
      <div className={styles.frame}>
        <div className={`${styles.half} ${styles.topHalf}`}>
          <video
            ref={remoteVideoRef}
            className={`${styles.video} ${styles.opponentVideo}`}
            playsInline
            autoPlay
          />
        </div>
        <div className={`${styles.half} ${styles.bottomHalf}`}>
          <video
            ref={localVideoRef}
            className={styles.video}
            playsInline
            muted
            autoPlay
          />
        </div>

        <canvas ref={canvasRef} className={styles.canvas} />

        <div className={styles.hud}>
          <div className={styles.pill}>Rally: {rallyScore}</div>
          <div className={styles.pill}>
            FacePong {opponentConnected ? "• 2P" : "• 1P"}
          </div>
        </div>

        {FP_NET_DEBUG ? (
          <div className={styles.debugNet}>
            <div>auth host: {role === "host" ? "yes" : "no"}</div>
            <div>local id: {clientId.slice(0, 10)}…</div>
            <div>room: {roomId ?? "—"}</div>
            <div>remote peer: {remotePeerIdRef.current ?? "—"}</div>
            <div>
              seq: {role === "host" ? hostSeqRef.current : lastGuestSeqRef.current} · sent{" "}
              {lastSentAtRef.current?.toFixed(0) ?? "—"} · recv {lastStateRecvAtRef.current?.toFixed(0) ?? "—"}
            </div>
          </div>
        ) : null}

        {showMenu || showMatchmaking ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>FacePong</div>
              {showMatchmaking ? (
                <>
                  <div className={styles.sub}>Searching for an opponent…</div>
                  <div className={styles.row}>
                    <button
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      type="button"
                      onClick={cancelMatchmaking}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.sub}>
                    Match with the next available player (same queue style as Staring Contest).
                  </div>
                  <div className={styles.row}>
                    <button className={styles.button} type="button" onClick={() => void findMatch()}>
                      Find Match
                    </button>
                  </div>
                </>
              )}
              <div className={styles.status}>{status}</div>
              {micOk === false ? (
                <div className={styles.status}>
                  Mic blocked (no audio track). Enable Microphone for this site in iOS Safari settings, then try again.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {showLobby ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>FacePong Lobby</div>
              <div className={styles.sub}>
                {opponentConnected ? "Opponent connected." : "Waiting for opponent…"}
              </div>

              <div className={styles.row}>
                {canStart ? (
                  <button className={styles.button} onClick={hostStartGame}>
                    Start Game
                  </button>
                ) : null}
              </div>

              <div className={styles.row2}>
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => {
                    cleanup();
                    setUiPhase("menu");
                    setRole(null);
                    setRoomId(null);
                    setOpponentConnected(false);
                    setStatus("Idle");
                  }}
                >
                  Back
                </button>
              </div>
              <div className={styles.status}>{status}</div>
              {micOk === false ? (
                <div className={styles.status}>
                  Mic blocked (no audio track). Enable Microphone for this site in iOS Safari settings, then try again.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {showGameOver ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>Game Over</div>
              <div className={styles.sub}>Score: {rallyScore}</div>
              <div className={styles.row}>
                <button className={styles.button} onClick={onPlayAgain}>
                  Play Again
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

