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

function attachAvailability(server) {
  const wss = new WebSocketServer({ server, path: "/ws/availability" });
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
      const field = msg.field === "username" ? "username" : msg.field === "email" ? "email" : null;
      if (!field) return;
      const payload = field === "email" ? { email: msg.value } : { username: msg.value };
      const result = await checkAvailability(payload);
      const row = result[field];
      socket.send(
        JSON.stringify({
          type: "availability",
          field,
          value: msg.value,
          available: Boolean(row?.available),
          reason: row?.reason || null,
        }),
      );
    });
  });
  return wss;
}

export { attachAvailability };
