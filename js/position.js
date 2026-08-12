const STORAGE_KEY = "igs-position-v1";

const SERIES_COLORS = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];

function defaultState() {
  return {
    baseCurrency: "KRW",
    fxRate: 1380,
    cashAmount: 0,
    cashCurrency: "KRW",
    holdings: [],
    risk: { return: 0, vol: 0, rf: 3.5 },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

function confirmCurrencyChange(prevCurrency, nextCurrency, amountLabel) {
  if (prevCurrency === nextCurrency) return true;
  return confirm(
    `${amountLabel} 통화를 ${prevCurrency} → ${nextCurrency}로 바꾸면 입력된 숫자는 그대로 유지돼요.\n` +
    `그 숫자가 ${prevCurrency} 기준 금액이었다면, 통화를 바꾸기 전에 ${nextCurrency} 기준 금액으로 직접 고쳐야 정확해요.\n` +
    `(안 그러면 환율만큼 그대로 부풀려지거나 줄어들어요.) 계속할까요?`
  );
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function toBase(amount, currency, state) {
  if (currency === state.baseCurrency) return amount;
  const fx = Number(state.fxRate) || 0;
  if (currency === "USD" && state.baseCurrency === "KRW") return amount * fx;
  if (currency === "KRW" && state.baseCurrency === "USD") return fx ? amount / fx : 0;
  return amount;
}

function fmtMoney(amount, currency) {
  const rounded = Math.round(amount);
  return `${currency === "USD" ? "$" : "₩"}${rounded.toLocaleString("en-US")}`;
}

function fmtPct(x) {
  if (!isFinite(x)) return "–";
  return `${x.toFixed(1)}%`;
}

let state = loadState();
let chart = null;

function newHoldingRow() {
  return { ticker: "", name: "", currency: state.baseCurrency, shares: 0, avgCost: 0, price: 0, beta: 1 };
}

function computeDerived() {
  const cashBase = toBase(Number(state.cashAmount) || 0, state.cashCurrency, state);
  const holdingsWithValue = state.holdings.map(h => {
    const value = (Number(h.shares) || 0) * (Number(h.price) || 0);
    const valueBase = toBase(value, h.currency, state);
    return { ...h, valueBase };
  });
  const equityBase = holdingsWithValue.reduce((s, h) => s + h.valueBase, 0);
  const totalBase = cashBase + equityBase;

  const withWeight = holdingsWithValue.map(h => ({
    ...h,
    weightPct: totalBase > 0 ? (h.valueBase / totalBase) * 100 : 0,
  }));

  const beta = equityBase > 0
    ? withWeight.reduce((s, h) => s + (Number(h.beta) || 0) * (h.valueBase / equityBase), 0)
    : NaN;

  return { cashBase, equityBase, totalBase, holdingsWithValue: withWeight, beta };
}

function renderStats(d) {
  document.getElementById("statAUM").textContent = fmtMoney(d.totalBase, state.baseCurrency);
  document.getElementById("statCashPct").textContent = d.totalBase > 0 ? fmtPct((d.cashBase / d.totalBase) * 100) : "–";
  document.getElementById("statEquityPct").textContent = d.totalBase > 0 ? fmtPct((d.equityBase / d.totalBase) * 100) : "–";
  document.getElementById("statCount").textContent = String(state.holdings.length);
}

function renderRiskPanel(d) {
  document.getElementById("statBeta").textContent = isFinite(d.beta) ? d.beta.toFixed(2) : "–";
  const ret = Number(state.risk.return) || 0;
  const vol = Number(state.risk.vol) || 0;
  const rf = Number(state.risk.rf) || 0;
  const sharpe = vol > 0 ? (ret - rf) / vol : NaN;
  document.getElementById("statSharpe").textContent = isFinite(sharpe) ? sharpe.toFixed(2) : "–";
}

function renderHoldingsTable(d) {
  const tbody = document.getElementById("holdingsBody");
  tbody.innerHTML = "";

  if (state.holdings.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="10" style="text-align:center;color:var(--text-muted);padding:18px 8px;">
      아직 보유 종목이 없어요. "+ 종목 추가"로 시작하세요.</td>`;
    tbody.appendChild(tr);
    return;
  }

  state.holdings.forEach((h, i) => {
    const computed = d.holdingsWithValue[i];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input data-field="ticker" data-i="${i}" value="${h.ticker}" placeholder="AAPL" title="${h.ticker}"></td>
      <td><input data-field="name" data-i="${i}" value="${h.name}" placeholder="Apple" title="${h.name}"></td>
      <td>
        <select data-field="currency" data-i="${i}">
          <option value="KRW" ${h.currency === "KRW" ? "selected" : ""}>KRW</option>
          <option value="USD" ${h.currency === "USD" ? "selected" : ""}>USD</option>
        </select>
      </td>
      <td><input class="cell-num" type="number" data-field="shares" data-i="${i}" value="${h.shares}" step="1"></td>
      <td><input class="cell-num" type="number" data-field="avgCost" data-i="${i}" value="${h.avgCost}" step="0.01"></td>
      <td><input class="cell-num" type="number" data-field="price" data-i="${i}" value="${h.price}" step="0.01"></td>
      <td><input class="cell-num" type="number" data-field="beta" data-i="${i}" value="${h.beta}" step="0.05"></td>
      <td class="cell-computed">${fmtMoney(computed.valueBase, state.baseCurrency)}</td>
      <td class="cell-computed">${fmtPct(computed.weightPct)}</td>
      <td><button class="row-remove-btn" data-remove="${i}" title="삭제">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("input", onHoldingFieldChange);
  });
  tbody.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.holdings.splice(Number(btn.dataset.remove), 1);
      persistAndRender();
    });
  });
}

function renderChart(d) {
  const canvas = document.getElementById("allocationChart");
  const emptyMsg = document.getElementById("allocationEmpty");
  const hasData = d.totalBase > 0;
  canvas.style.display = hasData ? "block" : "none";
  emptyMsg.style.display = hasData ? "none" : "block";
  if (!hasData) return;

  const labels = ["현금", ...d.holdingsWithValue.map(h => h.ticker || "?")];
  const values = [d.cashBase, ...d.holdingsWithValue.map(h => h.valueBase)];
  const colors = labels.map((_, i) => cssVar(SERIES_COLORS[i % SERIES_COLORS.length]));

  if (chart) chart.destroy();
  chart = new Chart(canvas, {
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
              const pct = (ctx.parsed / d.totalBase) * 100;
              return ` ${ctx.label}: ${fmtMoney(ctx.parsed, state.baseCurrency)} (${pct.toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

function render() {
  const d = computeDerived();
  renderStats(d);
  renderHoldingsTable(d);
  renderChart(d);
  renderRiskPanel(d);
}

function persistAndRender() {
  saveState(state);
  render();
}

function onHoldingFieldChange(e) {
  const i = Number(e.target.dataset.i);
  const field = e.target.dataset.field;

  if (field === "currency") {
    const prevCurrency = state.holdings[i].currency;
    const nextCurrency = e.target.value;
    if (!confirmCurrencyChange(prevCurrency, nextCurrency, "이 종목의 평단/현재가")) {
      e.target.value = prevCurrency;
      return;
    }
  }

  const isNumeric = ["shares", "avgCost", "price", "beta"].includes(field);
  state.holdings[i][field] = isNumeric ? Number(e.target.value) : e.target.value;
  if (field === "ticker" || field === "name") e.target.title = e.target.value;
  saveState(state);
  const d = computeDerived();
  renderStats(d);
  renderChart(d);
  renderRiskPanel(d);
  // avoid full table re-render on every keystroke to keep input focus
  const row = document.querySelectorAll("#holdingsBody tr")[i];
  if (row) {
    row.children[7].textContent = fmtMoney(d.holdingsWithValue[i].valueBase, state.baseCurrency);
    row.children[8].textContent = fmtPct(d.holdingsWithValue[i].weightPct);
  }
}

export function initPosition() {
  document.getElementById("baseCurrency").value = state.baseCurrency;
  document.getElementById("fxRate").value = state.fxRate;
  document.getElementById("cashAmount").value = state.cashAmount;
  document.getElementById("cashCurrency").value = state.cashCurrency;
  document.getElementById("inputReturn").value = state.risk.return;
  document.getElementById("inputVol").value = state.risk.vol;
  document.getElementById("inputRf").value = state.risk.rf;

  document.getElementById("baseCurrency").addEventListener("change", e => {
    const prev = state.baseCurrency;
    const next = e.target.value;
    if (prev !== next) {
      const ok = confirm(
        `기준통화를 ${prev} → ${next}로 바꾸면, 지금 ${prev}로 입력된 현금/종목들이 전부 실제로는 ${next} 금액인 것처럼 환율로 재계산돼요.\n` +
        `개별 종목/현금 통화와 금액을 먼저 맞는 값으로 고쳐놓지 않았다면 Total AUM이 크게 틀어질 수 있어요. 계속할까요?`
      );
      if (!ok) {
        e.target.value = prev;
        return;
      }
    }
    state.baseCurrency = next;
    persistAndRender();
  });
  document.getElementById("fxRate").addEventListener("input", e => {
    state.fxRate = Number(e.target.value);
    persistAndRender();
  });
  document.getElementById("cashAmount").addEventListener("input", e => {
    state.cashAmount = Number(e.target.value);
    persistAndRender();
  });
  document.getElementById("cashCurrency").addEventListener("change", e => {
    const prev = state.cashCurrency;
    const next = e.target.value;
    if (!confirmCurrencyChange(prev, next, "현금 보유액")) {
      e.target.value = prev;
      return;
    }
    state.cashCurrency = next;
    persistAndRender();
  });
  document.getElementById("addHoldingBtn").addEventListener("click", () => {
    state.holdings.push(newHoldingRow());
    persistAndRender();
  });
  ["inputReturn", "inputVol", "inputRf"].forEach(id => {
    document.getElementById(id).addEventListener("input", e => {
      const key = { inputReturn: "return", inputVol: "vol", inputRf: "rf" }[id];
      state.risk[key] = Number(e.target.value);
      saveState(state);
      renderRiskPanel(computeDerived());
    });
  });

  // theme toggle repaints chart colors
  document.getElementById("themeToggle").addEventListener("click", () => {
    setTimeout(() => renderChart(computeDerived()), 0);
  });

  initImportModal();
  render();
}

function initImportModal() {
  const modal = document.getElementById("importModal");
  const textarea = document.getElementById("importTextarea");

  document.getElementById("importBtn").addEventListener("click", () => {
    textarea.value = "";
    modal.hidden = false;
    textarea.focus();
  });
  document.getElementById("importCancelBtn").addEventListener("click", () => {
    modal.hidden = true;
  });
  modal.addEventListener("click", e => {
    if (e.target === modal) modal.hidden = true;
  });
  document.getElementById("importApplyBtn").addEventListener("click", () => {
    let parsed;
    try {
      parsed = JSON.parse(textarea.value);
    } catch (err) {
      alert("JSON을 읽을 수 없어요: " + err.message);
      return;
    }
    state = { ...defaultState(), ...parsed };
    modal.hidden = true;
    document.getElementById("baseCurrency").value = state.baseCurrency;
    document.getElementById("fxRate").value = state.fxRate;
    document.getElementById("cashAmount").value = state.cashAmount;
    document.getElementById("cashCurrency").value = state.cashCurrency;
    document.getElementById("inputReturn").value = state.risk.return;
    document.getElementById("inputVol").value = state.risk.vol;
    document.getElementById("inputRf").value = state.risk.rf;
    persistAndRender();
  });
}
