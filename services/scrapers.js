import axios from "axios";
import db from "../database.js";

const BETWAY_ORIGIN = "https://www.betway.co.tz";
const BETWAY_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9,sw-TZ;q=0.8",
  Origin: BETWAY_ORIGIN,
  Referer: `${BETWAY_ORIGIN}/`,
};

const MARKET_TYPES = ["[Win/Draw/Win]", "[Double Chance]", "[Both Teams To Score]"];
const PAGE_SIZE = 100;
const MAX_UPCOMING_PAGES = 10;

function betwayUrl(path, { skip, take }) {
  const params = new URLSearchParams({
    countryCode: "TZ",
    sportId: "soccer",
    Skip: String(skip),
    Take: String(take),
    cultureCode: "en-TZ",
    isEsport: "false",
    boostedOnly: "false",
  });
  MARKET_TYPES.forEach((market) => params.append("marketTypes", market));
  return `${BETWAY_ORIGIN}${path}?${params.toString()}`;
}

async function fetchBetBook(path, skip, take) {
  const url = betwayUrl(path, { skip, take });
  const res = await axios.get(url, { headers: BETWAY_HEADERS, timeout: 25000 });
  return res.data || {};
}

function indexBy(items, key) {
  const map = new Map();
  for (const item of items || []) {
    map.set(item[key], item);
  }
  return map;
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items || []) {
    const id = item[key];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(item);
  }
  return map;
}

function isEsoccer(event) {
  const regionId = String(event.regionId || "").toLowerCase();
  const region = String(event.region || "").toLowerCase();
  return regionId === "esoccer" || region.includes("esoccer") || region.includes("esport");
}

function isTanzaniaEvent(event) {
  const blob = [event.regionId, event.region, event.leagueId, event.league].join(" ").toLowerCase();
  return blob.includes("tanzania") || blob.includes("nbc");
}

function decimalFor(outcome, pricesByOutcome) {
  const price = pricesByOutcome.get(outcome.outcomeId);
  const decimal = price && Number(price.priceDecimal);
  if (!decimal || decimal <= 1) return null;
  if (outcome.isTradingActive === false) return null;
  if (outcome.shouldDisplay === false) return null;
  return decimal;
}

function activeMarkets(list, typeName) {
  const names = (Array.isArray(typeName) ? typeName : [typeName]).map((name) => String(name).toLowerCase());
  return (list || []).filter((market) => {
    const cname = String(market.marketTypeCName || "").toLowerCase();
    const display = String(market.displayName || "").toLowerCase();
    return (
      (names.includes(cname) || names.includes(display)) &&
      market.isActive !== false &&
      market.shouldDisplay !== false &&
      !market.isSuspended
    );
  });
}

function parseOneXTwo(event, marketsByEvent, outcomesByMarket, pricesByOutcome) {
  const markets = activeMarkets(marketsByEvent.get(event.eventId), ["1x2", "win-draw-win", "win/draw/win"]);
  if (!markets.length) return null;

  const outcomes = (outcomesByMarket.get(markets[0].marketId) || [])
    .filter((o) => o.shouldDisplay !== false)
    .sort((a, b) => (a.index || 0) - (b.index || 0));
  if (outcomes.length < 3) return null;

  const homeName = String(event.homeTeam || "").toLowerCase();
  const awayName = String(event.awayTeam || "").toLowerCase();

  let homeOdd = null;
  let drawOdd = null;
  let awayOdd = null;

  for (const outcome of outcomes) {
    const decimal = decimalFor(outcome, pricesByOutcome);
    if (!decimal) continue;
    const name = String(outcome.name || "").toLowerCase();
    if (name === "draw") drawOdd = decimal;
    else if (name === homeName) homeOdd = decimal;
    else if (name === awayName) awayOdd = decimal;
  }

  if (homeOdd && drawOdd && awayOdd) {
    return { homeOdd, drawOdd, awayOdd };
  }

  const priced = outcomes
    .map((outcome) => ({ outcome, decimal: decimalFor(outcome, pricesByOutcome) }))
    .filter((row) => row.decimal);
  if (priced.length < 3) return null;

  return {
    homeOdd: priced[0].decimal,
    drawOdd: priced[1].decimal,
    awayOdd: priced[2].decimal,
  };
}

function parseDoubleChance(event, marketsByEvent, outcomesByMarket, pricesByOutcome) {
  const markets = activeMarkets(marketsByEvent.get(event.eventId), "double-chance");
  if (!markets.length) return {};

  const home = String(event.homeTeam || "").toLowerCase();
  const away = String(event.awayTeam || "").toLowerCase();
  const outcomes = (outcomesByMarket.get(markets[0].marketId) || []).sort(
    (a, b) => (a.index || 0) - (b.index || 0),
  );

  const result = {};
  for (const outcome of outcomes) {
    const decimal = decimalFor(outcome, pricesByOutcome);
    if (!decimal) continue;
    const name = String(outcome.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (name === "1x" || name.includes("home or draw") || (name.includes(home) && name.includes("draw"))) {
      result.dc1x = decimal;
    } else if (name === "x2" || name.includes("draw or away") || (name.includes(away) && name.includes("draw"))) {
      result.dcX2 = decimal;
    } else if (name === "12" || name.includes("home or away") || (name.includes(home) && name.includes(away))) {
      result.dc12 = decimal;
    }
  }

  if (!result.dc1x && !result.dc12 && !result.dcX2 && outcomes.length >= 3) {
    const priced = outcomes.map((o) => decimalFor(o, pricesByOutcome)).filter(Boolean);
    if (priced.length >= 3) {
      result.dc1x = priced[0];
      result.dc12 = priced[1];
      result.dcX2 = priced[2];
    }
  }
  return result;
}

function parseBtts(event, marketsByEvent, outcomesByMarket, pricesByOutcome) {
  const markets = activeMarkets(marketsByEvent.get(event.eventId), "both-teams-to-score");
  if (!markets.length) return {};

  const outcomes = (outcomesByMarket.get(markets[0].marketId) || []).sort(
    (a, b) => (a.index || 0) - (b.index || 0),
  );
  const result = {};
  for (const outcome of outcomes) {
    const decimal = decimalFor(outcome, pricesByOutcome);
    if (!decimal) continue;
    const name = String(outcome.name || "").toLowerCase();
    if (name === "yes" || name === "ndiyo") result.bttsYes = decimal;
    else if (name === "no" || name === "hapana") result.bttsNo = decimal;
  }
  if (!result.bttsYes && !result.bttsNo && outcomes.length >= 2) {
    const priced = outcomes.map((o) => decimalFor(o, pricesByOutcome)).filter(Boolean);
    if (priced.length >= 2) {
      result.bttsYes = priced[0];
      result.bttsNo = priced[1];
    }
  }
  return result;
}

function parseLiveState(event) {
  const raw = event.gameStateTimeScore || event.gameState || event.scoreBoard || event.score;
  if (raw == null || raw === "") return { liveScore: null, liveMinute: null };

  if (typeof raw === "string") {
    const minute = (raw.match(/(\d+)\s*'/) || [])[1] || (raw.match(/\b(HT|FT|ET|1st half|2nd half)\b/i) || [])[1] || null;
    const score = (raw.match(/(\d+\s*[-–:]\s*\d+)/) || [])[1] || raw;
    return { liveScore: String(score).replace(/\s+/g, ""), liveMinute: minute };
  }

  if (typeof raw === "object") {
    let liveScore = null;
    if (Array.isArray(raw.score) && raw.score.length >= 2) {
      liveScore = `${raw.score[0]}–${raw.score[1]}`;
    } else {
      const home = raw.homeScore ?? raw.home ?? raw.scoreHome ?? raw.homeGoals;
      const away = raw.awayScore ?? raw.away ?? raw.scoreAway ?? raw.awayGoals;
      const display = raw.display || raw.text || raw.value;
      liveScore = home != null && away != null ? `${home}–${away}` : display ? String(display) : null;
    }

    const minuteNum = raw.time ?? raw.minute ?? raw.gameTime ?? raw.clock;
    const state = raw.state || raw.period;
    const liveMinute = [minuteNum != null && minuteNum !== "" ? `${minuteNum}'` : null, state]
      .filter(Boolean)
      .join(" · ");

    return { liveScore, liveMinute: liveMinute || null };
  }

  return { liveScore: String(raw), liveMinute: null };
}

function normalizeEvents(payload, existingById) {
  const events = payload.events || [];
  const marketsByEvent = groupBy(payload.markets, "eventId");
  const outcomesByMarket = groupBy(payload.outcomes, "marketId");
  const pricesByOutcome = indexBy(payload.prices, "outcomeId");

  for (const event of events) {
    if (!event || event.isActive === false || event.isFinished || event.shouldDisplay === false) continue;
    if (isEsoccer(event)) continue;
    if (!event.homeTeam || !event.awayTeam || !event.expectedStartEpoch) continue;

    const odds = parseOneXTwo(event, marketsByEvent, outcomesByMarket, pricesByOutcome);
    if (!odds) continue;

    const dc = parseDoubleChance(event, marketsByEvent, outcomesByMarket, pricesByOutcome);
    const btts = parseBtts(event, marketsByEvent, outcomesByMarket, pricesByOutcome);
    const live = parseLiveState(event);

    const id = `bw_${event.eventId}`;
    const previous = existingById.get(id);
    const isLive = Boolean(event.isLive);
    const match = {
      id,
      source: "betway",
      league: event.league || event.region || "Betway",
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      commenceTime: new Date(event.expectedStartEpoch * 1000).toISOString(),
      status: isLive ? "LIVE" : "NS",
      homeOdd: odds.homeOdd,
      drawOdd: odds.drawOdd,
      awayOdd: odds.awayOdd,
      dc1x: dc.dc1x || null,
      dc12: dc.dc12 || null,
      dcX2: dc.dcX2 || null,
      bttsYes: btts.bttsYes || null,
      bttsNo: btts.bttsNo || null,
      liveScore: isLive ? live.liveScore : null,
      liveMinute: isLive ? live.liveMinute : null,
      isTanzania: isTanzaniaEvent(event) ? 1 : 0,
    };

    if (!previous || isLive || previous.status !== "LIVE") {
      existingById.set(id, match);
    }
  }
}

async function fetchHighlights() {
  const data = await fetchBetBook("/sportsapi/br/v1/BetBook/Highlights/", 0, PAGE_SIZE);
  console.log(`[Scraper] Betway Highlights: ${(data.events || []).length} events`);
  return data;
}

async function fetchUpcomingPages() {
  const pages = [];
  for (let page = 0; page < MAX_UPCOMING_PAGES; page++) {
    const skip = page * PAGE_SIZE;
    try {
      const data = await fetchBetBook("/sportsapi/br/v1/BetBook/Upcoming/", skip, PAGE_SIZE);
      const events = data.events || [];
      pages.push(data);
      console.log(`[Scraper] Betway Upcoming skip=${skip}: ${events.length} events (final=${Boolean(data.isFinalPage)})`);
      if (!events.length || data.isFinalPage) break;
    } catch (err) {
      console.warn(`[Scraper Notice] Betway Upcoming skip=${skip} failed: ${err.message}`);
      break;
    }
  }
  return pages;
}

function persistMatches(matches) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, count) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(count);
    };

    const fail = (err) => {
      db.run("ROLLBACK", () => done(err));
    };

    const capturedAt = Date.now();

    db.serialize(() => {
      db.run("BEGIN TRANSACTION", (beginErr) => {
        if (beginErr) return done(beginErr);

        const upsert = db.prepare(`
          INSERT INTO matches (
            id, sport_key, league, home_team, away_team, commence_time, status,
            home_odd, draw_odd, away_odd, is_tanzania, updated_at,
            dc_1x, dc_12, dc_x2, btts_yes, btts_no, live_score, live_minute
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            sport_key=excluded.sport_key,
            league=excluded.league,
            home_team=excluded.home_team,
            away_team=excluded.away_team,
            commence_time=excluded.commence_time,
            status=excluded.status,
            home_odd=excluded.home_odd,
            draw_odd=excluded.draw_odd,
            away_odd=excluded.away_odd,
            is_tanzania=excluded.is_tanzania,
            updated_at=CURRENT_TIMESTAMP,
            dc_1x=excluded.dc_1x,
            dc_12=excluded.dc_12,
            dc_x2=excluded.dc_x2,
            btts_yes=excluded.btts_yes,
            btts_no=excluded.btts_no,
            live_score=excluded.live_score,
            live_minute=excluded.live_minute
        `);

        for (const match of matches) {
          upsert.run([
            match.id,
            match.source || "betway",
            match.league,
            match.homeTeam,
            match.awayTeam,
            match.commenceTime,
            match.status,
            match.homeOdd,
            match.drawOdd,
            match.awayOdd,
            match.isTanzania,
            match.dc1x,
            match.dc12,
            match.dcX2,
            match.bttsYes,
            match.bttsNo,
            match.liveScore,
            match.liveMinute,
          ]);
        }

        upsert.finalize((upsertErr) => {
          if (upsertErr) return fail(upsertErr);

          const snap = db.prepare(`
            INSERT INTO odds_snapshots (
              match_id, captured_at, home_odd, draw_odd, away_odd,
              dc_1x, dc_12, dc_x2, btts_yes, btts_no
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const match of matches) {
            snap.run([
              match.id,
              capturedAt,
              match.homeOdd,
              match.drawOdd,
              match.awayOdd,
              match.dc1x,
              match.dc12,
              match.dcX2,
              match.bttsYes,
              match.bttsNo,
            ]);
          }

            snap.finalize((snapErr) => {
            if (snapErr) return fail(snapErr);

            const pruneBefore = capturedAt - 14 * 24 * 60 * 60 * 1000;
            db.run("DELETE FROM odds_snapshots WHERE captured_at < ?", [pruneBefore], (pruneErr) => {
              if (pruneErr) return fail(pruneErr);

              db.run("CREATE TEMP TABLE IF NOT EXISTS keep_match_ids (id TEXT PRIMARY KEY)", (createErr) => {
                if (createErr) return fail(createErr);

                db.run("DELETE FROM keep_match_ids", (clearErr) => {
                  if (clearErr) return fail(clearErr);

                  const keep = db.prepare("INSERT OR IGNORE INTO keep_match_ids (id) VALUES (?)");
                  for (const match of matches) {
                    keep.run([match.id]);
                  }

                  keep.finalize((keepErr) => {
                    if (keepErr) return fail(keepErr);

                    db.run("DELETE FROM matches WHERE id NOT IN (SELECT id FROM keep_match_ids)", (deleteErr) => {
                      if (deleteErr) return fail(deleteErr);

                      db.run("COMMIT", (commitErr) => {
                        if (commitErr) return fail(commitErr);
                        done(null, matches.length);
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

async function scrapeBetway() {
  try {
    let highlights = { events: [], markets: [], outcomes: [], prices: [] };
    try {
      highlights = await fetchHighlights();
    } catch (err) {
      console.warn(`[Scraper Notice] Betway Highlights failed: ${err.message}`);
    }

    const upcomingPages = await fetchUpcomingPages();
    const byId = new Map();

    for (const page of upcomingPages) {
      normalizeEvents(page, byId);
    }
    normalizeEvents(highlights, byId);

    const matches = Array.from(byId.values());
    if (!matches.length) {
      const sample = upcomingPages[0]?.markets?.[0]?.marketTypeCName || highlights.markets?.[0]?.marketTypeCName;
      console.warn(`[Scraper Notice] Betway returned 0 usable 1X2 matches (sample market: ${sample || "none"}).`);
      return false;
    }

    const stored = await persistMatches(matches);
    const liveCount = matches.filter((m) => m.status === "LIVE").length;
    const tzCount = matches.filter((m) => m.isTanzania === 1).length;
    console.log(`[Scraper] Stored ${stored} Betway matches (${liveCount} live, ${tzCount} Tanzania).`);
    return true;
  } catch (err) {
    console.warn(`[Scraper Notice] Betway feed skipped: ${err.message}`);
    return false;
  }
}

const SPORTY_ORIGIN = "https://www.sportybet.com";
const SPORTY_PAGE_SIZE = 100;
const SPORTY_MAX_PAGES = 10;
const SPORTY_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  Origin: SPORTY_ORIGIN,
  Referer: `${SPORTY_ORIGIN}/tz/`,
  ClientId: "web",
  Platform: "web",
};

function sportyDecimal(outcome) {
  if (!outcome || Number(outcome.isActive) === 0) return null;
  const decimal = Number(outcome.odds);
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal;
}

function sportyOutcome(market, pattern) {
  const outcome = (market?.outcomes || []).find((row) => pattern.test(String(row.desc || "").trim()));
  return sportyDecimal(outcome);
}

function isVirtualBlob(blob) {
  const value = String(blob || "").toLowerCase();
  return value.includes("esoccer") || value.includes("efootball") || value.includes("virtual") || value.includes("srl");
}

function mapSportyEvent(event, tournament) {
  const homeTeam = String(event?.homeTeamName || "").trim();
  const awayTeam = String(event?.awayTeamName || "").trim();
  const start = Number(event?.estimateStartTime);
  if (!homeTeam || !awayTeam || !start) return null;

  const league = tournament?.name || tournament?.categoryName || "SportyBet";
  const blob = [tournament?.categoryName, tournament?.name, homeTeam, awayTeam].join(" ");
  if (isVirtualBlob(blob)) return null;

  const markets = event.markets || [];
  const oneXTwo = markets.find((market) => String(market.id) === "1");
  const homeOdd = sportyOutcome(oneXTwo, /^home$/i);
  const drawOdd = sportyOutcome(oneXTwo, /^draw$/i);
  const awayOdd = sportyOutcome(oneXTwo, /^away$/i);
  if (!homeOdd || !drawOdd || !awayOdd) return null;

  const doubleChance = markets.find((market) => String(market.id) === "10");
  const btts = markets.find((market) => String(market.id) === "29");
  const liveText = String(event.matchStatus || "");
  const isLive = Number(event.status) === 1 || /^(1st|2nd|ht|live)\b/i.test(liveText);
  const eventKey = String(event.eventId || event.gameId || "").replace(/[^\w:-]/g, "");
  if (!eventKey) return null;

  return {
    id: `sb_${eventKey}`,
    source: "sportybet",
    league,
    homeTeam,
    awayTeam,
    commenceTime: new Date(start).toISOString(),
    status: isLive ? "LIVE" : "NS",
    homeOdd,
    drawOdd,
    awayOdd,
    dc1x: sportyOutcome(doubleChance, /home or draw/i),
    dc12: sportyOutcome(doubleChance, /home or away/i),
    dcX2: sportyOutcome(doubleChance, /draw or away/i),
    bttsYes: sportyOutcome(btts, /^yes$/i),
    bttsNo: sportyOutcome(btts, /^no$/i),
    liveScore: null,
    liveMinute: isLive ? liveText || null : null,
    isTanzania: /tanzania|\bnbc\b/i.test(blob) ? 1 : 0,
  };
}

async function fetchSportyPage(pageNum) {
  const res = await axios.post(
    `${SPORTY_ORIGIN}/api/tz/factsCenter/wapConfigurableEventsByOrder`,
    {
      sportId: "sr:sport:1",
      marketId: "1,10,29",
      pageSize: SPORTY_PAGE_SIZE,
      pageNum,
      option: 1,
    },
    { headers: SPORTY_HEADERS, timeout: 25000 },
  );
  return res.data || {};
}

async function scrapeSportyBet() {
  try {
    const byId = new Map();
    for (let page = 1; page <= SPORTY_MAX_PAGES; page++) {
      let data;
      try {
        data = await fetchSportyPage(page);
      } catch (err) {
        console.warn(`[Scraper Notice] SportyBet page ${page} failed: ${err.message}`);
        break;
      }
      if (data.bizCode !== 10000) {
        console.warn(`[Scraper Notice] SportyBet page ${page} rejected: ${data.message || data.bizCode}`);
        break;
      }
      const tournaments = data.data?.tournaments || [];
      const before = byId.size;
      for (const tournament of tournaments) {
        for (const event of tournament.events || []) {
          const match = mapSportyEvent(event, tournament);
          if (match) byId.set(match.id, match);
        }
      }
      const added = byId.size - before;
      console.log(`[Scraper] SportyBet page ${page}: ${tournaments.length} rows, ${added} usable`);
      if (!tournaments.length || added === 0 || data.data?.moreEvents === false) break;
    }

    const matches = Array.from(byId.values());
    if (!matches.length) {
      console.warn("[Scraper Notice] SportyBet returned 0 usable 1X2 matches.");
      return false;
    }

    const stored = await persistMatches(matches);
    const tzCount = matches.filter((match) => match.isTanzania === 1).length;
    console.log(`[Scraper] Stored ${stored} SportyBet matches (${tzCount} Tanzania).`);
    return true;
  } catch (err) {
    console.warn(`[Scraper Notice] SportyBet feed skipped: ${err.message}`);
    return false;
  }
}

async function scrapeOdds() {
  const betwayOk = await scrapeBetway();
  if (betwayOk) return { ok: true, source: "Betway" };
  console.warn("[Scraper] Betway had no usable matches; trying SportyBet TZ.");
  const sportyOk = await scrapeSportyBet();
  if (sportyOk) return { ok: true, source: "SportyBet" };
  return { ok: false, source: null };
}

export { scrapeBetway, scrapeOdds, scrapeSportyBet };
