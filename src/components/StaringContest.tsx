"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./StaringContest.module.css";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import { createStaringContestLandmarker } from "@/lib/staringContestFaceLandmarker";
import {
  avgEyeBlinkBlendshapeScore,
  computeEyeAspectRatio,
  createBlinkSmoother,
  createHighSignalSmoother,
} from "@/lib/eyeBlinkEar";
import type { StaringNetMsg } from "@/lib/staringContestProtocol";
import { RematchBar } from "@/components/RematchBar";
import { emptyRematchIntent, rematchBothWant, type RematchIntent } from "@/lib/rematchSync";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { useConsumePendingMatch } from "@/hooks/useConsumePendingMatch";
import { GameplayDuelHud } from "@/components/gameface/gameplay/GameplayDuelHud";
import { GameIntroOverlay } from "@/components/gameface/GameIntroOverlay";
import { GAME_INTRO_REGISTRY, type GameIntroSlug } from "@/lib/gameface/gameIntroRegistry";
import { hudPlainUsername, hudUsernameForRemote } from "@/lib/gameface/hudIdentity";
import { copyPrivateInviteLink } from "@/lib/gameface/privateInviteClipboard";
import { PrivateInviteWaitModal } from "@/components/gameface/PrivateInviteWaitModal";
import { startPrivateFriendChallenge, type PrivateMatchPayload } from "@/lib/gameface/privateRoomsClient";
import gp from "@/components/gameface/gameplay/GameplaySurface.module.css";

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
const BLINK_FRAMES = 3;
const QUEUE_POLL_MS = 600;

const VIDEO_DEBUG =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

export type StaringContestProps = {
  autoJoinPublicQueue?: boolean;
  fromRandomMatch?: boolean;
  privateInviteLoading?: boolean;
  privateInviteError?: string | null;
  privateMatch?: PrivateMatchPayload | null;
  privateInviteCode?: string | null;
  introSlug?: GameIntroSlug;
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Same retry pattern as FaceCard / FacePong guest data connection. */
async function connectGuestWithRetry(peer: Parameters<typeof connectGuestToHost>[0], roomId: string) {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      await sleep(i === 0 ? 700 : 350);
      const conn = await Promise.race([
        connectGuestToHost(peer, roomId),
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

/** MM:SS:CC stopwatch from elapsed ms (centiseconds = hundredths of a second). */
function formatStopwatchMs(elapsedMs: number): string {
  const e = Math.max(0, Math.floor(elapsedMs));
  const totalCs = Math.floor(e / 10);
  const mm = Math.min(99, Math.floor(totalCs / 6000));
  const rem = totalCs % 6000;
  const ss = Math.floor(rem / 100);
  const cc = rem % 100;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(mm)}:${pad(ss)}:${pad(cc)}`;
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function StaringContest({
  autoJoinPublicQueue = false,
  fromRandomMatch = false,
  privateInviteLoading = false,
  privateInviteError = null,
  privateMatch = null,
  privateInviteCode = null,
  introSlug,
}: StaringContestProps) {
  const router = useRouter();
  const { profile } = useGameFaceProfile();
  const clientId = profile.userId;

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const dataConnOpenRef = useRef(false);

  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [remoteVideoPlaying, setRemoteVideoPlaying] = useState(false);
  const [localCameraReady, setLocalCameraReady] = useState(false);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  /** Bumped when returning to lobby so the host countdown effect can re-run after session setup. */
  const [lobbyEpoch, setLobbyEpoch] = useState(0);
  /** Dev-only: forces re-read of video debug fields. */
  const [, setVideoDebugTick] = useState(0);

  const [phase, setPhase] = useState<Phase>(() =>
    autoJoinPublicQueue || fromRandomMatch || privateInviteLoading ? "queue" : "intro",
  );
  const phaseRef = useRef<Phase>("intro");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const nameRef = useRef(profile.displayName.trim().slice(0, 24) || "Player");
  useEffect(() => {
    nameRef.current = profile.displayName.trim().slice(0, 24) || "Player";
  }, [profile.displayName]);

  const [status, setStatus] = useState(() => (privateInviteLoading ? "Connecting to friend match…" : ""));
  const [opponentName, setOpponentName] = useState<string | null>(null);

  const [role, setRole] = useState<Role | null>(null);
  const [peerRoomId, setPeerRoomId] = useState<string | null>(null);

  const [localReady, setLocalReady] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);

  const [countdownN, setCountdownN] = useState<number | null>(null);
  /** Elapsed ms while `phase === "playing"` (display only; same wall clock as gameplay). */
  const [playingElapsedMs, setPlayingElapsedMs] = useState(0);

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
  /** Blendshape “eyes closed” scores → streak above threshold (primary blink detector). */
  const blinkBlendSmootherRef = useRef(createHighSignalSmoother(3, 0.38));
  const faceMissingSinceRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const privateAppliedRef = useRef(false);

  const rematchIntentRef = useRef<RematchIntent>(emptyRematchIntent());
  const [, setRematchBump] = useState(0);
  const matchEpochRef = useRef(0);
  const [guestRematch, setGuestRematch] = useState<RematchIntent>(emptyRematchIntent());
  const [opponentLeftMatch, setOpponentLeftMatch] = useState(false);

  const bumpRematchUi = useCallback(() => {
    setRematchBump((x) => x + 1);
  }, []);

  const sendNet = useCallback((msg: StaringNetMsg) => {
    const c = dataRef.current;
    if (c?.open) c.send(msg);
  }, []);

  const bumpVideoDebug = useCallback(() => {
    if (VIDEO_DEBUG) setVideoDebugTick((x) => x + 1);
  }, []);

  /**
   * Attach remote MediaStream to the opponent video pane.
   * - Keeps video + **audio** tracks enabled so each player can hear the other.
   * - Local preview stays `muted` to avoid feedback; remote is **not** muted.
   */
  const attachRemoteStream = useCallback(
    (remoteStream: MediaStream, source: string) => {
      remoteStreamRef.current = remoteStream;
      setHasRemoteStream(true);
      for (const t of remoteStream.getVideoTracks()) {
        t.enabled = true;
      }
      for (const t of remoteStream.getAudioTracks()) {
        t.enabled = true;
      }
      if (VIDEO_DEBUG) {
        const vt = remoteStream.getVideoTracks();
        console.log("[StaringContest] remote stream received", source, {
          streamId: remoteStream.id,
          videoTracks: vt.length,
          audioTracks: remoteStream.getAudioTracks().length,
        });
        for (const t of vt) {
          console.log(
            "[StaringContest] remote video track",
            t.id,
            t.label,
            "enabled",
            t.enabled,
            "muted",
            t.muted,
            "readyState",
            t.readyState,
          );
        }
      }

      const attachToEl = (target: HTMLVideoElement) => {
        target.srcObject = remoteStream;
        target.muted = false;
        if (VIDEO_DEBUG) console.log("[StaringContest] remote video element attach", source);
        void target
          .play()
          .then(() => {
            if (VIDEO_DEBUG) console.log("[StaringContest] remote video playing", source);
          })
          .catch((e) => {
            if (VIDEO_DEBUG) console.warn("[StaringContest] remote video play()", source, e);
          });
      };

      let el = remoteVideoRef.current;
      if (!el) {
        if (VIDEO_DEBUG) {
          console.warn("[StaringContest] attachRemote: no video element yet, retry frame", source);
        }
        requestAnimationFrame(() => {
          el = remoteVideoRef.current;
          if (!el) return;
          attachToEl(el);
          bumpVideoDebug();
        });
        return;
      }
      attachToEl(el);
      bumpVideoDebug();
    },
    [bumpVideoDebug],
  );

  function whenDataConnOpen(conn: any, onOpen: () => void) {
    dataConnOpenRef.current = !!conn.open;
    if (conn.open) {
      setDataChannelReady(true);
      onOpen();
    } else {
      setDataChannelReady(false);
      conn.on("open", () => {
        dataConnOpenRef.current = true;
        setDataChannelReady(true);
        onOpen();
      });
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
    dataConnOpenRef.current = false;
    remoteStreamRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setHasRemoteStream(false);
    setRemoteVideoPlaying(false);
    setDataChannelReady(false);
    setLocalCameraReady(false);
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
    streamRef.current = null;
  }

  function broadcastRematchStateFromHost() {
    if (hostRoleRef.current !== "host") return;
    sendNet({
      t: "sc_rematch_state",
      host: rematchIntentRef.current.host,
      guest: rematchIntentRef.current.guest,
      matchEpoch: matchEpochRef.current,
    });
  }

  async function ensureCamera() {
    if (streamRef.current) {
      setLocalCameraReady(streamRef.current.getVideoTracks().length > 0);
      return streamRef.current;
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
        frameRate: { ideal: 30, max: 30 },
      },
    });
    streamRef.current = stream;
    setLocalCameraReady(stream.getVideoTracks().length > 0);
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
    const trimmed = profile.displayName.trim().slice(0, 24) || "Player";
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
    setPhase("intro");
    setStatus("");
  }

  useEffect(() => {
    if (phase !== "intro") return;
    void ensureCamera();
  }, [phase]);

  async function applyMatch(roomId: string, r: Role, opp: string) {
    setPeerRoomId(roomId);
    setRole(r);
    hostRoleRef.current = r;
    setOpponentName(opp);
    setStatus("Opponent found.");
    setPhase("peer_setup");
    await setupPeer(roomId, r);
    setPhase("lobby");
    setLobbyEpoch((e) => e + 1);
  }

  useConsumePendingMatch("staring", (p) => {
    void applyMatch(p.peerRoomId, p.role, "");
  });

  useEffect(() => {
    if (!privateInviteError || privateInviteLoading) return;
    setPhase("intro");
    setStatus(privateInviteError);
  }, [privateInviteError, privateInviteLoading]);

  useEffect(() => {
    if (!privateMatch || privateAppliedRef.current) return;
    privateAppliedRef.current = true;
    void applyMatch(privateMatch.peerRoomId, privateMatch.role, "");
  }, [privateMatch]);

  function resolveLoss(fromHost: boolean) {
    if (gameEndedRef.current) return;
    rematchIntentRef.current = emptyRematchIntent();
    bumpRematchUi();
    broadcastRematchStateFromHost();

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

  function hostTryApplyRematch() {
    if (hostRoleRef.current !== "host") return;
    if (phaseRef.current !== "ended") return;
    if (!rematchBothWant(rematchIntentRef.current)) return;

    matchEpochRef.current += 1;
    const epoch = matchEpochRef.current;
    rematchIntentRef.current = emptyRematchIntent();
    bumpRematchUi();

    gameEndedRef.current = false;
    gameStartWallMsRef.current = null;
    faceMissingSinceRef.current = null;
    setEndedWinner(null);
    setRoundSeconds(0);
    setPlayingElapsedMs(0);
    setCountdownN(null);
    setWarnFace(false);
    earCalibRef.current = [];
    earThresholdRef.current = 0.22;
    blinkSmootherRef.current.reset();
    blinkBlendSmootherRef.current.reset();
    setLocalReady(false);
    setRemoteReady(false);
    setPhase("lobby");
    setLobbyEpoch((e) => e + 1);

    sendNet({ t: "sc_rematch_go", matchEpoch: epoch });
    sendNet({
      t: "sc_rematch_state",
      host: false,
      guest: false,
      matchEpoch: epoch,
    });
    sendNet({ t: "ready", ready: false });
  }

  function guestApplyRematchGo(epoch: number) {
    void epoch;
    setGuestRematch(emptyRematchIntent());
    gameEndedRef.current = false;
    gameStartWallMsRef.current = null;
    faceMissingSinceRef.current = null;
    setEndedWinner(null);
    setRoundSeconds(0);
    setPlayingElapsedMs(0);
    setCountdownN(null);
    setWarnFace(false);
    earCalibRef.current = [];
    earThresholdRef.current = 0.22;
    blinkSmootherRef.current.reset();
    blinkBlendSmootherRef.current.reset();
    setLocalReady(false);
    setRemoteReady(false);
    setPhase("lobby");
    setLobbyEpoch((e) => e + 1);
    sendNet({ t: "ready", ready: false });
  }

  function requestRematch() {
    if (phaseRef.current !== "ended") return;
    if (hostRoleRef.current === "host") {
      rematchIntentRef.current = { ...rematchIntentRef.current, host: true };
      bumpRematchUi();
      broadcastRematchStateFromHost();
      queueMicrotask(() => hostTryApplyRematch());
    } else {
      sendNet({ t: "sc_rematch", want: true });
    }
  }

  function leaveMatch() {
    void leaveQueue();
    cleanupPeer();
    setPhase("intro");
    setStatus("");
    setOpponentName(null);
    setOpponentLeftMatch(false);
  }

  function returnToArcade() {
    leaveMatch();
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

      if (isHost && msg.t === "sc_rematch") {
        rematchIntentRef.current = { ...rematchIntentRef.current, guest: msg.want };
        bumpRematchUi();
        broadcastRematchStateFromHost();
        queueMicrotask(() => hostTryApplyRematch());
        return;
      }

      if (!isHost) {
        if (msg.t === "sc_rematch_state") {
          setGuestRematch({ host: msg.host, guest: msg.guest });
          return;
        }
        if (msg.t === "sc_rematch_go") {
          guestApplyRematchGo(msg.matchEpoch);
          return;
        }
        if (msg.t === "countdown") {
          setPhase("countdown");
          setCountdownN(msg.n);
          return;
        }
        if (msg.t === "game_go") {
          gameStartWallMsRef.current = msg.startWallMs;
          blinkSmootherRef.current.reset();
          blinkBlendSmootherRef.current.reset();
          gameEndedRef.current = false;
          setCountdownN(null);
          const med = median(earCalibRef.current);
          if (med > 0) {
            earThresholdRef.current = Math.max(0.10, Math.min(0.34, med * 0.62));
          } else {
            earThresholdRef.current = 0.2;
          }
          const delay = Math.max(0, msg.startWallMs - Date.now());
          window.setTimeout(() => setPhase("playing"), delay);
          return;
        }
        if (msg.t === "game_over") {
          if (phaseRef.current !== "playing" && phaseRef.current !== "countdown") return;
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
          attachRemoteStream(remoteStream, "host_call_answer");
        });
        call.on("error", (err: unknown) => {
          if (VIDEO_DEBUG) console.warn("[StaringContest] host media connection error", err);
        });
      });

      const conn = await waitForHostConnection(peer);
      dataRef.current = conn;
      setOpponentLeftMatch(false);
      wireData(conn, true);

      conn.on("close", () => {
        setOpponentLeftMatch(true);
        setDataChannelReady(false);
      });

      whenDataConnOpen(conn, () => {
        sendNet({ t: "hello", name: nameRef.current || "Player" });
      });
    } else {
      const peer = await createGuestPeer();
      peerRef.current = peer;

      const conn = await connectGuestWithRetry(peer, roomId);
      dataRef.current = conn;
      setOpponentLeftMatch(false);
      wireData(conn, false);

      conn.on("close", () => {
        setOpponentLeftMatch(true);
        setDataChannelReady(false);
      });

      whenDataConnOpen(conn, () => {
        sendNet({ t: "hello", name: nameRef.current || "Player" });
      });

      /* FacePong order: data channel first, outbound call, then answer incoming (symmetric/media). */
      const call = peer.call(roomId, stream);
      call.on("stream", (remoteStream: MediaStream) => {
        attachRemoteStream(remoteStream, "guest_call_out");
      });
      call.on("error", (err: unknown) => {
        if (VIDEO_DEBUG) console.warn("[StaringContest] guest outbound media error", err);
      });

      guestAnswerCalls(peer, stream, (incoming) => {
        incoming.on("stream", (remoteStream: MediaStream) => {
          attachRemoteStream(remoteStream, "guest_call_in");
        });
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
        earThresholdRef.current = Math.max(0.10, Math.min(0.34, med * 0.62));
      }

      const startWallMs = Date.now() + GRACE_MS;
      sendNet({ t: "game_go", startWallMs });
      gameStartWallMsRef.current = startWallMs;
      gameEndedRef.current = false;
      blinkSmootherRef.current.reset();
      blinkBlendSmootherRef.current.reset();
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
  }, [localReady, remoteReady, role, sendNet, lobbyEpoch]);

  useEffect(() => {
    if (!VIDEO_DEBUG) return;
    const id = window.setInterval(() => setVideoDebugTick((x) => x + 1), 400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let lm: Awaited<ReturnType<typeof createStaringContestLandmarker>> | null = null;
    let raf = 0;

    const tick = async () => {
      if (cancelled) return;
      const ph = phaseRef.current;
      const now = performance.now();

      // Timer uses wall clock only — must not depend on video readiness or landmark detection.
      if (ph === "playing" && gameStartWallMsRef.current != null) {
        setPlayingElapsedMs(Math.max(0, Date.now() - gameStartWallMsRef.current));
      }

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
            const wallNow = Date.now();
            const startWallMs = gameStartWallMsRef.current;

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
              const blendAvg = avgEyeBlinkBlendshapeScore(res.faceBlendshapes);
              const blendBlink = blinkBlendSmootherRef.current.update(blendAvg);
              const earBlink = blinkSmootherRef.current.update(ear, {
                openThreshold: earThresholdRef.current,
              });

              if (
                !graceActive &&
                hostRoleRef.current &&
                !gameEndedRef.current &&
                (blendBlink || earBlink.isLikelyBlink)
              ) {
                if (hostRoleRef.current === "host") resolveLoss(true);
                else sendNet({ t: "blink", fromHost: false, atMs: Date.now() });
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

  const displayLocalName = profile.displayName.trim() || "Guest";
  const displayRemoteName = opponentName?.trim() || "Connecting";

  const showPrivateInviteWait =
    phase === "lobby" && role === "host" && !!privateInviteCode && !dataChannelReady;

  const introCfg = introSlug ? GAME_INTRO_REGISTRY[introSlug] : GAME_INTRO_REGISTRY["staring-contest"];

  const showGameChrome =
    phase === "intro" ||
    phase === "peer_setup" ||
    phase === "lobby" ||
    phase === "countdown" ||
    phase === "playing" ||
    phase === "ended";

  return (
    <div className={styles.root}>
      {phase === "intro" ? (
        <GameIntroOverlay
          placement="viewport"
          accent={introCfg.accent}
          gameTitle={introCfg.title}
          howToPlayText={introCfg.description}
          onFindMatch={() => void findMatch()}
          onChallengeFriend={() => void startPrivateFriendChallenge(router, introCfg.slug)}
          onGoHome={() => router.push("/")}
        />
      ) : null}

      {phase === "queue" && !autoJoinPublicQueue ? (
        <div className={gp.fullOverlay}>
          <div className={gp.glassPanel}>
            <p className={gp.resultKicker}>Staring contest</p>
            <p className={gp.resultTitle} style={{ fontSize: "clamp(20px, 5vw, 26px)", marginTop: "6px" }}>
              Finding a player…
            </p>
            <p className={gp.resultDetail} style={{ marginTop: "10px", textAlign: "center" }}>
              {status || "Hang tight — we’ll drop you in as soon as someone is online."}
            </p>
            <button
              type="button"
              className={gp.surfacePillGhost}
              style={{ marginTop: "18px", width: "100%" }}
              onClick={() => void cancelQueueSearch()}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {phase === "queue" && autoJoinPublicQueue ? (
        <div className={gp.fullOverlay}>
          <div className={gp.glassPanel}>
            <p className={gp.resultKicker}>Staring contest</p>
            <p className={gp.resultTitle} style={{ fontSize: "clamp(20px, 5vw, 26px)", marginTop: "6px" }}>
              Finding a player…
            </p>
            <p className={gp.resultDetail} style={{ marginTop: "10px", textAlign: "center" }}>
              {status || "Hang tight — we’ll drop you in as soon as someone is online."}
            </p>
            <button type="button" className={gp.surfacePillGhost} style={{ marginTop: "18px", width: "100%" }} onClick={() => void cancelQueueSearch()}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showGameChrome ? (
        <div className={gp.surfaceRoot}>
          <div className={gp.surfaceVignette} aria-hidden />
          <GameplayDuelHud
            gameBadge="Stare"
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
          {VIDEO_DEBUG ? (
            <div className={styles.debugOverlay} aria-hidden>
              <div>localCameraReady: {String(localCameraReady)}</div>
              <div>remotePeerConnected: {String(dataChannelReady)}</div>
              <div>remoteStreamExists: {String(hasRemoteStream)}</div>
              <div>remoteVideoTracks: {remoteStreamRef.current?.getVideoTracks().length ?? 0}</div>
              <div>remoteVideoPlaying: {String(remoteVideoPlaying)}</div>
              <div>myReady: {String(localReady)}</div>
              <div>opponentReady: {String(remoteReady)}</div>
              <div>amIHost: {String(role === "host")}</div>
              <div>gameState: {phase}</div>
            </div>
          ) : null}
          <div className={gp.surfaceMain}>
            <div className={gp.surfaceStage}>
              <div className={gp.surfaceSplit}>
                {phase === "countdown" && countdownN !== null && countdownN > 0 ? (
                  <div className={gp.countdownCurtain} aria-hidden>
                    <div className={gp.countdownGlyph}>{countdownN}</div>
                  </div>
                ) : null}
                {phase === "countdown" && countdownN === 0 ? (
                  <div className={gp.countdownCurtain} aria-hidden>
                    <div className={gp.stinger}>Stare!</div>
                  </div>
                ) : null}

                <div className={`${gp.surfacePane} ${gp.surfacePaneOpponent}`}>
                  <video
                    ref={remoteVideoRef}
                    className={`${gp.surfaceFeed} ${styles.video} ${styles.videoRemote}`}
                    playsInline
                    autoPlay
                    onPlaying={() => {
                      setRemoteVideoPlaying(true);
                      bumpVideoDebug();
                    }}
                    onPause={() => {
                      setRemoteVideoPlaying(false);
                      bumpVideoDebug();
                    }}
                    onLoadedData={() => bumpVideoDebug()}
                  />
                </div>

                {phase === "playing" ? (
                  <div className={gp.surfaceCenterHud} role="timer" aria-live="off">
                    <span className={gp.surfaceCenterMuted}>Hold eye contact</span>
                    <span className={gp.surfaceCenterTimer}>{formatStopwatchMs(playingElapsedMs)}</span>
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

                  {phase === "playing" && warnFace ? (
                    <div className={gp.riskRibbon}>Face lost · get back in frame</div>
                  ) : null}

                  {phase === "lobby" && !showPrivateInviteWait ? (
                    <div className={gp.floatingGlass}>
                      <div className={gp.glassPanel}>
                        <div className={gp.resultKicker}>Lobby</div>
                        <div className={gp.resultTitle}>Opponent found</div>
                        <div className={gp.resultDetail}>
                          Tap ready when your camera is set. The round starts automatically when both players are ready.
                        </div>
                        {!dataChannelReady ? (
                          <div className={gp.resultDetail}>Connecting…</div>
                        ) : hasRemoteStream && !remoteVideoPlaying ? (
                          <div className={gp.resultDetail}>Waiting for opponent video…</div>
                        ) : null}
                        <button
                          type="button"
                          className={gp.surfacePill}
                          style={{ marginTop: "14px", width: "100%" }}
                          onClick={toggleReady}
                          disabled={!dataChannelReady || !localCameraReady}
                        >
                          {localReady ? "Cancel ready" : "Ready"}
                        </button>
                        <div className={gp.resultDetail} style={{ marginTop: "10px" }}>
                          Them: {remoteReady ? "Ready ✓" : "Waiting"}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {phase === "ended" ? (
                <div className={gp.floatingGlass}>
                  <div className={gp.glassPanel}>
                    {!endedWinner ? (
                      <>
                        <div className={gp.stinger} style={{ fontSize: "clamp(26px, 9vw, 44px)" }}>
                          Blink detected
                        </div>
                        <div className={gp.stingerSub}>You blinked first — round over.</div>
                      </>
                    ) : (
                      <>
                        <div className={gp.resultKicker}>Victory</div>
                        <div className={gp.resultTitle}>You held longer</div>
                      </>
                    )}
                    <div className={gp.resultDetail}>
                      Winner · {endedWinner ? displayLocalName : displayRemoteName}
                    </div>
                    <div className={gp.resultDetail}>Time · {roundSeconds.toFixed(2)}s</div>
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
        {showPrivateInviteWait && privateInviteCode ? (
          <PrivateInviteWaitModal
            gameTitle={introCfg.title}
            plainUsername={hudPlainUsername(profile.username)}
            playPath={introCfg.playPath}
            inviteCode={privateInviteCode}
            onCopy={() => void copyPrivateInviteLink(introCfg.playPath, privateInviteCode)}
            onCancel={leaveMatch}
            onGoHome={() => router.push("/")}
          />
        ) : null}
        </div>
      ) : null}
    </div>
  );
}
