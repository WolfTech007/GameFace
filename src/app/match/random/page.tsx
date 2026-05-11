"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useGameFaceProfile } from "@/contexts/GameFaceProfileContext";
import { PENDING_MATCH_KEY, type PendingMatchPayload } from "@/lib/gameface/matchmaking";
import styles from "./page.module.css";

const POLL_MS = 600;

export default function RandomMatchPage() {
  const { profile } = useGameFaceProfile();
  const router = useRouter();
  const [phase, setPhase] = useState<"searching" | "found">("searching");
  const [gameLabel, setGameLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | null = null;

    function commitMatch(data: {
      peerRoomId: string;
      role: "host" | "guest";
      gameId: string;
      gamePath: string;
      gameLabel: string;
    }) {
      const payload: PendingMatchPayload = {
        peerRoomId: data.peerRoomId,
        role: data.role,
        gameId: data.gameId as PendingMatchPayload["gameId"],
        gamePath: data.gamePath,
        gameLabel: data.gameLabel,
      };
      sessionStorage.setItem(PENDING_MATCH_KEY, JSON.stringify(payload));
      setPhase("found");
      setGameLabel(data.gameLabel);
      window.setTimeout(() => {
        if (cancelled) return;
        router.replace(`${data.gamePath}?gf=1`);
      }, 1600);
    }

    async function tick() {
      const res = await fetch("/api/matchmaking/random", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: profile.userId, action: "join" }),
      });
      const j = await res.json();
      if (cancelled) return;
      if (j.matched) {
        commitMatch(j);
        return;
      }
      pollTimer = window.setInterval(async () => {
        const r = await fetch(
          `/api/matchmaking/random?clientId=${encodeURIComponent(profile.userId)}`,
        );
        const d = await r.json();
        if (cancelled) return;
        if (d.matched) {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          commitMatch(d);
        }
      }, POLL_MS);
    }

    void tick();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      void fetch("/api/matchmaking/random", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: profile.userId, action: "leave" }),
      });
    };
  }, [profile.userId, router]);

  return (
    <main className={styles.root}>
      <div className={styles.glow} aria-hidden />
      <div className={styles.card}>
        <p className={styles.brand}>GAMEFACE</p>
        {phase === "searching" ? (
          <>
            <h1 className={styles.title}>Finding a player…</h1>
            <p className={styles.sub}>Hang tight — matching you with someone online.</p>
            <div className={styles.spinner} aria-hidden />
          </>
        ) : (
          <>
            <p className={styles.matchFound}>MATCH FOUND</p>
            <h1 className={styles.title}>Starting: {gameLabel}</h1>
            <p className={styles.sub}>Loading arena…</p>
          </>
        )}
      </div>
    </main>
  );
}
