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

function initMarketNote() {
  const key = "igs-market-note";
  const el = document.getElementById("marketNote");
  el.value = localStorage.getItem(key) || "";
  el.addEventListener("input", () => localStorage.setItem(key, el.value));
}

export function initMarket() {
  renderCatalysts();
  renderSectors();
  initMarketNote();
}
