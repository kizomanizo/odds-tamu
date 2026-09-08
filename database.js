import sqlite3Module from "sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sqlite3 = sqlite3Module.verbose();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "oddstamu.db");
const db = new sqlite3.Database(dbPath);

let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});

function addColumn(table, column, type) {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, () => {});
}

db.serialize(() => {
  db.run(`
        CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY,
            sport_key TEXT,
            league TEXT,
            home_team TEXT,
            away_team TEXT,
            commence_time DATETIME,
            status TEXT DEFAULT 'NS',
            home_odd REAL,
            draw_odd REAL,
            away_odd REAL,
            is_tanzania INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            dc_1x REAL,
            dc_12 REAL,
            dc_x2 REAL,
            btts_yes REAL,
            btts_no REAL,
            live_score TEXT,
            live_minute TEXT
        )
    `);

  [
    ["dc_1x", "REAL"],
    ["dc_12", "REAL"],
    ["dc_x2", "REAL"],
    ["btts_yes", "REAL"],
    ["btts_no", "REAL"],
    ["live_score", "TEXT"],
    ["live_minute", "TEXT"],
  ].forEach(([column, type]) => addColumn("matches", column, type));

  db.run(`
        CREATE TABLE IF NOT EXISTS odds_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id TEXT NOT NULL,
            captured_at INTEGER NOT NULL,
            home_odd REAL,
            draw_odd REAL,
            away_odd REAL,
            dc_1x REAL,
            dc_12 REAL,
            dc_x2 REAL,
            btts_yes REAL,
            btts_no REAL
        )
    `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_match_time ON odds_snapshots (match_id, captured_at)`);

  db.run(`
        CREATE TABLE IF NOT EXISTS watchlist (
            match_id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL
        )
    `);

  db.run(`
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

  db.run(`
        CREATE TABLE IF NOT EXISTS acca_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            eat_date TEXT NOT NULL,
            mode TEXT NOT NULL,
            min_odds REAL,
            max_odds REAL,
            combined REAL,
            legs_json TEXT NOT NULL,
            captured_at INTEGER NOT NULL,
            UNIQUE(eat_date, mode)
        )
    `);

  db.run(`
        CREATE TABLE IF NOT EXISTS access_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            occurred_at INTEGER NOT NULL,
            visitor_id TEXT NOT NULL,
            path TEXT NOT NULL,
            method TEXT NOT NULL,
            ip TEXT,
            user_agent TEXT,
            lang TEXT,
            mode TEXT
        )
    `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_access_visitor_time ON access_events (visitor_id, occurred_at)`);
  addColumn("access_events", "user_id", "INTEGER");

  db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'USER',
            status TEXT NOT NULL DEFAULT 'PENDING',
            must_reset INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            created_by INTEGER,
            approved_at INTEGER,
            approved_by INTEGER,
            last_login_at INTEGER,
            last_seen_at INTEGER,
            login_count INTEGER NOT NULL DEFAULT 0
        )
    `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_users_status ON users (status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`);

  db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expired INTEGER NOT NULL
        )
    `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions (expired)`);

  db.run(`
        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            code_hash TEXT,
            requested_at INTEGER NOT NULL,
            issued_at INTEGER,
            issued_by INTEGER,
            used_at INTEGER
        )
    `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_resets_status ON password_resets (status, requested_at)`);

  db.run(`
        CREATE TABLE IF NOT EXISTS login_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            last_seen_at INTEGER,
            ip TEXT,
            user_agent TEXT,
            live_count INTEGER,
            today_count INTEGER,
            week_count INTEGER,
            tz_count INTEGER,
            mode TEXT,
            min_odds REAL,
            max_odds REAL
        )
    `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions (user_id, started_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_login_sessions_seen ON login_sessions (last_seen_at)`, (err) => {
    if (err) readyReject(err);
    else readyResolve();
  });
});

export { ready };
export default db;
