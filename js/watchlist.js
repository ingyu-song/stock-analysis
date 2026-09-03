const SECTORS = [
  { name: "반도체 (메모리)", tone: "good", note: "HBM 수요 강세 지속, 가격 협상력 개선" },
  { name: "반도체 (파운드리)", tone: "warning", note: "설비투자 사이클 고점 논쟁" },
  { name: "소비자 가전", tone: "warning", note: "관세 이슈로 수요 둔화 우려" },
  { name: "AI 인프라", tone: "good", note: "capex 가이던스 상향 지속" },
];

// Built from the coverage file's earnings dates, filtered to what is still
// ahead, so this can never show an event that has already happened.
function renderCatalysts(coverage) {
  const tbody = document.getElementById("catalystBody");
  if (!tbody) return;

  const asOf = document.getElementById("catalystAsOf");
  if (asOf) asOf.textContent = coverage && coverage.updatedAt ? `${coverage.updatedAt} 기준` : "–";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = ((coverage && coverage.names) || [])
    .filter(c => c.nextEarnings)
    .map(c => {
      const when = new Date(`${c.nextEarnings}T00:00:00`);
      return { ...c, when, days: Math.round((when - today) / 86400000) };
    })
    .filter(c => c.days >= 0)
    .sort((a, b) => a.when - b.when);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:18px 8px;">
      예정된 실적 발표가 없어요.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(c => `
    <tr>
      <td class="cell-computed">${c.nextEarnings}</td>
      <td class="cell-computed ${c.days <= 7 ? "num-gain" : ""}">${c.days === 0 ? "오늘" : `D-${c.days}`}</td>
      <td>${c.name}</td>
      <td class="cell-computed">실적 발표</td>
    </tr>`).join("");
}

function renderSectors() {
  const grid = document.getElementById("sectorGrid");
  grid.innerHTML = SECTORS.map(
    s => `
    <div class="sector-card">
      <div class="sector-card-head">
        <span class="sector-name">${s.name}</span>
        <span class="dot dot-${s.tone}"></span>
      </div>
      <span class="sector-note">${s.note}</span>
    </div>`
  ).join("");
}

async function loadJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    // opened as a file:// page, or offline
    return null;
  }
}

function fmtPrice(amount, currency) {
  const symbols = { KRW: "₩", USD: "$", EUR: "€", JPY: "¥" };
  const digits = currency === "KRW" || currency === "JPY" ? 0 : 2;
  return `${symbols[currency] || ""}${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  })}`;
}

function changeClass(pct) {
  if (!isFinite(pct) || pct === 0) return "";
  return pct > 0 ? "num-gain" : "num-loss";
}

async function renderBoard() {
  const [coverage, book, news] = await Promise.all([
    loadJson("data/coverage.json"),
    loadJson("data/my-portfolio.json"),
    loadJson("data/news.json"),
  ]);
  renderCoverage(coverage, book);
  renderCatalysts(coverage);
  renderNews(news);
}

function renderCoverage(coverage, book) {
  const tbody = document.getElementById("coverageBody");
  if (!tbody) return;

  if (!coverage || !Array.isArray(coverage.names)) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:18px 8px;">
      커버리지 시세를 불러오지 못했어요.</td></tr>`;
    return;
  }

  const el = document.getElementById("coverageUpdatedAt");
  if (el) el.textContent = coverage.updatedAt ? `${coverage.updatedAt} 기준` : "–";

  // held is derived at render rather than stored, so selling out of a name
  // updates the badge without waiting for the next price run
  const held = new Map();
  (book && Array.isArray(book.holdings) ? book.holdings : []).forEach(h => {
    held.set(h.ticker, (held.get(h.ticker) || 0) + (Number(h.shares) || 0));
  });

  const rows = coverage.names
    .map(c => ({
      ...c,
      chg: c.prevClose ? (c.price / c.prevClose - 1) * 100 : NaN,
      shares: held.get(c.ticker) || 0,
    }))
    .sort((a, b) => (isFinite(b.chg) ? b.chg : -Infinity) - (isFinite(a.chg) ? a.chg : -Infinity));

  tbody.innerHTML = rows.map(c => `
    <tr>
      <td>${c.name}</td>
      <td class="cell-computed">${c.ticker}</td>
      <td class="cell-computed cell-num">${fmtPrice(c.price, c.currency)}</td>
      <td class="cell-computed cell-num ${changeClass(c.chg)}">${
        isFinite(c.chg) ? `${c.chg > 0 ? "+" : ""}${c.chg.toFixed(2)}%` : "–"
      }</td>
      <td class="cell-computed">${
        c.shares ? `<span class="acct-pill">${c.shares.toLocaleString("en-US")}주</span>` : "관심"
      }</td>
    </tr>
  `).join("");
}

const NEWS_LIMIT = 4;

function timeAgo(iso) {
  const then = new Date(iso.replace(" ", "T"));
  const mins = Math.round((Date.now() - then) / 60000);
  if (!isFinite(mins)) return "";
  if (mins < 60) return `${Math.max(0, mins)}분 전`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}시간 전`;
  return `${Math.floor(mins / 1440)}일 전`;
}

// Flattened across the whole coverage universe and sorted by time — the useful
// question is what just happened, not what happened per ticker.
function renderNews(news) {
  const list = document.getElementById("newsList");
  if (!list) return;

  const asOf = document.getElementById("newsAsOf");
  if (asOf) asOf.textContent = news && news.updatedAt ? `${news.updatedAt} 기준` : "–";

  const ranked = ((news && news.coverage) || [])
    .flatMap(c => (c.items || []).map(i => ({ ...i, ticker: c.ticker, name: c.name })))
    .filter(i => i.publishedAt)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  // wire stories run in several outlets with near-identical headlines, and with
  // only four slots a duplicate costs a quarter of the panel
  const seen = new Set();
  const items = [];
  for (const item of ranked) {
    const key = item.title.replace(/[^0-9a-z가-힣]/gi, "").slice(0, 32);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= NEWS_LIMIT) break;
  }

  if (!items.length) {
    list.innerHTML = `<p class="journal-empty">아직 수집된 뉴스가 없어요.</p>`;
    return;
  }

  list.innerHTML = items.map(i => `
    <div class="news-item">
      <div class="news-meta">
        <span class="acct-pill">${i.name}</span>
        <span>${i.publishedAt}</span>
        <span>· ${timeAgo(i.publishedAt)}</span>
      </div>
      <a class="news-title" href="${i.link}" target="_blank" rel="noopener">${i.title}</a>
      <p class="news-summary">${i.summary}</p>
    </div>`).join("");
}

function initMarketNote() {
  const key = "igs-market-note";
  const el = document.getElementById("marketNote");
  el.value = localStorage.getItem(key) || "";
  el.addEventListener("input", () => localStorage.setItem(key, el.value));
}

export function initWatchlist() {
  renderBoard();
  renderSectors();
  initMarketNote();
}
