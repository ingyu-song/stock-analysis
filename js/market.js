// Sample/placeholder data — replace with a real feed later.
const CATALYSTS = [
  { date: "2026-08-14", ticker: "6758.T", event: "Q1 FY26 실적 발표" },
  { date: "2026-08-21", ticker: "005930.KS", event: "갤럭시 언팩 후속 반응" },
  { date: "2026-09-05", ticker: "Macro", event: "미국 8월 고용지표" },
];

const SECTORS = [
  { name: "반도체 (메모리)", tone: "good", note: "HBM 수요 강세 지속, 가격 협상력 개선" },
  { name: "반도체 (파운드리)", tone: "warning", note: "설비투자 사이클 고점 논쟁" },
  { name: "소비자 가전", tone: "warning", note: "관세 이슈로 수요 둔화 우려" },
  { name: "AI 인프라", tone: "good", note: "capex 가이던스 상향 지속" },
];

function renderCatalysts() {
  const tbody = document.getElementById("catalystBody");
  tbody.innerHTML = CATALYSTS.map(
    c => `<tr><td>${c.date}</td><td>${c.ticker}</td><td>${c.event}</td></tr>`
  ).join("");
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

async function renderCoverage() {
  const tbody = document.getElementById("coverageBody");
  if (!tbody) return;

  const [coverage, book] = await Promise.all([
    loadJson("data/coverage.json"),
    loadJson("data/my-portfolio.json"),
  ]);

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

function initMarketNote() {
  const key = "igs-market-note";
  const el = document.getElementById("marketNote");
  el.value = localStorage.getItem(key) || "";
  el.addEventListener("input", () => localStorage.setItem(key, el.value));
}

export function initMarket() {
  renderCoverage();
  renderCatalysts();
  renderSectors();
  initMarketNote();
}
