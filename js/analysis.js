// Sample/placeholder data — for template layout only, not real research.
// TODO: replace with real filings-based data, ideally pulled via Toss API + your own analysis.
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
  },
};

function statusIcon(status) {
  return { good: "🟢", warning: "🟡", critical: "🔴" }[status] || "⚪";
}

function renderStock(key) {
  const s = STOCKS[key];
  const root = document.getElementById("analysisContent");
  if (!s) {
    root.innerHTML = `<p class="hint">종목을 선택하세요.</p>`;
    return;
  }

  const segmentRows = s.segments
    .map(
      seg => `
      <div class="promise-row">
        <span style="flex:1">${seg.name}</span>
        <span class="cell-computed">매출 ${seg.revenuePct}%</span>
        <span class="cell-computed">영업이익 ${seg.opIncomePct}%</span>
      </div>`
    )
    .join("");

  const kpiItems = s.kpis
    .map(
      k => `<li><span class="dot dot-${k.status === "critical" ? "critical" : k.status}"></span>${k.label}</li>`
    )
    .join("");

  const promiseRows = s.promises
    .map(
      p => `
      <div class="promise-row">
        <span style="flex:1">${p.item}</span>
        <span class="status-pill status-${p.status}">${statusIcon(p.status)} ${
        p.status === "good" ? "이행 중" : p.status === "warning" ? "지연" : "미이행"
      }</span>
      </div>
      <div class="hint" style="margin:-4px 0 4px;">${p.note}</div>`
    )
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
        <div class="card-head"><h2>수익 구조</h2></div>
        ${segmentRows}
      </div>
      <div class="card">
        <div class="card-head"><h2>핵심 KPI</h2></div>
        <ul class="kpi-list">${kpiItems}</ul>
      </div>
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
}

export function initAnalysis() {
  const select = document.getElementById("stockSelect");
  select.innerHTML = Object.values(STOCKS)
    .map(s => `<option value="${s.ticker}">${s.ticker} · ${s.name}</option>`)
    .join("");
  select.addEventListener("change", () => renderStock(select.value));
  renderStock(select.value);
}
