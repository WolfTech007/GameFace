"use client";

import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import styles from "./LipReader.module.css";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import {
  cloneLipReaderState,
  initialLipReaderState,
  pickRandomWord,
  redactLipStateForGuest,
  type GuestToHostLipMsg,
  type HostToGuestLipMsg,
  type LipReaderNetState,
} from "@/lib/lipreaderProtocol";
import { guessMatchesSecret } from "@/lib/lipreaderGuess";
import { RematchBar } from "@/components/RematchBar";
import { emptyRematchIntent, rematchBothWant } from "@/lib/rematchSync";

const QUEUE_POLL_MS = 600;
/** Set true locally to verify round/guess sync; keep false in production. */
const LIP_READER_UI_DEBUG = false;

type Role = "host" | "guest";

function makeClientId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  const k = "facearcade-lr-id";
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

export default function LipReader() {
  const clientId = useMemo(() => makeClientId(), []);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const [uiMenu, setUiMenu] = useState(true);
  const [matchmaking, setMatchmaking] = useState(false);
  const [name, setName] = useState("");
  const nameRef = useRef("");
  useEffect(() => {
    nameRef.current = name.trim();
  }, [name]);

  const [status, setStatus] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const roleRef = useRef<Role | null>(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [opponentLeftMatch, setOpponentLeftMatch] = useState(false);
  const [micOk, setMicOk] = useState<boolean | null>(null);

  const peerRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const matchPollRef = useRef<number | null>(null);
  const scheduledTimersRef = useRef<number[]>([]);

  /** Host: full authoritative state. Guest: redacted copy from host (no secret when guesser). */
  const gameStateRef = useRef<LipReaderNetState>(initialLipReaderState());
  const hostSeqRef = useRef(0);
  const lastGuestSeqRef = useRef(-1);

  const [viewGen, bumpView] = useReducer((x: number) => x + 1, 0);
  const lastResetRoundIdRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [tick, setTick] = useState(0);
  const [guessModalOpen, setGuessModalOpen] = useState(false);
  const [guessInput, setGuessInput] = useState("");

  function clearScheduledTimers() {
    for (const id of scheduledTimersRef.current) window.clearTimeout(id);
    scheduledTimersRef.current = [];
  }

  function broadcastToGuest() {
    if (roleRef.current !== "host") return;
    hostSeqRef.current += 1;
    const payload: HostToGuestLipMsg = {
      t: "lr_state",
      state: redactLipStateForGuest(gameStateRef.current),
      seq: hostSeqRef.current,
      sentAt: performance.now(),
    };
    const c = dataRef.current;
    if (c?.open) c.send(payload);
    bumpView();
  }

  async function ensureLocalCamera(opts?: { force?: boolean }) {
    if (localStreamRef.current && !opts?.force) {
      setMicOk(localStreamRef.current.getAudioTracks().length > 0);
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
        frameRate: { ideal: 30, max: 30 },
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
      await fetch("/api/lipreader/queue", {
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
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch {
        /* ignore */
      }
    }
    peerRef.current = null;
    dataRef.current = null;
    const s = localStreamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
    localStreamRef.current = null;
    gameStateRef.current = initialLipReaderState();
    lastGuestSeqRef.current = -1;
  }

  function sendToHost(msg: GuestToHostLipMsg) {
    const c = dataRef.current;
    if (c?.open) c.send(msg);
  }

  function finishRoundWin(s: LipReaderNetState) {
    const elapsed = s.roundStartAt ? Date.now() - s.roundStartAt : 0;
    s.sessionRematch = emptyRematchIntent();
    s.phase = "round_result";
    s.roundDurationMs = elapsed;
    s.roundEndReason = "correct";
    s.lastRoundWord = s.secretWord;
    s.lastRoundTimeMs = elapsed;
    s.lastRoundAttempts = s.attemptsThisRound;
    s.guesserHint = null;
    s.countdownN = null;
    s.readyNextHost = false;
    s.readyNextGuest = false;
  }

  function finishRoundOut(s: LipReaderNetState) {
    const elapsed = s.roundStartAt ? Date.now() - s.roundStartAt : 0;
    s.sessionRematch = emptyRematchIntent();
    s.phase = "round_result";
    s.roundDurationMs = elapsed;
    s.roundEndReason = "out_of_guesses";
    s.lastRoundWord = s.secretWord;
    s.lastRoundTimeMs = elapsed;
    s.lastRoundAttempts = s.attemptsThisRound;
    s.guesserHint = null;
    s.countdownN = null;
    s.readyNextHost = false;
    s.readyNextGuest = false;
  }

  function hostHandleGuess(raw: string) {
    const s = gameStateRef.current;
    if (s.phase !== "playing") return;
    const secret = s.secretWord;
    s.attemptsThisRound += 1;
    if (guessMatchesSecret(secret, raw)) {
      finishRoundWin(s);
      broadcastToGuest();
      return;
    }
    s.guessesRemaining -= 1;
    if (s.guessesRemaining <= 0) {
      finishRoundOut(s);
      broadcastToGuest();
      return;
    }
    s.guesserHint = "Nope. Keep watching.";
    broadcastToGuest();
    const tid = window.setTimeout(() => {
      if (gameStateRef.current.phase !== "playing") return;
      gameStateRef.current.guesserHint = null;
      broadcastToGuest();
    }, 2800);
    scheduledTimersRef.current.push(tid);
  }

  function scheduleCountdownFromHost(opts: { randomizeCommunicator: boolean }) {
    clearScheduledTimers();
    const s = gameStateRef.current;
    s.sessionRematch = emptyRematchIntent();
    s.roundId += 1;
    if (opts.randomizeCommunicator) {
      s.communicatorIsHost = Math.random() < 0.5;
    }
    s.phase = "countdown";
    s.countdownN = 3;
    s.countdownStartedAt = Date.now();
    s.roundStartAt = null;
    s.roundEndReason = null;
    s.secretWord = pickRandomWord(s.lastRoundWord);
    s.guessesRemaining = 3;
    s.attemptsThisRound = 0;
    s.guesserHint = null;
    broadcastToGuest();

    const t1 = window.setTimeout(() => {
      gameStateRef.current.countdownN = 2;
      broadcastToGuest();
    }, 1000);
    const t2 = window.setTimeout(() => {
      gameStateRef.current.countdownN = 1;
      broadcastToGuest();
    }, 2000);
    const t3 = window.setTimeout(() => {
      const cur = gameStateRef.current;
      cur.phase = "playing";
      cur.roundStartAt = Date.now();
      cur.countdownN = null;
      broadcastToGuest();
    }, 3000);
    scheduledTimersRef.current.push(t1, t2, t3);
  }

  function hostTryStartFromLobby() {
    const s = gameStateRef.current;
    if (!s.readyLobbyHost || !s.readyLobbyGuest) return;
    s.readyLobbyHost = false;
    s.readyLobbyGuest = false;
    scheduleCountdownFromHost({ randomizeCommunicator: true });
  }

  function hostTryAdvanceNextRound() {
    const s = gameStateRef.current;
    if (s.phase !== "round_result") return;
    if (!s.readyNextHost || !s.readyNextGuest) return;
    s.communicatorIsHost = !s.communicatorIsHost;
    s.readyNextHost = false;
    s.readyNextGuest = false;
    scheduleCountdownFromHost({ randomizeCommunicator: false });
  }

  function hostApplyFullSessionRematch() {
    const cur = gameStateRef.current;
    if (cur.phase !== "round_result") return;
    if (!rematchBothWant(cur.sessionRematch)) return;
    const hn = cur.hostName;
    const gn = cur.guestName;
    const epoch = (cur.sessionEpoch ?? 0) + 1;
    clearScheduledTimers();
    gameStateRef.current = initialLipReaderState();
    gameStateRef.current.sessionEpoch = epoch;
    gameStateRef.current.hostName = hn;
    gameStateRef.current.guestName = gn;
    gameStateRef.current.sessionRematch = emptyRematchIntent();
    broadcastToGuest();
  }

  function hostTryFullSessionRematch() {
    if (roleRef.current !== "host") return;
    const s = gameStateRef.current;
    if (s.phase !== "round_result") return;
    if (!rematchBothWant(s.sessionRematch)) return;
    hostApplyFullSessionRematch();
  }

  function toggleLobbyReady() {
    if (role === "host") {
      gameStateRef.current.readyLobbyHost = !gameStateRef.current.readyLobbyHost;
      gameStateRef.current.hostName = nameRef.current.slice(0, 24);
      broadcastToGuest();
    } else {
      sendToHost({ t: "lr_ready_lobby", ready: !gameStateRef.current.readyLobbyGuest });
    }
  }

  function toggleNextReady() {
    if (role === "host") {
      gameStateRef.current.readyNextHost = !gameStateRef.current.readyNextHost;
      broadcastToGuest();
      hostTryAdvanceNextRound();
    } else {
      sendToHost({ t: "lr_ready_next", ready: !gameStateRef.current.readyNextGuest });
    }
  }

  function requestSessionRematch() {
    if (gameStateRef.current.phase !== "round_result") return;
    if (role === "host") {
      gameStateRef.current.sessionRematch.host = true;
      broadcastToGuest();
      hostTryFullSessionRematch();
    } else if (role === "guest") {
      sendToHost({ t: "lr_rematch", want: true });
    }
  }

  function leaveMatch() {
    cleanup();
    setOpponentConnected(false);
    setOpponentLeftMatch(false);
    setUiMenu(true);
    setMatchmaking(false);
    setRole(null);
    setRoomId(null);
    setStatus("");
  }

  function returnToArcade() {
    leaveMatch();
  }

  function submitGuess() {
    const text = guessInput.trim();
    setGuessModalOpen(false);
    setGuessInput("");
    if (!text) return;
    if (role === "host") {
      const s = gameStateRef.current;
      const hostIsGuesser = s.communicatorIsHost === false;
      if (!hostIsGuesser) return;
      if (s.phase !== "playing") return;
      hostHandleGuess(text);
    } else {
      const s = gameStateRef.current;
      if (s.phase !== "playing" || !s.communicatorIsHost) return;
      sendToHost({ t: "lr_guess", text, roundId: s.roundId });
    }
  }

  async function connectAsHost(desiredRoomId: string) {
    cleanup();
    setRole("host");
    setOpponentConnected(false);
    gameStateRef.current = initialLipReaderState();
    gameStateRef.current.hostName = nameRef.current.slice(0, 24);

    const stream = await ensureLocalCamera({ force: true });

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
    setOpponentConnected(true);
    setOpponentLeftMatch(false);
    setStatus("Opponent connected");

    conn.on("data", (raw: unknown) => {
      const msg = raw as GuestToHostLipMsg;
      const s = gameStateRef.current;
      if (msg.t === "lr_name") {
        s.guestName = msg.name.slice(0, 24);
        broadcastToGuest();
      } else if (msg.t === "lr_ready_lobby") {
        s.readyLobbyGuest = msg.ready;
        broadcastToGuest();
      } else if (msg.t === "lr_ready_next") {
        s.readyNextGuest = msg.ready;
        broadcastToGuest();
        queueMicrotask(() => hostTryAdvanceNextRound());
      } else if (msg.t === "lr_rematch") {
        s.sessionRematch.guest = msg.want;
        broadcastToGuest();
        queueMicrotask(() => hostTryFullSessionRematch());
      } else if (msg.t === "lr_guess") {
        // Guest guesses iff host is communicator (same as iAmGuesser for guest).
        const guestIsGuesser = s.communicatorIsHost === true;
        if (!guestIsGuesser) return;
        if (s.phase !== "playing") return;
        if (msg.roundId !== s.roundId) return;
        hostHandleGuess(msg.text);
      }
    });

    conn.on("close", () => {
      setOpponentConnected(false);
      setOpponentLeftMatch(true);
    });

    conn.on("open", () => {
      broadcastToGuest();
    });
  }

  async function connectAsGuest(rid: string) {
    cleanup();
    lastGuestSeqRef.current = -1;
    setRole("guest");
    setOpponentConnected(false);
    gameStateRef.current = initialLipReaderState();

    const stream = await ensureLocalCamera({ force: true });

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
    setOpponentConnected(true);
    setOpponentLeftMatch(false);
    setStatus("Opponent connected");

    conn.on("data", (raw: unknown) => {
      const msg = raw as HostToGuestLipMsg;
      if (msg.t !== "lr_state") return;
      if (msg.seq <= lastGuestSeqRef.current) return;
      lastGuestSeqRef.current = msg.seq;
      gameStateRef.current = cloneLipReaderState(msg.state);
      if (msg.state.phase === "lobby") setOpponentLeftMatch(false);
      bumpView();
    });

    conn.on("close", () => {
      setOpponentConnected(false);
      setOpponentLeftMatch(true);
    });

    conn.on("open", () => {
      sendToHost({ t: "lr_name", name: nameRef.current.slice(0, 24) });
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
      setOpponentLeftMatch(false);
      setUiMenu(false);
      setMatchmaking(false);
      setStatus("Opponent connected.");
    } catch {
      cleanup();
      setStatus("Connection failed.");
      setUiMenu(true);
      setMatchmaking(false);
    }
  }

  async function findMatch() {
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) {
      setStatus("Enter your name first.");
      return;
    }
    setName(trimmed);
    setMatchmaking(true);
    setStatus("Searching…");

    const res = await fetch("/api/lipreader/queue", {
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
      const r = await fetch(`/api/lipreader/queue?clientId=${encodeURIComponent(clientId)}`);
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
    setMatchmaking(false);
    setStatus("");
  }

  const gs = gameStateRef.current;
  const iAmCommunicator =
    role === "host" ? gs.communicatorIsHost : role === "guest" ? !gs.communicatorIsHost : false;
  const iAmGuesser = role != null && !iAmCommunicator;

  const opponentName =
    role === "host" ? gs.guestName || "Opponent" : role === "guest" ? gs.hostName || "Opponent" : "Opponent";
  const myDisplayName =
    role === "host" ? gs.hostName || name || "You" : role === "guest" ? gs.guestName || name || "You" : "You";

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    const muteOutgoing = gs.phase === "playing" && iAmCommunicator;
    for (const t of audioTracks) {
      t.enabled = !muteOutgoing;
    }
    return () => {
      for (const t of audioTracks) {
        t.enabled = true;
      }
    };
  }, [gs.phase, gs.communicatorIsHost, role, iAmCommunicator, opponentConnected]);

  useEffect(() => {
    if (gs.phase !== "playing") return;
    const id = window.setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [gs.phase]);

  const elapsedSec =
    gs.phase === "playing" && gs.roundStartAt != null
      ? Math.floor((Date.now() - gs.roundStartAt) / 1000)
      : gs.phase === "round_result" && gs.lastRoundTimeMs != null
        ? Math.floor(gs.lastRoundTimeMs / 1000)
        : 0;

  const showWordToMe =
    iAmCommunicator &&
    gs.phase === "playing" &&
    (role === "host" || (role === "guest" && gs.secretWord.length > 0));

  const canHostStart =
    role === "host" && opponentConnected && gs.phase === "lobby" && gs.readyLobbyHost && gs.readyLobbyGuest;

  const lobbyReadyLabel =
    role === "host"
      ? gs.readyLobbyHost
        ? "Ready ✓"
        : "Ready"
      : gs.readyLobbyGuest
        ? "Ready ✓"
        : "Ready";

  const nextReadyLabel =
    role === "host" ? (gs.readyNextHost ? "Next Round ✓" : "Next Round") : gs.readyNextGuest ? "Next Round ✓" : "Next Round";

  useEffect(() => {
    if (role === "host" && gs.phase === "lobby") {
      gameStateRef.current.hostName = nameRef.current.slice(0, 24);
    }
  }, [name, role, gs.phase]);

  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const rid = gameStateRef.current.roundId;
    if (lastResetRoundIdRef.current === rid) return;
    lastResetRoundIdRef.current = rid;
    setGuessModalOpen(false);
    setGuessInput("");
  }, [viewGen]);

  return (
    <main className={styles.root}>
      <div className={styles.gameColumn}>
        <div className={styles.topBar}>
          <span className={styles.topBarTitle}>Lip Reader</span>
          <span className={styles.topBarSep}>·</span>
          <span className={styles.topBarSub}>Guess the muted word</span>
        </div>

        <div className={styles.frame}>
          <div className={styles.gridsplit}>
            {gs.phase === "countdown" && gs.countdownN != null ? (
              <div className={styles.countdownOverlayFull} aria-hidden>
                <div className={styles.countdownNum}>{gs.countdownN}</div>
              </div>
            ) : null}
            <div className={`${styles.half} ${styles.halfTop}`}>
              <video ref={remoteVideoRef} className={styles.videoRemote} playsInline autoPlay />
              <div className={`${styles.labelBar} ${styles.labelTop}`}>{opponentName}</div>
            </div>
            {!uiMenu && !matchmaking && opponentConnected && (gs.phase === "playing" || gs.phase === "countdown") ? (
              <div className={styles.hudFloat} aria-live="polite">
                {gs.phase === "countdown" ? <span className={styles.hudChip}>Get ready…</span> : null}
                {gs.phase === "playing" ? (
                  <>
                    <span className={styles.hudChip}>{iAmCommunicator ? "Acting" : "Guessing"}</span>
                    <span className={styles.hudTimer}>{elapsedSec}s</span>
                    <span className={styles.hudGuesses}>· {gs.guessesRemaining} left</span>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className={`${styles.half} ${styles.halfBottom}`}>
              <video ref={localVideoRef} className={styles.video} playsInline muted autoPlay />
              <div className={styles.labelBar}>{myDisplayName}</div>
              {showWordToMe ? (
                <div className={styles.wordRevealChip}>
                  <div className={styles.wordRevealLabel}>Your word</div>
                  <div className={styles.wordRevealText}>{gs.secretWord}</div>
                </div>
              ) : null}
            </div>
          </div>

          {!uiMenu && !matchmaking && opponentConnected && gs.phase === "playing" ? (
            <div className={styles.hintStrip}>
              {iAmCommunicator ? "Mic muted — act it out." : "Their mic is muted — watch their lips."}
              {gs.guesserHint && iAmGuesser ? <span className={styles.hintNope}> {gs.guesserHint}</span> : null}
            </div>
          ) : null}

          {!uiMenu && !matchmaking && opponentConnected && gs.phase === "round_result" ? (
            <div className={styles.resultCompact}>
              <div className={styles.resultHeadlineSmall}>
                {gs.roundEndReason === "correct"
                  ? "Correct!"
                  : gs.roundEndReason === "out_of_guesses"
                    ? "Out of guesses"
                    : "Round over"}
              </div>
              <div className={styles.resultLine}>
                <strong>{gs.lastRoundWord}</strong> · {((gs.lastRoundTimeMs ?? 0) / 1000).toFixed(1)}s · {gs.lastRoundAttempts}{" "}
                tries
              </div>
              <div className={styles.resultNextHint}>Both tap Next Round</div>
              <RematchBar
                iWantRematch={role === "host" ? gs.sessionRematch.host : role === "guest" ? gs.sessionRematch.guest : false}
                theyWantRematch={role === "host" ? gs.sessionRematch.guest : role === "guest" ? gs.sessionRematch.host : false}
                onRematch={requestSessionRematch}
                onLeave={leaveMatch}
                opponentLeft={opponentLeftMatch}
                onReturnArcade={returnToArcade}
              />
            </div>
          ) : null}

          {!uiMenu && !matchmaking && opponentConnected ? (
            <div className={styles.bottomDock}>
              {gs.phase === "lobby" ? (
                <>
                  <button type="button" className={styles.buttonSecondary} onClick={toggleLobbyReady}>
                    {lobbyReadyLabel}
                  </button>
                  {role === "host" ? (
                    <button type="button" className={styles.button} onClick={hostTryStartFromLobby} disabled={!canHostStart}>
                      Start Game
                    </button>
                  ) : (
                    <span className={styles.dockHint}>Wait for host…</span>
                  )}
                </>
              ) : null}
              {gs.phase === "round_result" ? (
                <button type="button" className={styles.button} onClick={toggleNextReady}>
                  {nextReadyLabel}
                </button>
              ) : null}
              {gs.phase === "playing" && iAmGuesser ? (
                <button type="button" className={styles.button} onClick={() => setGuessModalOpen(true)}>
                  I Know It
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {LIP_READER_UI_DEBUG && !uiMenu && opponentConnected ? (
        <div className={styles.debugStrip}>
          <div>roundId {gs.roundId}</div>
          <div>phase {gs.phase}</div>
          <div>commHost {String(gs.communicatorIsHost)}</div>
          <div>role {role ?? "—"}</div>
          <div>guessLeft {gs.guessesRemaining}</div>
          <div>word {role === "host" ? gs.secretWord || "—" : gs.secretWord ? "[synced]" : "[hidden]"}</div>
          <div>
            roundOver {String(gs.phase === "round_result")} {gs.roundEndReason ?? "—"}
          </div>
        </div>
      ) : null}

      {guessModalOpen ? (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.card}>
            <div className={styles.modalTitle}>What&apos;s the word?</div>
            <input
              className={styles.input}
              value={guessInput}
              onChange={(e) => setGuessInput(e.target.value)}
              placeholder="Type your guess"
              autoFocus
              maxLength={48}
            />
            <div className={styles.actionsRow}>
              <button type="button" className={styles.button} onClick={submitGuess}>
                Submit Guess
              </button>
              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() => {
                  setGuessModalOpen(false);
                  setGuessInput("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {uiMenu || matchmaking ? (
        <div className={styles.overlay}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Lip Reader</div>
            <div className={styles.field}>
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={24}
              />
            </div>
            {matchmaking ? (
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
              <div className={styles.status}>Enable microphone so your opponent can hear you when you guess.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
