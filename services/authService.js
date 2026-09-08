import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import db from "../database.js";

const ROUNDS = 10;
const ROLES = new Set(["ADMIN", "MANAGER", "USER"]);
const STATUSES = new Set(["PENDING", "ACTIVE", "REJECTED"]);
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const USERNAME_RE = /^[a-z][a-z0-9._]{2,23}$/;
const NAME_RE = /^[\p{L}][\p{L}\s'.-]{1,79}$/u;
const ADMIN_CONTACT = {
  phone: "+255755437887",
  emailDisplay: "kizomanizo(at)gmail.com",
  email: "kizomanizo@gmail.com",
};

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

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.full_name,
    role: user.role,
    status: user.status,
    mustReset: Boolean(user.must_reset),
    loginCount: user.login_count,
    lastLoginAt: user.last_login_at,
  };
}

function validateEmail(email) {
  if (!email) return "email_required";
  if (email.length > 120) return "email_invalid";
  if (!EMAIL_RE.test(email)) return "email_invalid";
  return null;
}

function validateUsername(username) {
  if (!username) return "username_required";
  if (!USERNAME_RE.test(username)) return "username_invalid";
  return null;
}

function validateFullName(name) {
  if (!name) return "name_required";
  if (name.length < 2 || name.length > 80) return "name_invalid";
  if (!NAME_RE.test(name)) return "name_invalid";
  return null;
}

function validatePassword(password) {
  if (!password || String(password).length < 8) return "password_short";
  if (String(password).length > 72) return "password_invalid";
  return null;
}

async function checkAvailability({ email, username, excludeUserId } = {}) {
  const result = { email: null, username: null };
  if (email != null) {
    const normalized = normalizeEmail(email);
    const err = validateEmail(normalized);
    if (err) result.email = { available: false, reason: err };
    else {
      const row = await get(
        `SELECT id FROM users WHERE email = ? ${excludeUserId ? "AND id != ?" : ""} LIMIT 1`,
        excludeUserId ? [normalized, excludeUserId] : [normalized],
      );
      result.email = row ? { available: false, reason: "email_taken" } : { available: true, reason: null };
    }
  }
  if (username != null) {
    const normalized = normalizeUsername(username);
    const err = validateUsername(normalized);
    if (err) result.username = { available: false, reason: err };
    else {
      const row = await get(
        `SELECT id FROM users WHERE username = ? ${excludeUserId ? "AND id != ?" : ""} LIMIT 1`,
        excludeUserId ? [normalized, excludeUserId] : [normalized],
      );
      result.username = row ? { available: false, reason: "username_taken" } : { available: true, reason: null };
    }
  }
  return result;
}

async function seedAdmin() {
  const seeded = await get("SELECT value FROM app_meta WHERE key = ?", ["admin_seeded"]);
  if (seeded?.value === "1") {
    console.log("[Auth] Admin already seeded; skipping.");
    return { seeded: false, reason: "already" };
  }

  const existingAdmin = await get("SELECT id FROM users WHERE role = ? LIMIT 1", ["ADMIN"]);
  if (existingAdmin) {
    await run("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
      "admin_seeded",
      "1",
    ]);
    console.log("[Auth] Admin already exists; marking seeded.");
    return { seeded: false, reason: "exists" };
  }

  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const username = normalizeUsername(process.env.ADMIN_USERNAME);
  const password = process.env.ADMIN_PASSWORD;
  const fullName = "Kizito Mrema";

  if (validateEmail(email) || validateUsername(username) || validatePassword(password)) {
    console.warn("[Auth] ADMIN_EMAIL / ADMIN_USERNAME / ADMIN_PASSWORD missing or invalid; admin not seeded.");
    return { seeded: false, reason: "env" };
  }

  const hash = await bcrypt.hash(password, ROUNDS);
  const now = Date.now();
  await run(
    `INSERT INTO users (email, username, full_name, password_hash, role, status, must_reset, created_at, approved_at, login_count)
     VALUES (?, ?, ?, ?, 'ADMIN', 'ACTIVE', 0, ?, ?, 0)`,
    [email, username, fullName, hash, now, now],
  );
  await run("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    "admin_seeded",
    "1",
  ]);
  console.log(`[Auth] Seeded admin ${username} <${email}>.`);
  return { seeded: true };
}

async function getUserById(id) {
  if (!id) return null;
  return get("SELECT * FROM users WHERE id = ?", [id]);
}

async function findUserByLogin(identifier) {
  const value = String(identifier || "").trim().toLowerCase();
  if (!value) return null;
  return get("SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1", [value, value]);
}

async function createUser({ email, username, fullName, password, role = "USER", status, createdBy = null }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);
  const name = normalizeName(fullName);
  const resolvedRole = ROLES.has(role) ? role : "USER";
  const resolvedStatus = STATUSES.has(status) ? status : "PENDING";

  const errors = {
    email: validateEmail(normalizedEmail),
    username: validateUsername(normalizedUsername),
    fullName: validateFullName(name),
    password: validatePassword(password),
  };
  if (Object.values(errors).some(Boolean)) {
    return { ok: false, errors };
  }

  const availability = await checkAvailability({ email: normalizedEmail, username: normalizedUsername });
  if (!availability.email.available) errors.email = availability.email.reason;
  if (!availability.username.available) errors.username = availability.username.reason;
  if (errors.email || errors.username) return { ok: false, errors };

  const hash = await bcrypt.hash(password, ROUNDS);
  const now = Date.now();
  const approvedAt = resolvedStatus === "ACTIVE" ? now : null;
  const result = await run(
    `INSERT INTO users (email, username, full_name, password_hash, role, status, must_reset, created_at, created_by, approved_at, approved_by, login_count)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0)`,
    [
      normalizedEmail,
      normalizedUsername,
      name,
      hash,
      resolvedRole,
      resolvedStatus,
      now,
      createdBy,
      approvedAt,
      resolvedStatus === "ACTIVE" ? createdBy : null,
    ],
  );
  const user = await getUserById(result.lastID);
  return { ok: true, user };
}

async function selfRegister(fields) {
  return createUser({ ...fields, role: "USER", status: "PENDING", createdBy: null });
}

async function login(identifier, password, { ip, userAgent } = {}) {
  const user = await findUserByLogin(identifier);
  if (!user) return { ok: false, reason: "invalid_credentials" };
  const match = await bcrypt.compare(String(password || ""), user.password_hash);
  if (!match) return { ok: false, reason: "invalid_credentials" };
  if (user.status === "PENDING") return { ok: false, reason: "pending", user };
  if (user.status === "REJECTED") return { ok: false, reason: "rejected" };
  if (user.status !== "ACTIVE") return { ok: false, reason: "invalid_credentials" };

  const previous = await get(
    "SELECT * FROM login_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
    [user.id],
  );
  const now = Date.now();
  const sessionInsert = await run(
    `INSERT INTO login_sessions (user_id, started_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, now, now, String(ip || "").slice(0, 64), String(userAgent || "").slice(0, 240)],
  );
  await run("UPDATE users SET last_login_at = ?, last_seen_at = ?, login_count = login_count + 1 WHERE id = ?", [
    now,
    now,
    user.id,
  ]);
  const fresh = await getUserById(user.id);
  return {
    ok: true,
    user: fresh,
    loginSessionId: sessionInsert.lastID,
    loginStats: {
      sessionCount: fresh.login_count,
      lastLoginAt: previous?.started_at || null,
      lastBoard: previous
        ? {
            live: previous.live_count,
            today: previous.today_count,
            week: previous.week_count,
            tz: previous.tz_count,
            mode: previous.mode,
          }
        : null,
    },
  };
}

async function touchPresence(userId, loginSessionId) {
  const now = Date.now();
  if (userId) await run("UPDATE users SET last_seen_at = ? WHERE id = ?", [now, userId]);
  if (loginSessionId) {
    await run("UPDATE login_sessions SET last_seen_at = ? WHERE id = ? AND ended_at IS NULL", [now, loginSessionId]);
  }
}

async function recordBoardStats(loginSessionId, dashboard, filters) {
  if (!loginSessionId || !dashboard?.oddsData) return;
  await run(
    `UPDATE login_sessions
     SET live_count = ?, today_count = ?, week_count = ?, tz_count = ?, mode = ?, min_odds = ?, max_odds = ?, last_seen_at = ?
     WHERE id = ?`,
    [
      dashboard.oddsData.live?.length || 0,
      dashboard.oddsData.today?.length || 0,
      dashboard.oddsData.week?.length || 0,
      dashboard.oddsData.tz?.length || 0,
      filters?.mode || null,
      filters?.minOdds ?? null,
      filters?.maxOdds ?? null,
      Date.now(),
      loginSessionId,
    ],
  );
}

async function endLoginSession(loginSessionId) {
  if (!loginSessionId) return;
  await run("UPDATE login_sessions SET ended_at = ?, last_seen_at = ? WHERE id = ? AND ended_at IS NULL", [
    Date.now(),
    Date.now(),
    loginSessionId,
  ]);
}

async function requestPasswordReset(email) {
  const normalized = normalizeEmail(email);
  if (validateEmail(normalized)) return { ok: true, found: false };
  const user = await get("SELECT * FROM users WHERE email = ?", [normalized]);
  if (!user) return { ok: true, found: false };
  const existing = await get(
    "SELECT id FROM password_resets WHERE user_id = ? AND status IN ('PENDING', 'ISSUED') LIMIT 1",
    [user.id],
  );
  if (!existing) {
    await run("INSERT INTO password_resets (user_id, email, status, requested_at) VALUES (?, ?, 'PENDING', ?)", [
      user.id,
      normalized,
      Date.now(),
    ]);
  }
  return { ok: true, found: true };
}

function sixDigitCode() {
  return String(randomInt(100000, 1000000));
}

function tempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[randomInt(0, alphabet.length)];
  return out;
}

async function issuePasswordReset(resetId, adminId) {
  const row = await get("SELECT * FROM password_resets WHERE id = ?", [resetId]);
  if (!row || (row.status !== "PENDING" && row.status !== "ISSUED")) {
    return { ok: false, reason: "not_found" };
  }
  const code = sixDigitCode();
  const password = tempPassword();
  const codeHash = await bcrypt.hash(code, ROUNDS);
  const passwordHash = await bcrypt.hash(password, ROUNDS);
  const now = Date.now();
  await run(
    "UPDATE password_resets SET status = 'ISSUED', code_hash = ?, issued_at = ?, issued_by = ? WHERE id = ?",
    [codeHash, now, adminId, resetId],
  );
  await run("UPDATE users SET password_hash = ?, must_reset = 1 WHERE id = ?", [passwordHash, row.user_id]);
  return { ok: true, code, tempPassword: password, email: row.email };
}

async function completePasswordReset({ email, code, password }) {
  const normalized = normalizeEmail(email);
  const errors = {
    email: validateEmail(normalized),
    password: validatePassword(password),
    code: String(code || "").trim().length === 6 ? null : "code_invalid",
  };
  if (Object.values(errors).some(Boolean)) return { ok: false, errors };

  const user = await get("SELECT * FROM users WHERE email = ?", [normalized]);
  if (!user) return { ok: false, reason: "invalid_reset" };
  const reset = await get(
    "SELECT * FROM password_resets WHERE user_id = ? AND status = 'ISSUED' ORDER BY issued_at DESC LIMIT 1",
    [user.id],
  );
  if (!reset?.code_hash) return { ok: false, reason: "invalid_reset" };
  const match = await bcrypt.compare(String(code).trim(), reset.code_hash);
  if (!match) return { ok: false, reason: "invalid_reset" };

  const hash = await bcrypt.hash(password, ROUNDS);
  const now = Date.now();
  await run("UPDATE users SET password_hash = ?, must_reset = 0 WHERE id = ?", [hash, user.id]);
  await run("UPDATE password_resets SET status = 'USED', used_at = ? WHERE id = ?", [now, reset.id]);
  return { ok: true };
}

async function setUserStatus(userId, status, adminId) {
  if (!STATUSES.has(status)) return { ok: false };
  const now = Date.now();
  if (status === "ACTIVE") {
    await run("UPDATE users SET status = ?, approved_at = ?, approved_by = ? WHERE id = ?", [
      status,
      now,
      adminId,
      userId,
    ]);
  } else {
    await run("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
  }
  return { ok: true };
}

export {
  ADMIN_CONTACT,
  checkAvailability,
  completePasswordReset,
  createUser,
  endLoginSession,
  findUserByLogin,
  getUserById,
  issuePasswordReset,
  login,
  publicUser,
  recordBoardStats,
  requestPasswordReset,
  seedAdmin,
  selfRegister,
  setUserStatus,
  touchPresence,
  validateEmail,
  validateFullName,
  validatePassword,
  validateUsername,
};
