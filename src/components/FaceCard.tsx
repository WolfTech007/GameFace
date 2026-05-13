"use client";

import React, { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import styles from "./FaceCard.module.css";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import { createFaceLandmarker } from "@/lib/mediapipeFaceLandmarker";
import { foreheadFromLandmarks, type ForeheadPlacement } from "@/lib/facecardForehead";
import { drawFaceCardOverlay } from "@/lib/facecardDraw";
import { POP_CULTURE_DECK, pickTwoDistinctRandom } from "@/lib/facecardDeck";
import { guessMatchesSecret } from "@/lib/facecardGuess";
import type { FaceCardNetMsg } from "@/lib/facecardProtocol";
import { RematchBar } from "@/components/RematchBar";
import { emptyRematchIntent, rematchBothWant, type RematchIntent } from "@/lib/rematchSync";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { GameplayDuelHud } from "@/components/gameface/gameplay/GameplayDuelHud";
import { hudPlainUsername, hudUsernameForRemote } from "@/lib/gameface/hudIdentity";
import gp from "@/components/gameface/gameplay/GameplaySurface.module.css";

type Phase = "intro" | "queue" | "peer_setup" | "lobby" | "playing" | "ended";

type Role = "host" | "guest";

const QUEUE_POLL_MS = 600;

/** Landing page (rules + Find Match) when returning from `/facecard/play`. */
const DEFAULT_FACECARD_INTRO_HREF = "/facecard";

/** Exponential smoothing so note cards stick to the forehead like a lightweight AR filter. */
function smoothForehead(
  store: MutableRefObject<{ nx: number; ny: number }>,
  raw: ForeheadPlacement,
  alpha: number,
): ForeheadPlacement {
  if (raw.kind === "fallback") {
    store.current = { nx: raw.nx, ny: raw.ny };
    return raw;
  }
  store.current.nx += (raw.nx - store.current.nx) * alpha;
  store.current.ny += (raw.ny - store.current.ny) * alpha;
  return { kind: "tracked", nx: store.current.nx, ny: store.current.ny };
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

type EndPayload =
  | {
      kind: "won";
      youWere: string;
      durationSec: number;
      guessesUsed: number;
    }
  | { kind: "lost"; youWere: string }
  | { kind: "draw"; hostCard: string; guestCard: string; durationSec: number };

export type FaceCardProps = {
  autoJoinPublicQueue?: boolean;
  fromRandomMatch?: boolean;
  introHref?: string;
};

export default function FaceCard({
  autoJoinPublicQueue = false,
  fromRandomMatch: _fromRandomMatch = false,
  introHref,
}: FaceCardProps) {
  const router = useRouter();
  const { profile } = useGameFaceProfile();
  const clientId = profile.userId;

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const remoteOverlayRef = useRef<HTMLCanvasElement | null>(null);

  const [phase, setPhase] = useState<Phase>(() => (autoJoinPublicQueue ? "queue" : "intro"));
  const phaseRef = useRef<Phase>("intro");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const nameRef = useRef(profile.displayName.trim().slice(0, 24) || "Player");
  useEffect(() => {
    nameRef.current = profile.displayName.trim().slice(0, 24) || "Player";
  }, [profile.displayName]);

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

  const overlaySmoothLocalRef = useRef({ nx: 0.5, ny: 0.28 });
  const overlaySmoothRemoteRef = useRef({ nx: 0.5, ny: 0.28 });

  const gameEndedRef = useRef(false);
  /** Prevents duplicate fc_begin if auto-start runs twice in one tick. */
  const startingFromLobbyRef = useRef(false);

  const [endPayload, setEndPayload] = useState<EndPayload | null>(null);

  const rematchIntentRef = useRef<RematchIntent>(emptyRematchIntent());
  const [, setRematchBump] = useState(0);
  const matchEpochRef = useRef(0);
  const [guestRematch, setGuestRematch] = useState<RematchIntent>(emptyRematchIntent());
  const [opponentLeftMatch, setOpponentLeftMatch] = useState(false);

  const peerRef = useRef<{ destroy?: () => void } | null>(null);
  const dataRef = useRef<{ open?: boolean; send: (m: FaceCardNetMsg) => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  const sendNet = useCallback((msg: FaceCardNetMsg) => {
    const c = dataRef.current as { open?: boolean; send?: (m: FaceCardNetMsg) => void } | null;
    if (c?.open && c.send) c.send(msg);
  }, []);

  const bumpRematchUi = useCallback(() => {
    setRematchBump((x) => x + 1);
  }, []);

  function broadcastRematchStateFromHost() {
    if (roleRef.current !== "host") return;
    sendNet({
      t: "fc_rematch_state",
      host: rematchIntentRef.current.host,
      guest: rematchIntentRef.current.guest,
      matchEpoch: matchEpochRef.current,
    });
  }

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

    rematchIntentRef.current = emptyRematchIntent();
    bumpRematchUi();
    broadcastRematchStateFromHost();

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
    if (phaseRef.current !== "playing") return;
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

  function hostTryApplyRematch() {
    if (roleRef.current !== "host") return;
    if (phaseRef.current !== "ended") return;
    if (!rematchBothWant(rematchIntentRef.current)) return;

    matchEpochRef.current += 1;
    const epoch = matchEpochRef.current;
    rematchIntentRef.current = emptyRematchIntent();
    bumpRematchUi();

    gameEndedRef.current = false;
    hostSecretRef.current = null;
    guestSecretRef.current = null;
    remoteCardLabelRef.current = "";
    startWallMsRef.current = null;
    syncPhysicalGuesses(3, 3);
    myGuessAttemptsRef.current = 0;
    setTimerSec(0);
    setEndPayload(null);
    setGuessModalOpen(false);
    setGuessInput("");
    setToast(null);
    setLocalReady(false);
    setRemoteReady(false);
    setPhase("lobby");

    sendNet({ t: "fc_rematch_go", matchEpoch: epoch });
    sendNet({
      t: "fc_rematch_state",
      host: false,
      guest: false,
      matchEpoch: epoch,
    });
    sendNet({ t: "fc_ready", ready: false });
  }

  function guestApplyRematchGo(epoch: number) {
    void epoch;
    setGuestRematch(emptyRematchIntent());
    gameEndedRef.current = false;
    hostSecretRef.current = null;
    guestSecretRef.current = null;
    remoteCardLabelRef.current = "";
    startWallMsRef.current = null;
    syncPhysicalGuesses(3, 3);
    myGuessAttemptsRef.current = 0;
    setTimerSec(0);
    setEndPayload(null);
    setGuessModalOpen(false);
    setGuessInput("");
    setToast(null);
    setLocalReady(false);
    setRemoteReady(false);
    setPhase("lobby");
    sendNet({ t: "fc_ready", ready: false });
  }

  function requestRematch() {
    if (phaseRef.current !== "ended") return;
    if (roleRef.current === "host") {
      rematchIntentRef.current = { ...rematchIntentRef.current, host: true };
      bumpRematchUi();
      broadcastRematchStateFromHost();
      queueMicrotask(() => hostTryApplyRematch());
    } else {
      sendNet({ t: "fc_rematch", want: true });
    }
  }

  function leaveMatch() {
    void leaveQueue();
    cleanupPeer();
    router.push(introHref ?? DEFAULT_FACECARD_INTRO_HREF);
  }

  function returnToArcade() {
    leaveMatch();
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
      if (msg.t === "fc_rematch") {
        rematchIntentRef.current = { ...rematchIntentRef.current, guest: msg.want };
        bumpRematchUi();
        broadcastRematchStateFromHost();
        queueMicrotask(() => hostTryApplyRematch());
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
      if (msg.t === "fc_rematch_state") {
        setGuestRematch({ host: msg.host, guest: msg.guest });
        return;
      }
      if (msg.t === "fc_rematch_go") {
        guestApplyRematchGo(msg.matchEpoch);
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
      setOpponentLeftMatch(false);
      wireHost(conn);

      conn.on("close", () => {
        setOpponentLeftMatch(true);
      });

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
      setOpponentLeftMatch(false);
      wireGuest(conn);

      conn.on("close", () => {
        setOpponentLeftMatch(true);
      });

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

  useEffect(() => {
    if (!autoJoinPublicQueue) return;
    void findMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot queue join from GameIntro
  }, [autoJoinPublicQueue]);

  async function cancelQueueSearch() {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    await leaveQueue();
    router.push(introHref ?? DEFAULT_FACECARD_INTRO_HREF);
  }

  function toggleReady() {
    const next = !localReady;
    setLocalReady(next);
    sendNet({ t: "fc_ready", ready: next });
  }

  function hostStartGame() {
    if (role !== "host" || !localReady || !remoteReady || gameEndedRef.current) return;
    if (phaseRef.current !== "lobby") return;
    if (startingFromLobbyRef.current) return;
    startingFromLobbyRef.current = true;
    try {
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
    } finally {
      queueMicrotask(() => {
        startingFromLobbyRef.current = false;
      });
    }
  }

  useEffect(() => {
    if (phase !== "lobby" || role !== "host") return;
    if (!localReady || !remoteReady) return;
    queueMicrotask(() => hostStartGame());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hostStartGame ties host lobby → playing once both ready
  }, [phase, role, localReady, remoteReady]);

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
    if (phase !== "playing") {
      overlaySmoothLocalRef.current = { nx: 0.5, ny: 0.28 };
      overlaySmoothRemoteRef.current = { nx: 0.5, ny: 0.28 };
    }
  }, [phase]);

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
          const smoothed = smoothForehead(overlaySmoothRemoteRef, placement, 0.44);
          const label =
            roleRef.current === "host"
              ? guestSecretRef.current ?? ""
              : remoteCardLabelRef.current ?? "";
          drawFaceCardOverlay(ctx, sz.cssW, sz.cssH, sz.dpr, smoothed, label || null, false);
        }
      }

      if (localV && locCanvas && localV.readyState >= 2) {
        const sz = resizeCanvas(locCanvas, localV);
        const ctx = locCanvas.getContext("2d");
        if (ctx && sz) {
          const res = lm.detectForVideo(localV, now);
          const landmarks = res.faceLandmarks?.[0];
          const placement = foreheadFromLandmarks(landmarks as { x: number; y: number }[] | undefined);
          const smoothed = smoothForehead(overlaySmoothLocalRef, placement, 0.44);
          drawFaceCardOverlay(ctx, sz.cssW, sz.cssH, sz.dpr, smoothed, null, true);
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

  const displayLocalName = profile.displayName.trim() || "Guest";
  const displayRemoteName = opponentName?.trim() || "Connecting";

  /** Intro with Find Match — only when not entering from GameIntro (?queue=1). */
  const showLegacyIntro = (phase === "intro" || phase === "queue") && !autoJoinPublicQueue;
  const showGame =
    phase === "peer_setup" ||
    phase === "lobby" ||
    phase === "playing" ||
    phase === "ended";

  const isHostPlayer = role === "host";
  const myLeft = isHostPlayer ? hostGuessCount : guestGuessCount;
  const theirLeft = isHostPlayer ? guestGuessCount : hostGuessCount;

  const outOfGuesses = phase === "playing" && myLeft <= 0 && !gameEndedRef.current;

  return (
    <div className={styles.root}>
      {showLegacyIntro ? (
        <div className={styles.intro}>
          <div className={styles.bigTitle}>FaceCard</div>
          <div className={styles.tagline}>Guess who you are.</div>

          <div className={styles.menuHint}>
            Playing as <strong>{displayLocalName}</strong>
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

      {phase === "queue" && autoJoinPublicQueue ? (
        <div className={gp.fullOverlay}>
          <div className={gp.glassPanel}>
            <p className={gp.resultKicker}>Face card</p>
            <p className={gp.resultTitle} style={{ fontSize: "clamp(20px, 5vw, 26px)", marginTop: "6px" }}>
              Finding a player…
            </p>
            <p className={gp.resultDetail} style={{ marginTop: "10px", textAlign: "center" }}>
              {status || "Hang tight — pairing you with the next available player."}
            </p>
            <button type="button" className={gp.surfacePillGhost} style={{ marginTop: "18px", width: "100%" }} onClick={() => void cancelQueueSearch()}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showGame ? (
        <div className={gp.surfaceRoot}>
          <div className={gp.surfaceVignette} aria-hidden />
          <GameplayDuelHud
            gameBadge="Face Card"
            opponent={{
              displayName: displayRemoteName,
              username: hudUsernameForRemote(displayRemoteName),
              online: true,
            }}
            you={{
              displayName: displayLocalName,
              username: hudPlainUsername(profile.username),
              online: true,
            }}
          />
        <div className={gp.surfaceMain}>
          <div className={gp.surfaceStage}>
          <div className={gp.surfaceSplit}>
          <div className={`${gp.surfacePane} ${gp.surfacePaneOpponent}`}>
            <video
              ref={remoteVideoRef}
              className={`${gp.surfaceFeed} ${styles.video} ${styles.videoRemote}`}
              playsInline
              autoPlay
            />
            <canvas ref={remoteOverlayRef} className={styles.overlayCanvas} aria-hidden />
          </div>

            {phase === "playing" ? (
              <div className={gp.surfaceCenterHud}>
                <span className={gp.surfaceCenterMuted}>Clock</span>
                <span className={gp.surfaceCenterTimer}>{timerSec.toFixed(2)}s</span>
                <span className={gp.surfaceCenterMuted}>
                  You {myLeft}/3 · Them {theirLeft}/3
                </span>
              </div>
            ) : null}

            <div className={`${gp.surfacePane} ${gp.surfacePaneYou}`}>
              <video
                ref={localVideoRef}
                className={`${gp.surfaceFeed} ${gp.surfaceFeedMirror} ${styles.video} ${styles.videoLocal}`}
                playsInline
                muted
                autoPlay
              />
              <canvas ref={localOverlayRef} className={styles.overlayCanvas} aria-hidden />

              {outOfGuesses ? <div className={gp.riskRibbon}>Out of guesses</div> : null}

              {toast ? <div className={styles.toast}>{toast}</div> : null}

              {phase === "lobby" ? (
                <div className={gp.floatingGlass}>
                  <div className={gp.glassPanel}>
                    <div className={gp.resultKicker}>Lobby</div>
                    <div className={gp.resultTitle}>Opponent locked in</div>
                    <div className={gp.resultDetail}>Tap ready when your camera is stable.</div>
                    <button type="button" className={gp.surfacePill} style={{ marginTop: "14px", width: "100%" }} onClick={toggleReady}>
                      {localReady ? "Cancel ready" : "Ready"}
                    </button>
                    <div className={gp.resultDetail} style={{ marginTop: "10px" }}>
                      Them: {remoteReady ? "Ready ✓" : "Waiting"}
                    </div>
                    <div className={gp.resultDetail} style={{ marginTop: "10px" }}>
                      When both players are ready, the game starts automatically.
                    </div>
                  </div>
                </div>
              ) : null}

              {phase === "playing" && myLeft > 0 ? (
                <div className={gp.surfaceDock}>
                  <button type="button" className={gp.surfacePill} onClick={() => setGuessModalOpen(true)}>
                    Make a guess
                  </button>
                </div>
              ) : null}

              {guessModalOpen ? (
                <div className={gp.fullOverlay} role="presentation" onClick={() => setGuessModalOpen(false)}>
                  <div className={gp.glassPanel} role="dialog" aria-labelledby="guess-title" onClick={(e) => e.stopPropagation()}>
                    <div id="guess-title" className={gp.resultTitle} style={{ fontSize: "18px", marginBottom: "12px" }}>
                      Who are you?
                    </div>
                    <input className={styles.modalInput} value={guessInput} onChange={(e) => setGuessInput(e.target.value)} placeholder="Your guess" autoComplete="off" />
                    <div style={{ display: "flex", gap: "10px", marginTop: "14px", justifyContent: "center", flexWrap: "wrap" }}>
                      <button type="button" className={gp.surfacePillGhost} onClick={() => setGuessModalOpen(false)}>
                        Cancel
                      </button>
                      <button type="button" className={gp.surfacePill} onClick={submitGuess}>
                        Submit
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          {phase === "ended" && endPayload ? (
            <div className={gp.floatingGlass}>
              <div className={gp.glassPanel}>
                {endPayload.kind === "won" ? (
                  <>
                    <div className={gp.resultKicker}>Victory</div>
                    <div className={gp.resultTitle}>You cracked it</div>
                    <div className={gp.resultDetail}>You were {endPayload.youWere}</div>
                    <div className={gp.resultDetail}>
                      {endPayload.durationSec.toFixed(2)}s · {endPayload.guessesUsed}/3 guesses
                    </div>
                  </>
                ) : endPayload.kind === "lost" ? (
                  <>
                    <div className={gp.resultKicker}>They got it</div>
                    <div className={gp.resultTitle}>Too slow</div>
                    <div className={gp.resultDetail}>You were {endPayload.youWere}</div>
                  </>
                ) : (
                  <>
                    <div className={gp.resultTitle}>Draw</div>
                    <div className={gp.resultDetail}>
                      {endPayload.hostCard} · {endPayload.guestCard}
                    </div>
                    <div className={gp.resultDetail}>{endPayload.durationSec.toFixed(2)}s</div>
                  </>
                )}
                <RematchBar
                  iWantRematch={role === "host" ? rematchIntentRef.current.host : guestRematch.guest}
                  theyWantRematch={role === "host" ? rematchIntentRef.current.guest : guestRematch.host}
                  onRematch={requestRematch}
                  onLeave={leaveMatch}
                  opponentLeft={opponentLeftMatch}
                  onReturnArcade={returnToArcade}
                  onGoHome={() => router.push("/")}
                />
              </div>
            </div>
          ) : null}
          </div>
        </div>
        </div>
      ) : null}
    </div>
  );
}
