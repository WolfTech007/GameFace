import { NextResponse } from "next/server";

/** Matchmaking uses in-memory queue (single Node process). On multi-instance deploys, use Redis/KV. */
export const dynamic = "force-dynamic";

type WaitingEntry = { clientId: string; name: string; enteredAt: number };

type MatchInfo = {
  peerRoomId: string;
  role: "host" | "guest";
  opponentName: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __staringQueue: WaitingEntry[] | undefined;
  // eslint-disable-next-line no-var
  var __staringResults: Map<string, MatchInfo> | undefined;
}

function getQueue(): WaitingEntry[] {
  if (!globalThis.__staringQueue) globalThis.__staringQueue = [];
  return globalThis.__staringQueue;
}

function getResults(): Map<string, MatchInfo> {
  if (!globalThis.__staringResults) globalThis.__staringResults = new Map();
  return globalThis.__staringResults;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { clientId?: string; name?: string; action?: "join" | "leave" };
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 24) : "Player";

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
      queue.push({ clientId, name: name || "Player", enteredAt: Date.now() });
    }

    // Pair first two distinct waiting users
    while (queue.length >= 2) {
      const a = queue.shift()!;
      const b = queue.shift()!;
      const roomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const peerRoomId = `staring-${roomSuffix}`;
      results.set(a.clientId, { peerRoomId, role: "host", opponentName: b.name });
      results.set(b.clientId, { peerRoomId, role: "guest", opponentName: a.name });
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
