import { WebSocketServer } from "ws";
import { checkAvailability } from "./authService.js";

const WINDOW_MS = 10 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map();

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return String(req.socket?.remoteAddress || "");
}

function tooMany(ip) {
  const now = Date.now();
  const row = hits.get(ip) || { count: 0, start: now };
  if (now - row.start > WINDOW_MS) {
    hits.set(ip, { count: 1, start: now });
    return false;
  }
  row.count += 1;
  hits.set(ip, row);
  return row.count > MAX_PER_WINDOW;
}

async function lookupAvailability(field, value) {
  const resolved = field === "username" ? "username" : field === "email" ? "email" : null;
  if (!resolved) return { type: "error", reason: "bad_field" };
  const payload = resolved === "email" ? { email: value } : { username: value };
  const result = await checkAvailability(payload);
  const row = result[resolved];
  return {
    type: "availability",
    field: resolved,
    value,
    available: Boolean(row?.available),
    reason: row?.reason || null,
  };
}

function attachAvailability(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "/";
    try {
      pathname = new URL(req.url || "/", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/ws/availability") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (socket, req) => {
    const ip = clientIp(req);
    socket.on("message", async (raw) => {
      if (tooMany(ip)) {
        socket.send(JSON.stringify({ type: "error", reason: "rate_limited" }));
        return;
      }
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.type !== "check") return;
      const reply = await lookupAvailability(msg.field, msg.value);
      socket.send(JSON.stringify(reply));
    });
  });

  return wss;
}

export { attachAvailability, lookupAvailability, tooMany };
