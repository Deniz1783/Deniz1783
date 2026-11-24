const express = require("express");
const http = require("http");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || "";

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      mediaSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "10kb" }));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));
app.use(express.static("public", { extensions: ["html"] }));

const rooms = new Map();
const randomToken = () => crypto.randomBytes(24).toString("base64url");
const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};

app.post("/api/rooms", (_req, res) => {
  // Expire old rooms; each room is single-use and short-lived.
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.expiresAt < now) {
      for (const client of Object.values(room.clients)) {
        if (client?.readyState === WebSocket.OPEN) client.close(1000, "Room expired");
      }
      rooms.delete(id);
    }
  }
  if (rooms.size >= 500) return res.status(503).json({ error: "Too many active rooms. Try again later." });

  const id = randomToken().slice(0, 12);
  const participantToken = randomToken();
  const viewerToken = randomToken();
  rooms.set(id, {
    participantToken, viewerToken, expiresAt: now + 60 * 60 * 1000,
    clients: { participant: null, viewer: null }
  });
  const base = BASE_URL || `${reqOrigin(res.req)}`;
  res.json({
    roomId: id,
    participantUrl: `${base}/share?room=${encodeURIComponent(id)}&token=${encodeURIComponent(participantToken)}`,
    viewerUrl: `${base}/view?room=${encodeURIComponent(id)}&token=${encodeURIComponent(viewerToken)}`,
    expiresInMinutes: 60
  });
});
function reqOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

server.on("upgrade", (req, socket, head) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { socket.destroy(); return; }
  if (url.pathname !== "/signal") { socket.destroy(); return; }
  const roomId = url.searchParams.get("room");
  const role = url.searchParams.get("role");
  const token = url.searchParams.get("token");
  const room = rooms.get(roomId);
  if (!room || room.expiresAt < Date.now() ||
      !["participant", "viewer"].includes(role) ||
      !safeEqual(token, room[`${role}Token`]) ||
      room.clients[role]) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.roomId = roomId;
    ws.role = role;
    wss.emit("connection", ws);
  });
});

wss.on("connection", ws => {
  const room = rooms.get(ws.roomId);
  if (!room) return ws.close(1008, "Room not found");
  room.clients[ws.role] = ws;

  const otherRole = ws.role === "participant" ? "viewer" : "participant";
  const other = room.clients[otherRole];
  if (other?.readyState === WebSocket.OPEN) {
    other.send(JSON.stringify({ type: "peer-ready" }));
    ws.send(JSON.stringify({ type: "peer-ready" }));
  }

  ws.on("message", raw => {
    if (raw.length > 64 * 1024) return ws.close(1009, "Message too large");
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || !["offer", "answer", "ice", "hangup"].includes(message.type)) return;

    // The participant creates the offer; viewer answers. ICE travels both ways.
    if (message.type === "offer" && ws.role !== "participant") return;
    if (message.type === "answer" && ws.role !== "viewer") return;
    if (message.type === "ice" && !message.candidate) return;
    if (message.type === "offer" && !message.sdp) return;
    if (message.type === "answer" && !message.sdp) return;

    const peer = room.clients[otherRole];
    if (peer?.readyState === WebSocket.OPEN) {
      peer.send(JSON.stringify(message));
    }
  });

  ws.on("close", () => {
    const current = rooms.get(ws.roomId);
    if (!current) return;
    if (current.clients[ws.role] === ws) current.clients[ws.role] = null;
    const peer = current.clients[otherRole];
    if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: "peer-left" }));
    if (!current.clients.participant && !current.clients.viewer) rooms.delete(ws.roomId);
  });
});

server.listen(PORT, () => console.log(`Screen-share server listening on port ${PORT}`));