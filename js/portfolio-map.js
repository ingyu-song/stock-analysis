// Portfolio Map — holdings grouped by theme, each tile sized by its share of the
// book and coloured by return on cost. Hand-rolled squarified treemap: the data
// is a dozen tiles, so a charting dependency would cost more than it saves, and
// drawing with the site's own CSS tokens keeps dark mode and the gain/loss
// colours correct for free.
import { getBookSnapshot, onBookChange } from "./position.js";

const THEMES_URL = "data/themes.json";
const SCOPE_KEY = "igs-map-scope";
const CASH_KEY = "igs-map-cash";
const UNSORTED = "미분류";
const CASH = "현금";
const HEADER_H = 19; // room for a group's label

let themeOf = new Map(); // ticker -> theme
let scope = readPref(SCOPE_KEY, "all");
let showCash = readPref(CASH_KEY, "0") === "1";
let queued = false;

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice just does not persist */
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const won = n => `₩${Math.round(n).toLocaleString("en-US")}`;
const signedPct = x => (isFinite(x) ? `${x > 0 ? "+" : ""}${x.toFixed(1)}%` : "–");

// ---------- squarified treemap (Bruls, Huizing, van Wijk) ----------
// Returns one rect per item, tiling `rect` exactly, areas proportional to value.
function squarify(items, rect) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!(total > 0) || rect.w <= 0 || rect.h <= 0) return [];

  const scale = (rect.w * rect.h) / total;
  const nodes = items
    .map(item => ({ item, area: item.value * scale }))
    .sort((a, b) => b.area - a.area);

  const out = [];
  let { x, y, w, h } = rect;
  let row = [];

  const sum = r => r.reduce((a, n) => a + n.area, 0);
  // the aspect ratio of the worst tile in a row laid along a side of length `side`
  const worst = (r, side) => {
    const s = sum(r);
    const areas = r.map(n => n.area);
    return Math.max(
      (side * side * Math.max(...areas)) / (s * s),
      (s * s) / (side * side * Math.min(...areas))
    );
  };

  const place = r => {
    const s = sum(r);
    if (w >= h) {
      // wide box: stack the row as a column down the left edge
      const colW = s / h;
      let cy = y;
      r.forEach(n => {
        const nh = n.area / colW;
        out.push({ item: n.item, x, y: cy, w: colW, h: nh });
        cy += nh;
      });
      x += colW;
      w -= colW;
    } else {
      const rowH = s / w;
      let cx = x;
      r.forEach(n => {
        const nw = n.area / rowH;
        out.push({ item: n.item, x: cx, y, w: nw, h: rowH });
        cx += nw;
      });
      y += rowH;
      h -= rowH;
    }
  };

  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(w, h);
    const candidate = row.concat(nodes[i]);
    if (row.length === 0 || worst(candidate, side) <= worst(row, side)) {
      row = candidate;
      i++;
    } else {
      place(row);
      row = [];
    }
  }
  if (row.length) place(row);
  return out;
}

// ---------- data shaping ----------
function buildGroups(snap) {
  const rows = snap.holdings.filter(h =>
    h.valueBase > 0 && (scope === "all" || h.account === scope));

  const byTheme = new Map();
  rows.forEach(h => {
    const theme = themeOf.get(h.ticker) || UNSORTED;
    if (!byTheme.has(theme)) byTheme.set(theme, []);
    byTheme.get(theme).push({
      key: `${h.account}|${h.ticker}`,
      label: h.name || h.ticker,
      ticker: h.ticker,
      value: h.valueBase,
      cost: h.costBase,
      pnl: h.pnlBase,
      pct: h.costBase > 0 ? (h.pnlBase / h.costBase) * 100 : NaN,
    });
  });

  const groups = [...byTheme.entries()].map(([name, tiles]) => {
    const cost = tiles.reduce((s, t) => s + t.cost, 0);
    const pnl = tiles.reduce((s, t) => s + t.pnl, 0);
    return {
      name, tiles,
      value: tiles.reduce((s, t) => s + t.value, 0),
      pct: cost > 0 ? (pnl / cost) * 100 : NaN,
    };
  });

  if (showCash) {
    const cashTiles = snap.accounts
      .filter(a => (scope === "all" || a.id === scope) && a.cashBase > 0)
      .map(a => ({
        key: `cash|${a.id}`, label: `${CASH} · ${a.name}`, ticker: "",
        value: a.cashBase, cost: 0, pnl: 0, pct: NaN, isCash: true,
      }));
    if (cashTiles.length) {
      groups.push({
        name: CASH, tiles: cashTiles, isCash: true, pct: NaN,
        value: cashTiles.reduce((s, t) => s + t.value, 0),
      });
    }
  }

  return groups;
}

// ---------- drawing ----------
function tileColour(pct, isCash) {
  if (isCash || !isFinite(pct) || Math.abs(pct) < 0.05) {
    return { bg: "var(--bg-chip)", strong: false };
  }
  // Square-rooted so the small moves that make up most of a book are still
  // visibly different from flat: on a linear scale a -1% and a +1% sit within a
  // few shades of grey and the whole map reads as one colour. Saturates at ±25%.
  const magnitude = Math.sqrt(Math.min(Math.abs(pct), 25) / 25);
  const mix = Math.round(14 + magnitude * 64);
  const base = pct > 0 ? "var(--gain)" : "var(--loss)";
  return { bg: `color-mix(in srgb, ${base} ${mix}%, var(--surface-2))`, strong: mix > 48 };
}

function tileHtml(t, r, total) {
  const { bg, strong } = tileColour(t.pct, t.isCash);
  const weight = (t.value / total) * 100;
  const lg = r.w > 230 && r.h > 110;
  // Below ~46px a label cannot fit at normal size, but a tile with no name at
  // all is just an unlabelled colour — worse than a cramped one, because on a
  // phone there is no hover to fall back on. Shrink the text and let a long
  // name wrap into the tile instead of dropping it.
  const tiny = r.w < 62 || r.h < 40;
  const showName = r.w >= 26 && r.h >= 18;
  const showMeta = !tiny && r.h >= 44;
  const showTicker = lg && t.ticker;

  const title = [
    t.label + (t.ticker ? ` (${t.ticker})` : ""),
    `평가액 ${won(t.value)} · 비중 ${weight.toFixed(1)}%`,
    t.isCash ? "" : `매입 대비 ${signedPct(t.pct)} (${t.pnl >= 0 ? "+" : "-"}${won(Math.abs(t.pnl))})`,
  ].filter(Boolean).join("\n");

  const body = !showName ? "" : `
      <span class="t-name">${esc(t.label)}</span>
      ${showTicker ? `<span class="t-ticker">${esc(t.ticker)}</span>` : ""}
      ${showMeta ? `<span class="t-meta">${weight.toFixed(1)}%${t.isCash ? "" : ` · ${signedPct(t.pct)}`}</span>` : ""}`;

  return `<div class="map-tile${strong ? " is-strong" : ""}${lg ? " is-lg" : ""}${tiny ? " is-tiny" : ""}"
      style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${bg};"
      title="${esc(title)}">${body}</div>`;
}

function groupHtml(g, r, total) {
  const gap = 1;
  const gx = Math.round(r.x) + gap, gy = Math.round(r.y) + gap;
  const gw = Math.max(0, Math.round(r.w) - gap * 2), gh = Math.max(0, Math.round(r.h) - gap * 2);

  const canLabel = gw >= 54 && gh >= HEADER_H + 22;
  const head = canLabel ? HEADER_H : 0;
  const inner = { x: 0, y: head, w: gw, h: gh - head };

  const tiles = squarify(g.tiles, inner).map(tr => tileHtml(
    g.tiles.find(t => t.key === tr.item.key),
    {
      x: Math.round(tr.x) + 1, y: Math.round(tr.y) + 1,
      w: Math.max(0, Math.round(tr.w) - 2), h: Math.max(0, Math.round(tr.h) - 2),
    },
    total
  )).join("");

  const weight = (g.value / total) * 100;
  const label = `${g.name} · ${weight.toFixed(1)}%${g.isCash || !isFinite(g.pct) ? "" : ` · ${signedPct(g.pct)}`}`;

  return `<div class="map-group${g.isCash ? " is-cash" : ""}" style="left:${gx}px;top:${gy}px;width:${gw}px;height:${gh}px;">
      ${canLabel ? `<div class="map-group-label" title="${esc(label)}">${esc(label)}</div>` : ""}
      ${tiles}
    </div>`;
}

function canvasHeight(width) {
  if (width < 520) return Math.round(Math.max(380, width * 1.25));
  return Math.round(Math.max(360, Math.min(640, width * 0.52)));
}

function render() {
  queued = false;
  const canvas = document.getElementById("mapCanvas");
  if (!canvas) return;

  const width = Math.floor(canvas.clientWidth);
  if (width < 40) return; // tab not visible yet — the ResizeObserver will call back

  const snap = getBookSnapshot();
  renderControls(snap);

  const groups = buildGroups(snap);
  const total = groups.reduce((s, g) => s + g.value, 0);
  const empty = document.getElementById("mapEmpty");

  if (!groups.length || total <= 0) {
    canvas.innerHTML = "";
    canvas.style.height = "0px";
    if (empty) empty.hidden = false;
    renderMeta(snap, groups, total);
    return;
  }
  if (empty) empty.hidden = true;

  const height = canvasHeight(width);
  canvas.style.height = `${height}px`;

  const groupRects = squarify(groups, { x: 0, y: 0, w: width, h: height });
  canvas.innerHTML = groupRects
    .map(r => groupHtml(groups.find(g => g.name === r.item.name), r, total))
    .join("");

  renderMeta(snap, groups, total);
}

function renderMeta(snap, groups, total) {
  const meta = document.getElementById("mapMeta");
  if (!meta) return;

  const stocks = groups.filter(g => !g.isCash).flatMap(g => g.tiles);
  const unsorted = groups.find(g => g.name === UNSORTED);
  const parts = [
    `${stocks.length}종목 · ${groups.filter(g => !g.isCash).length}개 테마`,
    `표시 ${won(total)}`,
    snap.updatedAt ? `${snap.updatedAt} 기준` : "",
  ].filter(Boolean);

  meta.innerHTML = esc(parts.join(" · ")) + (unsorted
    ? ` <span class="map-warn">미분류 ${unsorted.tiles.length}종목 — <code>data/themes.json</code>에 테마를 지정하세요</span>`
    : "");
}

function renderControls(snap) {
  const bar = document.getElementById("mapScope");
  if (!bar) return;

  // the account list can change (accounts added or removed), so it is rebuilt
  // from the live snapshot rather than fixed in markup
  const scopes = [{ id: "all", name: "전체" }, ...snap.accounts];
  if (!scopes.some(s => s.id === scope)) scope = "all";

  bar.innerHTML = scopes.map(s => `
    <button class="scope-btn ${scope === s.id ? "is-active" : ""}" data-map-scope="${esc(s.id)}"
            aria-pressed="${scope === s.id}">${esc(s.name)}</button>`).join("");

  bar.querySelectorAll("[data-map-scope]").forEach(btn => {
    btn.addEventListener("click", () => {
      scope = btn.dataset.mapScope;
      writePref(SCOPE_KEY, scope);
      render();
    });
  });

  const cash = document.getElementById("mapCash");
  if (cash) cash.checked = showCash;
}

function schedule() {
  if (queued) return;
  queued = true;
  // a burst of edits collapses to one redraw. A timer rather than
  // requestAnimationFrame: this only writes DOM, there is no frame to align
  // with, and rAF never fires in a backgrounded tab — which would leave the
  // map blank until the user came back to it
  setTimeout(render, 0);
}

async function loadThemes() {
  try {
    const res = await fetch(THEMES_URL, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const map = new Map();
    Object.entries(data.themes || {}).forEach(([theme, tickers]) => {
      (tickers || []).forEach(t => map.set(t, theme));
    });
    themeOf = map;
  } catch {
    // offline, or file:// — everything lands in 미분류 rather than failing
  }
}

export function initPortfolioMap() {
  const canvas = document.getElementById("mapCanvas");
  if (!canvas) return;

  document.getElementById("mapCash")?.addEventListener("change", e => {
    showCash = e.target.checked;
    writePref(CASH_KEY, showCash ? "1" : "0");
    render();
  });

  onBookChange(schedule);
  // fires when the tab first becomes visible (0 -> real width) and on any resize
  new ResizeObserver(schedule).observe(canvas);

  loadThemes().then(schedule);
  schedule();
}
