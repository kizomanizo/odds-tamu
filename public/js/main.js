const bootEl = document.getElementById("odds-tamu-boot");
const cfg = bootEl ? JSON.parse(bootEl.textContent) : null;
if (!cfg) {
  throw new Error("OddsTamu boot data missing");
}

  const overlay = document.getElementById("loading-overlay");
  const stamp = document.getElementById("odds-updated-at");
  const labels = cfg.labels || {};
  const EAT = "Africa/Dar_es_Salaam";
  let countdownTimer = null;
  let dashboard = cfg.dashboard || {};

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatUpdated(ts) {
    if (!ts) return labels.updated_never || "No Betway refresh yet";
    const when = new Date(ts);
    if (Number.isNaN(when.getTime())) return labels.updated_never || "No Betway refresh yet";
    return `${labels.updated_prefix || "Odds updated"} ${when.toLocaleString(cfg.locale || undefined, { timeZone: EAT })}`;
  }

  function formatKickoff(iso) {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return "";
    return when.toLocaleString(cfg.locale || undefined, {
      timeZone: EAT,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    });
  }

  function formatCountdown(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "now";
    const totalMin = Math.floor(ms / 60000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function sparkSvg(values) {
    if (!values || values.length < 2) return "";
    const w = 56;
    const h = 18;
    const pad = 1;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 0.01;
    const pts = values
      .map((v, i) => {
        const x = pad + (i / (values.length - 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / span) * (h - pad * 2);
        return `${x},${y}`;
      })
      .join(" ");
    const down = values[values.length - 1] <= values[0];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline fill="none" stroke="${down ? "#3ddc84" : "#ff6b6b"}" stroke-width="1.5" points="${pts}"/></svg>`;
  }

  function watchBtn(item) {
    const on = Boolean(item.watched);
    return `<button type="button" class="watch-btn ${on ? "is-on" : ""}" data-watch="${esc(item.id)}" title="${esc(on ? labels.watch_remove : labels.watch_add)}">★</button>`;
  }

  function chipsHtml(chips) {
    if (!chips || !chips.length) return "";
    return `<div class="chips mt-1">${chips
      .map((chip) => `<span class="chip ${chip.hot ? "hot" : ""}">${esc(chip.label)} ${Number(chip.odd).toFixed(2)}</span>`)
      .join("")}</div>`;
  }

  function timeCell(item) {
    if (item.isLive) {
      const score = item.liveScore ? ` ${esc(item.liveScore)}` : "";
      const minute = item.liveMinute ? ` ${esc(item.liveMinute)}` : "";
      return `<span class="badge bg-danger">LIVE</span><div class="live-clock">${score}${minute}</div>`;
    }
    return `<span class="kickoff-copy">${esc(formatKickoff(item.commenceTime))}</span>`;
  }

  function steamHtml(item) {
    if (item.steam == null) return sparkSvg(item.spark);
    const cls = item.steam < 0 ? "steam-down" : "steam-up";
    const arrow = item.steam < 0 ? "↓" : "↑";
    return `${sparkSvg(item.spark)}<div class="${cls}">${arrow}${Math.abs(item.steam).toFixed(2)}</div>`;
  }

  function renderTable(items) {
    if (!items || !items.length) {
      return `<p class="empty-copy">${esc(labels.no_matches)}</p>`;
    }

    const rows = items
      .map(
        (item) => `<tr>
          <td>${watchBtn(item)}</td>
          <td>
            <div class="fw-bold">${esc(item.homeTeam)} vs ${esc(item.awayTeam)}</div>
            <div class="meta-copy">${esc(item.league)}</div>
            ${chipsHtml(item.chips)}
          </td>
          <td>${timeCell(item)}</td>
          <td><span class="badge badge-pick">${esc(item.selection)}</span></td>
          <td>
            <span class="badge badge-sweet">${Number(item.odd).toFixed(2)}</span>
            ${steamHtml(item)}
          </td>
          <td><span class="meta-copy">${item.margin != null ? `${item.margin.toFixed(1)}%` : "—"}</span></td>
        </tr>`,
      )
      .join("");

    const cards = items
      .map(
        (item) => `<article class="odds-card">
          <div class="odds-card-top">
            ${watchBtn(item)}
            <div class="odds-card-time">${timeCell(item)}</div>
          </div>
          <div class="odds-card-teams">${esc(item.homeTeam)} vs ${esc(item.awayTeam)}</div>
          <div class="meta-copy">${esc(item.league)}</div>
          <div class="odds-card-pick">
            <span class="badge badge-pick">${esc(item.selection)}</span>
            <span class="badge badge-sweet">${Number(item.odd).toFixed(2)}</span>
            <span class="meta-copy">${item.margin != null ? `${item.margin.toFixed(1)}%` : ""}</span>
          </div>
          ${steamHtml(item)}
          ${chipsHtml(item.chips)}
        </article>`,
      )
      .join("");

    return `<div class="odds-desktop">
      <table class="table table-dark table-hover align-middle mb-0">
        <thead>
          <tr>
            <th></th>
            <th>${esc(labels.fixture)}</th>
            <th>${esc(labels.time)}</th>
            <th>${esc(labels.selection)}</th>
            <th>${esc(labels.odds)}</th>
            <th>${esc(labels.margin)}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="odds-mobile">${cards}</div>`;
  }

  function renderAlerts(alerts) {
    const el = document.getElementById("alerts-panel");
    if (!el) return;
    if (!alerts || !alerts.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<div class="card p-3 mb-4 alerts-banner">
      <h2 class="section-heading mb-2">${esc(labels.alerts_title)}</h2>
      ${alerts
        .map(
          (alert) =>
            `<div class="small">${esc(alert.homeTeam)} vs ${esc(alert.awayTeam)} — ${esc(alert.selection)} <span class="badge badge-sweet">${Number(alert.odd).toFixed(2)}</span></div>`,
        )
        .join("")}
    </div>`;
  }

  function renderRadar(radar) {
    const el = document.getElementById("radar-panel");
    if (!el) return;
    const hours = (radar && radar.hours) || [];
    const max = Math.max(1, ...hours.map((h) => h.count || 0));
    const bars = hours
      .map((h) => {
        const pct = Math.round(((h.count || 0) / max) * 100);
        const label = h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : "";
        return `<div class="radar-hour" title="${h.hour}:00 · ${h.count}">
          <div class="radar-bar ${h.count ? "has-games" : ""}" style="height:${Math.max(3, Math.round((pct / 100) * 32))}px"></div>
          <span>${label}</span>
        </div>`;
      })
      .join("");

    const next = radar && radar.nextKickoff;
    const upcoming = (radar && radar.upcoming) || [];
    el.innerHTML = `
      <h2 class="section-heading">${esc(labels.radar_title)}</h2>
      <div class="meta-copy">${esc(labels.radar_eat)}</div>
      ${
        next
          ? `<div class="mt-2 fixture-name">${esc(labels.radar_next)}</div>
             <div class="fixture-name">${esc(next.homeTeam)} vs ${esc(next.awayTeam)}</div>
             <div class="countdown" id="kickoff-countdown" data-iso="${esc(next.commenceTime)}">${esc(formatCountdown(next.commenceTime))}</div>
             <div class="meta-copy">${esc(formatKickoff(next.commenceTime))} · ${esc(next.league)}</div>`
          : `<p class="empty-copy mb-0 mt-2">${esc(labels.radar_none)}</p>`
      }
      <div class="radar-hours">${bars}</div>
      ${
        upcoming.length
          ? `<div class="upcoming-kickoffs">
               <div class="fixture-name mt-3">${esc(labels.radar_later)}</div>
               ${upcoming
                 .map(
                   (item) =>
                     `<div class="upcoming-row">
                        <span class="fixture-name">${esc(item.homeTeam)} vs ${esc(item.awayTeam)}</span>
                        <span class="meta-copy">${esc(formatKickoff(item.commenceTime))}</span>
                      </div>`,
                 )
                 .join("")}
             </div>`
          : ""
      }
    `;
    startCountdown();
  }

  function shareText(acca) {
    const title = cfg.mode === "chungu" ? "Chungu ya Leo" : labels.share_title;
    const lines = [`OddsTamu — ${title}`];
    (acca.legs || []).forEach((leg, i) => {
      lines.push(`${i + 1}. ${leg.homeTeam} vs ${leg.awayTeam} — ${leg.selection} @ ${Number(leg.odd).toFixed(2)}`);
    });
    if (acca.combined) lines.push(`${labels.acca_combined}: ${Number(acca.combined).toFixed(2)}`);
    return lines.join("\n");
  }

  function renderAcca(acca) {
    const el = document.getElementById("ghost-acca");
    if (!el) return;
    const legs = (acca && acca.legs) || [];
    const text = shareText(acca || { legs: [] });
    const tg = `https://t.me/share/url?url=${encodeURIComponent("OddsTamu")}&text=${encodeURIComponent(text)}`;

    el.innerHTML = `
      <h2 class="section-heading">${esc(labels.acca_title)}</h2>
      ${
        legs.length
          ? `<div class="meta-copy">${legs.length} ${esc(labels.acca_legs)}</div>
             <div class="acca-combined my-2">${Number(acca.combined).toFixed(2)}</div>
             <div class="meta-copy mb-2">${esc(labels.acca_combined)}</div>
             ${legs
               .map(
                 (leg) =>
                   `<div class="acca-leg"><span class="fixture-name">${esc(leg.homeTeam)} vs ${esc(leg.awayTeam)}<br><span class="meta-copy">${esc(leg.selection)}</span></span><strong>${Number(leg.odd).toFixed(2)}</strong></div>`,
               )
               .join("")}
             <div class="share-row">
               <button type="button" class="btn btn-sm btn-success" id="share-whatsapp">${esc(labels.share_whatsapp)}</button>
               <a class="btn btn-sm btn-info text-dark" target="_blank" rel="noopener" href="${tg}">${esc(labels.share_telegram)}</a>
               <button type="button" class="btn btn-sm btn-outline-warning" id="download-card">${esc(labels.share_download)}</button>
               <button type="button" class="btn btn-sm btn-outline-light" id="acca-archive">${esc(labels.acca_archive)}</button>
             </div>
             <p class="meta-copy mb-0 mt-2" id="share-hint"></p>`
          : `<p class="empty-copy mb-2">${esc(labels.acca_empty)}</p>
             <button type="button" class="btn btn-sm btn-outline-light" id="acca-archive">${esc(labels.acca_archive)}</button>`
      }
    `;

    const download = document.getElementById("download-card");
    if (download) download.addEventListener("click", () => downloadShareCard(acca));
    const whatsapp = document.getElementById("share-whatsapp");
    if (whatsapp) whatsapp.addEventListener("click", () => shareWhatsAppCard(acca));
    const archive = document.getElementById("acca-archive");
    if (archive) archive.addEventListener("click", () => openAccaHistoryDialog());
  }

  function renderNbc(cards) {
    const wrap = document.getElementById("nbc-wrap");
    const el = document.getElementById("nbc-cards");
    if (!wrap || !el) return;
    if (!cards || !cards.length) {
      wrap.classList.add("is-hidden");
      return;
    }
    wrap.classList.remove("is-hidden");
    el.innerHTML = cards
      .map((card) => {
        const live = card.isLive
          ? `<span class="badge bg-danger">LIVE</span> ${esc(card.liveScore || "")} ${esc(card.liveMinute || "")}`
          : esc(formatKickoff(card.commenceTime));
        return `<article class="nbc-card">
          <div class="d-flex justify-content-between">
            ${watchBtn(card)}
            <span class="meta-copy">${esc(card.league)}</span>
          </div>
          <div class="fixture-name mt-1">${esc(card.homeTeam)} vs ${esc(card.awayTeam)}</div>
          <div class="meta-copy">${live}</div>
          <div class="nbc-odds">
            <span>1<br><strong>${Number(card.homeOdd).toFixed(2)}</strong></span>
            <span>X<br><strong>${Number(card.drawOdd).toFixed(2)}</strong></span>
            <span>2<br><strong>${Number(card.awayOdd).toFixed(2)}</strong></span>
          </div>
          ${chipsHtml(card.chips)}
          <div class="meta-copy mt-2">${card.margin != null ? `${card.margin.toFixed(1)}%` : ""}</div>
        </article>`;
      })
      .join("");
  }

  function applyDashboard(data) {
    dashboard = data || {};
    renderAlerts(dashboard.alerts);
    renderRadar(dashboard.radar);
    renderAcca(dashboard.ghostAcca);
    renderNbc(dashboard.nbcCards);
    const oddsData = dashboard.oddsData || {};
    ["live", "today", "week", "tz"].forEach((tab) => {
      const pane = document.getElementById(tab);
      if (pane) pane.innerHTML = renderTable(oddsData[tab] || []);
    });
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    const node = document.getElementById("kickoff-countdown");
    if (!node || !node.dataset.iso) return;
    const tick = () => {
      node.textContent = formatCountdown(node.dataset.iso);
    };
    tick();
    countdownTimer = setInterval(tick, 30000);
  }

  function setLoading(on) {
    document.body.classList.toggle("is-loading", on);
    if (overlay) overlay.setAttribute("aria-hidden", on ? "false" : "true");
  }

  async function refreshFromBetway() {
    const params = new URLSearchParams({
      minOdds: String(cfg.minOdds),
      maxOdds: String(cfg.maxOdds),
      limit: String(cfg.limit),
      mode: String(cfg.mode || "tamu"),
    });

    setLoading(true);
    try {
      const res = await fetch(`/api/odds?${params.toString()}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyDashboard(data);
      if (stamp) stamp.textContent = formatUpdated(data.lastFetchAt);
    } catch (err) {
      console.error("[OddsTamu] Refresh failed:", err);
      if (stamp) stamp.textContent = labels.refresh_failed || "Could not refresh Betway odds; showing local data.";
    } finally {
      setLoading(false);
    }
  }

  async function toggleWatch(matchId) {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId }),
    });
    if (!res.ok) return;
    const result = await res.json();
    document.querySelectorAll(`[data-watch="${CSS.escape(matchId)}"]`).forEach((btn) => {
      btn.classList.toggle("is-on", Boolean(result.watched));
      btn.title = result.watched ? labels.watch_remove : labels.watch_add;
    });
  }

  async function drawShareCard(acca, options = {}) {
    const canvas = document.getElementById("tamu-card");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    if (document.fonts && !document.fonts.check('700 72px "Varsity Team"')) {
      try {
        await document.fonts.load('700 72px "Varsity Team"');
      } catch (err) {
        /* fall through with system font */
      }
    }

    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = cfg.mode === "chungu" ? "#ff6b35" : "#ffc107";
    ctx.fillRect(0, 0, w, 16);

    ctx.font = '700 72px "Varsity Team", Impact, sans-serif';
    ctx.fillStyle = cfg.mode === "chungu" ? "#ff6b35" : "#ffc107";
    ctx.fillText("OddsTamu", 56, 130);

    ctx.font = "500 28px sans-serif";
    ctx.fillStyle = "#e2d3a8";
    const subtitle = options.dateLabel
      ? `${cfg.mode === "chungu" ? "Chungu" : labels.share_title} · ${options.dateLabel}`
      : cfg.mode === "chungu"
        ? "Chungu ya Leo"
        : labels.share_title;
    ctx.fillText(subtitle, 56, 180);

    let y = 260;
    (acca.legs || []).forEach((leg, i) => {
      ctx.font = "600 28px sans-serif";
      ctx.fillStyle = "#e8e4dc";
      ctx.fillText(`${i + 1}. ${leg.homeTeam} vs ${leg.awayTeam}`, 56, y);
      ctx.font = "500 22px sans-serif";
      ctx.fillStyle = "#cfc6b4";
      ctx.fillText(`${leg.selection}   ${Number(leg.odd).toFixed(2)}`, 56, y + 36);
      y += 92;
    });

    if (acca.combined) {
      ctx.font = '700 64px "Varsity Team", Impact, sans-serif';
      ctx.fillStyle = cfg.mode === "chungu" ? "#ff6b35" : "#ffc107";
      ctx.fillText(Number(acca.combined).toFixed(2), 56, h - 140);
      ctx.font = "500 22px sans-serif";
      ctx.fillStyle = "#e2d3a8";
      ctx.fillText(labels.acca_combined, 56, h - 96);
    }

    ctx.font = "400 18px sans-serif";
    ctx.fillStyle = "#9a9080";
    ctx.fillText(new Date().toLocaleString(cfg.locale || undefined, { timeZone: EAT }), 56, h - 48);

    return canvas;
  }

  function canvasToFile(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Could not build PNG"));
        resolve(new File([blob], "oddstamu-tamu-ya-leo.png", { type: "image/png" }));
      }, "image/png");
    });
  }

  function triggerDownload(canvas, filename = "oddstamu-tamu-ya-leo.png") {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function downloadShareCard(acca, options = {}) {
    const canvas = await drawShareCard(acca, options);
    if (canvas) triggerDownload(canvas, options.filename || "oddstamu-tamu-ya-leo.png");
  }

  function todayEatDate() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: EAT,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function clampAccaDate(value, minDate, maxDate) {
    if (!value || value > maxDate) return maxDate;
    if (minDate && value < minDate) return minDate;
    return value;
  }

  async function openAccaHistoryDialog() {
    const dialog = document.getElementById("acca-history-dialog");
    const dateInput = document.getElementById("acca-history-date");
    const status = document.getElementById("acca-dialog-status");
    if (!dialog || !dateInput) return;

    const today = todayEatDate();
    let minDate = today;
    try {
      const res = await fetch(`/api/acca/history?mode=${encodeURIComponent(cfg.mode || "tamu")}`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const range = await res.json();
        minDate = range.minDate || today;
      }
    } catch (err) {
      console.warn("[OddsTamu] Acca range failed:", err);
    }

    dateInput.min = minDate;
    dateInput.max = today;
    dateInput.value = clampAccaDate(dateInput.value || today, minDate, today);
    if (status) status.textContent = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
  }

  function bindAccaHistoryDialog() {
    const dialog = document.getElementById("acca-history-dialog");
    const dateInput = document.getElementById("acca-history-date");
    const status = document.getElementById("acca-dialog-status");
    const hint = document.getElementById("acca-dialog-hint");
    const downloadBtn = document.getElementById("acca-dialog-download");
    const title = document.getElementById("acca-dialog-title");
    const dateLabel = document.getElementById("acca-dialog-date-label");
    const closeBtn = document.getElementById("acca-dialog-close");
    if (!dialog || !dateInput || !downloadBtn) return;

    if (title) title.textContent = labels.acca_dialog_title || "Download acca card";
    if (dateLabel) dateLabel.textContent = labels.acca_date_label || "Card date";
    if (hint) hint.textContent = labels.acca_date_hint || "";
    downloadBtn.textContent = labels.acca_download_date || "Download this card";
    if (closeBtn) closeBtn.textContent = labels.acca_close || "Close";

    const today = todayEatDate();
    dateInput.max = today;
    dateInput.min = today;

    dateInput.addEventListener("input", () => {
      const next = clampAccaDate(dateInput.value, dateInput.min, dateInput.max || today);
      if (next !== dateInput.value) dateInput.value = next;
      if (status) status.textContent = "";
    });

    downloadBtn.addEventListener("click", async () => {
      const todayValue = todayEatDate();
      const date = clampAccaDate(dateInput.value, dateInput.min, todayValue);
      dateInput.value = date;
      if (status) status.textContent = "";
      try {
        const res = await fetch(
          `/api/acca/history?mode=${encodeURIComponent(cfg.mode || "tamu")}&date=${encodeURIComponent(date)}`,
          { headers: { Accept: "application/json" } },
        );
        const data = await res.json();
        if (!res.ok || !data.acca || !data.acca.legs || !data.acca.legs.length) {
          if (status) status.textContent = labels.acca_no_history || "No saved acca for that date yet.";
          return;
        }
        await downloadShareCard(data.acca, {
          dateLabel: date,
          filename: `oddstamu-acca-${date}.png`,
        });
        if (typeof dialog.close === "function") dialog.close();
      } catch (err) {
        console.error("[OddsTamu] Acca download failed:", err);
        if (status) status.textContent = labels.acca_no_history || "No saved acca for that date yet.";
      }
    });
  }

  async function shareWhatsAppCard(acca) {
    const hint = document.getElementById("share-hint");
    if (hint) hint.textContent = "";

    const canvas = await drawShareCard(acca);
    if (!canvas) return;

    try {
      const file = await canvasToFile(canvas);
      const title = cfg.mode === "chungu" ? "Chungu ya Leo" : labels.share_title;
      const payload = { files: [file], title: `OddsTamu — ${title}` };
      const canShareFiles =
        typeof navigator.canShare === "function" ? navigator.canShare({ files: [file] }) : Boolean(navigator.share);

      if (navigator.share && canShareFiles) {
        await navigator.share(payload);
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }

    triggerDownload(canvas, "oddstamu-tamu-ya-leo.png");
    if (hint) hint.textContent = labels.share_desktop || "";
  }

  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-watch]");
    if (!btn) return;
    toggleWatch(btn.getAttribute("data-watch"));
  });

  if (stamp) stamp.textContent = formatUpdated(cfg.lastFetchAt);
  bindAccaHistoryDialog();
  applyDashboard(dashboard);
  if (cfg.needsRefresh) refreshFromBetway();
  if (document.fonts) {
    document.fonts.load('700 72px "Varsity Team"').catch(() => {});
  }
