// Sample/placeholder data — for template layout only, not real research.
// TODO: replace with real filings-based data. Live price/PER history can't be fetched
// client-side from a static GitHub Pages site (CORS blocks Yahoo/Stooq/etc. directly) —
// this will need either the Toss API integration or a GitHub Actions job that fetches
// data on a schedule and commits it as JSON for the page to read.
const STOCKS = {
  "6758.T": {
    ticker: "6758.T",
    name: "Sony Group",
    sector: "Consumer Electronics / Entertainment",
    price: "¥3,180",
    asOf: "Sample data",
    oneLiner:
      "Sells PlayStation hardware, music and film IP, and image sensors under one roof. " +
      "Hardware pulls people into the ecosystem; subscriptions and content then earn off them repeatedly.",
    segments: [
      { name: "Game & Network Services", revenuePct: 32, opIncomePct: 22 },
      { name: "Music", revenuePct: 10, opIncomePct: 20 },
      { name: "Pictures", revenuePct: 9, opIncomePct: 10 },
      { name: "Imaging & Sensing", revenuePct: 10, opIncomePct: 17 },
      { name: "Electronics Products", revenuePct: 20, opIncomePct: 11 },
      { name: "Financial Services", revenuePct: 19, opIncomePct: 20 },
    ],
    kpis: [
      { label: "PS5 cumulative units & software attach rate", status: "good" },
      { label: "Mobile image sensor share vs Samsung Electro-Mechanics", status: "warning" },
      { label: "Music streaming royalty revenue growth", status: "good" },
      { label: "Holdco valuation after the financial arm spin-off", status: "warning" },
    ],
    promises: [
      { item: "Raise image sensor capex to defend share", status: "warning", note: "Flagged a possible delay as rivals add capacity" },
      { item: "Expand live-service titles in gaming", status: "critical", note: "Cancelled development on several live-service games" },
      { item: "Widen cross-licensing of music and film IP", status: "good", note: "Ahead of the quarterly target" },
    ],
    valuation: {
      impliedGrowth: "6.8%",
      historicalGrowth: "9.4%",
      note:
        "Today's price implies 6.8% annual growth over the next decade (reverse DCF, sample assumptions). " +
        "That is below the 9.4% actually delivered over the past ten years, which reads as the market pricing " +
        "the name conservatively — though the figure swings hard on WACC and terminal multiple, so treat it as indicative.",
    },
    risks: [
      { text: "Margin pressure as image sensor competition intensifies (Samsung Electro-Mechanics, OmniVision)", severity: "warning" },
      { text: "Repeated failures of the live-service strategy in gaming", severity: "critical" },
      { text: "Yen volatility feeding through to translated overseas revenue", severity: "warning" },
    ],
    priceHistory: [
      ["24-09", 2720], ["24-11", 2865], ["25-01", 2610], ["25-03", 2980],
      ["25-05", 3105], ["25-07", 2940], ["25-09", 3220], ["25-11", 3055],
      ["26-01", 3310], ["26-03", 3190], ["26-05", 3260], ["26-07", 3180],
    ],
    perHistory: [
      ["24-09", 17.8], ["24-11", 18.6], ["25-01", 16.4], ["25-03", 19.1],
      ["25-05", 19.9], ["25-07", 18.2], ["25-09", 20.4], ["25-11", 18.9],
      ["26-01", 21.0], ["26-03", 19.8], ["26-05", 20.1], ["26-07", 19.4],
    ],
  },
};

const SERIES_COLORS = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgba(hex, alpha) {
  const m = hex.replace("#", "");
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

let revenueChart = null;
let priceChart = null;
let perChart = null;
let currentTicker = null;

function destroyCharts() {
  [revenueChart, priceChart, perChart].forEach(c => c && c.destroy());
  revenueChart = priceChart = perChart = null;
}

function renderRevenuePie(s) {
  const canvas = document.getElementById("segmentPieChart");
  if (!canvas) return;
  const colors = s.segments.map((_, i) => cssVar(SERIES_COLORS[i % SERIES_COLORS.length]));
  revenueChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: s.segments.map(seg => seg.name),
      datasets: [{ data: s.segments.map(seg => seg.revenuePct), backgroundColor: colors, borderWidth: 2, borderColor: cssVar("--surface-1") }],
    },
    options: {
      cutout: "58%",
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}% of revenue` } },
      },
    },
  });
}

function lineChartOptions(suffix) {
  return {
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false }, ticks: { color: cssVar("--text-muted"), font: { size: 11 } } },
      y: {
        grid: { color: cssVar("--gridline") },
        ticks: { color: cssVar("--text-muted"), font: { size: 11 }, callback: v => `${v}${suffix}` },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y}${suffix}` } },
    },
    interaction: { mode: "index", intersect: false },
  };
}

function renderLine(canvasId, series, suffix) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: series.map(p => p[0]),
      datasets: [{
        data: series.map(p => p[1]),
        borderColor: cssVar("--series-1"),
        backgroundColor: context => {
          const { ctx, chartArea } = context.chart;
          if (!chartArea) return "transparent";
          const seriesHex = cssVar("--series-1");
          const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, hexToRgba(seriesHex, 0.25));
          g.addColorStop(1, hexToRgba(seriesHex, 0));
          return g;
        },
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.25,
      }],
    },
    options: lineChartOptions(suffix),
  });
}

function renderStock(key) {
  const s = STOCKS[key];
  const root = document.getElementById("analysisContent");
  destroyCharts();
  if (!s) {
    root.innerHTML = `<p class="hint">Search for a company to open its one-pager.</p>`;
    return;
  }
  currentTicker = key;

  const opIncomeRows = s.segments
    .map(seg => `
      <div class="segment-op-row">
        <span class="name">${seg.name}</span>
        <span class="val">${seg.opIncomePct}% of op. income</span>
      </div>`)
    .join("");

  const kpiItems = s.kpis
    .map(k => `<li><span class="dot dot-${k.status}"></span>${k.label}</li>`)
    .join("");

  const promiseRows = s.promises
    .map(p => `
      <div class="promise-row">
        <span style="flex:1">${p.item}</span>
        <span class="status-pill status-${p.status}">${
        p.status === "good" ? "On track" : p.status === "warning" ? "Slipping" : "Missed"
      }</span>
      </div>
      <div class="hint" style="margin:-4px 0 4px;">${p.note}</div>`)
    .join("");

  const riskItems = s.risks
    .map(r => `<li><span class="dot dot-${r.severity}"></span>${r.text}</li>`)
    .join("");

  root.innerHTML = `
    <div class="stock-header">
      <span class="stock-ticker-badge">${s.ticker}</span>
      <span class="stock-title">${s.name}</span>
      <span class="stock-price">${s.price}</span>
      <span class="badge badge-muted">${s.sector}</span>
      <span class="badge badge-muted">${s.asOf}</span>
    </div>

    <div class="stock-oneliner">${s.oneLiner}</div>

    <div class="section-grid">
      <div class="card">
        <div class="card-head"><h2>Revenue mix</h2></div>
        <div class="segment-mix-wrap">
          <div class="mini-chart-wrap"><canvas id="segmentPieChart"></canvas></div>
          <div class="segment-op-list">${opIncomeRows}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Key KPIs</h2></div>
        <ul class="kpi-list">${kpiItems}</ul>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Price &amp; valuation history</h2>
        <span class="badge badge-muted">${s.asOf} · live data pending</span>
      </div>
      <div class="section-grid">
        <div>
          <p class="hint" style="margin:0 0 8px;">Share price</p>
          <div class="mini-chart-wrap"><canvas id="priceLineChart"></canvas></div>
        </div>
        <div>
          <p class="hint" style="margin:0 0 8px;">P/E (x)</p>
          <div class="mini-chart-wrap"><canvas id="perLineChart"></canvas></div>
        </div>
      </div>
      <p class="hint">A static site cannot call market data APIs from the browser (CORS). This will be replaced with real data the same way prices are: a scheduled job fetches it and commits JSON the page reads.</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Management scorecard</h2></div>
      ${promiseRows}
    </div>

    <div class="section-grid">
      <div class="card">
        <div class="card-head"><h2>Fair value (reverse DCF)</h2></div>
        <div class="valuation-compare">
          <div class="valuation-stat">
            <span class="stat-label">Growth implied by price</span>
            <span class="stat-value">${s.valuation.impliedGrowth}</span>
          </div>
          <div class="valuation-stat">
            <span class="stat-label">Actual 10-year growth</span>
            <span class="stat-value">${s.valuation.historicalGrowth}</span>
          </div>
        </div>
        <p class="valuation-note">${s.valuation.note}</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>Key risks</h2></div>
        <ul class="risk-list">${riskItems}</ul>
      </div>
    </div>
  `;

  renderRevenuePie(s);
  priceChart = renderLine("priceLineChart", s.priceHistory, "");
  perChart = renderLine("perLineChart", s.perHistory, "x");
}

// ---------- search combobox ----------
function initStockSearch() {
  const input = document.getElementById("stockSearchInput");
  const results = document.getElementById("stockSearchResults");
  const wrap = document.getElementById("stockSearch");
  const list = Object.values(STOCKS);

  function renderResults(query) {
    const q = query.trim().toLowerCase();
    const matches = q
      ? list.filter(s => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      : list;

    results.innerHTML = matches.length
      ? matches
          .map(s => `<div class="stock-search-result" data-ticker="${s.ticker}">
              <span class="ticker">${s.ticker}</span><span class="name">${s.name}</span>
            </div>`)
          .join("")
      : `<div class="stock-search-empty">No matches</div>`;

    results.querySelectorAll("[data-ticker]").forEach(el => {
      el.addEventListener("click", () => {
        selectStock(el.dataset.ticker);
      });
    });
  }

  function selectStock(ticker) {
    const s = STOCKS[ticker];
    if (!s) return;
    input.value = `${s.ticker} · ${s.name}`;
    closeResults();
    renderStock(ticker);
  }

  function openResults() {
    renderResults(input.value === currentSearchLabel() ? "" : input.value);
    results.classList.add("is-open");
  }
  function closeResults() {
    results.classList.remove("is-open");
  }
  function currentSearchLabel() {
    const s = STOCKS[currentTicker];
    return s ? `${s.ticker} · ${s.name}` : "";
  }

  input.addEventListener("focus", openResults);
  input.addEventListener("input", () => {
    renderResults(input.value);
    results.classList.add("is-open");
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeResults(); input.blur(); }
    if (e.key === "Enter") {
      const first = results.querySelector("[data-ticker]");
      if (first) selectStock(first.dataset.ticker);
    }
  });
  document.addEventListener("click", e => {
    if (!wrap.contains(e.target)) closeResults();
  });

  // theme toggle repaints chart colors
  document.getElementById("themeToggle").addEventListener("click", () => {
    setTimeout(() => currentTicker && renderStock(currentTicker), 0);
  });
}

export function initAnalysis() {
  initStockSearch();
  const first = Object.keys(STOCKS)[0];
  const s = STOCKS[first];
  document.getElementById("stockSearchInput").value = `${s.ticker} · ${s.name}`;
  renderStock(first);
}
