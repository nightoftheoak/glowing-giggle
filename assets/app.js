/* Plano temperature dashboard. Data: window.PLANO_DATA from data/plano_daily.js */
(() => {
  "use strict";

  const TZ = "America/Chicago";
  const BASELINE_YEARS = 20;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]; // non-leap day offsets
  const PRESETS = [
    ["Today", null], ["Halloween", [10, 31]], ["Christmas", [12, 25]],
    ["New Year's", [1, 1]], ["July 4th", [7, 4]], ["Valentine's", [2, 14]],
  ];

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const avg = (a) => { const v = a.filter(isNum); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  const r0 = (v) => (isNum(v) ? Math.round(v) : "—");
  const deg = (v) => (isNum(v) ? `${Math.round(v)}°` : "—");
  const signed = (v, digits = 0) => {
    if (!isNum(v)) return "—";
    const s = Math.abs(v).toFixed(digits);
    return `${+s === 0 ? "±" : v > 0 ? "+" : "−"}${s}`;
  };
  const idx365 = (m, d) => CUM[m - 1] + Math.min(d, m === 2 ? 28 : 31) - 1; // Feb 29 -> Feb 28
  const idxLabel = (i) => { let m = 11; while (CUM[m] > i) m--; return `${MONTHS[m]} ${i - CUM[m] + 1}`; };
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const daysInMonth = (m, y = 2024) => new Date(y, m, 0).getDate();
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clock = (t) => { const [h, mi] = t.slice(11, 16).split(":").map(Number); return `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const range = (lo, hi) => (isNum(lo) && isNum(hi) ? `${Math.round(lo)}–${Math.round(hi)}°` : "—");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function linreg(xs, ys) {
    const pts = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    if (pts.length < 3) return null;
    const n = pts.length, mx = avg(pts.map((p) => p[0])), my = avg(pts.map((p) => p[1]));
    let num = 0, den = 0;
    for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
    if (!den) return null;
    const slope = num / den;
    return { slope, at: (x) => my + slope * (x - mx), n };
  }

  const todayParts = (() => {
    const s = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    const [y, m, d] = s.split("-").map(Number);
    return { y, m, d, iso: s };
  })();
  const CY = todayParts.y;

  // ---------- data model ----------
  const META = window.PLANO_META || {};
  const STATION = META.station || { code: "KTKI", name: "McKinney National Airport" };
  const SOURCES = META.sources || [];
  let rows = [], byDate = new Map(), years = [], grid = {}, normal = null, baseline = [];
  let live = null;

  function ingest(raw) {
    rows = raw.map(([date, hi, lo, mean, prov, src]) => {
      const [y, m, d] = date.split("-").map(Number);
      return { date, y, m, d, hi, lo, mean, prov: !!prov, src: SOURCES[src] || "" };
    }).sort((a, b) => (a.date < b.date ? -1 : 1));
    byDate = new Map(rows.map((r) => [r.date, r]));
    years = [...new Set(rows.map((r) => r.y))].sort((a, b) => a - b);
    grid = {};
    for (const y of years) grid[y] = { hi: new Array(365).fill(NaN), lo: new Array(365).fill(NaN), mean: new Array(365).fill(NaN) };
    for (const r of rows) {
      if (r.m === 2 && r.d === 29) continue;
      const g = grid[r.y], i = idx365(r.m, r.d);
      g.hi[i] = r.hi; g.lo[i] = r.lo; g.mean[i] = r.mean;
    }
    baseline = years.filter((y) => y >= CY - BASELINE_YEARS && y < CY);
    normal = { hi: [], lo: [], mean: [] };
    for (const k of ["hi", "lo", "mean"]) {
      for (let i = 0; i < 365; i++) {
        const vals = [];
        for (const y of baseline) for (let o = -3; o <= 3; o++) vals.push(grid[y][k][(i + o + 365) % 365]);
        normal[k][i] = avg(vals);
      }
    }
  }

  // values for an exact calendar date (each year)
  function onDate(m, d) {
    return years.map((y) => ({ y, r: byDate.get(iso(y, m, d)) })).filter((o) => o.r);
  }

  // ---------- live conditions: hourly observations at the station (NWS) ----------
  async function fetchLive() {
    const start = new Date(Date.now() - 26 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
    const url = `https://api.weather.gov/stations/${STATION.code}/observations?start=${start}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/geo+json" } });
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
      const obs = (json.features || [])
        .map((f) => ({ time: new Date(f.properties.timestamp), c: f.properties.temperature && f.properties.temperature.value }))
        .filter((o) => isNum(o.c))
        .map((o) => ({ time: o.time, f: o.c * 9 / 5 + 32 }))
        .sort((a, b) => b.time - a.time);
      if (!obs.length) return null;
      const today = obs.filter((o) => localDay.format(o.time) === todayParts.iso).map((o) => o.f);
      return {
        now: obs[0],
        today: today.length ? { hi: Math.max(...today), lo: Math.min(...today), n: today.length } : null,
      };
    } catch (e) {
      console.warn("Live observations unavailable:", e);
      return null;
    } finally { clearTimeout(t); }
  }

  // ---------- section: today ----------
  function renderToday() {
    const { m, d } = todayParts, i = idx365(m, d);
    const tiles = [];
    const tile = (label, value, detail = "") =>
      tiles.push(`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`);
    const vsNormal = (v, n) => {
      if (!isNum(v) || !isNum(n)) return "";
      const diff = v - n, cls = diff >= 0.5 ? "up" : diff <= -0.5 ? "down" : "";
      return `<span class="${cls}">${signed(diff)}°F</span> vs. normal ${deg(n)}`;
    };

    const vsNormalRange = (lo, hi, nl, nh) => `normal ${range(nl, nh)} · high <span class="${hi - nh >= 0.5 ? "up" : hi - nh <= -0.5 ? "down" : ""}">${signed(hi - nh)}°</span>, low <span class="${lo - nl >= 0.5 ? "up" : lo - nl <= -0.5 ? "down" : ""}">${signed(lo - nl)}°</span>`;
    if (live) {
      const at = live.now.time.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
      tile("Right now", `${deg(live.now.f)}F`, `${STATION.code} reading at ${at}`);
      if (live.today) tile("Today so far", range(live.today.lo, live.today.hi), vsNormalRange(live.today.lo, live.today.hi, normal.lo[i], normal.hi[i]) + "<br>from hourly readings");
    } else {
      tile("Right now", "—", "Live station reading unavailable");
    }

    const hist = onDate(m, d).filter((o) => o.y < CY && o.y >= CY - BASELINE_YEARS);
    if (hist.length) {
      const hiRec = hist.reduce((a, b) => (b.r.hi > a.r.hi ? b : a));
      const loRec = hist.reduce((a, b) => (b.r.lo < a.r.lo ? b : a));
      tile(`Warmest ${MONTHS[m - 1]} ${d}`, `${deg(hiRec.r.hi)}F`, `in ${hiRec.y}`);
      tile(`Coldest ${MONTHS[m - 1]} ${d}`, `${deg(loRec.r.lo)}F`, `in ${loRec.y}`);
    }

    const yest = new Date(Date.UTC(todayParts.y, m - 1, d - 1));
    const yr = byDate.get(yest.toISOString().slice(0, 10));
    if (yr) {
      const yi = idx365(yr.m, yr.d);
      tile("Yesterday", range(yr.lo, yr.hi), vsNormalRange(yr.lo, yr.hi, normal.lo[yi], normal.hi[yi]) + (yr.prov ? " · provisional" : ""));
      const same = onDate(yr.m, yr.d).filter((o) => o.y >= CY - BASELINE_YEARS);
      const rank = same.filter((o) => o.r.hi > yr.hi).length + 1;
      tile("Yesterday's high ranked", ordinal(rank), `warmest of ${same.length} years on ${MONTHS[yr.m - 1]} ${yr.d}`);
    }
    $("todayTiles").innerHTML = tiles.join("");
    $("todayNote").textContent = baseline.length
      ? `“Normal” is the ${baseline[0]}–${baseline[baseline.length - 1]} average for this date (±3 days). Records are for this exact date over the same years.`
      : "";
  }

  // ---------- charts ----------
  const charts = {};
  function chartBase() {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: css("--text-2"), usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
        tooltip: {
          backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text"),
          borderColor: css("--border"), borderWidth: 1, padding: 10, usePointStyle: true,
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: css("--text-2") }, border: { color: css("--border") } },
        y: { grid: { color: css("--grid") }, ticks: { color: css("--text-2") }, border: { display: false } },
      },
    };
  }
  function draw(id, config) {
    if (charts[id]) charts[id].destroy();
    if (!window.Chart) return;
    charts[id] = new Chart($(id), config);
  }
  const trendSet = (label, xs, reg, color) => ({
    label, data: xs.map((x) => (reg ? +reg.at(x).toFixed(2) : null)),
    borderColor: color, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false,
  });

  function halves(pairs) { // pairs: [{x, v}] over completed years -> early vs late decade averages
    const done = pairs.filter((p) => p.x < CY && isNum(p.v));
    if (done.length < 6) return null;
    const mid = Math.floor(done.length / 2);
    const a = done.slice(0, mid), b = done.slice(mid);
    return { a: avg(a.map((p) => p.v)), b: avg(b.map((p) => p.v)), aLab: `${a[0].x}–${a[a.length - 1].x}`, bLab: `${b[0].x}–${b[b.length - 1].x}` };
  }

  // ---------- section: on this day ----------
  let otd = { m: 10, d: 31 };
  function setupOtd() {
    $("otdMonth").innerHTML = MONTH_NAMES.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("");
    const fillDays = () => {
      const m = +$("otdMonth").value, max = daysInMonth(m);
      $("otdDay").innerHTML = Array.from({ length: max }, (_, i) => `<option>${i + 1}</option>`).join("");
      $("otdDay").value = Math.min(otd.d, max);
    };
    $("otdPresets").innerHTML = PRESETS.map(([n], i) => `<button class="chip" data-i="${i}" aria-pressed="false">${n}</button>`).join("");
    $("otdPresets").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const p = PRESETS[+b.dataset.i][1] || [todayParts.m, todayParts.d];
      otd = { m: p[0], d: p[1] };
      $("otdMonth").value = otd.m; fillDays(); renderOtd();
    });
    $("otdMonth").addEventListener("change", () => { otd.m = +$("otdMonth").value; fillDays(); otd.d = +$("otdDay").value; renderOtd(); });
    $("otdDay").addEventListener("change", () => { otd.d = +$("otdDay").value; renderOtd(); });
    $("otdMonth").value = otd.m; fillDays();
  }
  function renderOtd() {
    const { m, d } = otd;
    const name = PRESETS.find(([, p]) => p && p[0] === m && p[1] === d)?.[0];
    const isToday = m === todayParts.m && d === todayParts.d;
    for (const b of $("otdPresets").children) {
      const p = PRESETS[+b.dataset.i][1] || [todayParts.m, todayParts.d];
      b.setAttribute("aria-pressed", String(p[0] === m && p[1] === d));
    }
    const label = `${MONTH_NAMES[m - 1]} ${d}`;
    const data = onDate(m, d);
    // include today's observed range so far if today isn't on record yet
    if (isToday && live && live.today && !data.some((o) => o.y === CY)) {
      const t = live.today;
      data.push({ y: CY, r: { hi: t.hi, lo: t.lo, mean: (t.hi + t.lo) / 2, prov: true, sofar: true } });
    }
    const ys = data.map((o) => o.y);
    const regHi = linreg(ys.filter((y) => y < CY), data.filter((o) => o.y < CY).map((o) => o.r.hi));
    const regLo = linreg(ys.filter((y) => y < CY), data.filter((o) => o.y < CY).map((o) => o.r.lo));

    if (!data.length) { $("otdSummary").textContent = "No data for this date yet."; }
    else {
      const past = data.filter((o) => o.y < CY);
      const warm = past.reduce((a, b) => (b.r.hi > a.r.hi ? b : a), past[0]);
      const cold = past.reduce((a, b) => (b.r.lo < a.r.lo ? b : a), past[0]);
      const h = halves(data.map((o) => ({ x: o.y, v: o.r.hi })));
      const parts = [];
      if (h) parts.push(`Average high on ${name || label}: <b>${deg(h.a)}F</b> in ${h.aLab} vs. <b>${deg(h.b)}F</b> in ${h.bLab}.`);
      if (regHi) parts.push(`Trend in the high: <b>${signed(regHi.slope * 10, 1)}°F per decade</b>.`);
      if (warm) parts.push(`Warmest: ${deg(warm.r.hi)} (${warm.y}). Coldest morning: ${deg(cold.r.lo)} (${cold.y}).`);
      const cur = data.find((o) => o.y === CY);
      if (cur) parts.push(`${CY}: ${range(cur.r.lo, cur.r.hi)}F${cur.r.sofar ? " so far today" : cur.r.prov ? " (provisional)" : ""}.`);
      $("otdSummary").innerHTML = parts.join(" ");
    }

    const hiC = css("--high"), loC = css("--low");
    const base = chartBase();
    base.scales.y.ticks.callback = (v) => `${v}°`;
    base.scales.y.beginAtZero = false;
    base.scales.y.grace = "4%";
    base.plugins.tooltip.filter = (c) => c.datasetIndex === 0;
    base.plugins.tooltip.callbacks = {
      label: (c) => {
        const r = data[c.dataIndex].r;
        return ` ${range(r.lo, r.hi)}F (a ${Math.round(r.hi - r.lo)}° swing)${r.sofar ? " so far" : ""}`;
      },
    };
    base.plugins.legend.labels.filter = (l) => l.datasetIndex !== 0;
    draw("otdChart", {
      type: "bar",
      data: {
        labels: ys,
        datasets: [
          { label: "Range", data: data.map((o) => [o.r.lo, o.r.hi]), backgroundColor: css("--range"), borderRadius: 4, borderSkipped: false, maxBarThickness: 18, order: 3 },
          { type: "line", label: "High", data: data.map((o) => o.r.hi), showLine: false, pointRadius: 4, pointHoverRadius: 5, backgroundColor: hiC, borderColor: css("--surface"), borderWidth: 1.5, order: 1 },
          { type: "line", label: "Low", data: data.map((o) => o.r.lo), showLine: false, pointRadius: 4, pointHoverRadius: 5, backgroundColor: loC, borderColor: css("--surface"), borderWidth: 1.5, order: 1 },
          { type: "line", order: 2, ...trendSet("High trend", ys, regHi, hiC) },
          { type: "line", order: 2, ...trendSet("Low trend", ys, regLo, loC) },
        ],
      },
      options: base,
    });
    const ni = idx365(m, d);
    $("otdTable").innerHTML = `<thead><tr><th>Year</th><th>Range (low–high)</th><th>Swing</th><th>High vs. normal</th><th>Low vs. normal</th><th>Station</th></tr></thead><tbody>` +
      data.slice().reverse().map((o) => `<tr><td${o.r.prov ? ' class="prov"' : ""}>${o.y}${o.r.sofar ? " (so far)" : o.r.prov ? " (prov.)" : ""}</td><td>${range(o.r.lo, o.r.hi)}</td><td>${Math.round(o.r.hi - o.r.lo)}°</td><td>${signed(o.r.hi - normal.hi[ni])}°</td><td>${signed(o.r.lo - normal.lo[ni])}°</td><td>${esc(o.r.src || (o.r.sofar ? STATION.code : ""))}</td></tr>`).join("") +
      `</tbody>`;
  }

  // ---------- seasonal arrival sections (spring & autumn) ----------
  const lastRecorded = () => (rows.length ? rows[rows.length - 1].date : "");
  const idxDate = (y, i) => { let m = 11; while (CUM[m] > i) m--; return iso(y, m + 1, i - CUM[m] + 1); };
  // First day in [from, to] that starts a 7-day stretch whose average daily mean is <= (cool) or >= (warm) thresh.
  function firstRun(y, from, to, thresh, cool) {
    for (let i = from; i <= to - 6; i++) {
      const vals = [];
      for (let k = 0; k < 7; k++) vals.push(grid[y].mean[i + k]);
      if (vals.some((v) => !isNum(v))) continue;
      const a = avg(vals);
      if (cool ? a <= thresh : a >= thresh) return i;
    }
    return null;
  }
  function firstWhere(y, key, from, to, pred) {
    for (let i = from; i <= to; i++) if (isNum(grid[y][key][i]) && pred(grid[y][key][i])) return i;
    return null;
  }
  function lastWhere(y, key, from, to, pred) {
    let out = null;
    for (let i = from; i <= to; i++) if (isNum(grid[y][key][i]) && pred(grid[y][key][i])) out = i;
    return out;
  }

  // kind "first": settled as soon as it happens. kind "last": settled once the record covers `settleAt`.
  const SEASONS = {
    spring: {
      thresh: { label: "7-day avg ≥", def: 70, min: 55, max: 78 },
      metrics: {
        warmup: {
          label: "Sustained warm-up", col: (t) => `Warm-up (${t}°F)`, color: "--high", kind: "first", end: idx365(7, 31),
          def: (t) => `The first day after February 1 that begins a 7-day stretch whose daily average temperature (high + low) ÷ 2 averages ${t}°F or more — a lasting turn to warm weather, not a single warm day.`,
          calc: (y, t) => firstRun(y, idx365(2, 1), idx365(7, 31), t, false),
        },
        lastFreeze: {
          label: "Last freeze (≤ 32°F)", col: () => "Last freeze", color: "--low", kind: "last", end: idx365(6, 30), settleAt: idx365(6, 30),
          def: () => "The last day before July 1 with a low of 32°F or colder — the end of frost risk.",
          calc: (y) => lastWhere(y, "lo", 0, idx365(6, 30), (v) => v <= 32),
        },
        first80: {
          label: "First 80°F+ high", col: () => "First 80°F+", color: "--high", kind: "first", end: 364,
          def: () => "The first day of the year with a high of 80°F or more.",
          calc: (y) => firstWhere(y, "hi", 0, 364, (v) => v >= 80),
        },
        first90: {
          label: "First 90°F+ high", col: () => "First 90°F+", color: "--high", kind: "first", end: 364,
          def: () => "The first day of the year with a high of 90°F or more — when summer heat starts.",
          calc: (y) => firstWhere(y, "hi", 0, 364, (v) => v >= 90),
        },
        first100: {
          label: "First 100°F+ high", col: () => "First 100°F+", color: "--high", kind: "first", end: 364,
          def: () => "The first day of the year with a high of 100°F or more. Some years never reach 100°F.",
          calc: (y) => firstWhere(y, "hi", 0, 364, (v) => v >= 100),
        },
      },
    },
    fall: {
      thresh: { label: "7-day avg ≤", def: 70, min: 60, max: 75 },
      metrics: {
        onset: {
          label: "Sustained cool-down", col: (t) => `Cool-down (${t}°F)`, color: "--low", kind: "first", end: 364,
          def: (t) => `The first day after August 1 that begins a 7-day stretch whose daily average temperature (high + low) ÷ 2 averages ${t}°F or less — a sustained shift to cooler weather, not a single cool day.`,
          calc: (y, t) => firstRun(y, idx365(8, 1), 364, t, true),
        },
        last90: {
          label: "Last 90°F+ high", col: () => "Last 90°F+", color: "--high", kind: "last", end: 364, settleAt: idx365(11, 1),
          def: () => "The last day of the year with a high of 90°F or more — when summer heat ends.",
          calc: (y) => lastWhere(y, "hi", 0, 364, (v) => v >= 90),
        },
        first50: {
          label: "First low ≤ 50°F", col: () => "First ≤ 50°F", color: "--low", kind: "first", end: 364,
          def: () => "The first day after July 1 with a low of 50°F or colder — the first truly crisp morning.",
          calc: (y) => firstWhere(y, "lo", idx365(7, 1), 364, (v) => v <= 50),
        },
        firstFreeze: {
          label: "First freeze (≤ 32°F)", col: () => "First freeze", color: "--low", kind: "first", end: 364,
          def: () => "The first day after July 1 with a low of 32°F or colder.",
          calc: (y) => firstWhere(y, "lo", idx365(7, 1), 364, (v) => v <= 32),
        },
      },
    },
  };

  // For one metric and year: { v: day index or null, settled, never }
  function seasonMark(mt, y, t) {
    const v = mt.calc(y, t), last = lastRecorded();
    const covered = (i) => last >= idxDate(y, i);
    if (mt.kind === "last") {
      const settled = covered(mt.settleAt);
      return { v, settled: v !== null && settled, never: v === null && settled };
    }
    return { v, settled: v !== null, never: v === null && covered(mt.end) };
  }

  function setupSeason(key) {
    const cfg = SEASONS[key];
    $(`${key}Metric`).innerHTML = Object.entries(cfg.metrics).map(([k, mt]) => `<option value="${k}">${mt.label}</option>`).join("");
    $(`${key}ThreshLabel`).textContent = cfg.thresh.label;
    const sel = $(`${key}Thresh`);
    for (let t = cfg.thresh.min; t <= cfg.thresh.max; t++) sel.insertAdjacentHTML("beforeend", `<option value="${t}"${t === cfg.thresh.def ? " selected" : ""}>${t}°F</option>`);
    $(`${key}Metric`).addEventListener("change", () => renderSeason(key));
    sel.addEventListener("change", () => renderSeason(key));
  }

  function renderSeason(key) {
    const cfg = SEASONS[key], P = (s) => $(`${key}${s}`);
    const metric = P("Metric").value, thresh = +P("Thresh").value, mt = cfg.metrics[metric];
    P("ThreshWrap").hidden = !mt.col(0).includes("(");
    P("Def").textContent = mt.def(thresh);
    const marks = years.map((y) => ({ y, ...seasonMark(mt, y, thresh) }));
    const pts = marks.filter((mk) => mk.settled).map((mk) => ({ x: mk.y, v: mk.v }));
    const done = pts.filter((p) => p.x < CY);
    const reg = linreg(done.map((p) => p.x), done.map((p) => p.v));
    const h = halves(pts);
    const days = (n) => `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`;
    const parts = [];
    if (h) {
      const shift = Math.round(h.b) - Math.round(h.a);
      const shiftTxt = shift === 0 ? "about the same" : `${days(shift)} ${shift > 0 ? "later" : "earlier"}`;
      parts.push(`Typical date: <b>${idxLabel(Math.round(h.a))}</b> in ${h.aLab} vs. <b>${idxLabel(Math.round(h.b))}</b> in ${h.bLab} (${shiftTxt}).`);
    }
    if (reg) parts.push(`Trend: <b>${Math.abs(reg.slope * 10).toFixed(1)} days ${reg.slope >= 0 ? "later" : "earlier"} per decade</b>.`);
    const cur = marks.find((mk) => mk.y === CY);
    if (cur) {
      const bl = Math.round(avg(pts.filter((p) => baseline.includes(p.x)).map((p) => p.v)));
      if (cur.settled) {
        const d = cur.v - bl;
        const vs = !isNum(bl) ? "" : d === 0 ? ` — right at the ${baseline.length}-year average` : ` — ${days(d)} ${d > 0 ? "later" : "earlier"} than the ${baseline.length}-year average (${idxLabel(bl)})`;
        parts.push(`${CY}: <b>${idxLabel(cur.v)}</b>${vs}.`);
      } else if (cur.never) parts.push(`${CY}: didn't happen.`);
      else if (cur.v !== null) parts.push(`${CY}: ${idxLabel(cur.v)} so far (could still change).`);
      else parts.push(`${CY}: not reached yet.`);
    }
    const missing = marks.filter((mk) => mk.never && mk.y < CY).map((mk) => mk.y);
    if (missing.length) parts.push(`<span class="note">Never happened in: ${missing.join(", ")}.</span>`);
    P("Summary").innerHTML = parts.join(" ");

    const color = css(mt.color), xs = pts.map((p) => p.x);
    const base = chartBase();
    base.plugins.legend.display = false;
    base.interaction = { mode: "nearest", intersect: false, axis: "x" };
    base.scales.y.ticks.callback = (v) => idxLabel(Math.round(v));
    base.scales.y.ticks.stepSize = 7;
    base.plugins.tooltip.filter = (c) => c.datasetIndex === 0;
    base.plugins.tooltip.callbacks = { label: (c) => ` ${idxLabel(c.parsed.y)}` };
    draw(`${key}Chart`, {
      type: "line",
      data: {
        labels: xs,
        datasets: [
          { label: "Date", data: pts.map((p) => p.v), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 5, pointHoverRadius: 7, tension: 0 },
          trendSet("Trend", xs, reg, css("--text-3")),
        ],
      },
      options: base,
    });

    const entries = Object.values(cfg.metrics);
    const cell = (m) => (m.v === null ? "—" : idxLabel(m.v) + (m.settled ? "" : " (so far)"));
    P("Table").innerHTML = `<thead><tr><th>Year</th>${entries.map((e) => `<th>${e.col(thresh)}</th>`).join("")}</tr></thead><tbody>` +
      years.slice().reverse().map((y) => `<tr><td>${y}</td>${entries.map((e) => `<td>${cell(seasonMark(e, y, thresh))}</td>`).join("")}</tr>`).join("") + `</tbody>`;
  }

  // ---------- section: hot days per year ----------
  function hotStats(y, t, uptoIdx = 364) {
    let count = 0, streak = 0, best = 0, first = null, last = null, days = 0;
    for (let i = 0; i <= uptoIdx; i++) {
      const v = grid[y].hi[i];
      if (!isNum(v)) { streak = 0; continue; }
      days++;
      if (v >= t) { count++; streak++; best = Math.max(best, streak); if (first === null) first = i; last = i; }
      else streak = 0;
    }
    // Feb 29 isn't in the grid; count it directly
    const leap = byDate.get(iso(y, 2, 29));
    if (leap && leap.hi >= t && uptoIdx >= idx365(2, 28)) count++;
    return { count, best, first, last, days };
  }
  function renderHot() {
    const t = +$("hotThresh").value;
    const lastRow = rows[rows.length - 1];
    const stats = years.map((y) => ({ y, ...hotStats(y, t) }));
    const full = stats.filter((s) => s.y < CY && s.days >= 360);
    const reg = linreg(full.map((s) => s.y), full.map((s) => s.count));
    const h = halves(full.map((s) => ({ x: s.y, v: s.count })));
    const parts = [];
    if (h) parts.push(`Average per year: <b>${Math.round(h.a)} days</b> in ${h.aLab} vs. <b>${Math.round(h.b)} days</b> in ${h.bLab} (${signed(Math.round(h.b) - Math.round(h.a))}).`);
    if (reg) parts.push(`Trend: <b>${signed(reg.slope * 10, 1)} days per decade</b>.`);
    if (full.length) {
      const most = full.reduce((a, b) => (b.count > a.count ? b : a)), least = full.reduce((a, b) => (b.count < a.count ? b : a));
      parts.push(`Most: ${most.count} in ${most.y}. Fewest: ${least.count} in ${least.y}.`);
    }
    const cur = stats.find((s) => s.y === CY);
    if (cur && lastRow && lastRow.y === CY) {
      const upto = idx365(lastRow.m, lastRow.d);
      const prior = full.filter((s) => baseline.includes(s.y)).map((s) => hotStats(s.y, t, upto).count);
      const typ = avg(prior);
      const rank = prior.filter((c) => c > cur.count).length + 1;
      parts.push(`${CY} so far: <b>${cur.count} days</b> through ${MONTHS[lastRow.m - 1]} ${lastRow.d}${isNum(typ) ? `, vs. ${Math.round(typ)} by this date in a typical year (${rank === 1 ? "the most" : ordinal(rank) + " most"} of the last ${prior.length + 1} years by this date)` : ""}.`);
    }
    $("hotSummary").innerHTML = parts.join(" ");

    const color = css("--high"), xs = stats.map((s) => s.y);
    const base = chartBase();
    base.plugins.legend.display = false;
    base.scales.y.beginAtZero = true;
    base.scales.y.title = { display: true, text: `Days with a high ≥ ${t}°F`, color: css("--text-2") };
    base.plugins.tooltip.filter = (c) => c.datasetIndex === 0;
    base.plugins.tooltip.callbacks = { label: (c) => { const s = stats[c.dataIndex]; return ` ${s.count} days${s.y === CY ? " so far" : ""} · longest streak ${s.best}`; } };
    draw("hotChart", {
      type: "bar",
      data: {
        labels: xs,
        datasets: [
          { label: "Hot days", data: stats.map((s) => s.count), backgroundColor: stats.map((s) => (s.y === CY ? color + "88" : color)), borderRadius: 4, borderSkipped: "start", maxBarThickness: 28 },
          { type: "line", ...trendSet("Trend", xs, reg, css("--text-2")) },
        ],
      },
      options: base,
    });
    $("hotTable").innerHTML = `<thead><tr><th>Year</th><th>Days ≥ ${t}°F</th><th>Longest streak</th><th>First</th><th>Last</th></tr></thead><tbody>` +
      stats.slice().reverse().map((s) => `<tr><td>${s.y}${s.y === CY ? " (so far)" : ""}</td><td>${s.count}</td><td>${s.best ? s.best + " days" : "—"}</td><td>${s.first === null ? "—" : idxLabel(s.first)}</td><td>${s.last === null ? "—" : idxLabel(s.last)}</td></tr>`).join("") + `</tbody>`;
  }

  // ---------- section: long-term ----------
  function seasonValue(y, season) {
    let picks;
    if (season === "year") picks = [[y, 1, 12]];
    else if (season === "fall") picks = [[y, 9, 11]];
    else if (season === "summer") picks = [[y, 6, 8]];
    else if (season === "spring") picks = [[y, 3, 5]];
    else if (season === "winter") picks = [[y - 1, 12, 12], [y, 1, 2]];
    else picks = [[y, +season, +season]];
    let need = 0; const vals = [];
    for (const [yy, m0, m1] of picks) {
      if (!grid[yy]) { need += 999; continue; }
      for (let i = CUM[m0 - 1]; i < (m1 === 12 ? 365 : CUM[m1]); i++) { need++; if (isNum(grid[yy].mean[i])) vals.push(grid[yy].mean[i]); }
    }
    return vals.length >= need * 0.95 ? avg(vals) : NaN; // only (nearly) complete seasons
  }
  function renderTrend() {
    const season = $("trendSeason").value;
    const label = $("trendSeason").selectedOptions[0].textContent;
    const vals = years.map((y) => ({ x: y, v: seasonValue(y, season) })).filter((p) => isNum(p.v));
    const bl = avg(vals.filter((p) => baseline.includes(p.x)).map((p) => p.v));
    const anom = vals.map((p) => ({ x: p.x, v: p.v - bl, abs: p.v }));
    const reg = linreg(vals.map((p) => p.x), vals.map((p) => p.v));
    const h = halves(vals);
    const parts = [];
    if (h) parts.push(`${label} average: <b>${h.a.toFixed(1)}°F</b> in ${h.aLab} vs. <b>${h.b.toFixed(1)}°F</b> in ${h.bLab} (${signed(h.b - h.a, 1)}°F).`);
    if (reg) parts.push(`Trend: <b>${signed(reg.slope * 10, 1)}°F per decade</b>.`);
    if (vals.length) {
      const hot = vals.reduce((a, b) => (b.v > a.v ? b : a)), cool = vals.reduce((a, b) => (b.v < a.v ? b : a));
      parts.push(`Warmest: ${hot.x} (${hot.v.toFixed(1)}°F). Coolest: ${cool.x} (${cool.v.toFixed(1)}°F).`);
    }
    $("trendSummary").innerHTML = parts.join(" ") || "Not enough complete seasons yet.";
    const warm = css("--warm"), cool = css("--cool");
    const xs = anom.map((p) => p.x);
    const base = chartBase();
    base.plugins.legend.display = false;
    base.scales.y.ticks.callback = (v) => `${signed(v, 1)}°`;
    base.scales.y.title = { display: true, text: `°F vs. ${isNum(bl) ? bl.toFixed(1) + "°F " : ""}20-year average`, color: css("--text-2") };
    base.plugins.tooltip.filter = (c) => c.datasetIndex === 0;
    base.plugins.tooltip.callbacks = { label: (c) => ` ${anom[c.dataIndex].abs.toFixed(1)}°F (${signed(c.parsed.y, 1)}°)` };
    draw("trendChart", {
      type: "bar",
      data: {
        labels: xs,
        datasets: [
          { label: "Average", data: anom.map((p) => +p.v.toFixed(2)), backgroundColor: anom.map((p) => (p.v >= 0 ? warm : cool)), borderRadius: 4, borderSkipped: false, maxBarThickness: 28 },
          { type: "line", ...trendSet("Trend", xs, reg && { at: (x) => reg.at(x) - bl }, css("--text-2")) },
        ],
      },
      options: base,
    });
  }

  // ---------- section: heatmap ----------
  function mix(a, b, t) {
    const pa = parseHex(a), pb = parseHex(b);
    return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
  }
  function parseHex(h) { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  const HEAT_MAX = 12;
  function heatColor(v) {
    if (!isNum(v)) return null;
    const t = Math.max(-1, Math.min(1, v / HEAT_MAX));
    return t >= 0 ? mix(css("--mid"), css("--warm"), t) : mix(css("--mid"), css("--cool"), -t);
  }
  let heatState = null;
  function renderHeat() {
    const cv = $("heat"), wrap = cv.parentElement;
    const W = wrap.clientWidth, labelW = 44, topH = 18, rowH = Math.max(6, Math.min(16, Math.floor(420 / Math.max(1, years.length))));
    const H = topH + rowH * years.length;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cw = (W - labelW) / 365;
    ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = css("--text-2"); ctx.textBaseline = "middle";
    MONTHS.forEach((mn, i) => ctx.fillText(mn, labelW + CUM[i] * cw + 2, topH / 2));
    const cells = {};
    years.forEach((y, r) => {
      const yy = topH + r * rowH;
      if (rowH >= 9 || r % 2 === 0 || y === years[years.length - 1]) { ctx.fillStyle = css("--text-2"); ctx.fillText(y, 0, yy + rowH / 2); }
      cells[y] = [];
      for (let i = 0; i < 365; i++) {
        const win = [];
        for (let o = -3; o <= 3; o++) { const j = i + o; if (j >= 0 && j < 365) win.push(grid[y].mean[j] - normal.mean[j]); }
        const v = isNum(grid[y].mean[i]) ? avg(win) : NaN;
        cells[y][i] = v;
        const c = heatColor(v);
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(labelW + i * cw, yy, Math.ceil(cw), rowH - 1);
      }
    });
    heatState = { labelW, topH, rowH, cw, cells };
    $("heatLegend").innerHTML = `<span>−${HEAT_MAX}°F</span><span class="bar" style="background:linear-gradient(90deg,${css("--cool")},${css("--mid")},${css("--warm")})"></span><span>+${HEAT_MAX}°F</span><span>vs. normal</span>`;
  }
  function setupHeat() {
    const cv = $("heat"), tip = $("heatTip");
    cv.addEventListener("mousemove", (e) => {
      if (!heatState) return;
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const { labelW, topH, rowH, cw, cells } = heatState;
      const i = Math.floor((x - labelW) / cw), r = Math.floor((y - topH) / rowH), yr = years[r];
      if (i < 0 || i >= 365 || yr === undefined) { tip.hidden = true; return; }
      let m = 11; while (CUM[m] > i) m--;
      const row = byDate.get(iso(yr, m + 1, i - CUM[m] + 1));
      const v = cells[yr][i];
      if (!row) { tip.hidden = true; return; }
      tip.innerHTML = `<b>${idxLabel(i)}, ${yr}</b><br>${range(row.lo, row.hi)}F (${esc(row.src)})<br>Week vs. normal: ${signed(v, 1)}°F`;
      tip.hidden = false;
      const tx = Math.min(x + 12, rect.width - tip.offsetWidth - 4);
      tip.style.left = Math.max(0, tx) + "px"; tip.style.top = (y + 14) + "px";
    });
    cv.addEventListener("mouseleave", () => (tip.hidden = true));
  }

  // ---------- section: daily log ----------
  function setupLog() {
    $("logYear").innerHTML = years.slice().reverse().map((y) => `<option>${y}</option>`).join("");
    $("logMonth").innerHTML = `<option value="0">All months</option>` + MONTH_NAMES.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("");
    $("logYear").value = years.includes(CY) ? CY : years[years.length - 1];
    $("logYear").addEventListener("change", renderLog);
    $("logMonth").addEventListener("change", renderLog);
  }
  function renderLog() {
    const y = +$("logYear").value, m = +$("logMonth").value;
    const list = rows.filter((r) => r.y === y && (!m || r.m === m)).reverse();
    const hiC = css("--high"), loC = css("--low");
    $("logTable").innerHTML = `<thead><tr><th>Date</th><th>Range (<span class="dot" style="background:${loC}"></span>low–<span class="dot" style="background:${hiC}"></span>high)</th><th>Swing</th><th>High vs. normal</th><th>Low vs. normal</th><th>Station</th><th>Status</th></tr></thead><tbody>` +
      list.map((r) => {
        const i = idx365(r.m, r.d);
        const dh = r.hi - normal.hi[i], dl = r.lo - normal.lo[i];
        const cls = (v) => (v >= 0.5 ? "up" : v <= -0.5 ? "down" : "");
        const day = new Date(Date.UTC(r.y, r.m - 1, r.d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
        return `<tr><td>${esc(day)}</td><td>${range(r.lo, r.hi)}</td><td>${Math.round(r.hi - r.lo)}°</td><td class="${cls(dh)}">${signed(dh)}°</td><td class="${cls(dl)}">${signed(dl)}°</td><td>${esc(r.src)}</td><td${r.prov ? ' class="prov"' : ""}>${r.prov ? "provisional" : "final"}</td></tr>`;
      }).join("") + `</tbody>`;
  }

  // ---------- boot ----------
  function renderAll() {
    renderToday(); renderOtd(); renderSeason("spring"); renderSeason("fall"); renderHot(); renderTrend(); renderHeat(); renderLog();
  }

  async function boot() {
    const raw = (window.PLANO_DATA || []).slice();
    live = await fetchLive();
    ingest(raw);
    if (!rows.length) {
      $("empty").hidden = false;
      $("coverage").textContent = "No temperature history recorded yet.";
    } else {
      const upd = META.updated ? ` · Updated ${new Date(META.updated).toLocaleString()}` : "";
      $("coverage").textContent = `Recorded at ${STATION.name} (${STATION.code}), the nearest official weather station to Plano. ${rows.length.toLocaleString()} days on record, ${rows[0].date} to ${rows[rows.length - 1].date}. All temperatures °F${upd}.`;
    }
    setupOtd(); setupSeason("spring"); setupSeason("fall"); setupHeat(); setupLog();
    $("trendSeason").addEventListener("change", renderTrend);
    $("hotThresh").addEventListener("change", renderHot);
    // Default "on this day" to today; Halloween is one click away.
    otd = { m: todayParts.m, d: todayParts.d };
    $("otdMonth").value = otd.m; $("otdMonth").dispatchEvent(new Event("change"));
    renderAll();
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderHeat, 150); });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
  }
  boot();
})();
