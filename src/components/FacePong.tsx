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

type UiPhase = "menu" | "lobby" | "playing" | "gameover";
type Role = "host" | "guest";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function parseRoomIdFromUrl() {
  if (typeof window === "undefined") return null;
  const u = new URL(window.location.href);
  return u.searchParams.get("room") || null;
}

function makeInitialNetState(): FacePongNetState {
  return {
    phase: "lobby",
    rallyScore: 0,
    ball: { x: 0.5, y: 0.5, vx: 0.0, vy: 0.0 },
    paddles: { hostX: 0.5, guestX: 0.5 },
  };
}

function nowMs() {
  return performance.now();
}

export default function FacePong() {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [uiPhase, setUiPhase] = useState<UiPhase>("menu");
  const [role, setRole] = useState<Role | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Idle");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [rallyScore, setRallyScore] = useState(0);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const peerRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const destroyRef = useRef<null | (() => void)>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const hostStateRef = useRef<FacePongNetState>(makeInitialNetState());
  const guestPaddleXRef = useRef(0.5);
  const lastHostTickRef = useRef(0);
  const hostStartedAtRef = useRef<number | null>(null);

  const localNoseXRef = useRef(0.5);
  const smoothedLocalPaddleRef = useRef(0.5);

  const startedFromInvite = useMemo(() => parseRoomIdFromUrl(), []);

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

  async function ensureLocalCamera() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 720 },
        height: { ideal: 1280 },
        frameRate: { ideal: 60, max: 60 },
      },
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      await localVideoRef.current.play();
    }
    return stream;
  }

  function cleanup() {
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
    sendToGuest({ t: "state", state: s });
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

  function draw(state: FacePongNetState) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

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

    const hostX = state.paddles.hostX * w;
    const guestX = state.paddles.guestX * w;

    // paddles
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    roundRect(ctx, hostX - paddleW / 2, h * 0.92 - paddleH / 2, paddleW, paddleH, padR);
    ctx.fill();
    roundRect(ctx, guestX - paddleW / 2, h * 0.08 - paddleH / 2, paddleW, paddleH, padR);
    ctx.fill();

    // ball
    const bx = state.ball.x * w;
    const by = state.ball.y * h;
    const r = Math.max(6, Math.round(w * 0.018));
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "rgba(130, 220, 255, 0.18)";
    ctx.arc(bx, by, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  async function onCreateRoom() {
    cleanup();
    setStatus("Creating room…");
    setUiPhase("lobby");
    setRole("host");
    setOpponentConnected(false);
    hostResetState();

    const stream = await ensureLocalCamera();
    const nose = await createNoseTracker();
    destroyRef.current = nose.start({
      videoEl: localVideoRef.current!,
      onNoseX: (x01) => {
        localNoseXRef.current = x01;
        smoothedLocalPaddleRef.current = x01;
      },
    });

    const { roomId: rid, peer } = await createHostRoom();
    peerRef.current = peer;
    setRoomId(rid);
    const url = new URL(window.location.href);
    url.pathname = "/facepong";
    url.searchParams.set("room", rid);
    setShareLink(url.toString());
    setStatus("Waiting for opponent…");

    const conn = await waitForHostConnection(peer);
    dataRef.current = conn;
    setOpponentConnected(true);
    setStatus("Opponent connected");

    conn.on("data", (raw: any) => {
      const msg = raw as GuestToHostMsg;
      if (msg.t === "paddle") guestPaddleXRef.current = clamp(msg.x01, 0, 1);
    });

    // Receive guest stream (guest will call host)
    peer.on("call", (call: any) => {
      call.answer(stream);
      call.on("stream", (remoteStream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play();
        }
      });
    });

    // also send our stream to guest
    conn.on("open", () => {
      conn.send({ t: "hello", roomId: rid } satisfies HostToGuestMsg);
    });
  }

  async function onJoinRoom(rid: string) {
    cleanup();
    setStatus("Joining room…");
    setUiPhase("lobby");
    setRole("guest");
    setOpponentConnected(false);
    setRoomId(rid);

    const stream = await ensureLocalCamera();
    const nose = await createNoseTracker();
    destroyRef.current = nose.start({
      videoEl: localVideoRef.current!,
      onNoseX: (x01) => {
        localNoseXRef.current = x01;
        smoothedLocalPaddleRef.current = x01;
        sendToHost({ t: "paddle", x01 });
      },
    });

    const peer = await createGuestPeer();
    peerRef.current = peer;

    const conn = await connectGuestToHost(peer, rid);
    dataRef.current = conn;
    setOpponentConnected(true);
    setStatus("Opponent connected");

    conn.on("data", (raw: any) => {
      const msg = raw as HostToGuestMsg;
      if (msg.t === "state") {
        hostStateRef.current = msg.state;
        setRallyScore(msg.state.rallyScore);
        if (msg.state.phase === "playing") setUiPhase("playing");
        if (msg.state.phase === "gameover") setUiPhase("gameover");
      }
    });

    // Guest sends their media stream to host; host will answer and stream back.
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

  async function copyRoomLink() {
    const link = shareLink || (roomId ? `${window.location.origin}/facepong?room=${roomId}` : null);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyToast("Copied link");
    } catch {
      // fallback for older Safari
      try {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopyToast("Copied link");
      } catch {
        setCopyToast("Copy failed");
      }
    } finally {
      window.setTimeout(() => setCopyToast(null), 1200);
    }
  }

  function onPlayAgain() {
    if (role === "host") {
      hostResetState();
      setUiPhase("lobby");
      sendToGuest({ t: "state", state: hostStateRef.current });
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
    // Auto-join if a room param exists
    if (startedFromInvite && uiPhase === "menu") {
      void onJoinRoom(startedFromInvite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedFromInvite]);

  useEffect(() => {
    let raf: number | null = null;
    let last = nowMs();

    const loop = () => {
      const n = nowMs();
      const dt = clamp((n - last) / 1000, 0, 0.05);
      last = n;

      // host runs authoritative sim
      if (role === "host" && opponentConnected) {
        if (!lastHostTickRef.current) lastHostTickRef.current = n;
        hostTick(dt);
        sendToGuest({ t: "state", state: hostStateRef.current });
      }

      // guest & host draw current known state
      draw(hostStateRef.current);

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
            muted
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
            {role ? role.toUpperCase() : "FACEPONG"} {opponentConnected ? "• 2P" : "• 1P"}
          </div>
        </div>

        {showMenu ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>FacePong</div>
              <div className={styles.sub}>
                Create a room, share the link, and rally together.
              </div>
              <div className={styles.row}>
                <button className={styles.button} onClick={onCreateRoom}>
                  Create Room
                </button>
                {startedFromInvite ? (
                  <button
                    className={`${styles.button} ${styles.buttonSecondary}`}
                    onClick={() => void onJoinRoom(startedFromInvite)}
                  >
                    Join Room
                  </button>
                ) : null}
              </div>
              <div className={styles.status}>{status}</div>
              {copyToast ? <div className={styles.status}>{copyToast}</div> : null}
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
              {shareLink ? (
                <div className={styles.mono}>Share link: {shareLink}</div>
              ) : roomId ? (
                <div className={styles.mono}>Room: {roomId}</div>
              ) : null}

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
                  onClick={copyRoomLink}
                  disabled={!shareLink && !roomId}
                >
                  Copy Link
                </button>
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => {
                    cleanup();
                    setUiPhase("menu");
                    setRole(null);
                    setRoomId(null);
                    setShareLink(null);
                    setOpponentConnected(false);
                    setStatus("Idle");
                  }}
                >
                  Back
                </button>
              </div>
              <div className={styles.status}>{status}</div>
              {copyToast ? <div className={styles.status}>{copyToast}</div> : null}
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

