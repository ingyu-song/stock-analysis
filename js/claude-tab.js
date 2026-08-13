const DATA_URL = "data/claude-portfolio.json";

const SERIES_COLORS = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fmtKRW(amount) {
  return `₩${Math.round(amount).toLocaleString("en-US")}`;
}

function fmtPct(x, withSign) {
  if (!isFinite(x)) return "–";
  const sign = withSign && x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}

let allocationChart = null;
let valueChart = null;
let portfolioData = null;

function computeTotals(p) {
  const equityValue = p.holdings.reduce((s, h) => s + (h.marketValueKRW || 0), 0);
  const totalValue = p.cash + equityValue;
  return { equityValue, totalValue };
}

function renderStats(p) {
  const { equityValue, totalValue } = computeTotals(p);
  const returnPct = ((totalValue - p.startingAUM) / p.startingAUM) * 100;

  document.getElementById("claudeStartDate").textContent = p.startDate;
  document.getElementById("claudeStartAUM").textContent = fmtKRW(p.startingAUM);
  document.getElementById("claudeStatAUM").textContent = fmtKRW(totalValue);
  const returnEl = document.getElementById("claudeStatReturn");
  returnEl.textContent = fmtPct(returnPct, true);
  returnEl.style.color = returnPct > 0 ? "var(--good)" : returnPct < 0 ? "var(--critical)" : "";
  document.getElementById("claudeStatCashPct").textContent = totalValue > 0 ? fmtPct((p.cash / totalValue) * 100) : "–";
  document.getElementById("claudeStatCount").textContent = String(p.holdings.length);
}

function renderHoldingsTable(p) {
  const tbody = document.getElementById("claudeHoldingsBody");
  const { totalValue } = computeTotals(p);

  if (p.holdings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:18px 8px;">
      아직 보유 종목이 없어요. 다음 매매 결정을 기다리는 중입니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = p.holdings
    .map(h => {
      const pnlPct = h.avgCost ? (h.lastPrice / h.avgCost - 1) * 100 : 0;
      const weightPct = totalValue > 0 ? (h.marketValueKRW / totalValue) * 100 : 0;
      const pnlColor = pnlPct > 0 ? "var(--good)" : pnlPct < 0 ? "var(--critical)" : "var(--text-secondary)";
      return `
        <tr>
          <td title="${h.ticker}">${h.ticker}</td>
          <td title="${h.name}">${h.name}</td>
          <td class="cell-num">${h.shares}</td>
          <td class="cell-num cell-computed">${h.avgCost.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${h.currency}</td>
          <td class="cell-num cell-computed">${h.lastPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${h.currency}</td>
          <td class="cell-num cell-computed" style="color:${pnlColor}">${fmtPct(pnlPct, true)}</td>
          <td class="cell-computed">${fmtKRW(h.marketValueKRW)}</td>
          <td class="cell-computed">${fmtPct(weightPct)}</td>
        </tr>`;
    })
    .join("");
}

function renderAllocationChart(p) {
  const canvas = document.getElementById("claudeAllocationChart");
  const emptyMsg = document.getElementById("claudeAllocationEmpty");
  const { equityValue, totalValue } = computeTotals(p);
  const hasData = totalValue > 0;
  canvas.style.display = hasData ? "block" : "none";
  emptyMsg.style.display = hasData ? "none" : "block";
  if (!hasData) return;

  const labels = ["현금", ...p.holdings.map(h => h.ticker)];
  const values = [p.cash, ...p.holdings.map(h => h.marketValueKRW)];
  const colors = labels.map((_, i) => cssVar(SERIES_COLORS[i % SERIES_COLORS.length]));

  if (allocationChart) allocationChart.destroy();
  allocationChart = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: cssVar("--surface-1") }] },
    options: {
      cutout: "62%",
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: cssVar("--text-secondary"), boxWidth: 10, padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const pct = (ctx.parsed / totalValue) * 100;
              return ` ${ctx.label}: ${fmtKRW(ctx.parsed)} (${pct.toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

function hexToRgba(hex, alpha) {
  const m = hex.replace("#", "");
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderValueChart(p) {
  const canvas = document.getElementById("claudeValueChart");
  if (valueChart) valueChart.destroy();
  const seriesHex = cssVar("--series-1");
  valueChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: p.valueHistory.map(v => v.date),
      datasets: [{
        data: p.valueHistory.map(v => v.totalValue),
        borderColor: seriesHex,
        backgroundColor: context => {
          const { ctx, chartArea } = context.chart;
          if (!chartArea) return "transparent";
          const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, hexToRgba(seriesHex, 0.25));
          g.addColorStop(1, hexToRgba(seriesHex, 0));
          return g;
        },
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: cssVar("--text-muted"), font: { size: 11 } } },
        y: {
          grid: { color: cssVar("--gridline") },
          ticks: { color: cssVar("--text-muted"), font: { size: 11 }, callback: v => fmtKRW(v) },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${fmtKRW(ctx.parsed.y)}` } },
      },
      interaction: { mode: "index", intersect: false },
    },
  });
}

function renderDecisionLog(p) {
  const root = document.getElementById("claudeDecisionLog");
  if (p.decisions.length === 0) {
    root.innerHTML = `<p class="hint">아직 실행된 결정이 없어요. 매월 1일 자동으로 첫 판단이 기록됩니다.</p>`;
    return;
  }

  root.innerHTML = [...p.decisions]
    .reverse()
    .map(d => {
      const tradeRows = d.trades.length
        ? d.trades
            .map(t => {
              const filled = t.status === "filled";
              const actionLabel = t.action === "buy" ? "매수" : "매도";
              const statusNote = filled
                ? ""
                : ` <span class="hint" style="margin:0;">(${t.status.replace("skipped_", "미체결: ")})</span>`;
              const targetBlock = filled && t.targetPrice != null
                ? `
                <div style="margin:2px 0 6px;">
                  <span class="status-pill status-${t.expectedUpsidePct >= 0 ? "good" : "critical"}">
                    1개월 목표가 ${t.targetPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    (${t.expectedUpsidePct >= 0 ? "+" : ""}${t.expectedUpsidePct.toFixed(1)}%, ${t.targetPriceDate}까지)
                  </span>
                </div>
                <div class="hint" style="margin:-2px 0 8px;">목표가 근거: ${t.targetPriceRationale || "(제공 안 됨)"}</div>`
                : "";
              return `
                <div class="promise-row">
                  <span style="flex:1">
                    <span class="status-pill status-${t.action === "buy" ? "good" : "critical"}">${actionLabel}</span>
                    ${t.ticker} · ${t.name} ${filled ? `${t.shares}주 @ ${t.price ? t.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-"}` : ""}${statusNote}
                  </span>
                </div>
                <div class="hint" style="margin:-4px 0 8px;">${t.rationale}</div>
                ${targetBlock}`;
            })
            .join("")
        : `<p class="hint">이번 달은 매매 없이 관망했습니다.</p>`;

      return `
        <div class="pf-decision" style="padding:16px 0; border-bottom:0.5px solid var(--gridline);">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
            <span class="badge badge-muted">${d.date}</span>
            <span class="hint" style="margin:0;">AUM ${fmtKRW(d.portfolioValueBefore)} → ${fmtKRW(d.portfolioValueAfter)}</span>
            ${d.dryRun ? '<span class="badge badge-muted">DRY RUN</span>' : ""}
          </div>
          <p style="font-size:13.5px; line-height:1.6; margin-bottom:10px;">${d.marketView}</p>
          ${tradeRows}
        </div>`;
    })
    .join("");
}

function render(p) {
  renderStats(p);
  renderHoldingsTable(p);
  renderAllocationChart(p);
  renderValueChart(p);
  renderDecisionLog(p);
}

export function initClaudeTab() {
  fetch(DATA_URL)
    .then(res => res.json())
    .then(p => {
      portfolioData = p;
      render(p);
    })
    .catch(err => {
      document.getElementById("claudeDecisionLog").innerHTML =
        `<p class="hint">포트폴리오 데이터를 불러오지 못했어요. (${err})</p>`;
    });

  document.getElementById("themeToggle").addEventListener("click", () => {
    setTimeout(() => portfolioData && render(portfolioData), 0);
  });
}
