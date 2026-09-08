import { randomUUID } from "node:crypto";
import db from "../database.js";

const VISITOR_COOKIE = "oddstamu_vid";
const VISITOR_MS = 400 * 24 * 60 * 60 * 1000;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  return String(req.socket?.remoteAddress || "").slice(0, 64);
}

function ensureVisitor(req, res) {
  const existing = req.cookies?.[VISITOR_COOKIE];
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = randomUUID();
  res.cookie(VISITOR_COOKIE, id, {
    maxAge: VISITOR_MS,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return id;
}

function shouldLog(req) {
  const path = req.path || "";
  if (path === "/" || path.startsWith("/api/") || path.startsWith("/admin") || path === "/login") return true;
  return false;
}

async function recordAccess(req, res) {
  if (!shouldLog(req)) return;
  const visitorId = ensureVisitor(req, res);
  try {
    await run(
      `INSERT INTO access_events (occurred_at, visitor_id, path, method, ip, user_agent, lang, mode, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(),
        visitorId,
        String(req.path || "/").slice(0, 180),
        String(req.method || "GET").slice(0, 12),
        clientIp(req),
        String(req.get("user-agent") || "").slice(0, 240),
        String(req.locale || req.cookies?.oddstamu_lang || "").slice(0, 12),
        String(req.query?.mode || "").slice(0, 16) || null,
        req.user?.id || null,
      ],
    );
  } catch (err) {
    console.warn(`[Telemetry] skip: ${err.message}`);
  }
}

function accessLogger() {
  return (req, res, next) => {
    recordAccess(req, res).finally(() => next());
  };
}

export { accessLogger, clientIp, VISITOR_COOKIE };
