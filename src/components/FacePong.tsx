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

/** Canonical world / net debug overlay (Player A=host bottom, Player B=guest top). */
const FP_WORLD_DEBUG = true;

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

function nowMs() {
  return performance.now();
}

/**
 * Shared world space (host sim only). +y is down. Same mapping on every client.
 * - World Player A (bottom paddle, y≈0.92) = matchmaking **host** → `paddles.hostX`
 * - World Player B (top paddle, y≈0.08) = matchmaking **guest** → `paddles.guestX`
 */
const PADDLE_WORLD_Y_TOP = 0.08;
const PADDLE_WORLD_Y_BOT = 0.92;

export default function FacePong() {
  const clientId = useMemo(() => makeClientId(), []);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [uiPhase, setUiPhase] = useState<UiPhase>("menu");
  const uiPhaseRef = useRef<UiPhase>("menu");
  useEffect(() => {
    uiPhaseRef.current = uiPhase;
  }, [uiPhase]);

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
  const hostStartedAtRef = useRef<number | null>(null);

  const localNoseXRef = useRef(0.5);
  const smoothedLocalPaddleRef = useRef(0.5);

  const lastGuestSeqRef = useRef(-1);
  const lastStateRecvAtRef = useRef<number | null>(null);
  const lastSentAtRef = useRef<number | null>(null);
  /** Guest: `sentAt` from last authoritative state packet (host perf clock). */
  const lastAuthSentAtFromHostRef = useRef<number | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const lastRenderedBallRef = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const physicsRunningRef = useRef(false);

  const [, setWorldDebugTick] = useState(0);
  useEffect(() => {
    if (!FP_WORLD_DEBUG) return;
    const id = window.setInterval(() => setWorldDebugTick((x) => x + 1), 200);
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
    lastAuthSentAtFromHostRef.current = null;

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

    // update paddles from latest controls
    s.paddles.hostX = smoothedLocalPaddleRef.current;
    s.paddles.guestX = guestPaddleXRef.current;

    // collide with top paddle (world B / guest)
    if (s.ball.vy < 0 && s.ball.y <= PADDLE_WORLD_Y_TOP + 0.02) {
      const px = s.paddles.guestX;
      if (Math.abs(s.ball.x - px) <= paddleW / 2) {
        // hit
        s.ball.y = PADDLE_WORLD_Y_TOP + 0.02;
        s.ball.vy = Math.abs(s.ball.vy);
        const off = (s.ball.x - px) / (paddleW / 2);
        s.ball.vx += off * 0.18;
        s.rallyScore += 1;
      } else if (s.ball.y < 0) {
        s.phase = "gameover";
      }
    }

    // collide with bottom paddle (world A / host)
    if (s.ball.vy > 0 && s.ball.y >= PADDLE_WORLD_Y_BOT - 0.02) {
      const px = s.paddles.hostX;
      if (Math.abs(s.ball.x - px) <= paddleW / 2) {
        s.ball.y = PADDLE_WORLD_Y_BOT - 0.02;
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

  /**
   * Render snapshot: **identical** authoritative world on host + guest (no guest-side blending;
   * blending caused tiny mismatches vs host). Guest receives-only; draws latest `hostStateRef`.
   */
  function getDrawState(): FacePongNetState {
    return hostStateRef.current;
  }

  /**
   * Renders **only** authoritative world state. No per-viewer role remap: world +y = down on canvas.
   * Top half of the frame ≈ world player B (guest); bottom half ≈ world player A (host).
   */
  function draw(state: FacePongNetState) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const screenY = (y01: number) => y01 * h;

    // subtle overlay
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(0,0,0,0.08)");
    grad.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // center line (world equator between the two video halves)
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

    const topCx = state.paddles.guestX * w;
    const topCy = screenY(PADDLE_WORLD_Y_TOP);
    const botCx = state.paddles.hostX * w;
    const botCy = screenY(PADDLE_WORLD_Y_BOT);

    // World B (guest / top paddle)
    ctx.fillStyle = "rgba(180, 235, 255, 0.95)";
    roundRect(ctx, topCx - paddleW / 2, topCy - paddleH / 2, paddleW, paddleH, padR);
    ctx.fill();
    // World A (host / bottom paddle)
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    roundRect(ctx, botCx - paddleW / 2, botCy - paddleH / 2, paddleW, paddleH, padR);
    ctx.fill();

    // ball (same world coords on both clients)
    const bx = state.ball.x * w;
    const by = screenY(state.ball.y);
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
      mirrorSelfie: true,
      onNoseX: (x01) => {
        localNoseXRef.current = x01;
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
        lastAuthSentAtFromHostRef.current = msg.sentAt;

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

      const isHost = roleRef.current === "host";
      const playing = uiPhaseRef.current === "playing";
      physicsRunningRef.current = !!(isHost && opponentConnected && playing);

      // Host: sole physics while playing. Guest never calls hostTick. Broadcast playing + gameover so joiner stays in sync.
      if (isHost && opponentConnected) {
        if (hostStateRef.current.phase === "playing") {
          hostTick(dt);
        }
        const ph = hostStateRef.current.phase;
        if (ph === "playing" || ph === "gameover") {
          broadcastAuthoritativeState();
        }
      }

      const ds = getDrawState();
      lastRenderedBallRef.current = {
        x: ds.ball.x,
        y: ds.ball.y,
        vx: ds.ball.vx,
        vy: ds.ball.vy,
      };
      draw(ds);

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
        {role === "guest" ? (
          <>
            <div className={`${styles.half} ${styles.topHalf}`}>
              <video
                ref={localVideoRef}
                className={styles.video}
                playsInline
                muted
                autoPlay
              />
            </div>
            <div className={`${styles.half} ${styles.bottomHalf}`}>
              <video
                ref={remoteVideoRef}
                className={styles.video}
                playsInline
                autoPlay
              />
            </div>
          </>
        ) : (
          <>
            <div className={`${styles.half} ${styles.topHalf}`}>
              <video
                ref={remoteVideoRef}
                className={styles.video}
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
          </>
        )}

        <canvas ref={canvasRef} className={styles.canvas} />

        <div className={styles.hud}>
          <div className={styles.pill}>Rally: {rallyScore}</div>
          <div className={styles.pill}>
            FacePong {opponentConnected ? "• 2P" : "• 1P"}
          </div>
        </div>

        {FP_WORLD_DEBUG ? (
          <div className={styles.debugWorld}>
            <div>localUserId: {clientId}</div>
            <div>roomCreatorId: {roomId ?? "—"}</div>
            <div>amIHost: {role === "host" ? "true" : role === "guest" ? "false" : "—"}</div>
            <div>
              myRole:{" "}
              {role === "host" ? "Player A" : role === "guest" ? "Player B" : "—"}
            </div>
            <div>physicsRunning: {physicsRunningRef.current ? "true" : "false"}</div>
            <div>
              ball x/y: {lastRenderedBallRef.current.x.toFixed(4)},{" "}
              {lastRenderedBallRef.current.y.toFixed(4)} · vx/vy:{" "}
              {lastRenderedBallRef.current.vx.toFixed(4)}, {lastRenderedBallRef.current.vy.toFixed(4)}
            </div>
            <div>
              last authoritative update (local perf ms):{" "}
              {role === "host"
                ? lastSentAtRef.current?.toFixed(1) ?? "—"
                : lastStateRecvAtRef.current?.toFixed(1) ?? "—"}
              {role === "guest" ? (
                <>
                  {" "}
                  · host sentAt: {lastAuthSentAtFromHostRef.current?.toFixed(1) ?? "—"}
                </>
              ) : null}
            </div>
            <div>
              remotePeerId: {remotePeerIdRef.current ?? "—"} · seq{" "}
              {role === "host" ? hostSeqRef.current : lastGuestSeqRef.current}
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

