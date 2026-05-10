"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./FaceCard.module.css";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";
import { foreheadFromLandmarks } from "@/lib/facecardForehead";
import { drawFaceCardOverlay } from "@/lib/facecardDraw";
import { POP_CULTURE_DECK, pickTwoDistinctRandom } from "@/lib/facecardDeck";
import { guessMatchesSecret } from "@/lib/facecardGuess";
import type { FaceCardNetMsg } from "@/lib/facecardProtocol";

type Phase = "intro" | "queue" | "peer_setup" | "lobby" | "playing" | "ended";

type Role = "host" | "guest";

const QUEUE_POLL_MS = 600;

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

function makeClientId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const k = "facearcade-fc-id";
  let id = window.sessionStorage.getItem(k);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(k, id);
  }
  return id;
}

type EndPayload =
  | {
      kind: "won";
      youWere: string;
      durationSec: number;
      guessesUsed: number;
    }
  | { kind: "lost"; youWere: string }
  | { kind: "draw"; hostCard: string; guestCard: string; durationSec: number };

export default function FaceCard() {
  const clientId = useMemo(() => makeClientId(), []);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const remoteOverlayRef = useRef<HTMLCanvasElement | null>(null);

  const [phase, setPhase] = useState<Phase>("intro");
  const phaseRef = useRef<Phase>("intro");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const [name, setName] = useState("");
  const nameRef = useRef("");
  useEffect(() => {
    nameRef.current = name.trim();
  }, [name]);

  const [status, setStatus] = useState("");
  const [opponentName, setOpponentName] = useState<string | null>(null);

  const [role, setRole] = useState<Role | null>(null);
  const roleRef = useRef<Role | null>(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const [localReady, setLocalReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);

  const [guessModalOpen, setGuessModalOpen] = useState(false);
  const [guessInput, setGuessInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  /** Host-only: assignments never stored in guest React state. */
  const hostSecretRef = useRef<string | null>(null);
  const guestSecretRef = useRef<string | null>(null);

  /** Physical host row / guest row (same meaning on both devices). */
  const [hostGuessCount, setHostGuessCount] = useState(3);
  const [guestGuessCount, setGuestGuessCount] = useState(3);
  const hostGuessRef = useRef(3);
  const guestGuessRef = useRef(3);
  const myGuessAttemptsRef = useRef(0);

  const startWallMsRef = useRef<number | null>(null);
  const [timerSec, setTimerSec] = useState(0);

  /** Label drawn on remote feed (guest receives from host; host sets from guestSecretRef). */
  const remoteCardLabelRef = useRef<string>("");

  const gameEndedRef = useRef(false);

  const [endPayload, setEndPayload] = useState<EndPayload | null>(null);

  const peerRef = useRef<{ destroy?: () => void } | null>(null);
  const dataRef = useRef<{ open?: boolean; send: (m: FaceCardNetMsg) => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  const sendNet = useCallback((msg: FaceCardNetMsg) => {
    const c = dataRef.current as { open?: boolean; send?: (m: FaceCardNetMsg) => void } | null;
    if (c?.open && c.send) c.send(msg);
  }, []);

  async function leaveQueue() {
    try {
      await fetch("/api/facecard/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, action: "leave" }),
      });
    } catch {
      /* ignore */
    }
  }

  function cleanupPeer() {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    try {
      peerRef.current?.destroy?.();
    } catch {
      /* ignore */
    }
    peerRef.current = null;
    dataRef.current = null;
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
    streamRef.current = null;
  }

  async function ensureCamera() {
    if (streamRef.current) return streamRef.current;
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
        frameRate: { ideal: 30, max: 30 },
      },
    });
    streamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      await localVideoRef.current.play();
    }
    return stream;
  }

  function pushEndFromHost(outcome: "win_host" | "win_guest" | "draw") {
    const hostCard = hostSecretRef.current ?? "";
    const guestCard = guestSecretRef.current ?? "";
    const start = startWallMsRef.current ?? Date.now();
    const durationSec = Math.max(0, (Date.now() - start) / 1000);

    sendNet({
      t: "fc_end",
      outcome,
      hostCard,
      guestCard,
      durationSec,
    });

    gameEndedRef.current = true;
    setPhase("ended");

    if (outcome === "draw") {
      setEndPayload({ kind: "draw", hostCard, guestCard, durationSec });
      return;
    }
    if (outcome === "win_host") {
      setEndPayload({
        kind: "won",
        youWere: hostCard,
        durationSec,
        guessesUsed: myGuessAttemptsRef.current,
      });
      return;
    }
    setEndPayload({
      kind: "lost",
      youWere: hostCard,
    });
  }

  function pushEndGuest(msg: Extract<FaceCardNetMsg, { t: "fc_end" }>) {
    gameEndedRef.current = true;
    setPhase("ended");
    const localIsHost = roleRef.current === "host";
    const durationSec = msg.durationSec;

    if (msg.outcome === "draw") {
      setEndPayload({
        kind: "draw",
        hostCard: msg.hostCard,
        guestCard: msg.guestCard,
        durationSec,
      });
      return;
    }

    const iWon =
      (msg.outcome === "win_host" && localIsHost) || (msg.outcome === "win_guest" && !localIsHost);

    const myName = localIsHost ? msg.hostCard : msg.guestCard;

    if (iWon) {
      setEndPayload({
        kind: "won",
        youWere: myName,
        durationSec,
        guessesUsed: myGuessAttemptsRef.current,
      });
    } else {
      setEndPayload({
        kind: "lost",
        youWere: myName,
      });
    }
  }

  function syncPhysicalGuesses(h: number, g: number) {
    hostGuessRef.current = h;
    guestGuessRef.current = g;
    setHostGuessCount(h);
    setGuestGuessCount(g);
  }

  function wireHost(conn: any) {
    conn.on("data", (raw: unknown) => {
      const msg = raw as FaceCardNetMsg;
      if (msg.t === "fc_hello") {
        setOpponentName(msg.displayName);
        return;
      }
      if (msg.t === "fc_ready") {
        setRemoteReady(msg.ready);
        return;
      }
      if (msg.t === "fc_try") {
        const secret = guestSecretRef.current;
        if (!secret || gameEndedRef.current) return;
        const hg = hostGuessRef.current;
        let gg = guestGuessRef.current;
        if (gg <= 0) return;

        if (guessMatchesSecret(secret, msg.text)) {
          sendNet({
            t: "fc_try_result",
            correct: true,
            yourGuessesLeft: gg,
            ended: true,
            youWon: true,
          });
          pushEndFromHost("win_guest");
          return;
        }

        gg = Math.max(0, gg - 1);
        syncPhysicalGuesses(hg, gg);
        sendNet({
          t: "fc_try_result",
          correct: false,
          yourGuessesLeft: gg,
          ended: false,
        });
        sendNet({
          t: "fc_sync",
          hostGuessesLeft: hg,
          guestGuessesLeft: gg,
        });

        if (gg <= 0 && hg <= 0) {
          pushEndFromHost("draw");
        }
      }
    });
  }

  function wireGuest(conn: any) {
    conn.on("data", (raw: unknown) => {
      const msg = raw as FaceCardNetMsg;
      if (msg.t === "fc_hello") {
        setOpponentName(msg.displayName);
        return;
      }
      if (msg.t === "fc_ready") {
        setRemoteReady(msg.ready);
        return;
      }
      if (msg.t === "fc_begin") {
        startWallMsRef.current = msg.startWallMs;
        remoteCardLabelRef.current = msg.remoteCardLabel;
        syncPhysicalGuesses(3, 3);
        myGuessAttemptsRef.current = 0;
        gameEndedRef.current = false;
        setPhase("playing");
        return;
      }
      if (msg.t === "fc_try_result") {
        guestGuessRef.current = msg.yourGuessesLeft;
        setGuestGuessCount(msg.yourGuessesLeft);
        if (!msg.correct) {
          setToast("Nope. Keep cooking.");
          window.setTimeout(() => setToast(null), 2200);
        }
        return;
      }
      if (msg.t === "fc_sync") {
        syncPhysicalGuesses(msg.hostGuessesLeft, msg.guestGuessesLeft);
        return;
      }
      if (msg.t === "fc_end") {
        pushEndGuest(msg);
      }
    });
  }

  async function setupPeer(roomId: string, r: Role) {
    cleanupPeer();
    await ensureCamera();
    const stream = streamRef.current!;

    if (r === "host") {
      const { peer } = await createHostRoom({ desiredRoomId: roomId });
      peerRef.current = peer;

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
      wireHost(conn);

      conn.on("open", () => {
        sendNet({ t: "fc_hello", displayName: nameRef.current || "Player" });
      });
    } else {
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

      const conn = await connectGuestWithRetry(peer, roomId);
      dataRef.current = conn;
      wireGuest(conn);

      conn.on("open", () => {
        sendNet({ t: "fc_hello", displayName: nameRef.current || "Player" });
      });

      const call = peer.call(roomId, stream);
      call.on("stream", (remoteStream: MediaStream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play();
        }
      });
    }
  }

  async function applyMatch(roomId: string, r: Role, opp: string) {
    setOpponentName(opp || "Opponent");
    setRole(r);
    setStatus("Opponent found.");
    setPhase("peer_setup");
    await setupPeer(roomId, r);
    setPhase("lobby");
  }

  async function findMatch() {
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) {
      setStatus("Enter your name first.");
      return;
    }
    setName(trimmed);
    setPhase("queue");
    setStatus("Finding a stranger…");

    const res = await fetch("/api/facecard/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, action: "join" }),
    });
    const data = await res.json();
    if (data.matched) {
      await applyMatch(data.peerRoomId as string, data.role as Role, "");
      return;
    }

    pollTimerRef.current = window.setInterval(async () => {
      const r = await fetch(`/api/facecard/queue?clientId=${encodeURIComponent(clientId)}`);
      const j = await r.json();
      if (j.matched) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        await applyMatch(j.peerRoomId as string, j.role as Role, "");
      }
    }, QUEUE_POLL_MS);
  }

  function toggleReady() {
    const next = !localReady;
    setLocalReady(next);
    sendNet({ t: "fc_ready", ready: next });
  }

  function hostStartGame() {
    if (role !== "host" || !localReady || !remoteReady || gameEndedRef.current) return;
    const [hostCard, guestCard] = pickTwoDistinctRandom(POP_CULTURE_DECK);
    hostSecretRef.current = hostCard;
    guestSecretRef.current = guestCard;

    const startWallMs = Date.now() + 500;
    startWallMsRef.current = startWallMs;
    syncPhysicalGuesses(3, 3);
    myGuessAttemptsRef.current = 0;
    gameEndedRef.current = false;

    sendNet({
      t: "fc_begin",
      startWallMs,
      remoteCardLabel: hostCard,
    });

    setPhase("playing");
  }

  function submitGuess() {
    const text = guessInput.trim();
    setGuessModalOpen(false);
    setGuessInput("");
    if (!text || gameEndedRef.current) return;

    if (role === "host") {
      const secret = hostSecretRef.current;
      if (!secret) return;
      let hg = hostGuessRef.current;
      const gg = guestGuessRef.current;
      if (hg <= 0) return;

      myGuessAttemptsRef.current += 1;

      if (guessMatchesSecret(secret, text)) {
        pushEndFromHost("win_host");
        return;
      }

      hg = Math.max(0, hg - 1);
      syncPhysicalGuesses(hg, gg);
      setToast("Nope. Keep cooking.");
      window.setTimeout(() => setToast(null), 2200);
      sendNet({
        t: "fc_sync",
        hostGuessesLeft: hg,
        guestGuessesLeft: gg,
      });

      if (hg <= 0 && gg <= 0) {
        pushEndFromHost("draw");
      }
      return;
    }

    myGuessAttemptsRef.current += 1;
    sendNet({ t: "fc_try", text });
  }

  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => {
      const t0 = startWallMsRef.current;
      if (!t0) return;
      setTimerSec(Math.max(0, (Date.now() - t0) / 1000));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    let lm: Awaited<ReturnType<typeof createFaceLandmarker>> | null = null;
    let raf = 0;
    let cancelled = false;

    const resizeCanvas = (canvas: HTMLCanvasElement | null, video: HTMLVideoElement | null) => {
      if (!canvas || !video) return;
      const rect = video.getBoundingClientRect();
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.floor(rect.width * dpr);
      const h = Math.floor(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return { cssW: rect.width, cssH: rect.height, dpr };
    };

    const loop = async () => {
      if (cancelled) return;
      const ph = phaseRef.current;
      if (ph !== "playing") {
        const lc = localOverlayRef.current;
        const rc = remoteOverlayRef.current;
        const lctx = lc?.getContext("2d");
        const rctx = rc?.getContext("2d");
        if (lctx && lc) lctx.clearRect(0, 0, lc.width, lc.height);
        if (rctx && rc) rctx.clearRect(0, 0, rc.width, rc.height);
        raf = requestAnimationFrame(() => void loop());
        return;
      }

      if (!lm) lm = await createFaceLandmarker();

      const localV = localVideoRef.current;
      const remoteV = remoteVideoRef.current;
      const locCanvas = localOverlayRef.current;
      const remCanvas = remoteOverlayRef.current;

      const now = performance.now();

      if (remoteV && remCanvas && remoteV.readyState >= 2) {
        const sz = resizeCanvas(remCanvas, remoteV);
        const ctx = remCanvas.getContext("2d");
        if (ctx && sz) {
          const res = lm.detectForVideo(remoteV, now);
          const landmarks = res.faceLandmarks?.[0];
          const placement = foreheadFromLandmarks(landmarks as { x: number; y: number }[] | undefined);
          const label =
            roleRef.current === "host"
              ? guestSecretRef.current ?? ""
              : remoteCardLabelRef.current ?? "";
          drawFaceCardOverlay(ctx, sz.cssW, sz.cssH, sz.dpr, placement, label || null, false);
        }
      }

      if (localV && locCanvas && localV.readyState >= 2) {
        const sz = resizeCanvas(locCanvas, localV);
        const ctx = locCanvas.getContext("2d");
        if (ctx && sz) {
          const res = lm.detectForVideo(localV, now);
          const landmarks = res.faceLandmarks?.[0];
          const placement = foreheadFromLandmarks(landmarks as { x: number; y: number }[] | undefined);
          drawFaceCardOverlay(ctx, sz.cssW, sz.cssH, sz.dpr, placement, null, true);
        }
      }

      raf = requestAnimationFrame(() => void loop());
    };

    void loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    return () => {
      void leaveQueue();
      cleanupPeer();
    };
  }, []);

  function playAgain() {
    void leaveQueue();
    cleanupPeer();
    setPhase("intro");
    setStatus("");
    setOpponentName(null);
    setRole(null);
    setLocalReady(false);
    setRemoteReady(false);
    setGuessModalOpen(false);
    setGuessInput("");
    setToast(null);
    syncPhysicalGuesses(3, 3);
    myGuessAttemptsRef.current = 0;
    setTimerSec(0);
    setEndPayload(null);
    gameEndedRef.current = false;
    hostSecretRef.current = null;
    guestSecretRef.current = null;
    remoteCardLabelRef.current = "";
    startWallMsRef.current = null;
  }

  const displayLocalName = name.trim() || "You";
  const displayRemoteName = opponentName || "Opponent";

  const showIntro = phase === "intro" || phase === "queue";
  const showGame =
    phase === "peer_setup" ||
    phase === "lobby" ||
    phase === "playing" ||
    phase === "ended";

  const canHostStart = role === "host" && phase === "lobby" && localReady && remoteReady;

  const isHostPlayer = role === "host";
  const myLeft = isHostPlayer ? hostGuessCount : guestGuessCount;
  const theirLeft = isHostPlayer ? guestGuessCount : hostGuessCount;

  const outOfGuesses = phase === "playing" && myLeft <= 0 && !gameEndedRef.current;

  return (
    <div className={styles.root}>
      {showIntro ? (
        <div className={styles.intro}>
          <div className={styles.bigTitle}>FaceCard</div>
          <div className={styles.tagline}>Guess who you are.</div>

          <div className={styles.field}>
            <div className={styles.label}>Your name</div>
            <input
              className={styles.nameInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Type your name"
              maxLength={24}
              autoComplete="nickname"
            />
          </div>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void findMatch()}
            disabled={phase === "queue"}
          >
            Find Match
          </button>

          <div className={styles.statusText}>{status}</div>
        </div>
      ) : null}

      {showGame ? (
        <div className={styles.gameWrap}>
          <div className={styles.splitTop}>
            <video
              ref={remoteVideoRef}
              className={`${styles.video} ${styles.videoRemote}`}
              playsInline
              autoPlay
            />
            <canvas ref={remoteOverlayRef} className={styles.overlayCanvas} aria-hidden />
            <div className={styles.nameTag}>{displayRemoteName}</div>
          </div>

          <div className={styles.divider} />

          <div className={styles.splitBottom}>
            <video
              ref={localVideoRef}
              className={`${styles.video} ${styles.videoLocal}`}
              playsInline
              muted
              autoPlay
            />
            <canvas ref={localOverlayRef} className={styles.overlayCanvas} aria-hidden />
            <div className={styles.nameTag}>{displayLocalName}</div>

            {phase === "playing" ? (
              <div className={styles.timerPill}>{timerSec.toFixed(2)}s</div>
            ) : null}

            {phase === "playing" ? (
              <div className={styles.guessPill}>
                Guesses: {myLeft}/3
                <span className={styles.guessSub}> · Them: {theirLeft}/3</span>
              </div>
            ) : null}

            {outOfGuesses ? <div className={styles.outBanner}>Out of guesses</div> : null}

            {toast ? <div className={styles.toast}>{toast}</div> : null}

            {phase === "lobby" ? (
              <div className={styles.overlayCard}>
                <div className={styles.card}>
                  <div className={styles.cardTitle}>Opponent found.</div>
                  <div className={styles.cardBody}>Tap Ready when you&apos;re set.</div>
                  <button type="button" className={styles.primaryBtn} onClick={toggleReady}>
                    {localReady ? "Cancel Ready" : "Ready"}
                  </button>
                  <div className={styles.cardBody}>
                    Opponent: {remoteReady ? "Ready ✓" : "Not ready yet"}
                  </div>
                  {role === "host" ? (
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={hostStartGame}
                      disabled={!canHostStart}
                    >
                      Start Game
                    </button>
                  ) : (
                    <div className={styles.cardBodyMuted}>
                      {localReady && remoteReady
                        ? "Waiting for host to start…"
                        : "Both players must tap Ready."}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {phase === "playing" && myLeft > 0 ? (
              <button
                type="button"
                className={styles.iknowBtn}
                onClick={() => setGuessModalOpen(true)}
              >
                I Know It
              </button>
            ) : null}

            {guessModalOpen ? (
              <div
                className={styles.modalBackdrop}
                role="presentation"
                onClick={() => setGuessModalOpen(false)}
              >
                <div
                  className={styles.modalCard}
                  role="dialog"
                  aria-labelledby="guess-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div id="guess-title" className={styles.modalTitle}>
                    Who are you?
                  </div>
                  <input
                    className={styles.modalInput}
                    value={guessInput}
                    onChange={(e) => setGuessInput(e.target.value)}
                    placeholder="Your guess"
                    autoComplete="off"
                  />
                  <div className={styles.modalRow}>
                    <button type="button" className={styles.secondaryBtn} onClick={() => setGuessModalOpen(false)}>
                      Cancel
                    </button>
                    <button type="button" className={styles.primaryBtn} onClick={submitGuess}>
                      Submit Guess
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {phase === "ended" && endPayload ? (
              <div className={styles.overlayCard}>
                <div className={styles.card}>
                  {endPayload.kind === "won" ? (
                    <>
                      <div className={`${styles.cardTitle} ${styles.win}`}>You Win!</div>
                      <div className={styles.cardBody}>You were: {endPayload.youWere}</div>
                      <div className={styles.cardBody}>
                        Time: {endPayload.durationSec.toFixed(2)}s
                      </div>
                      <div className={styles.cardBody}>
                        Guesses Used: {endPayload.guessesUsed}/3
                      </div>
                    </>
                  ) : endPayload.kind === "lost" ? (
                    <>
                      <div className={`${styles.cardTitle} ${styles.lose}`}>You Lost</div>
                      <div className={styles.cardBody}>Opponent guessed first.</div>
                      <div className={styles.cardBody}>You were: {endPayload.youWere}</div>
                    </>
                  ) : (
                    <>
                      <div className={styles.cardTitle}>Nobody cooked. Game Over.</div>
                      <div className={styles.cardBody}>Names: {endPayload.hostCard}</div>
                      <div className={styles.cardBody}>and {endPayload.guestCard}</div>
                      <div className={styles.cardBody}>Time: {endPayload.durationSec.toFixed(2)}s</div>
                    </>
                  )}
                  <button type="button" className={styles.primaryBtn} onClick={playAgain}>
                    Play Again
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
