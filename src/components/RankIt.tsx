"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./RankIt.module.css";
import {
  connectGuestToHost,
  createGuestPeer,
  createHostRoom,
  guestAnswerCalls,
  waitForHostConnection,
} from "@/lib/peerRoom";
import {
  cloneRankItState,
  initialRankItState,
  type RankItGuestMsg,
  type RankItNetMsg,
  type RankItPromptPayload,
  type RankItSharedState,
  type Tuple5,
} from "@/lib/rankitProtocol";
import { computeRankSimilarity, isValidTuple5Order } from "@/lib/rankitScore";
import { POP_CULTURE_DEBATES, shuffleMatchDeckOrder } from "@/lib/rankitPrompts";
import { RematchBar } from "@/components/RematchBar";
import { emptyRematchIntent, rematchBothWant } from "@/lib/rematchSync";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";

const QUEUE_POLL_MS = 600;

type Role = "host" | "guest";
type FlowPhase = "intro" | "matchmaking" | "connecting" | "session";

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

function clampName(name: string) {
  const t = name.trim().slice(0, 24);
  return t || "Player";
}

function deckEntryToPayload(pi: number): RankItPromptPayload {
  const row = POP_CULTURE_DEBATES[pi];
  return {
    id: row.id,
    question: row.question,
    items: [...row.items] as RankItPromptPayload["items"],
  };
}

export default function RankIt() {
  const { profile } = useGameFaceProfile();
  const clientId = profile.userId;

  const [flowPhase, setFlowPhase] = useState<FlowPhase>("intro");
  const nameRef = useRef("");
  useEffect(() => {
    nameRef.current = profile.displayName.trim();
  }, [profile.displayName]);

  const [status, setStatus] = useState("");
  const [gameState, setGameState] = useState<RankItSharedState | null>(null);

  const [role, setRole] = useState<Role | null>(null);
  const roleRef = useRef<Role | null>(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<{ destroy?: () => void } | null>(null);
  const dataRef = useRef<{ open?: boolean; send: (m: RankItNetMsg) => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const stateRef = useRef<RankItSharedState>(initialRankItState());
  const matchRoomIdRef = useRef("");
  const deckOrderRef = useRef<number[]>([]);
  const deckPtrRef = useRef(0);

  const [draftOrder, setDraftOrder] = useState<number[]>([0, 1, 2, 3, 4]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const sendNet = useCallback((msg: RankItNetMsg) => {
    const c = dataRef.current;
    if (c?.open) c.send(msg);
  }, []);

  function resetHostDeck(roomId: string) {
    deckOrderRef.current = shuffleMatchDeckOrder(roomId);
    deckPtrRef.current = 0;
  }

  function hostPickPromptPayload(): RankItPromptPayload {
    const roomId = matchRoomIdRef.current;
    if (deckOrderRef.current.length === 0) {
      resetHostDeck(roomId);
    }
    let ptr = deckPtrRef.current;
    if (ptr >= deckOrderRef.current.length) {
      resetHostDeck(`${roomId}-${Date.now()}`);
      ptr = 0;
    }
    const pi = deckOrderRef.current[ptr];
    deckPtrRef.current = ptr + 1;
    return deckEntryToPayload(pi);
  }

  function tryStartFromLobbyInPlace(s: RankItSharedState) {
    if (s.phase !== "lobby") return;
    if (!s.lobbyReady.host || !s.lobbyReady.guest) return;
    s.sessionRematch = emptyRematchIntent();
    s.roundId = 1;
    s.phase = "ranking";
    s.prompt = hostPickPromptPayload();
    s.ranking = { hostOrder: null, guestOrder: null };
    s.reveal = null;
    s.nextRoundReady = { host: false, guest: false };
  }

  function tryRevealInPlace(s: RankItSharedState) {
    if (s.phase !== "ranking") return;
    const ho = s.ranking.hostOrder;
    const go = s.ranking.guestOrder;
    if (!ho || !go) return;
    const { positionMatches, compatPct } = computeRankSimilarity(ho, go);
    s.sessionRematch = emptyRematchIntent();
    s.phase = "reveal";
    s.reveal = { positionMatches, compatPct };
  }

  function tryNextRoundInPlace(s: RankItSharedState) {
    if (s.phase !== "reveal") return;
    if (!s.nextRoundReady.host || !s.nextRoundReady.guest) return;
    s.sessionRematch = emptyRematchIntent();
    s.roundId += 1;
    s.phase = "ranking";
    s.prompt = hostPickPromptPayload();
    s.ranking = { hostOrder: null, guestOrder: null };
    s.reveal = null;
    s.nextRoundReady = { host: false, guest: false };
  }

  const hostMutate = useCallback(
    (fn: (s: RankItSharedState) => void) => {
      if (roleRef.current !== "host") return;
      fn(stateRef.current);
      const st = cloneRankItState(stateRef.current);
      setGameState(st);
      const c = dataRef.current;
      if (c?.open) c.send({ t: "ri_sync", state: st });
    },
    [],
  );

  function hostTryFullSessionRematch(s: RankItSharedState) {
    if (s.phase !== "reveal") return;
    if (!rematchBothWant(s.sessionRematch)) return;
    const epoch = (s.matchEpoch ?? 0) + 1;
    s.matchEpoch = epoch;
    resetHostDeck(`${matchRoomIdRef.current}-rematch-${epoch}`);
    s.sessionRematch = emptyRematchIntent();
    s.phase = "lobby";
    s.roundId = 0;
    s.prompt = null;
    s.ranking = { hostOrder: null, guestOrder: null };
    s.reveal = null;
    s.nextRoundReady = { host: false, guest: false };
    s.lobbyReady = { host: false, guest: false };
  }

  const handleGuestMessage = useCallback(
    (msg: RankItGuestMsg) => {
      hostMutate((s) => {
        switch (msg.t) {
          case "ri_g_hello":
            s.names.guest = clampName(msg.name);
            break;
          case "ri_g_lobby_ready":
            s.lobbyReady.guest = msg.ready;
            break;
          case "ri_g_lock":
            if (msg.roundId !== s.roundId || s.phase !== "ranking") return;
            if (!isValidTuple5Order(msg.order)) return;
            s.ranking.guestOrder = msg.order;
            break;
          case "ri_g_next_ready":
            if (msg.roundId !== s.roundId || s.phase !== "reveal") return;
            s.nextRoundReady.guest = msg.ready;
            break;
          case "ri_g_rematch":
            if (s.phase !== "reveal") return;
            s.sessionRematch.guest = msg.want;
            hostTryFullSessionRematch(s);
            break;
          default:
            break;
        }
        tryStartFromLobbyInPlace(s);
        tryRevealInPlace(s);
        tryNextRoundInPlace(s);
      });
    },
    [hostMutate],
  );

  async function leaveQueue() {
    try {
      await fetch("/api/rankit/queue", {
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
    void leaveQueue();
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
    stateRef.current = initialRankItState();
    deckOrderRef.current = [];
    deckPtrRef.current = 0;
    matchRoomIdRef.current = "";
    setGameState(null);
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

  function wireConn(conn: any) {
    conn.on("data", (raw: unknown) => {
      if (roleRef.current === "host") {
        handleGuestMessage(raw as RankItGuestMsg);
        return;
      }
      const msg = raw as RankItNetMsg;
      if (msg.t === "ri_sync") {
        setGameState(cloneRankItState(msg.state));
      }
    });
    conn.on("close", () => {
      if (roleRef.current === "host") {
        hostMutate((s) => {
          s.opponentLeft = true;
        });
      } else {
        setGameState((g) => (g ? { ...g, opponentLeft: true } : g));
      }
    });
  }

  async function setupPeer(roomId: string, r: Role) {
    cleanupPeer();
    await ensureCamera();
    const stream = streamRef.current!;
    matchRoomIdRef.current = roomId;

    if (r === "host") {
      resetHostDeck(roomId);
      stateRef.current = initialRankItState();
      stateRef.current.names.host = clampName(nameRef.current);
      setGameState(cloneRankItState(stateRef.current));

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
      wireConn(conn);

      conn.on("open", () => {
        const st = cloneRankItState(stateRef.current);
        setGameState(st);
        conn.send({ t: "ri_sync", state: st });
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
      wireConn(conn);

      conn.on("open", () => {
        sendNet({ t: "ri_g_hello", name: clampName(nameRef.current) });
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

  async function applyMatch(roomId: string, r: Role) {
    setRole(r);
    setStatus("Connecting…");
    setFlowPhase("connecting");
    await setupPeer(roomId, r);
    setFlowPhase("session");
    setStatus("Connected");
  }

  async function findMatch() {
    setFlowPhase("matchmaking");
    setStatus("Finding a stranger…");

    const res = await fetch("/api/rankit/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, action: "join" }),
    });
    const data = await res.json();
    if (data.matched) {
      await applyMatch(data.peerRoomId as string, data.role as Role);
      return;
    }

    pollTimerRef.current = window.setInterval(async () => {
      const r = await fetch(`/api/rankit/queue?clientId=${encodeURIComponent(clientId)}`);
      const j = await r.json();
      if (j.matched) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        await applyMatch(j.peerRoomId as string, j.role as Role);
      }
    }, QUEUE_POLL_MS);
  }

  function cancelMatchmaking() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    void leaveQueue();
    setFlowPhase("intro");
    setStatus("");
  }

  function leaveSession() {
    cleanupPeer();
    setFlowPhase("intro");
    setRole(null);
    setStatus("");
    setDraftOrder([0, 1, 2, 3, 4]);
  }

  const isHost = role === "host";
  const gs = gameState;

  useEffect(() => {
    if (!gs || gs.phase !== "ranking" || !gs.prompt) return;
    setDraftOrder([0, 1, 2, 3, 4]);
  }, [gs?.roundId, gs?.prompt?.id, gs?.phase]);

  function swapDraft(a: number, b: number) {
    setDraftOrder((prev) => {
      const next = [...prev];
      const t = next[a]!;
      next[a] = next[b]!;
      next[b] = t;
      return next;
    });
  }

  /** Toggle “Start Game” readiness (both must be ready). */
  function lobbyReadyToggle() {
    if (!gs) return;
    const localReady = isHost ? gs.lobbyReady.host : gs.lobbyReady.guest;
    const next = !localReady;
    if (isHost) {
      hostMutate((s) => {
        s.lobbyReady.host = next;
        tryStartFromLobbyInPlace(s);
      });
    } else {
      sendNet({ t: "ri_g_lobby_ready", ready: next });
    }
  }

  function lockRanking() {
    if (!gs?.prompt || gs.phase !== "ranking") return;
    const tuple = draftOrder as unknown as number[];
    if (!isValidTuple5Order(tuple)) return;
    const order = tuple as Tuple5;
    if (isHost) {
      hostMutate((s) => {
        if (s.roundId !== gs.roundId || s.phase !== "ranking") return;
        s.ranking.hostOrder = order;
        tryRevealInPlace(s);
      });
    } else {
      sendNet({ t: "ri_g_lock", roundId: gs.roundId, order });
    }
  }

  /** Both players tap once; when both have pressed, host advances the round. */
  function confirmNextRound() {
    if (!gs || gs.phase !== "reveal") return;
    if (isHost) {
      if (gs.nextRoundReady.host) return;
      hostMutate((s) => {
        if (s.roundId !== gs.roundId || s.phase !== "reveal") return;
        s.nextRoundReady.host = true;
        tryNextRoundInPlace(s);
      });
    } else {
      if (gs.nextRoundReady.guest) return;
      sendNet({ t: "ri_g_next_ready", roundId: gs.roundId, ready: true });
    }
  }

  function requestSessionRematch() {
    if (!gs || gs.phase !== "reveal") return;
    if (isHost) {
      hostMutate((s) => {
        if (s.phase !== "reveal") return;
        s.sessionRematch.host = true;
        hostTryFullSessionRematch(s);
      });
    } else {
      sendNet({ t: "ri_g_rematch", want: true });
    }
  }

  const myName = gs ? (isHost ? gs.names.host : gs.names.guest) : "";
  const theirName = gs ? (isHost ? gs.names.guest : gs.names.host) : "";

  const myLocked =
    gs && gs.phase === "ranking"
      ? isHost
        ? gs.ranking.hostOrder !== null
        : gs.ranking.guestOrder !== null
      : false;

  const bothLocked =
    gs?.phase === "ranking" && gs.ranking.hostOrder !== null && gs.ranking.guestOrder !== null;

  const intro = flowPhase === "intro";
  const matchmaking = flowPhase === "matchmaking";
  const connecting = flowPhase === "connecting";

  return (
    <main className={styles.root}>
      {intro || matchmaking ? (
        <div className={styles.intro}>
          <div className={styles.bigTitle}>Rank It</div>
          <div className={styles.tagline}>Rank. Reveal. Argue.</div>
          <div className={styles.menuHint}>
            Playing as <strong>{clampName(profile.displayName)}</strong>
          </div>
          {matchmaking ? (
            <>
              <button type="button" className={styles.secondaryBtn} onClick={cancelMatchmaking}>
                Cancel
              </button>
              <div className={styles.statusText}>{status}</div>
            </>
          ) : (
            <>
              <button type="button" className={styles.primaryBtn} onClick={() => void findMatch()}>
                Find Match
              </button>
              <div className={styles.statusText}>{status}</div>
            </>
          )}
        </div>
      ) : null}

      {connecting ? (
        <div className={styles.intro}>
          <div className={styles.bigTitle}>Connecting…</div>
          <div className={styles.statusText}>Setting up webcam link.</div>
        </div>
      ) : null}

      {flowPhase === "session" ? (
        <div className={styles.gameWrap}>
          <div className={styles.splitTop}>
            <div className={styles.videoLabel}>{theirName || "Opponent"}</div>
            <video
              ref={remoteVideoRef}
              className={`${styles.video} ${styles.videoRemote}`}
              playsInline
              autoPlay
            />
          </div>
          <div className={styles.divider} />
          <div className={styles.splitBottom}>
            <div className={styles.videoLabel}>You · {myName || "You"}</div>
            <video
              ref={localVideoRef}
              className={`${styles.video} ${styles.videoLocal}`}
              playsInline
              muted
              autoPlay
            />
          </div>

          <div className={styles.panel}>
            <div className={styles.connectionRow}>
              <span className={`${styles.pill} ${styles.pillOk}`}>● Live</span>
              <span>{status}</span>
            </div>

            {!gs ? (
              <div className={styles.statusText}>Syncing game state…</div>
            ) : gs.opponentLeft ? (
              <div className={styles.overlay} style={{ position: "relative", inset: "unset", minHeight: 120 }}>
                <div className={styles.overlayCard}>
                  <div className={styles.overlayTitle}>Opponent left.</div>
                  <button type="button" className={styles.primaryBtn} onClick={leaveSession}>
                    Back to menu
                  </button>
                </div>
              </div>
            ) : gs.phase === "lobby" ? (
              <>
                <div className={styles.promptTitle}>Lobby</div>
                <div className={styles.statusText}>
                  When you&apos;re both ready, you&apos;ll get the same debate prompt.
                </div>
                <button
                  type="button"
                  className={`${styles.readyToggle} ${
                    (isHost ? gs.lobbyReady.host : gs.lobbyReady.guest) ? styles.readyToggleActive : ""
                  }`}
                  onClick={lobbyReadyToggle}
                >
                  {(isHost ? gs.lobbyReady.host : gs.lobbyReady.guest)
                    ? "Ready ✓"
                    : "Start Game"}
                </button>
                <div className={styles.monoNote}>
                  Host ready: {gs.lobbyReady.host ? "yes" : "no"} · Guest ready:{" "}
                  {gs.lobbyReady.guest ? "yes" : "no"}
                </div>
                <button type="button" className={styles.secondaryBtn} onClick={leaveSession}>
                  Leave Match
                </button>
              </>
            ) : gs.phase === "ranking" && gs.prompt ? (
              <RankingRoundPanel
                prompt={gs.prompt}
                draftOrder={draftOrder}
                dragIndex={dragIndex}
                setDragIndex={setDragIndex}
                myLocked={myLocked}
                bothLocked={bothLocked}
                swapDraft={swapDraft}
                lockRanking={lockRanking}
              />
            ) : gs.phase === "reveal" && gs.prompt && gs.reveal ? (
              <div className={styles.revealShell}>
                <div className={styles.bigScore}>
                  <div className={styles.bigScoreNum}>
                    You matched {gs.reveal.positionMatches}/5
                  </div>
                  <div className={styles.bigScoreSub}>Same item in the same rank slot</div>
                  <div className={styles.compatBig}>{gs.reveal.compatPct}% compatibility</div>
                </div>

                <RevealColumns
                  prompt={gs.prompt}
                  hostOrder={gs.ranking.hostOrder!}
                  guestOrder={gs.ranking.guestOrder!}
                  isHost={isHost}
                  hostLabel={gs.names.host}
                  guestLabel={gs.names.guest}
                />

                <div className={styles.actionsRow}>
                  <button type="button" className={styles.nextBtn} onClick={confirmNextRound}>
                    Next Round
                  </button>
                </div>
                <div className={styles.monoNote}>
                  Both tap Next Round to continue · Host: {gs.nextRoundReady.host ? "✓" : "…"} · Guest:{" "}
                  {gs.nextRoundReady.guest ? "✓" : "…"}
                </div>
                <RematchBar
                  iWantRematch={isHost ? gs.sessionRematch.host : gs.sessionRematch.guest}
                  theyWantRematch={isHost ? gs.sessionRematch.guest : gs.sessionRematch.host}
                  onRematch={requestSessionRematch}
                  onLeave={leaveSession}
                  opponentLeft={gs.opponentLeft}
                  onReturnArcade={leaveSession}
                />
              </div>
            ) : (
              <div className={styles.statusText}>Loading…</div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function RankingRoundPanel(props: {
  prompt: RankItPromptPayload;
  draftOrder: number[];
  dragIndex: number | null;
  setDragIndex: (n: number | null) => void;
  myLocked: boolean;
  bothLocked: boolean;
  swapDraft: (a: number, b: number) => void;
  lockRanking: () => void;
}) {
  const {
    prompt,
    draftOrder,
    dragIndex,
    setDragIndex,
    myLocked,
    bothLocked,
    swapDraft,
    lockRanking,
  } = props;

  return (
    <>
      <div className={styles.promptTitle}>{prompt.question}</div>
      {myLocked && !bothLocked ? (
        <div className={styles.waitBanner}>Waiting for opponent…</div>
      ) : null}

      <div className={styles.rankList}>
        {draftOrder.map((itemIdx, rowIdx) => (
          <div
            key={`${itemIdx}-${rowIdx}`}
            className={`${styles.rankRow} ${dragIndex === rowIdx ? styles.rankRowDragging : ""}`}
            draggable={!myLocked}
            onDragStart={() => setDragIndex(rowIdx)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (myLocked || dragIndex === null) return;
              if (dragIndex !== rowIdx) swapDraft(dragIndex, rowIdx);
              setDragIndex(null);
            }}
          >
            <div className={styles.rankSlot}>{rowIdx + 1}</div>
            <div className={styles.rankLabel}>{prompt.items[itemIdx]}</div>
            <div className={styles.rankMoves}>
              <button
                type="button"
                className={styles.rankMoveBtn}
                disabled={myLocked || rowIdx === 0}
                onClick={() => swapDraft(rowIdx, rowIdx - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.rankMoveBtn}
                disabled={myLocked || rowIdx >= draftOrder.length - 1}
                onClick={() => swapDraft(rowIdx, rowIdx + 1)}
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className={styles.lockBtn} disabled={myLocked} onClick={lockRanking}>
        {myLocked ? "Locked In" : "Lock In Ranking"}
      </button>
    </>
  );
}

function RevealColumns(props: {
  prompt: RankItPromptPayload;
  hostOrder: Tuple5;
  guestOrder: Tuple5;
  isHost: boolean;
  hostLabel: string;
  guestLabel: string;
}) {
  const { prompt, hostOrder, guestOrder, isHost, hostLabel, guestLabel } = props;
  const youOrder = isHost ? hostOrder : guestOrder;
  const themOrder = isHost ? guestOrder : hostOrder;
  const youLabel = "YOU";
  const themLabel = isHost ? guestLabel : hostLabel;

  return (
    <div className={styles.columns}>
      <div className={styles.column}>
        <div className={styles.columnTitle}>{youLabel}</div>
        {youOrder.map((itemIdx, rankIdx) => {
          const match = hostOrder[rankIdx] === guestOrder[rankIdx];
          return (
            <div
              key={`you-${rankIdx}`}
              className={`${styles.columnRow} ${match ? styles.matchRow : styles.missRow}`}
            >
              <span>{rankIdx + 1}</span>
              <span>{prompt.items[itemIdx]}</span>
            </div>
          );
        })}
      </div>
      <div className={styles.column}>
        <div className={styles.columnTitle}>THEM · {themLabel}</div>
        {themOrder.map((itemIdx, rankIdx) => {
          const match = hostOrder[rankIdx] === guestOrder[rankIdx];
          return (
            <div
              key={`them-${rankIdx}`}
              className={`${styles.columnRow} ${match ? styles.matchRow : styles.missRow}`}
            >
              <span>{rankIdx + 1}</span>
              <span>{prompt.items[itemIdx]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
