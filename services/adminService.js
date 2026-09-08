import db from "../database.js";
import * as oddsService from "./oddsService.js";

const ONLINE_MS = 15 * 60 * 1000;

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

async function getOverview() {
  const now = Date.now();
  const startToday = now - ((now + 3 * 60 * 60 * 1000) % (24 * 60 * 60 * 1000));
  const [
    users,
    pending,
    managers,
    resets,
    online,
    loginsToday,
    visitsToday,
    matches,
    liveMatches,
    cache,
    prefs,
  ] = await Promise.all([
    get("SELECT COUNT(*) AS n FROM users"),
    get("SELECT COUNT(*) AS n FROM users WHERE status = 'PENDING'"),
    get("SELECT COUNT(*) AS n FROM users WHERE role = 'MANAGER' AND status = 'ACTIVE'"),
    get("SELECT COUNT(*) AS n FROM password_resets WHERE status IN ('PENDING', 'ISSUED')"),
    get(
      "SELECT COUNT(*) AS n FROM users WHERE last_seen_at IS NOT NULL AND last_seen_at >= ? AND status = 'ACTIVE'",
      [now - ONLINE_MS],
    ),
    get("SELECT COUNT(*) AS n FROM login_sessions WHERE started_at >= ?", [startToday]),
    get("SELECT COUNT(*) AS n FROM access_events WHERE occurred_at >= ?", [startToday]),
    get("SELECT COUNT(*) AS n FROM matches"),
    get("SELECT COUNT(*) AS n FROM matches WHERE status = 'LIVE'"),
    oddsService.getCacheInfo(),
    oddsService.getOddsPrefs(),
  ]);

  const recentLogins = await all(
    `SELECT ls.id, ls.started_at, ls.last_seen_at, ls.ended_at, ls.ip, ls.mode,
            ls.live_count, ls.today_count, u.full_name, u.email, u.role
     FROM login_sessions ls
     JOIN users u ON u.id = ls.user_id
     ORDER BY ls.started_at DESC
     LIMIT 12`,
  );

  return {
    counts: {
      users: users?.n || 0,
      pending: pending?.n || 0,
      managers: managers?.n || 0,
      resets: resets?.n || 0,
      online: online?.n || 0,
      loginsToday: loginsToday?.n || 0,
      visitsToday: visitsToday?.n || 0,
      matches: matches?.n || 0,
      liveMatches: liveMatches?.n || 0,
    },
    cache,
    prefs,
    recentLogins,
  };
}

async function listUsers() {
  return all(
    `SELECT id, email, username, full_name, role, status, must_reset, created_at, last_login_at, last_seen_at, login_count, created_by
     FROM users
     ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END, created_at DESC`,
  );
}

async function listPendingUsers() {
  return all(
    `SELECT id, email, username, full_name, role, status, created_at, created_by
     FROM users WHERE status = 'PENDING' ORDER BY created_at ASC`,
  );
}

async function listPasswordResets() {
  return all(
    `SELECT r.*, u.full_name, u.username, u.status AS user_status
     FROM password_resets r
     JOIN users u ON u.id = r.user_id
     WHERE r.status IN ('PENDING', 'ISSUED')
     ORDER BY r.requested_at ASC`,
  );
}

async function listOnlineUsers() {
  const since = Date.now() - ONLINE_MS;
  return all(
    `SELECT id, full_name, email, role, last_seen_at, last_login_at, login_count
     FROM users
     WHERE last_seen_at IS NOT NULL AND last_seen_at >= ? AND status = 'ACTIVE'
     ORDER BY last_seen_at DESC`,
    [since],
  );
}

export { getOverview, listOnlineUsers, listPasswordResets, listPendingUsers, listUsers };
