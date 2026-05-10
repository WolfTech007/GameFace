"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./StaringContest.module.css";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import { createStaringContestLandmarker } from "@/lib/staringContestFaceLandmarker";
import { computeEyeAspectRatio, createBlinkSmoother } from "@/lib/eyeBlinkEar";
import type { StaringNetMsg } from "@/lib/staringContestProtocol";

type Phase =
  | "intro"
  | "queue"
  | "peer_setup"
  | "lobby"
  | "countdown"
  | "playing"
  | "ended";

type Role = "host" | "guest";

const GRACE_MS = 450;
const FACE_LOSE_AFTER_MS = 1000;
const BLINK_FRAMES = 5;
const QUEUE_POLL_MS = 600;

function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function makeClientId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const k = "facearcade-sc-id";
  let id = window.sessionStorage.getItem(k);
  if (!id) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(k, id);
  }
  return id;
}

export default function StaringContest() {
  const clientId = useMemo(() => makeClientId(), []);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

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
  const [peerRoomId, setPeerRoomId] = useState<string | null>(null);

  const [localReady, setLocalReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);

  const [countdownN, setCountdownN] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);

  const [warnFace, setWarnFace] = useState(false);
  const [endedWinner, setEndedWinner] = useState<boolean | null>(null);
  const [roundSeconds, setRoundSeconds] = useState(0);

  const peerRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const hostRoleRef = useRef<Role | null>(null);
  const gameEndedRef = useRef(false);
  const gameStartWallMsRef = useRef<number | null>(null);
  const earCalibRef = useRef<number[]>([]);
  const earThresholdRef = useRef(0.22);
  const blinkSmootherRef = useRef(createBlinkSmoother(BLINK_FRAMES));
  const faceMissingSinceRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const sendNet = useCallback((msg: StaringNetMsg) => {
    const c = dataRef.current;
    if (c?.open) c.send(msg);
  }, []);

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

  async function leaveQueue() {
    try {
      await fetch("/api/staring-contest/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, action: "leave" }),
      });
    } catch {
      /* ignore */
    }
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

    const res = await fetch("/api/staring-contest/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, name: trimmed, action: "join" }),
    });
    const data = await res.json();
    if (data.matched) {
      applyMatch(data.peerRoomId as string, data.role as Role, data.opponentName as string);
      return;
    }

    pollTimerRef.current = window.setInterval(async () => {
      const r = await fetch(`/api/staring-contest/queue?clientId=${encodeURIComponent(clientId)}`);
      const j = await r.json();
      if (j.matched) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        applyMatch(j.peerRoomId as string, j.role as Role, j.opponentName as string);
      }
    }, QUEUE_POLL_MS);
  }

  async function applyMatch(roomId: string, r: Role, opp: string) {
    setPeerRoomId(roomId);
    setRole(r);
    hostRoleRef.current = r;
    setOpponentName(opp);
    setStatus("Opponent found.");
    setPhase("peer_setup");
    await setupPeer(roomId, r);
    setPhase("lobby");
  }

  function resolveLoss(fromHost: boolean) {
    if (gameEndedRef.current) return;
    gameEndedRef.current = true;
    const winnerIsHost = !fromHost;
    const start = gameStartWallMsRef.current ?? Date.now();
    const roundSec = Math.max(0, (Date.now() - start) / 1000);

    const localIsHost = hostRoleRef.current === "host";
    setEndedWinner(winnerIsHost === localIsHost);
    setRoundSeconds(roundSec);
    setPhase("ended");

    sendNet({
      t: "game_over",
      winnerIsHost,
      roundSeconds: roundSec,
    });
  }

  function wireData(conn: any, isHost: boolean) {
    conn.on("data", (raw: unknown) => {
      const msg = raw as StaringNetMsg;
      if (msg.t === "hello") {
        setOpponentName(msg.name);
        return;
      }
      if (msg.t === "ready") {
        setRemoteReady(msg.ready);
        return;
      }

      if (!isHost) {
        if (msg.t === "countdown") {
          setPhase("countdown");
          setCountdownN(msg.n);
          return;
        }
        if (msg.t === "game_go") {
          gameStartWallMsRef.current = msg.startWallMs;
          blinkSmootherRef.current.reset();
          gameEndedRef.current = false;
          setCountdownN(null);
          const med = median(earCalibRef.current);
          if (med > 0) {
            earThresholdRef.current = Math.max(0.11, Math.min(0.38, med * 0.55));
          } else {
            earThresholdRef.current = 0.22;
          }
          const delay = Math.max(0, msg.startWallMs - Date.now());
          window.setTimeout(() => setPhase("playing"), delay);
          return;
        }
        if (msg.t === "game_over") {
          gameEndedRef.current = true;
          const localIsHost = hostRoleRef.current === "host";
          setEndedWinner(msg.winnerIsHost === localIsHost);
          setRoundSeconds(msg.roundSeconds);
          setPhase("ended");
        }
        return;
      }

      if (isHost && (msg.t === "blink" || msg.t === "face_lost")) {
        resolveLoss(msg.fromHost);
      }
    });
  }

  async function setupPeer(roomId: string, r: Role) {
    cleanupPeer();
    const stream = await ensureCamera();

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
      wireData(conn, true);

      conn.on("open", () => {
        sendNet({ t: "hello", name: nameRef.current || "Player" });
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

      const conn = await connectGuestToHost(peer, roomId, { reliable: true });
      dataRef.current = conn;
      wireData(conn, false);

      conn.on("open", () => {
        sendNet({ t: "hello", name: nameRef.current || "Player" });
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

  // Do not depend on `phase` here: when the host sets phase to "countdown", a re-run would
  // clean up this effect and cancel the async loop (stuck on "3"). Use phaseRef to gate.
  useEffect(() => {
    if (phaseRef.current !== "lobby") return;
    if (!localReady || !remoteReady) return;
    if (role !== "host") return;

    let cancelled = false;
    const run = async () => {
      setPhase("countdown");
      earCalibRef.current = [];
      earThresholdRef.current = 0.22;

      for (let n = 3; n >= 1; n--) {
        if (cancelled) return;
        sendNet({ t: "countdown", n });
        setCountdownN(n);
        await new Promise((r) => setTimeout(r, 900));
      }
      if (cancelled) return;

      sendNet({ t: "countdown", n: 0 });
      setCountdownN(0);
      await new Promise((r) => setTimeout(r, 650));
      if (cancelled) return;

      const med = median(earCalibRef.current);
      if (med > 0) {
        earThresholdRef.current = Math.max(0.11, Math.min(0.38, med * 0.55));
      }

      const startWallMs = Date.now() + GRACE_MS;
      sendNet({ t: "game_go", startWallMs });
      gameStartWallMsRef.current = startWallMs;
      gameEndedRef.current = false;
      blinkSmootherRef.current.reset();
      faceMissingSinceRef.current = null;
      setCountdownN(null);
      await new Promise((r) => setTimeout(r, Math.max(0, startWallMs - Date.now())));
      if (cancelled) return;
      setPhase("playing");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [localReady, remoteReady, role, sendNet]);

  useEffect(() => {
    let cancelled = false;
    let lm: Awaited<ReturnType<typeof createStaringContestLandmarker>> | null = null;
    let raf = 0;

    const tick = async () => {
      if (cancelled) return;
      const ph = phaseRef.current;
      const now = performance.now();

      if (ph === "playing" || ph === "countdown") {
        if (!lm) lm = await createStaringContestLandmarker();
        const video = localVideoRef.current;
        if (video && video.readyState >= 2 && lm && !cancelled) {
          const res = lm.detectForVideo(video, performance.now());
          const landmarks = res.faceLandmarks?.[0];
          const ear = computeEyeAspectRatio(landmarks as any);

          if (phaseRef.current === "countdown") {
            if (ear != null) earCalibRef.current.push(ear);
          }

          if (phaseRef.current === "playing") {
            // gameStartWallMsRef is wall-clock ms (Date.now) from host game_go — must not mix with performance.now().
            const wallNow = Date.now();
            const startWallMs = gameStartWallMsRef.current;

            if (startWallMs != null) {
              setTimerSeconds(Math.max(0, (wallNow - startWallMs) / 1000));
            }

            if (!landmarks) {
              if (faceMissingSinceRef.current == null) faceMissingSinceRef.current = now;
              const missingMs = now - faceMissingSinceRef.current;
              setWarnFace(missingMs > 200);
              if (missingMs > FACE_LOSE_AFTER_MS && hostRoleRef.current && !gameEndedRef.current) {
                if (hostRoleRef.current === "host") resolveLoss(true);
                else sendNet({ t: "face_lost", fromHost: false, atMs: Date.now() });
              }
            } else {
              faceMissingSinceRef.current = null;
              setWarnFace(false);

              const graceActive = startWallMs != null && wallNow < startWallMs + GRACE_MS;
              if (!graceActive && ear != null && hostRoleRef.current && !gameEndedRef.current) {
                const { isLikelyBlink } = blinkSmootherRef.current.update(ear, {
                  openThreshold: earThresholdRef.current,
                });
                if (isLikelyBlink) {
                  if (hostRoleRef.current === "host") resolveLoss(true);
                  else sendNet({ t: "blink", fromHost: false, atMs: Date.now() });
                }
              }
            }
          }
        }
      }

      raf = requestAnimationFrame(() => void tick());
    };

    raf = requestAnimationFrame(() => void tick());
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [sendNet]);

  useEffect(() => {
    return () => {
      void leaveQueue();
      cleanupPeer();
    };
  }, []);

  function toggleReady() {
    const next = !localReady;
    setLocalReady(next);
    sendNet({ t: "ready", ready: next });
  }

  function playAgain() {
    void leaveQueue();
    cleanupPeer();
    setPhase("intro");
    setStatus("");
    setOpponentName(null);
    setPeerRoomId(null);
    setRole(null);
    hostRoleRef.current = null;
    setLocalReady(false);
    setRemoteReady(false);
    setCountdownN(null);
    setEndedWinner(null);
    setRoundSeconds(0);
    gameEndedRef.current = false;
    earThresholdRef.current = 0.22;
    earCalibRef.current = [];
    blinkSmootherRef.current.reset();
    faceMissingSinceRef.current = null;
    gameStartWallMsRef.current = null;
  }

  const displayLocalName = name.trim() || "You";
  const displayRemoteName = opponentName || "Opponent";

  const showGameChrome =
    phase === "peer_setup" ||
    phase === "lobby" ||
    phase === "countdown" ||
    phase === "playing" ||
    phase === "ended";

  return (
    <div className={styles.root}>
      {phase === "intro" || phase === "queue" ? (
        <div className={styles.intro}>
          <div className={styles.bigTitle}>Staring Contest</div>
          <div className={styles.tagline}>Don&apos;t blink.</div>

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

      {showGameChrome ? (
        <div className={styles.gameWrap}>
          <div className={styles.splitTop}>
            <video
              ref={remoteVideoRef}
              className={`${styles.video} ${styles.videoRemote}`}
              playsInline
              autoPlay
            />
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
            <div className={styles.nameTag}>{displayLocalName}</div>

            {phase === "playing" ? (
              <div className={styles.timerOverlay}>{timerSeconds.toFixed(2)}s</div>
            ) : null}

            {phase === "countdown" && countdownN !== null && countdownN > 0 ? (
              <div className={styles.countdownFlash}>{countdownN}</div>
            ) : null}

            {phase === "countdown" && countdownN === 0 ? (
              <div className={styles.countdownFlash}>Stare!</div>
            ) : null}

            {phase === "playing" && warnFace ? (
              <div className={styles.warnBanner}>Face not detected — get back in frame!</div>
            ) : null}

            {phase === "lobby" ? (
              <div className={styles.overlayCard}>
                <div className={styles.card}>
                  <div className={styles.cardTitle}>Opponent found.</div>
                  <div className={styles.cardBody}>
                    Tap Ready when you&apos;re set. The game starts when both players are ready.
                  </div>
                  <button type="button" className={styles.primaryBtn} onClick={toggleReady}>
                    {localReady ? "Cancel Ready" : "Ready"}
                  </button>
                  <div className={styles.cardBody}>
                    Opponent: {remoteReady ? "Ready ✓" : "Not ready yet"}
                  </div>
                </div>
              </div>
            ) : null}

            {phase === "ended" ? (
              <div className={styles.overlayCard}>
                <div className={styles.card}>
                  <div className={`${styles.cardTitle} ${endedWinner ? styles.win : styles.lose}`}>
                    {endedWinner ? "You win!" : "You lose!"}
                  </div>
                  <div className={styles.cardBody}>
                    Winner:{" "}
                    {endedWinner ? displayLocalName : displayRemoteName}
                  </div>
                  <div className={styles.cardBody}>
                    You kept your eyes open for {roundSeconds.toFixed(2)} seconds.
                  </div>
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
