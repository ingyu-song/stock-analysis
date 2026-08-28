const STORAGE_KEY = "igs-position-v1";
const PORTFOLIO_URL = "data/my-portfolio.json";

const SERIES_COLORS = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];

function uid() {
  return "acct-" + Math.random().toString(36).slice(2, 8);
}

function defaultAccounts() {
  return [
    { id: "kiwoom", name: "키움", cash: 0 },
    { id: "mirae", name: "미래에셋", cash: 0 },
  ];
}

function defaultState() {
  return {
    baseCurrency: "KRW",
    fxRate: 1380,
    fxRateEUR: 1634,
    accounts: defaultAccounts(),
    holdings: [],
    scope: "all",
    risk: { return: 0, vol: 0, rf: 3.5 },
  };
}

// Normalises anything we load (old localStorage shapes, pasted JSON) into the
// current account-aware shape, so a v1 state never renders as an empty book.
function migrate(raw) {
  const st = { ...defaultState(), ...(raw || {}), baseCurrency: "KRW" };

  if (!Array.isArray(st.accounts) || st.accounts.length === 0) st.accounts = defaultAccounts();
  st.accounts = st.accounts.map((a, i) => ({
    id: a.id || uid(),
    name: a.name || `계좌 ${i + 1}`,
    cash: Number(a.cash) || 0,
  }));

  // v1 kept one top-level cash figure; fold it into the first account, but only
  // if no account carries cash yet, so a re-import can't double-count it.
  if (raw && raw.cashAmount != null && st.accounts.every(a => a.cash === 0)) {
    st.accounts[0].cash = Number(raw.cashAmount) || 0;
  }
  delete st.cashAmount;

  const ids = new Set(st.accounts.map(a => a.id));
  st.holdings = (Array.isArray(st.holdings) ? st.holdings : []).map(h => {
    const { beta, ...rest } = h; // beta was dropped from the model
    return { ...rest, account: ids.has(h.account) ? h.account : st.accounts[0].id };
  });

  if (st.scope !== "all" && !ids.has(st.scope)) st.scope = "all";
  return st;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    // baseCurrency is fixed to KRW — never trust a stored/imported value here,
    // so a stale currency selection can never leave AUM stuck in USD.
    return migrate(JSON.parse(raw));
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

async function fetchPortfolio() {
  try {
    const res = await fetch(PORTFOLIO_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // offline, or opened as a file:// page — fall back to whatever is stored
    return null;
  }
}

// The repo file is the source of truth: whenever it carries an updatedAt we
// have not seeded from yet, it replaces local state. Between updates the
// user's own edits survive, so tweaking a price here is not wiped on reload.
function seedFromPortfolio(remote) {
  if (!remote || !remote.updatedAt) return false;
  if (state.seededFrom === remote.updatedAt) return false;
  state = migrate({ ...remote, seededFrom: remote.updatedAt });
  saveState(state);
  return true;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// baseCurrency is always KRW, so this only ever converts currency -> KRW.
function toBase(amount, currency, state) {
  if (currency === "KRW") return amount;
  if (currency === "USD") return amount * (Number(state.fxRate) || 0);
  if (currency === "EUR") return amount * (Number(state.fxRateEUR) || 0);
  return amount;
}

function fmtMoney(amount, currency) {
  const rounded = Math.round(amount);
  return `${currency === "USD" ? "$" : "₩"}${rounded.toLocaleString("en-US")}`;
}

function fmtSignedMoney(amount) {
  const rounded = Math.round(amount);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}₩${Math.abs(rounded).toLocaleString("en-US")}`;
}

function fmtPct(x) {
  if (!isFinite(x)) return "–";
  return `${x.toFixed(1)}%`;
}

function fmtSignedPct(x) {
  if (!isFinite(x)) return "–";
  return `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;
}

function pnlClass(x) {
  if (!isFinite(x) || Math.round(x) === 0) return "";
  return x > 0 ? "num-gain" : "num-loss";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

let state = loadState();
let chart = null;

function newHoldingRow() {
  const account = state.scope === "all" ? state.accounts[0].id : state.scope;
  return { account, ticker: "", name: "", currency: "KRW", shares: 0, avgCost: 0, price: 0 };
}

function accountName(id) {
  const a = state.accounts.find(x => x.id === id);
  return a ? a.name : "–";
}

function scopeLabel() {
  return state.scope === "all" ? "전체" : accountName(state.scope);
}

function aggregate(list, cashBase) {
  const equityBase = list.reduce((s, h) => s + h.valueBase, 0);
  const costBase = list.reduce((s, h) => s + h.costBase, 0);
  const pnlBase = equityBase - costBase;
  return {
    cashBase,
    equityBase,
    costBase,
    pnlBase,
    pnlPct: costBase > 0 ? (pnlBase / costBase) * 100 : NaN,
    totalBase: cashBase + equityBase,
    count: list.length,
  };
}

function computeDerived() {
  const enriched = state.holdings.map((h, i) => {
    const shares = Number(h.shares) || 0;
    const valueBase = toBase(shares * (Number(h.price) || 0), h.currency, state);
    const costBase = toBase(shares * (Number(h.avgCost) || 0), h.currency, state);
    return { ...h, i, valueBase, costBase, pnlBase: valueBase - costBase };
  });

  const totalCash = state.accounts.reduce((s, a) => s + (Number(a.cash) || 0), 0);
  const all = aggregate(enriched, totalCash);

  const perAccount = state.accounts.map(a => ({
    id: a.id,
    name: a.name,
    ...aggregate(enriched.filter(h => h.account === a.id), Number(a.cash) || 0),
  })).map(a => ({
    ...a,
    sharePct: all.totalBase > 0 ? (a.totalBase / all.totalBase) * 100 : 0,
  }));

  const inScope = state.scope === "all" ? enriched : enriched.filter(h => h.account === state.scope);
  const scopeCash = state.scope === "all"
    ? totalCash
    : Number((state.accounts.find(a => a.id === state.scope) || {}).cash) || 0;
  const scoped = aggregate(inScope, scopeCash);

  const rows = inScope.map(h => ({
    ...h,
    weightPct: scoped.totalBase > 0 ? (h.valueBase / scoped.totalBase) * 100 : 0,
  }));

  return { enriched, perAccount, all, scoped, rows };
}

function renderScopeBar() {
  const bar = document.getElementById("scopeBar");
  const scopes = [{ id: "all", name: "전체" }, ...state.accounts];
  bar.innerHTML = scopes.map(s => `
    <button class="scope-btn ${state.scope === s.id ? "is-active" : ""}"
            data-scope="${escapeHtml(s.id)}"
            aria-pressed="${state.scope === s.id}">${escapeHtml(s.name)}</button>
  `).join("");

  bar.querySelectorAll("[data-scope]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.scope = btn.dataset.scope;
      persistAndRender();
    });
  });
}

function renderStats(d) {
  document.getElementById("statAUMLabel").textContent =
    state.scope === "all" ? "Total AUM · 전체" : `AUM · ${scopeLabel()}`;
  document.getElementById("statAUM").textContent = fmtMoney(d.scoped.totalBase, state.baseCurrency);

  const pnlEl = document.getElementById("statPnl");
  pnlEl.textContent = d.scoped.costBase > 0
    ? `${fmtSignedMoney(d.scoped.pnlBase)} (${fmtSignedPct(d.scoped.pnlPct)})`
    : "–";
  pnlEl.className = `stat-value ${pnlClass(d.scoped.pnlBase)}`;

  document.getElementById("statCashPct").textContent =
    d.scoped.totalBase > 0 ? fmtPct((d.scoped.cashBase / d.scoped.totalBase) * 100) : "–";
  document.getElementById("statCount").textContent = String(d.scoped.count);
}

function accountCardHtml(a, colorVar, isTotal) {
  return `
    <div class="acct-card ${isTotal ? "is-total" : ""}">
      <div class="acct-head">
        <span class="acct-name">${escapeHtml(a.name)}</span>
        <span class="acct-share">${isTotal ? `${a.count}종목` : fmtPct(a.sharePct)}</span>
      </div>
      <span class="acct-total">${fmtMoney(a.totalBase, "KRW")}</span>
      <div class="acct-bar"><span style="width:${Math.min(100, isTotal ? 100 : a.sharePct).toFixed(1)}%;background:${colorVar}"></span></div>
      <div class="acct-rows">
        <div class="acct-row"><span>평가금액</span><span>${fmtMoney(a.equityBase, "KRW")}</span></div>
        <div class="acct-row"><span>예수금</span><span>${fmtMoney(a.cashBase, "KRW")}</span></div>
        <div class="acct-row"><span>매입금액</span><span>${fmtMoney(a.costBase, "KRW")}</span></div>
        <div class="acct-row">
          <span>평가손익</span>
          <span class="${pnlClass(a.pnlBase)}">${a.costBase > 0 ? `${fmtSignedMoney(a.pnlBase)} (${fmtSignedPct(a.pnlPct)})` : "–"}</span>
        </div>
        <div class="acct-row"><span>현금 비중</span><span>${a.totalBase > 0 ? fmtPct((a.cashBase / a.totalBase) * 100) : "–"}</span></div>
      </div>
    </div>
  `;
}

function renderUpdatedAt() {
  const el = document.getElementById("dataUpdatedAt");
  el.textContent = state.updatedAt ? `${state.updatedAt} 기준` : "전체 + 계좌별";
  el.title = state.source || "";
}

function renderAccountCards(d) {
  const grid = document.getElementById("acctGrid");
  const total = { ...d.all, name: "전체", sharePct: 100 };
  grid.innerHTML =
    accountCardHtml(total, cssVar("--text-secondary"), true) +
    d.perAccount.map((a, i) =>
      accountCardHtml(a, cssVar(SERIES_COLORS[i % SERIES_COLORS.length]), false)
    ).join("");
}

function renderAccountFields() {
  const wrap = document.getElementById("accountFields");
  wrap.innerHTML = state.accounts.map((a, i) => `
    <div class="inline-field grow" style="flex-direction:row; gap:8px; align-items:flex-end;">
      <label class="inline-field" style="flex:1;">
        계좌명
        <input data-acct-field="name" data-acct="${i}" value="${escapeHtml(a.name)}" placeholder="계좌 이름">
      </label>
      <label class="inline-field" style="flex:1;">
        예수금 (KRW)
        <input class="cell-num" type="number" data-acct-field="cash" data-acct="${i}" value="${a.cash}" step="10000">
      </label>
      <button class="row-remove-btn" data-acct-remove="${i}" title="계좌 삭제"
              ${state.accounts.length <= 1 ? "disabled" : ""}>✕</button>
    </div>
  `).join("");

  wrap.querySelectorAll("[data-acct-field]").forEach(el => {
    el.addEventListener("input", onAccountFieldChange);
  });
  wrap.querySelectorAll("[data-acct-remove]").forEach(btn => {
    btn.addEventListener("click", () => removeAccount(Number(btn.dataset.acctRemove)));
  });
}

function removeAccount(idx) {
  if (state.accounts.length <= 1) return;
  const acct = state.accounts[idx];
  const held = state.holdings.filter(h => h.account === acct.id).length;
  const fallback = state.accounts[idx === 0 ? 1 : 0];
  const msg = held > 0
    ? `"${acct.name}" 계좌를 삭제하면 이 계좌의 종목 ${held}개가 "${fallback.name}"으로 옮겨지고, 예수금은 사라져요. 계속할까요?`
    : `"${acct.name}" 계좌를 삭제할까요? 예수금은 사라져요.`;
  if (!confirm(msg)) return;

  state.holdings.forEach(h => { if (h.account === acct.id) h.account = fallback.id; });
  state.accounts.splice(idx, 1);
  if (state.scope === acct.id) state.scope = "all";
  persistAndRender();
}

function onAccountFieldChange(e) {
  const i = Number(e.target.dataset.acct);
  const field = e.target.dataset.acctField;
  state.accounts[i][field] = field === "cash" ? Number(e.target.value) : e.target.value;
  saveState(state);

  // re-render everything except the account fields themselves, so the input
  // the user is typing into keeps focus
  const d = computeDerived();
  renderScopeBar();
  renderStats(d);
  renderAccountCards(d);
  renderHoldingsTable(d);
  renderChart(d);
  renderRiskPanel();
}

function renderHoldingsTable(d) {
  const tbody = document.getElementById("holdingsBody");
  tbody.innerHTML = "";

  if (d.rows.length === 0) {
    const tr = document.createElement("tr");
    const msg = state.holdings.length === 0
      ? `아직 보유 종목이 없어요. "+ 종목 추가"로 시작하세요.`
      : `"${escapeHtml(scopeLabel())}" 계좌에는 보유 종목이 없어요.`;
    tr.innerHTML = `<td colspan="11" style="text-align:center;color:var(--text-muted);padding:18px 8px;">${msg}</td>`;
    tbody.appendChild(tr);
    return;
  }

  const acctOptions = h => state.accounts.map(a =>
    `<option value="${escapeHtml(a.id)}" ${h.account === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`
  ).join("");

  d.rows.forEach(row => {
    const i = row.i;
    const h = state.holdings[i];
    const tr = document.createElement("tr");
    tr.dataset.rowI = String(i);
    tr.innerHTML = `
      <td>
        <select data-field="account" data-i="${i}">${acctOptions(h)}</select>
      </td>
      <td><input data-field="ticker" data-i="${i}" value="${escapeHtml(h.ticker)}" placeholder="AAPL" title="${escapeHtml(h.ticker)}"></td>
      <td><input data-field="name" data-i="${i}" value="${escapeHtml(h.name)}" placeholder="Apple" title="${escapeHtml(h.name)}"></td>
      <td>
        <select data-field="currency" data-i="${i}">
          <option value="KRW" ${h.currency === "KRW" ? "selected" : ""}>KRW</option>
          <option value="USD" ${h.currency === "USD" ? "selected" : ""}>USD</option>
          <option value="EUR" ${h.currency === "EUR" ? "selected" : ""}>EUR</option>
        </select>
      </td>
      <td><input class="cell-num" type="number" data-field="shares" data-i="${i}" value="${h.shares}" step="1"></td>
      <td><input class="cell-num" type="number" data-field="avgCost" data-i="${i}" value="${h.avgCost}" step="0.01"></td>
      <td><input class="cell-num" type="number" data-field="price" data-i="${i}" value="${h.price}" step="0.01"></td>
      <td class="cell-computed">${fmtMoney(row.valueBase, state.baseCurrency)}</td>
      <td class="cell-computed ${pnlClass(row.pnlBase)}">${row.costBase > 0 ? fmtSignedMoney(row.pnlBase) : "–"}</td>
      <td class="cell-computed">${fmtPct(row.weightPct)}</td>
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
  const hasData = d.scoped.totalBase > 0;
  canvas.style.display = hasData ? "block" : "none";
  emptyMsg.style.display = hasData ? "none" : "block";
  if (!hasData) return;

  const labels = ["현금", ...d.rows.map(h => h.ticker || h.name || "?")];
  const values = [d.scoped.cashBase, ...d.rows.map(h => h.valueBase)];
  const owners = ["", ...d.rows.map(h => accountName(h.account))];
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
              const pct = (ctx.parsed / d.scoped.totalBase) * 100;
              const owner = state.scope === "all" && owners[ctx.dataIndex] ? ` · ${owners[ctx.dataIndex]}` : "";
              return ` ${ctx.label}${owner}: ${fmtMoney(ctx.parsed, state.baseCurrency)} (${pct.toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

function renderRiskPanel() {
  const ret = Number(state.risk.return) || 0;
  const vol = Number(state.risk.vol) || 0;
  const rf = Number(state.risk.rf) || 0;
  const sharpe = vol > 0 ? (ret - rf) / vol : NaN;
  document.getElementById("statSharpe").textContent = isFinite(sharpe) ? sharpe.toFixed(2) : "–";
}

function render() {
  const d = computeDerived();
  renderUpdatedAt();
  renderScopeBar();
  renderStats(d);
  renderAccountCards(d);
  renderAccountFields();
  renderHoldingsTable(d);
  renderChart(d);
  renderRiskPanel();
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

  // moving a holding to another account changes which rows belong in view,
  // so that one needs a full re-render
  if (field === "account") {
    state.holdings[i].account = e.target.value;
    persistAndRender();
    return;
  }

  const isNumeric = ["shares", "avgCost", "price"].includes(field);
  state.holdings[i][field] = isNumeric ? Number(e.target.value) : e.target.value;
  if (field === "ticker" || field === "name") e.target.title = e.target.value;
  saveState(state);

  const d = computeDerived();
  renderStats(d);
  renderAccountCards(d);
  renderChart(d);
  renderRiskPanel();

  // avoid a full table re-render on every keystroke to keep input focus, but
  // still refresh every row — one edit moves every other row's weight too
  d.rows.forEach(row => {
    const tr = document.querySelector(`#holdingsBody tr[data-row-i="${row.i}"]`);
    if (!tr) return;
    tr.children[7].textContent = fmtMoney(row.valueBase, state.baseCurrency);
    tr.children[8].textContent = row.costBase > 0 ? fmtSignedMoney(row.pnlBase) : "–";
    tr.children[8].className = `cell-computed ${pnlClass(row.pnlBase)}`;
    tr.children[9].textContent = fmtPct(row.weightPct);
  });
}

function syncTopLevelInputs() {
  document.getElementById("fxRate").value = state.fxRate;
  document.getElementById("fxRateEUR").value = state.fxRateEUR;
  document.getElementById("inputReturn").value = state.risk.return;
  document.getElementById("inputVol").value = state.risk.vol;
  document.getElementById("inputRf").value = state.risk.rf;
}

export async function initPosition() {
  seedFromPortfolio(await fetchPortfolio());
  syncTopLevelInputs();

  document.getElementById("fxRate").addEventListener("input", e => {
    state.fxRate = Number(e.target.value);
    saveState(state);
    const d = computeDerived();
    renderStats(d);
    renderAccountCards(d);
    renderHoldingsTable(d);
    renderChart(d);
    renderRiskPanel();
  });
  document.getElementById("fxRateEUR").addEventListener("input", e => {
    state.fxRateEUR = Number(e.target.value);
    saveState(state);
    const d = computeDerived();
    renderStats(d);
    renderAccountCards(d);
    renderHoldingsTable(d);
    renderChart(d);
    renderRiskPanel();
  });
  document.getElementById("addAccountBtn").addEventListener("click", () => {
    state.accounts.push({ id: uid(), name: `계좌 ${state.accounts.length + 1}`, cash: 0 });
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
      renderRiskPanel();
    });
  });

  // theme toggle repaints chart + account bar colors
  document.getElementById("themeToggle").addEventListener("click", () => {
    setTimeout(() => {
      const d = computeDerived();
      renderChart(d);
      renderAccountCards(d);
    }, 0);
  });

  initImportModal();
  render();
}

function initImportModal() {
  const modal = document.getElementById("importModal");
  const textarea = document.getElementById("importTextarea");

  const title = document.getElementById("importModalTitle");
  const hint = document.getElementById("importModalHint");

  document.getElementById("importBtn").addEventListener("click", () => {
    title.textContent = "포지션 JSON 가져오기";
    hint.textContent = "아래에 JSON을 붙여넣고 적용하세요. 이 브라우저의 localStorage에만 저장되고 레포에는 올라가지 않습니다.";
    textarea.value = "";
    modal.hidden = false;
    textarea.focus();
  });

  // localStorage is per-origin, so localhost and github.io each keep their own
  // copy — exporting is how a book moves between them (and between devices)
  document.getElementById("exportBtn").addEventListener("click", () => {
    title.textContent = "포지션 JSON 내보내기";
    hint.textContent = "이 JSON을 복사해서, 보려는 주소·기기에서 \"JSON 가져오기\"에 붙여넣으면 그대로 옮겨져요.";
    textarea.value = JSON.stringify(state, null, 2);
    modal.hidden = false;
    textarea.focus();
    textarea.select();
  });

  document.getElementById("copyJsonBtn").addEventListener("click", async () => {
    const btn = document.getElementById("copyJsonBtn");
    textarea.select();
    try {
      await navigator.clipboard.writeText(textarea.value);
      btn.textContent = "복사됨";
    } catch {
      // clipboard blocked (insecure origin, permission) — the text is selected,
      // so fall back to telling the user to copy it themselves
      btn.textContent = "Cmd/Ctrl+C";
    }
    setTimeout(() => { btn.textContent = "복사"; }, 1800);
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
    // keep whatever seededFrom the import carries so a hand-pasted book is not
    // immediately overwritten by the repo file on the next load
    state = migrate({ seededFrom: state.seededFrom, ...parsed });
    modal.hidden = true;
    syncTopLevelInputs();
    persistAndRender();
  });
}
