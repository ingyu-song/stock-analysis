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
    asOf: "샘플 데이터",
    oneLiner:
      "게임(플레이스테이션)·음악·영화 IP와 이미지센서 반도체를 함께 파는 회사. " +
      "하드웨어를 팔아 생태계에 사람을 가두고, 그 위에서 구독·콘텐츠로 반복 수익을 뽑는 구조.",
    segments: [
      { name: "Game & Network Services", revenuePct: 32, opIncomePct: 22 },
      { name: "Music", revenuePct: 10, opIncomePct: 20 },
      { name: "Pictures", revenuePct: 9, opIncomePct: 10 },
      { name: "Imaging & Sensing (반도체)", revenuePct: 10, opIncomePct: 17 },
      { name: "Electronics Products", revenuePct: 20, opIncomePct: 11 },
      { name: "Financial Services", revenuePct: 19, opIncomePct: 20 },
    ],
    kpis: [
      { label: "PS5 누적 판매 & 소프트웨어 attach rate", status: "good" },
      { label: "이미지센서 모바일向 점유율 (vs 삼성전기)", status: "warning" },
      { label: "Music 스트리밍 로열티 수익 성장률", status: "good" },
      { label: "금융 자회사 분사 이후 홀딩스 밸류에이션", status: "warning" },
    ],
    promises: [
      { item: "이미지센서 CAPEX 확대 → 점유율 방어", status: "warning", note: "경쟁사 증설로 목표 지연 가능성 언급" },
      { item: "게임 부문 서비스형(라이브 서비스) 타이틀 확대", status: "critical", note: "다수 라이브 서비스 게임 개발 중단 발표" },
      { item: "음악/영화 IP 크로스 라이선싱 확대", status: "good", note: "분기별 목표치 상회" },
    ],
    valuation: {
      impliedGrowth: "6.8%",
      historicalGrowth: "9.4%",
      note:
        "현재 주가는 향후 10년 연 6.8% 성장을 반영 (역산 DCF, 샘플 가정치). " +
        "과거 10년 실제 성장(9.4%)보다 낮은 기대치라 시장이 보수적으로 가격을 매기고 있다는 해석이 가능 — " +
        "단, WACC·터미널 멀티플 가정에 따라 크게 달라지므로 참고용.",
    },
    risks: [
      { text: "이미지센서 경쟁 심화로 마진 압박 (삼성전기, 옴니비전)", severity: "warning" },
      { text: "게임 부문 라이브 서비스 전략 실패 반복", severity: "critical" },
      { text: "엔화 변동성이 해외 매출 환산에 미치는 영향", severity: "warning" },
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

function statusIcon(status) {
  return { good: "🟢", warning: "🟡", critical: "🔴" }[status] || "⚪";
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
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: 매출 ${ctx.parsed}%` } },
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
    root.innerHTML = `<p class="hint">검색해서 종목을 선택하세요.</p>`;
    return;
  }
  currentTicker = key;

  const opIncomeRows = s.segments
    .map(seg => `
      <div class="segment-op-row">
        <span class="name">${seg.name}</span>
        <span class="val">영업이익 ${seg.opIncomePct}%</span>
      </div>`)
    .join("");

  const kpiItems = s.kpis
    .map(k => `<li><span class="dot dot-${k.status}"></span>${k.label}</li>`)
    .join("");

  const promiseRows = s.promises
    .map(p => `
      <div class="promise-row">
        <span style="flex:1">${p.item}</span>
        <span class="status-pill status-${p.status}">${statusIcon(p.status)} ${
        p.status === "good" ? "이행 중" : p.status === "warning" ? "지연" : "미이행"
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
        <div class="card-head"><h2>수익 구조 (매출 비중)</h2></div>
        <div class="segment-mix-wrap">
          <div class="mini-chart-wrap"><canvas id="segmentPieChart"></canvas></div>
          <div class="segment-op-list">${opIncomeRows}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>핵심 KPI</h2></div>
        <ul class="kpi-list">${kpiItems}</ul>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>가격 &amp; 밸류에이션 추이</h2>
        <span class="badge badge-muted">${s.asOf} · 실데이터 연동 예정</span>
      </div>
      <div class="section-grid">
        <div>
          <p class="hint" style="margin:0 0 8px;">주가 추이</p>
          <div class="mini-chart-wrap"><canvas id="priceLineChart"></canvas></div>
        </div>
        <div>
          <p class="hint" style="margin:0 0 8px;">PER 추이 (배)</p>
          <div class="mini-chart-wrap"><canvas id="perLineChart"></canvas></div>
        </div>
      </div>
      <p class="hint">정적 사이트에서는 브라우저가 외부 시세 API를 직접 못 불러와요 (CORS). Toss API 연동 또는 주기적으로 데이터를 받아 JSON으로 커밋하는 방식으로 실데이터로 교체할 예정입니다.</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>최근 흐름 · 약속이행 성과표</h2></div>
      ${promiseRows}
    </div>

    <div class="section-grid">
      <div class="card">
        <div class="card-head"><h2>적정 주가 (역발상 DCF)</h2></div>
        <div class="valuation-compare">
          <div class="valuation-stat">
            <span class="stat-label">현재가 반영 기대성장률</span>
            <span class="stat-value">${s.valuation.impliedGrowth}</span>
          </div>
          <div class="valuation-stat">
            <span class="stat-label">과거 10년 실제 성장률</span>
            <span class="stat-value">${s.valuation.historicalGrowth}</span>
          </div>
        </div>
        <p class="valuation-note">${s.valuation.note}</p>
      </div>
      <div class="card">
        <div class="card-head"><h2>핵심 리스크</h2></div>
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
      : `<div class="stock-search-empty">검색 결과 없음</div>`;

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
