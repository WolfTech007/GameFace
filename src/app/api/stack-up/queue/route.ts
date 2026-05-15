import { NextResponse } from "next/server";

type WaitingEntry = { clientId: string; enteredAt: number };
type MatchInfo = { peerRoomId: string; role: "host" | "guest" };

declare global {
  // eslint-disable-next-line no-var
  var __stackUpQueue: WaitingEntry[] | undefined;
  // eslint-disable-next-line no-var
  var __stackUpResults: Map<string, MatchInfo> | undefined;
}

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0" };

function getQueue(): WaitingEntry[] {
  if (!globalThis.__stackUpQueue) globalThis.__stackUpQueue = [];
  return globalThis.__stackUpQueue;
}

function getResults(): Map<string, MatchInfo> {
  if (!globalThis.__stackUpResults) globalThis.__stackUpResults = new Map();
  return globalThis.__stackUpResults;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { clientId?: string; action?: "join" | "leave" };
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    if (!clientId || clientId.length > 64) {
      return NextResponse.json({ error: "Invalid clientId" }, { status: 400, headers: NO_STORE });
    }
    const results = getResults();
    const queue = getQueue();

    if (body.action === "leave") {
      const idx = queue.findIndex((e) => e.clientId === clientId);
      if (idx >= 0) queue.splice(idx, 1);
      results.delete(clientId);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    const existing = results.get(clientId);
    if (existing) return NextResponse.json({ matched: true, ...existing }, { headers: NO_STORE });

    const alreadyWaiting = queue.some((e) => e.clientId === clientId);
    if (!alreadyWaiting) queue.push({ clientId, enteredAt: Date.now() });

    while (queue.length >= 2) {
      const a = queue.shift()!;
      const b = queue.shift()!;
      const roomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const peerRoomId = `stackup-${roomSuffix}`;
      results.set(a.clientId, { peerRoomId, role: "host" });
      results.set(b.clientId, { peerRoomId, role: "guest" });
    }

    const now = results.get(clientId);
    if (now) return NextResponse.json({ matched: true, ...now }, { headers: NO_STORE });
    return NextResponse.json({ matched: false, waiting: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400, headers: NO_STORE });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId")?.trim() ?? "";
  if (!clientId) return NextResponse.json({ error: "Missing clientId" }, { status: 400, headers: NO_STORE });
  const results = getResults();
  const m = results.get(clientId);
  if (m) return NextResponse.json({ matched: true, ...m }, { headers: NO_STORE });
  const waiting = getQueue().some((e) => e.clientId === clientId);
  return NextResponse.json({ matched: false, waiting }, { headers: NO_STORE });
}
