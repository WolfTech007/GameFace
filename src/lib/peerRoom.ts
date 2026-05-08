import Peer, { DataConnection, MediaConnection } from "peerjs";

export type FacePongRole = "host" | "guest";

export type RoomStatus =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "waiting"; roomId: string }
  | { kind: "joining"; roomId: string }
  | { kind: "connected"; roomId: string; role: FacePongRole };

export type HostToGuestMsg =
  | { t: "state"; state: FacePongNetState }
  | { t: "hello"; roomId: string };

export type GuestToHostMsg = { t: "paddle"; x01: number } | { t: "ready" };

export type FacePongNetState = {
  phase: "lobby" | "playing" | "gameover";
  rallyScore: number;
  ball: { x: number; y: number; vx: number; vy: number };
  paddles: { hostX: number; guestX: number };
};

export type PeerRoom = {
  peer: Peer;
  role: FacePongRole;
  roomId: string;
  data?: DataConnection;
  call?: MediaConnection;
  destroy: () => void;
};

function makePeer() {
  // Default PeerJS cloud broker. For a production app you’d run your own.
  return new Peer({
    debug: 1,
  });
}

export async function createHostRoom(opts?: {
  desiredRoomId?: string;
}): Promise<{ roomId: string; peer: Peer }> {
  const peer = opts?.desiredRoomId ? new Peer(opts.desiredRoomId, { debug: 1 }) : makePeer();
  const roomId = await new Promise<string>((resolve, reject) => {
    peer.on("open", (id) => resolve(id));
    peer.on("error", (e) => reject(e));
  });
  return { roomId, peer };
}

export async function createGuestPeer(): Promise<Peer> {
  const peer = makePeer();
  await new Promise<void>((resolve, reject) => {
    peer.on("open", () => resolve());
    peer.on("error", (e) => reject(e));
  });
  return peer;
}

export function connectGuestToHost(peer: Peer, roomId: string, opts?: { reliable?: boolean }) {
  const data = peer.connect(roomId, { reliable: opts?.reliable ?? false });
  return new Promise<DataConnection>((resolve, reject) => {
    data.on("open", () => resolve(data));
    data.on("error", (e) => reject(e));
  });
}

export function waitForHostConnection(peer: Peer) {
  return new Promise<DataConnection>((resolve) => {
    peer.on("connection", (conn) => resolve(conn));
  });
}

export function hostCallGuest(peer: Peer, guestPeerId: string, stream: MediaStream) {
  const call = peer.call(guestPeerId, stream);
  return call;
}

export function guestAnswerCalls(peer: Peer, stream: MediaStream, onCall: (c: MediaConnection) => void) {
  peer.on("call", (call) => {
    call.answer(stream);
    onCall(call);
  });
}

