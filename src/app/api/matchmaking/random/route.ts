import { NextResponse } from "next/server";
import { pickWeightedGame } from "@/lib/gameface/matchmaking";

type WaitingEntry = { clientId: string; enteredAt: number };

type MatchInfo = {
  peerRoomId: string;
  role: "host" | "guest";
  gameId: string;
  gamePath: string;
  gameLabel: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __gfRandomQueue: WaitingEntry[] | undefined;
  // eslint-disable-next-line no-var
  var __gfRandomResults: Map<string, MatchInfo> | undefined;
}

export const dynamic = "force-dynamic";

function getQueue(): WaitingEntry[] {
  if (!globalThis.__gfRandomQueue) globalThis.__gfRandomQueue = [];
  return globalThis.__gfRandomQueue;
}

function getResults(): Map<string, MatchInfo> {
  if (!globalThis.__gfRandomResults) globalThis.__gfRandomResults = new Map();
  return globalThis.__gfRandomResults;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { clientId?: string; action?: "join" | "leave" };
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";

    if (!clientId || clientId.length > 64) {
      return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
    }

    const results = getResults();
    const queue = getQueue();

    if (body.action === "leave") {
      const idx = queue.findIndex((e) => e.clientId === clientId);
      if (idx >= 0) queue.splice(idx, 1);
      results.delete(clientId);
      return NextResponse.json({ ok: true });
    }

    const existing = results.get(clientId);
    if (existing) {
      return NextResponse.json({ matched: true, ...existing });
    }

    const alreadyWaiting = queue.some((e) => e.clientId === clientId);
    if (!alreadyWaiting) {
      queue.push({ clientId, enteredAt: Date.now() });
    }

    while (queue.length >= 2) {
      const a = queue.shift()!;
      const b = queue.shift()!;
      const roomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const peerRoomId = `gf-${roomSuffix}`;
      const game = pickWeightedGame();
      results.set(a.clientId, {
        peerRoomId,
        role: "host",
        gameId: game.id,
        gamePath: game.path,
        gameLabel: game.label,
      });
      results.set(b.clientId, {
        peerRoomId,
        role: "guest",
        gameId: game.id,
        gamePath: game.path,
        gameLabel: game.label,
      });
    }

    const now = results.get(clientId);
    if (now) {
      return NextResponse.json({ matched: true, ...now });
    }

    return NextResponse.json({ matched: false, waiting: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId")?.trim() ?? "";
  if (!clientId) {
    return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
  }
  const results = getResults();
  const m = results.get(clientId);
  if (m) {
    return NextResponse.json({ matched: true, ...m });
  }
  const waiting = getQueue().some((e) => e.clientId === clientId);
  return NextResponse.json({ matched: false, waiting });
}
