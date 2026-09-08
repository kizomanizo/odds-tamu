import db from "../database.js";
import { scrapeBetway } from "./scrapers.js";

const CACHE_MS = 60 * 60 * 1000;
const EAT = "Africa/Dar_es_Salaam";
const ACCA_LEGS = 5;
const MODE_DEFAULTS = {
  tamu: { minOdds: 1.05, maxOdds: 1.45 },
  chungu: { minOdds: 3.5, maxOdds: 12 },
};

let inFlight = null;

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

async function getMeta(key) {
  const row = await get("SELECT value FROM app_meta WHERE key = ?", [key]);
  return row ? row.value : null;
}

async function setMeta(key, value) {
  await run(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

async function getCacheInfo() {
  const raw = await getMeta("betway_last_fetch_at");
  const lastFetchAt = raw ? Number(raw) : 0;
  const ageMs = lastFetchAt ? Date.now() - lastFetchAt : null;
  return {
    lastFetchAt: lastFetchAt || null,
    stale: !lastFetchAt || ageMs >= CACHE_MS,
    ageMs,
  };
}

async function getOddsPrefs() {
  const [tamuMin, tamuMax, chunguMin, chunguMax, limitRaw] = await Promise.all([
    getMeta("prefs_tamu_min"),
    getMeta("prefs_tamu_max"),
    getMeta("prefs_chungu_min"),
    getMeta("prefs_chungu_max"),
    getMeta("prefs_limit"),
  ]);
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    tamu: {
      minOdds: num(tamuMin, MODE_DEFAULTS.tamu.minOdds),
      maxOdds: num(tamuMax, MODE_DEFAULTS.tamu.maxOdds),
    },
    chungu: {
      minOdds: num(chunguMin, MODE_DEFAULTS.chungu.minOdds),
      maxOdds: num(chunguMax, MODE_DEFAULTS.chungu.maxOdds),
    },
    limit: Math.max(1, Math.round(num(limitRaw, 20))),
  };
}

async function setOddsPrefs({ tamuMin, tamuMax, chunguMin, chunguMax, limit }) {
  const pairs = [
    ["prefs_tamu_min", tamuMin],
    ["prefs_tamu_max", tamuMax],
    ["prefs_chungu_min", chunguMin],
    ["prefs_chungu_max", chunguMax],
    ["prefs_limit", limit],
  ];
  for (const [key, value] of pairs) {
    if (value == null || value === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    await setMeta(key, String(n));
  }
  return getOddsPrefs();
}

async function fetchAndCacheOdds({ force } = {}) {
  const info = await getCacheInfo();
  if (!force && !info.stale) {
    const minutes = Math.max(0, Math.round((info.ageMs || 0) / 60000));
    console.log(`[Cache] Serving local odds (${minutes} min old); Betway skipped.`);
    return info;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    console.log(force ? "[Cache] Manual Betway fetch requested..." : "[Cache] Local odds are older than 1 hour; querying Betway...");
    const ok = await scrapeBetway();
    if (ok) await setMeta("betway_last_fetch_at", String(Date.now()));
    else console.warn("[Cache] Betway refresh failed; keeping existing local odds.");
    return getCacheInfo();
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

function eatYmd(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EAT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function eatHour(date) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: EAT,
      hour: "2-digit",
      hour12: false,
    }).format(date),
  );
  return hour === 24 ? 0 : hour;
}

function startOfEatDayMs(date = new Date()) {
  return new Date(`${eatYmd(date)}T00:00:00+03:00`).getTime();
}

function eatDateToday() {
  return eatYmd(new Date());
}

function isEatDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function persistAccaHistory({ eatDate, mode, minOdds, maxOdds, acca }) {
  if (!acca?.legs?.length || !isEatDate(eatDate)) return;
  await run(
    `INSERT INTO acca_history (eat_date, mode, min_odds, max_odds, combined, legs_json, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(eat_date, mode) DO UPDATE SET
       min_odds=excluded.min_odds,
       max_odds=excluded.max_odds,
       combined=excluded.combined,
       legs_json=excluded.legs_json,
       captured_at=excluded.captured_at`,
    [eatDate, mode, minOdds, maxOdds, acca.combined, JSON.stringify(acca.legs), Date.now()],
  );
}

function rowToAcca(row) {
  if (!row) return null;
  let legs = [];
  try {
    legs = JSON.parse(row.legs_json) || [];
  } catch (err) {
    legs = [];
  }
  return {
    eatDate: row.eat_date,
    mode: row.mode,
    minOdds: row.min_odds,
    maxOdds: row.max_odds,
    combined: row.combined,
    legs,
    capturedAt: row.captured_at,
  };
}

async function getAccaHistory(mode, eatDate) {
  const today = eatDateToday();
  if (!isEatDate(eatDate) || eatDate > today) return null;
  const row = await get("SELECT * FROM acca_history WHERE mode = ? AND eat_date = ?", [mode, eatDate]);
  return rowToAcca(row);
}

async function getAccaHistoryRange(mode) {
  const today = eatDateToday();
  const rows = await all(
    "SELECT eat_date FROM acca_history WHERE mode = ? AND eat_date <= ? ORDER BY eat_date ASC",
    [mode, today],
  );
  const dates = rows.map((row) => row.eat_date);
  return {
    today,
    minDate: dates[0] || today,
    maxDate: today,
    dates,
  };
}

function overround(home, draw, away) {
  if (!home || !draw || !away) return null;
  const sum = 1 / home + 1 / draw + 1 / away;
  return Math.round((sum - 1) * 1000) / 10;
}

function inBand(odd, minOdds, maxOdds) {
  return Boolean(odd) && odd >= minOdds && odd <= maxOdds;
}

function sparkFrom(points) {
  const clean = (points || []).map(Number).filter((n) => n > 1);
  if (clean.length < 2) return [];
  return clean.slice(-8);
}

function steamDelta(spark) {
  if (!spark || spark.length < 2) return null;
  const prev = spark[spark.length - 2];
  const last = spark[spark.length - 1];
  return Math.round((last - prev) * 100) / 100;
}

function outcomeCatalog(match) {
  return [
    { key: "HOME", name: match.home_team, type: "HOME", market: "1X2", odd: match.home_odd, sparkKey: "home" },
    { key: "DRAW", name: "Draw", type: "DRAW", market: "1X2", odd: match.draw_odd, sparkKey: "draw" },
    { key: "AWAY", name: match.away_team, type: "AWAY", market: "1X2", odd: match.away_odd, sparkKey: "away" },
    { key: "DC_1X", name: "1X", type: "DC", market: "DC", odd: match.dc_1x, sparkKey: "dc1x" },
    { key: "DC_12", name: "12", type: "DC", market: "DC", odd: match.dc_12, sparkKey: "dc12" },
    { key: "DC_X2", name: "X2", type: "DC", market: "DC", odd: match.dc_x2, sparkKey: "dcX2" },
    { key: "BTTS_YES", name: "BTTS Yes", type: "BTTS", market: "BTTS", odd: match.btts_yes, sparkKey: "bttsYes" },
    { key: "BTTS_NO", name: "BTTS No", type: "BTTS", market: "BTTS", odd: match.btts_no, sparkKey: "bttsNo" },
  ];
}

function extraMarketChips(match, minOdds, maxOdds) {
  return [
    match.dc_1x && { label: "1X", odd: match.dc_1x, hot: inBand(match.dc_1x, minOdds, maxOdds) },
    match.dc_12 && { label: "12", odd: match.dc_12, hot: inBand(match.dc_12, minOdds, maxOdds) },
    match.dc_x2 && { label: "X2", odd: match.dc_x2, hot: inBand(match.dc_x2, minOdds, maxOdds) },
    match.btts_yes && { label: "GG", odd: match.btts_yes, hot: inBand(match.btts_yes, minOdds, maxOdds) },
    match.btts_no && { label: "NG", odd: match.btts_no, hot: inBand(match.btts_no, minOdds, maxOdds) },
  ].filter(Boolean);
}

function groupSnapshots(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.match_id)) byId.set(row.match_id, []);
    byId.get(row.match_id).push(row);
  }
  for (const list of byId.values()) {
    list.sort((a, b) => a.captured_at - b.captured_at);
  }
  return byId;
}

function sparksFor(history) {
  return {
    home: sparkFrom(history.map((h) => h.home_odd)),
    draw: sparkFrom(history.map((h) => h.draw_odd)),
    away: sparkFrom(history.map((h) => h.away_odd)),
    dc1x: sparkFrom(history.map((h) => h.dc_1x)),
    dc12: sparkFrom(history.map((h) => h.dc_12)),
    dcX2: sparkFrom(history.map((h) => h.dc_x2)),
    bttsYes: sparkFrom(history.map((h) => h.btts_yes)),
    bttsNo: sparkFrom(history.map((h) => h.btts_no)),
  };
}

function buildGhostAcca(rows, minOdds, maxOdds, mode) {
  const legLimit = mode === "chungu" ? 3 : ACCA_LEGS;
  const picked = [];
  const used = new Set();
  const candidates = [];

  for (const match of rows) {
    if (match.status === "LIVE") continue;
    const oneXTwo = outcomeCatalog(match).filter((o) => o.market === "1X2" && inBand(o.odd, minOdds, maxOdds));
    if (!oneXTwo.length) continue;
    const chosen = oneXTwo.reduce((best, o) => (o.odd < best.odd ? o : best));
    candidates.push({ match, chosen });
  }

  candidates.sort((a, b) => a.chosen.odd - b.chosen.odd);

  for (const row of candidates) {
    if (used.has(row.match.id)) continue;
    used.add(row.match.id);
    picked.push({
      id: row.match.id,
      homeTeam: row.match.home_team,
      awayTeam: row.match.away_team,
      league: row.match.league,
      commenceTime: row.match.commence_time,
      selection: `${row.chosen.name} (${row.chosen.type})`,
      odd: row.chosen.odd,
    });
    if (picked.length >= legLimit) break;
  }

  const combined = picked.reduce((acc, leg) => acc * leg.odd, 1);
  return {
    mode,
    legs: picked,
    combined: picked.length ? Math.round(combined * 100) / 100 : null,
  };
}

function buildRadar(items) {
  const now = Date.now();
  const startToday = startOfEatDayMs();
  const endToday = startToday + 24 * 60 * 60 * 1000;
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const seenHour = new Set();
  let next = null;

  for (const item of items) {
    if (item.isLive) continue;
    const ms = new Date(item.commenceTime).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms > now && (!next || ms < new Date(next.commenceTime).getTime())) next = item;
    if (ms >= startToday && ms < endToday) {
      const key = `${item.id}:${eatHour(new Date(ms))}`;
      if (!seenHour.has(key)) {
        seenHour.add(key);
        hours[eatHour(new Date(ms))].count += 1;
      }
    }
  }

  const seenIds = new Set();
  const upcoming = [];
  const sorted = items
    .filter((item) => !item.isLive && item.commenceTime)
    .sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
  for (const item of sorted) {
    const ms = new Date(item.commenceTime).getTime();
    if (Number.isNaN(ms) || ms <= now) continue;
    if (next && item.id === next.id) continue;
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    upcoming.push({
      id: item.id,
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      commenceTime: item.commenceTime,
      league: item.league,
    });
    if (upcoming.length >= 5) break;
  }

  return {
    nextKickoff: next
      ? {
          id: next.id,
          homeTeam: next.homeTeam,
          awayTeam: next.awayTeam,
          commenceTime: next.commenceTime,
          league: next.league,
        }
      : null,
    upcoming,
    hours,
  };
}

function buildNbcCards(rows, minOdds, maxOdds, watchSet) {
  return rows
    .filter((match) => match.is_tanzania === 1)
    .sort((a, b) => String(a.commence_time).localeCompare(String(b.commence_time)))
    .slice(0, 8)
    .map((match) => ({
      id: match.id,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      league: match.league,
      commenceTime: match.commence_time,
      isLive: match.status === "LIVE",
      liveScore: match.live_score,
      liveMinute: match.live_minute,
      homeOdd: match.home_odd,
      drawOdd: match.draw_odd,
      awayOdd: match.away_odd,
      watched: watchSet.has(match.id),
      chips: extraMarketChips(match, minOdds, maxOdds),
      margin: overround(match.home_odd, match.draw_odd, match.away_odd),
    }));
}

function buildAlerts(rows, snapshotsById, watchSet, minOdds, maxOdds) {
  const alerts = [];
  for (const match of rows) {
    if (!watchSet.has(match.id)) continue;
    const history = snapshotsById.get(match.id) || [];
    if (history.length < 2) continue;
    const prev = history[history.length - 2];
    const curr = history[history.length - 1];
    const prevOdds = {
      HOME: prev.home_odd,
      DRAW: prev.draw_odd,
      AWAY: prev.away_odd,
      DC_1X: prev.dc_1x,
      DC_12: prev.dc_12,
      DC_X2: prev.dc_x2,
      BTTS_YES: prev.btts_yes,
      BTTS_NO: prev.btts_no,
    };
    for (const out of outcomeCatalog(match)) {
      if (inBand(out.odd, minOdds, maxOdds) && !inBand(prevOdds[out.key], minOdds, maxOdds)) {
        alerts.push({
          id: match.id,
          homeTeam: match.home_team,
          awayTeam: match.away_team,
          selection: `${out.name} (${out.type})`,
          odd: out.odd,
        });
      }
    }
  }
  return alerts.slice(0, 8);
}

async function getWatchlistIds() {
  const rows = await all("SELECT match_id FROM watchlist");
  return rows.map((r) => r.match_id);
}

async function toggleWatchlist(matchId) {
  if (!matchId || typeof matchId !== "string") return { watched: false };
  const existing = await get("SELECT match_id FROM watchlist WHERE match_id = ?", [matchId]);
  if (existing) {
    await run("DELETE FROM watchlist WHERE match_id = ?", [matchId]);
    return { watched: false, matchId };
  }
  await run("INSERT INTO watchlist (match_id, created_at) VALUES (?, ?)", [matchId, Date.now()]);
  return { watched: true, matchId };
}

async function getDashboard({ minOdds, maxOdds, limit, mode }) {
  const [rows, snapRows, watchIds] = await Promise.all([
    all("SELECT * FROM matches ORDER BY commence_time ASC"),
    all(
      `SELECT s.* FROM odds_snapshots s
       INNER JOIN matches m ON m.id = s.match_id
       ORDER BY s.captured_at ASC`,
    ),
    getWatchlistIds(),
  ]);

  const watchSet = new Set(watchIds);
  const snapshotsById = groupSnapshots(snapRows);
  const now = Date.now();
  const startOfTodayMs = startOfEatDayMs();
  const endOfTodayMs = startOfTodayMs + 24 * 60 * 60 * 1000;
  const endOfWeekMs = startOfTodayMs + 7 * 24 * 60 * 60 * 1000;

  const results = { live: [], today: [], week: [], tz: [] };
  const radarPool = [];

  rows.forEach((match) => {
    const commenceMs = new Date(match.commence_time).getTime();
    const isLive = match.status === "LIVE";
    const isToday = !isLive && commenceMs >= startOfTodayMs && commenceMs < endOfTodayMs;
    const isThisWeek = !isLive && commenceMs >= endOfTodayMs && commenceMs <= endOfWeekMs;
    const sparks = sparksFor(snapshotsById.get(match.id) || []);
    const chips = extraMarketChips(match, minOdds, maxOdds);
    const margin = overround(match.home_odd, match.draw_odd, match.away_odd);

    outcomeCatalog(match).forEach((out) => {
      if (!inBand(out.odd, minOdds, maxOdds)) return;
      const spark = sparks[out.sparkKey] || [];
      const betItem = {
        id: match.id,
        league: match.league,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        commenceTime: match.commence_time,
        selection: `${out.name} (${out.type})`,
        market: out.market,
        odd: out.odd,
        isLive,
        liveScore: match.live_score,
        liveMinute: match.live_minute,
        margin,
        steam: steamDelta(spark),
        spark,
        chips,
        watched: watchSet.has(match.id),
        isTanzania: match.is_tanzania === 1,
      };

      radarPool.push(betItem);
      if (match.is_tanzania === 1 && results.tz.length < limit) results.tz.push(betItem);
      if (isLive && results.live.length < limit) results.live.push(betItem);
      else if (isToday && results.today.length < limit) results.today.push(betItem);
      else if (isThisWeek && results.week.length < limit) results.week.push(betItem);
    });
  });

  const ghostAcca = buildGhostAcca(rows, minOdds, maxOdds, mode);
  persistAccaHistory({
    eatDate: eatDateToday(),
    mode,
    minOdds,
    maxOdds,
    acca: ghostAcca,
  }).catch((err) => console.warn(`[Acca] history skip: ${err.message}`));

  return {
    mode,
    minOdds,
    maxOdds,
    limit,
    oddsData: results,
    ghostAcca,
    radar: buildRadar(radarPool),
    nbcCards: buildNbcCards(rows, minOdds, maxOdds, watchSet),
    alerts: buildAlerts(rows, snapshotsById, watchSet, minOdds, maxOdds),
    watchlist: watchIds,
    now,
  };
}

function resolveQuery({ mode, minOdds, maxOdds, limit, prefs }) {
  const resolvedMode = mode === "chungu" ? "chungu" : "tamu";
  const band = prefs?.[resolvedMode] || MODE_DEFAULTS[resolvedMode];
  const defaultLimit = prefs?.limit && prefs.limit > 0 ? prefs.limit : 20;
  return {
    mode: resolvedMode,
    minOdds: Number.isFinite(minOdds) ? minOdds : band.minOdds,
    maxOdds: Number.isFinite(maxOdds) ? maxOdds : band.maxOdds,
    limit: Number.isFinite(limit) && limit > 0 ? limit : defaultLimit,
  };
}

export {
  fetchAndCacheOdds,
  getCacheInfo,
  getDashboard,
  getOddsPrefs,
  setOddsPrefs,
  toggleWatchlist,
  resolveQuery,
  persistAccaHistory,
  getAccaHistory,
  getAccaHistoryRange,
  eatDateToday,
  MODE_DEFAULTS,
};
