import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import session from "express-session";
import { rateLimit } from "express-rate-limit";
import i18n from "i18n";
import { ready as dbReady } from "./database.js";
import * as oddsService from "./services/oddsService.js";
import * as auth from "./services/authService.js";
import * as admin from "./services/adminService.js";
import SqliteStore from "./services/sessionStore.js";
import { attachAvailability, lookupAvailability, tooMany } from "./services/availabilityWs.js";
import { accessLogger, clientIp } from "./services/telemetry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const CONTACT = auth.ADMIN_CONTACT;

await dbReady;
await auth.seedAdmin();

i18n.configure({
  locales: ["en", "sw"],
  directory: path.join(__dirname, "locales"),
  defaultLocale: "sw",
  cookie: "oddstamu_lang",
  queryParameter: "lang",
  objectNotation: true,
  autoReload: true,
});

app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    name: "oddstamu_sid",
    store: new SqliteStore(),
    secret: process.env.SESSION_SECRET || "oddstamu-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(i18n.init);

app.use((req, res, next) => {
  console.log(`[DEBUG LOG] ${req.method} ${req.url} - Lang Cookie: ${req.cookies.oddstamu_lang} | Query Lang: ${req.query.lang}`);
  next();
});

app.use((req, res, next) => {
  if (req.query.lang) {
    res.cookie("oddstamu_lang", req.query.lang, { maxAge: 900000, httpOnly: true });
    req.locale = req.query.lang;
    i18n.setLocale(req, req.query.lang);
  }
  res.locals.__ = res.__;
  res.locals.currentLang = i18n.getLocale(req);
  res.locals.contact = CONTACT;
  next();
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use("/fonts", express.static(path.join(__dirname, "fonts")));

app.use(async (req, res, next) => {
  try {
    if (req.session?.userId) {
      const user = await auth.getUserById(req.session.userId);
      req.user = user && user.status !== "REJECTED" ? user : null;
      if (!req.user) {
        req.session.userId = null;
        req.session.loginSessionId = null;
        req.session.loginStats = null;
      } else {
        auth.touchPresence(user.id, req.session.loginSessionId).catch(() => {});
      }
    } else {
      req.user = null;
    }
    res.locals.currentUser = auth.publicUser(req.user);
    res.locals.loginStats = req.session?.loginStats || null;
    res.locals.flash = req.session?.flash || null;
    if (req.session) req.session.flash = null;
    next();
  } catch (err) {
    next(err);
  }
});

app.use(accessLogger());

function limitHandler(redirectTo) {
  return (req, res) => {
    setFlash(req, "error", res.__("auth.errors.rate_limited"));
    res.redirect(redirectTo);
  };
}

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler("/register"),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler("/login"),
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler("/forgot"),
});

const OPEN_PATHS = new Set(["/login", "/register", "/forgot", "/reset-password", "/api/availability"]);

function isStaff(user) {
  return user && (user.role === "ADMIN" || user.role === "MANAGER");
}

function isAdmin(user) {
  return user && user.role === "ADMIN";
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function wantsJson(req) {
  return req.xhr || req.path.startsWith("/api/") || req.path.startsWith("/admin/api/") || (req.get("accept") || "").includes("application/json");
}

app.use((req, res, next) => {
  if (req.method === "GET" && (req.path.startsWith("/css") || req.path.startsWith("/js") || req.path.startsWith("/fonts") || req.path === "/favicon.ico")) {
    return next();
  }

  if (req.path === "/logout") return next();
  if (OPEN_PATHS.has(req.path)) {
    if (req.user && req.user.status === "ACTIVE" && !req.user.must_reset && req.method === "GET") {
      return res.redirect("/");
    }
    return next();
  }

  if (!req.user) {
    if (wantsJson(req)) return res.status(401).json({ error: "auth_required" });
    return res.redirect("/login");
  }

  if (req.user.status === "PENDING") {
    if (req.path === "/pending") return next();
    if (wantsJson(req)) return res.status(403).json({ error: "pending" });
    return res.redirect("/pending");
  }

  if (req.user.must_reset) {
    if (req.path === "/reset-password") return next();
    if (wantsJson(req)) return res.status(403).json({ error: "must_reset" });
    return res.redirect("/reset-password");
  }

  if (req.path === "/pending") return res.redirect("/");
  next();
});

async function parseOddsQuery(query) {
  const prefs = await oddsService.getOddsPrefs();
  const minRaw = query.minOdds === undefined || query.minOdds === "" ? NaN : parseFloat(query.minOdds);
  const maxRaw = query.maxOdds === undefined || query.maxOdds === "" ? NaN : parseFloat(query.maxOdds);
  const limitRaw = query.limit === undefined || query.limit === "" ? NaN : parseInt(query.limit, 10);
  return {
    ...oddsService.resolveQuery({
      mode: query.mode,
      minOdds: minRaw,
      maxOdds: maxRaw,
      limit: limitRaw,
      prefs,
    }),
    prefs,
  };
}

function buildBoot({ cache, dashboard, filters, res, currentLang }) {
  const t = (key) => res.__(key);
  return {
    needsRefresh: Boolean(cache.stale),
    lastFetchAt: cache.lastFetchAt || null,
    minOdds: filters.minOdds,
    maxOdds: filters.maxOdds,
    limit: filters.limit,
    mode: filters.mode,
    locale: currentLang === "sw" ? "sw-TZ" : "en-TZ",
    dashboard,
    labels: {
      loading: t("loading"),
      no_matches: t("table.no_matches"),
      fixture: t("table.fixture"),
      time: t("table.time"),
      selection: t("table.selection"),
      odds: t("table.odds"),
      margin: t("table.margin"),
      markets: t("table.markets"),
      updated_prefix: t("updated_prefix"),
      updated_never: t("updated_never"),
      refresh_failed: t("refresh_failed"),
      radar_title: t("radar.title"),
      radar_next: t("radar.next"),
      radar_none: t("radar.none"),
      radar_eat: t("radar.eat"),
      radar_later: t("radar.later"),
      acca_title: t("acca.title"),
      acca_empty: t("acca.empty"),
      acca_combined: t("acca.combined"),
      acca_legs: t("acca.legs"),
      acca_archive: t("acca.archive"),
      acca_dialog_title: t("acca.dialog_title"),
      acca_date_label: t("acca.date_label"),
      acca_date_hint: t("acca.date_hint"),
      acca_no_history: t("acca.no_history"),
      acca_close: t("acca.close"),
      acca_download_date: t("acca.download_date"),
      share_title: t("share.title"),
      share_whatsapp: t("share.whatsapp"),
      share_telegram: t("share.telegram"),
      share_download: t("share.download"),
      share_desktop: t("share.desktop_hint"),
      nbc_title: t("nbc.title"),
      watch_add: t("watch.add"),
      watch_remove: t("watch.remove"),
      alerts_title: t("alerts.title"),
    },
  };
}

function renderAuth(res, view, extra = {}) {
  res.render(view, extra);
}

app.get("/api/availability", async (req, res) => {
  const ip = clientIp(req);
  if (tooMany(ip)) return res.status(429).json({ type: "error", reason: "rate_limited" });
  try {
    const result = await lookupAvailability(String(req.query.field || ""), String(req.query.value || ""));
    res.json(result);
  } catch (err) {
    console.error("[Auth] availability failed:", err);
    res.status(500).json({ type: "error", reason: "generic" });
  }
});

app.get("/login", (req, res) => {
  renderAuth(res, "login", { form: { identifier: "" } });
});

app.post("/login", loginLimiter, async (req, res) => {
  const identifier = String(req.body.identifier || "").trim();
  const password = String(req.body.password || "");
  try {
    const result = await auth.login(identifier, password, {
      ip: clientIp(req),
      userAgent: req.get("user-agent"),
    });
    if (!result.ok) {
      if (result.reason === "pending") {
        req.session.userId = result.user.id;
        return res.redirect("/pending");
      }
      setFlash(req, "error", res.__(`auth.errors.${result.reason}`));
      return res.redirect("/login");
    }
    req.session.userId = result.user.id;
    req.session.loginSessionId = result.loginSessionId;
    req.session.loginStats = result.loginStats;
    if (result.user.must_reset) return res.redirect("/reset-password");
    return res.redirect("/");
  } catch (err) {
    console.error("[Auth] login failed:", err);
    setFlash(req, "error", res.__("auth.errors.generic"));
    return res.redirect("/login");
  }
});

app.get("/register", (req, res) => {
  renderAuth(res, "register", {
    form: { fullName: "", email: "", username: "" },
    errors: {},
  });
});

app.post("/register", registerLimiter, async (req, res) => {
  const form = {
    fullName: String(req.body.fullName || ""),
    email: String(req.body.email || ""),
    username: String(req.body.username || ""),
    password: String(req.body.password || ""),
  };
  try {
    const result = await auth.selfRegister(form);
    if (!result.ok) {
      return renderAuth(res.status(400), "register", {
        form: { fullName: form.fullName, email: form.email, username: form.username },
        errors: result.errors || {},
      });
    }
    req.session.userId = result.user.id;
    return res.redirect("/pending");
  } catch (err) {
    if (err.statusCode === 429 || err.message === "too_many") {
      setFlash(req, "error", res.__("auth.errors.rate_limited"));
      return res.redirect("/register");
    }
    console.error("[Auth] register failed:", err);
    setFlash(req, "error", res.__("auth.errors.generic"));
    return res.redirect("/register");
  }
});

app.get("/forgot", (req, res) => {
  renderAuth(res, "forgot", { form: { email: "" } });
});

app.post("/forgot", forgotLimiter, async (req, res) => {
  const email = String(req.body.email || "");
  try {
    const result = await auth.requestPasswordReset(email);
    if (result.found) {
      setFlash(req, "ok", res.__("auth.forgot_received"));
    } else {
      setFlash(req, "ok", res.__("auth.forgot_unknown"));
    }
    return res.redirect("/forgot");
  } catch (err) {
    console.error("[Auth] forgot failed:", err);
    setFlash(req, "error", res.__("auth.errors.generic"));
    return res.redirect("/forgot");
  }
});

app.get("/pending", (req, res) => {
  renderAuth(res, "pending");
});

app.get("/reset-password", (req, res) => {
  renderAuth(res, "reset", {
    form: { email: req.user?.email || "" },
  });
});

app.post("/reset-password", async (req, res) => {
  try {
    const result = await auth.completePasswordReset({
      email: req.body.email,
      code: req.body.code,
      password: req.body.password,
    });
    if (!result.ok) {
      setFlash(req, "error", res.__(`auth.errors.${result.reason || "invalid_reset"}`));
      return res.redirect("/reset-password");
    }
    setFlash(req, "ok", res.__("auth.reset_done"));
    return res.redirect("/login");
  } catch (err) {
    console.error("[Auth] reset failed:", err);
    setFlash(req, "error", res.__("auth.errors.generic"));
    return res.redirect("/reset-password");
  }
});

app.post("/logout", async (req, res) => {
  try {
    await auth.endLoginSession(req.session?.loginSessionId);
  } catch (err) {
    console.warn("[Auth] logout session skip:", err.message);
  }
  req.session.destroy(() => {
    res.clearCookie("oddstamu_sid");
    res.redirect("/login");
  });
});

app.get("/logout", async (req, res) => {
  try {
    await auth.endLoginSession(req.session?.loginSessionId);
  } catch (err) {
    console.warn("[Auth] logout session skip:", err.message);
  }
  req.session.destroy(() => {
    res.clearCookie("oddstamu_sid");
    res.redirect("/login");
  });
});

app.get("/", async (req, res) => {
  const filters = await parseOddsQuery(req.query);

  console.log(`\n--- Fetching Dashboard Odds ---`);
  console.log(`Params -> Mode: ${filters.mode}, Min: ${filters.minOdds}, Max: ${filters.maxOdds}, Limit: ${filters.limit}`);

  try {
    const cache = await oddsService.getCacheInfo();
    const dashboard = await oddsService.getDashboard(filters);
    auth.recordBoardStats(req.session.loginSessionId, dashboard, filters).catch(() => {});
    const boot = buildBoot({
      cache,
      dashboard,
      filters,
      res,
      currentLang: res.locals.currentLang,
    });

    console.log(
      `Render Stats -> Live: ${dashboard.oddsData.live.length}, Today: ${dashboard.oddsData.today.length}, Week: ${dashboard.oddsData.week.length}, TZ: ${dashboard.oddsData.tz.length}`,
    );
    console.log(`Cache -> stale: ${cache.stale}, lastFetchAt: ${cache.lastFetchAt || "never"}`);

    res.render("index", {
      ...filters,
      dashboard,
      cache,
      boot,
    });
  } catch (err) {
    console.error("[ERROR] Route Handler Failed:", err);
    res.status(500).send("Error rendering dashboard: " + err.message);
  }
});

app.get("/api/odds", async (req, res) => {
  const filters = await parseOddsQuery(req.query);

  try {
    await oddsService.fetchAndCacheOdds();
    const [dashboard, cache] = await Promise.all([
      oddsService.getDashboard(filters),
      oddsService.getCacheInfo(),
    ]);
    auth.recordBoardStats(req.session.loginSessionId, dashboard, filters).catch(() => {});
    res.json({
      ...dashboard,
      lastFetchAt: cache.lastFetchAt,
      stale: cache.stale,
    });
  } catch (err) {
    console.error("[ERROR] Odds API Failed:", err);
    res.status(500).json({ error: "Could not load odds" });
  }
});

app.get("/api/acca/history", async (req, res) => {
  const { mode } = await parseOddsQuery(req.query);
  const today = oddsService.eatDateToday();
  const requested = String(req.query.date || "");

  try {
    const range = await oddsService.getAccaHistoryRange(mode);
    if (!requested) {
      return res.json(range);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requested) || requested > today) {
      return res.status(400).json({ error: "invalid_date", ...range });
    }
    const acca = await oddsService.getAccaHistory(mode, requested);
    res.json({ ...range, date: requested, acca });
  } catch (err) {
    console.error("[ERROR] Acca history failed:", err);
    res.status(500).json({ error: "Could not load acca history" });
  }
});

app.post("/api/watchlist", async (req, res) => {
  try {
    const result = await oddsService.toggleWatchlist(req.body && req.body.matchId);
    res.json(result);
  } catch (err) {
    console.error("[ERROR] Watchlist Failed:", err);
    res.status(500).json({ error: "Could not update watchlist" });
  }
});

function requireStaff(req, res, next) {
  if (!isStaff(req.user)) {
    if (wantsJson(req)) return res.status(403).json({ error: "forbidden" });
    return res.redirect("/");
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    if (wantsJson(req)) return res.status(403).json({ error: "forbidden" });
    return res.redirect("/admin");
  }
  next();
}

app.get("/admin", requireStaff, async (req, res) => {
  try {
    const [overview, pending, users, resets, online] = await Promise.all([
      admin.getOverview(),
      admin.listPendingUsers(),
      isAdmin(req.user) ? admin.listUsers() : Promise.resolve([]),
      isAdmin(req.user) ? admin.listPasswordResets() : Promise.resolve([]),
      isAdmin(req.user) ? admin.listOnlineUsers() : Promise.resolve([]),
    ]);
    res.render("admin", {
      overview,
      pending,
      users,
      resets,
      online,
      canApprove: isAdmin(req.user),
      canSettings: isAdmin(req.user),
    });
  } catch (err) {
    console.error("[Admin] dashboard failed:", err);
    res.status(500).send("Admin dashboard error: " + err.message);
  }
});

app.post("/admin/api/users", requireStaff, async (req, res) => {
  try {
    const role = isAdmin(req.user) && req.body.role === "MANAGER" ? "MANAGER" : "USER";
    const status = isAdmin(req.user) ? "ACTIVE" : "PENDING";
    const result = await auth.createUser({
      email: req.body.email,
      username: req.body.username,
      fullName: req.body.fullName,
      password: req.body.password,
      role,
      status,
      createdBy: req.user.id,
    });
    if (!result.ok) return res.status(400).json({ ok: false, errors: result.errors });
    res.json({ ok: true, user: auth.publicUser(result.user), status });
  } catch (err) {
    console.error("[Admin] create user failed:", err);
    res.status(500).json({ ok: false, error: "create_failed" });
  }
});

app.post("/admin/api/users/:id/approve", requireAdmin, async (req, res) => {
  await auth.setUserStatus(Number(req.params.id), "ACTIVE", req.user.id);
  res.json({ ok: true });
});

app.post("/admin/api/users/:id/reject", requireAdmin, async (req, res) => {
  await auth.setUserStatus(Number(req.params.id), "REJECTED", req.user.id);
  res.json({ ok: true });
});

app.post("/admin/api/resets/:id/issue", requireAdmin, async (req, res) => {
  const result = await auth.issuePasswordReset(Number(req.params.id), req.user.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

app.post("/admin/api/settings", requireAdmin, async (req, res) => {
  try {
    const prefs = await oddsService.setOddsPrefs({
      tamuMin: req.body.tamuMin,
      tamuMax: req.body.tamuMax,
      chunguMin: req.body.chunguMin,
      chunguMax: req.body.chunguMax,
      limit: req.body.limit,
    });
    res.json({ ok: true, prefs });
  } catch (err) {
    console.error("[Admin] settings failed:", err);
    res.status(500).json({ ok: false });
  }
});

app.post("/admin/api/fetch", requireAdmin, async (req, res) => {
  try {
    const cache = await oddsService.fetchAndCacheOdds({ force: true });
    res.json({ ok: true, cache });
  } catch (err) {
    console.error("[Admin] fetch failed:", err);
    res.status(500).json({ ok: false, error: "fetch_failed" });
  }
});

app.get("/admin/api/overview", requireStaff, async (req, res) => {
  const overview = await admin.getOverview();
  res.json(overview);
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
attachAvailability(server);
server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 OddsTamu Dev Server Running on http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
