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

const LOBBY_PREFIX = "facepong-";

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

function normalizeLobbyCode(input: string) {
  return input.replace(/\D/g, "").slice(0, 6);
}

function makeLobbyCode() {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, "0");
}

function lobbyIdFromCode(code6: string) {
  return `${LOBBY_PREFIX}${code6}`;
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
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [lobbyCode, setLobbyCode] = useState<string>(() => makeLobbyCode());
  const [activeCode, setActiveCode] = useState<string | null>(null);

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

    // Physics is host-centric: guest paddle at top (y≈0.08), host at bottom (y≈0.92).
    // On the guest device, the bottom half is THEIR camera — so we flip Y when drawing
    // so ball + paddles match what each player sees (fixes “who missed” feeling swapped).
    const guestFlipped = role === "guest";
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
    const localX01 = role === "guest" ? state.paddles.guestX : state.paddles.hostX;
    const remoteX01 = role === "guest" ? state.paddles.hostX : state.paddles.guestX;
    const localX = localX01 * w;
    // Host views the guest’s unmirrored camera; guest tracking is mirror-corrected like their UI.
    // Mirror remote X for host only so paddle + top video match world ball. Guest: keep as-is.
    const remoteX = (role === "host" ? 1 - remoteX01 : remoteX01) * w;

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

    const stream = await ensureLocalCamera({ force: true });
    const nose = await createNoseTracker();
    destroyRef.current = nose.start({
      videoEl: localVideoRef.current!,
      onNoseX: (x01) => {
        localNoseXRef.current = x01;
        smoothedLocalPaddleRef.current = x01;
        // Keep host UI responsive immediately (even before opponent connects).
        hostStateRef.current.paddles.hostX = x01;
      },
    });

    const code6 = normalizeLobbyCode(lobbyCode);
    if (code6.length !== 6) {
      setStatus("Enter a 6-digit lobby code.");
      setUiPhase("menu");
      return;
    }
    setActiveCode(code6);

    const desiredId = lobbyIdFromCode(code6);
    let rid: string;
    let peer: any;
    try {
      const created = await createHostRoom({ desiredRoomId: desiredId });
      rid = created.roomId;
      peer = created.peer;
    } catch {
      setStatus("That lobby code is already in use. Tap New and try again.");
      setUiPhase("menu");
      return;
    }

    peerRef.current = peer;
    setRoomId(rid);
    setShareLink(null);
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

    const stream = await ensureLocalCamera({ force: true });
    const nose = await createNoseTracker();
    destroyRef.current = nose.start({
      videoEl: localVideoRef.current!,
      // Keep mapping consistent: both players see "move left -> paddle left".
      // Our local preview is mirrored, so mirrorSelfie stays true.
      mirrorSelfie: true,
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

  async function onJoinByCode(code: string) {
    const code6 = normalizeLobbyCode(code);
    if (code6.length !== 6) {
      setStatus("Enter a 6-digit lobby code.");
      return;
    }
    setActiveCode(code6);
    await onJoinRoom(lobbyIdFromCode(code6));
  }

  async function copyRoomLink() {
    const text = activeCode ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyToast("Copied code");
    } catch {
      // fallback for older Safari
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopyToast("Copied code");
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
      const raw = startedFromInvite;
      const code6 = normalizeLobbyCode(raw);
      if (code6.length === 6) {
        setLobbyCode(code6);
        setActiveCode(code6);
        void onJoinRoom(lobbyIdFromCode(code6));
      } else {
        void onJoinRoom(raw);
      }
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
            className={`${styles.video} ${role === "host" ? styles.opponentVideoAsHost : styles.opponentVideo}`}
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
            {role ? role.toUpperCase() : "FACEPONG"} {opponentConnected ? "• 2P" : "• 1P"}
          </div>
        </div>

        {showMenu ? (
          <div className={styles.overlay}>
            <div className={styles.card}>
              <div className={styles.title}>FacePong</div>
              <div className={styles.sub}>
                Create a lobby code, then have your friend enter the same code.
              </div>
              <div className={styles.codeWrap}>
                <div className={styles.codeRow}>
                  <input
                    className={styles.codeInput}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={lobbyCode}
                    onChange={(e) => setLobbyCode(normalizeLobbyCode(e.target.value))}
                    aria-label="Lobby code"
                  />
                  <button
                    className={styles.smallButton}
                    onClick={() => setLobbyCode(makeLobbyCode())}
                  >
                    New
                  </button>
                </div>
                <div className={styles.row2}>
                  <button className={styles.button} onClick={onCreateRoom}>
                    Create Lobby
                  </button>
                  <button
                    className={`${styles.button} ${styles.buttonSecondary}`}
                    onClick={() => void onJoinByCode(lobbyCode)}
                  >
                    Join Lobby
                  </button>
                </div>
              </div>
              <div className={styles.status}>{status}</div>
              {micOk === false ? (
                <div className={styles.status}>
                  Mic blocked (no audio track). Enable Microphone for this site in iOS Safari settings, then try again.
                </div>
              ) : null}
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
              {activeCode ? <div className={styles.mono}>Lobby code: {activeCode}</div> : null}

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
                  disabled={!activeCode}
                >
                  Copy Code
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
                    setActiveCode(null);
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

