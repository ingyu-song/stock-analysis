const STORAGE_KEY = "igs-position-v1";
const PORTFOLIO_URL = "data/my-portfolio.json";

const CURRENCIES = ["KRW", "USD", "EUR"];

const SERIES_COLORS = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];

function uid() {
  return "acct-" + Math.random().toString(36).slice(2, 8);
}

function defaultAccounts() {
  return [
    { id: "kiwoom", name: "키움", cash: { KRW: 0 } },
    { id: "mirae", name: "미래에셋", cash: { KRW: 0 } },
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
    cash: normaliseCash(a.cash),
  }));

  // v1 kept one top-level cash figure; fold it into the first account, but only
  // if no account carries cash yet, so a re-import can't double-count it.
  if (raw && raw.cashAmount != null && st.accounts.every(a => cashTotal(a.cash, st) === 0)) {
    st.accounts[0].cash.KRW = Number(raw.cashAmount) || 0;
  }
  delete st.cashAmount;

  const ids = new Set(st.accounts.map(a => a.id));
  st.holdings = (Array.isArray(st.holdings) ? st.holdings : []).map(h => {
    const { beta, avgCost, ...rest } = h;
    const shares = Number(h.shares) || 0;
    // avgCost was per-share in the holding's currency; the fixed KRW basis the
    // brokerage reports is what survives an FX move, so convert once and keep it
    const currency = CURRENCIES.includes(h.currency) ? h.currency : "KRW";
    const costKRW = h.costKRW != null
      ? Number(h.costKRW) || 0
      : toBase(shares * (Number(avgCost) || 0), currency, st);
    // No native figure stored yet: back it out at today's rate. That is only an
    // estimate of what was paid, which is exactly why 평단 stays editable.
    const rate = fxOf(currency, st);
    const costNative = h.costNative != null
      ? Number(h.costNative) || 0
      : (rate ? costKRW / rate : 0);
    return {
      ...rest,
      currency,
      costKRW,
      costNative,
      account: ids.has(h.account) ? h.account : st.accounts[0].id,
    };
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

// What counts as "the book" for change detection — view state (scope) and
// bookkeeping (seededFrom) are deliberately excluded.
function bookFingerprint(st) {
  return JSON.stringify({
    accounts: st.accounts,
    holdings: st.holdings,
    fxRate: st.fxRate,
    fxRateEUR: st.fxRateEUR,
    risk: st.risk,
  });
}

function hasUnpublishedChanges() {
  if (!state.publishedBook) return false;
  return bookFingerprint(state) !== state.publishedBook;
}

function publishTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Every publish gets a fresh minute-precision updatedAt: two updates on the
// same day must still look different, or browsers already holding the first
// one would never pick up the second.
function buildPublishPayload() {
  const payload = {
    updatedAt: publishTimestamp(),
    ...(state.source ? { source: state.source } : {}),
    baseCurrency: "KRW",
    fxRate: state.fxRate,
    fxRateEUR: state.fxRateEUR,
    accounts: state.accounts,
    holdings: state.holdings,
    risk: state.risk,
  };
  return JSON.stringify(payload, null, 2) + "\n";
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

  const incoming = migrate({ ...remote, seededFrom: remote.updatedAt });

  // The nightly price refresh lands as a new updatedAt every day, so a plain
  // overwrite would quietly bin any edit this browser has not published yet.
  // Prices and FX belong to the refresh; shares, cost, cash and account names
  // belong to the user — keep theirs and take only the marks.
  if (hasUnpublishedChanges()) {
    const fresh = new Map(incoming.holdings.map(h => [`${h.account}|${h.ticker}`, h]));
    state.holdings = state.holdings.map(h => {
      const match = fresh.get(`${h.account}|${h.ticker}`);
      return match ? { ...h, currency: match.currency, price: match.price } : h;
    });
    state.fxRate = incoming.fxRate;
    state.fxRateEUR = incoming.fxRateEUR;
    state.updatedAt = incoming.updatedAt;
    state.source = incoming.source;
    state.seededFrom = incoming.seededFrom;
    // Baseline against what the site now holds, not the older snapshot: once the
    // user commits their edits the two agree and the change flag clears itself.
    state.publishedBook = bookFingerprint(incoming);
    saveState(state);
    return true;
  }

  state = incoming;
  state.publishedBook = bookFingerprint(state);
  saveState(state);
  return true;
}

// Pages caches index.html and js/ separately, so a returning visitor can get a
// stale page with fresh script — every lookup here tolerates a missing node.
function setText(el, text) { if (el) el.textContent = text; }
function on(id, event, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, fn);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function normaliseCash(cash) {
  // a bare number is the pre-map shape and was always KRW
  if (typeof cash === "number") return { KRW: cash };
  const out = {};
  CURRENCIES.forEach(c => {
    const v = Number((cash || {})[c]);
    if (isFinite(v) && v !== 0) out[c] = v;
  });
  if (!Object.keys(out).length) out.KRW = 0;
  return out;
}

// "$5,585.93 · €11.25" — the balances a daily FX move actually revalues
function foreignCashNote(cash) {
  const symbols = { USD: "$", EUR: "€" };
  return Object.entries(normaliseCash(cash))
    .filter(([cur, amt]) => cur !== "KRW" && Number(amt))
    .map(([cur, amt]) => `${symbols[cur] || cur}${Number(amt).toLocaleString("en-US")}`)
    .join(" · ");
}

function cashTotal(cash, st) {
  return Object.entries(normaliseCash(cash))
    .reduce((sum, [cur, amt]) => sum + toBase(Number(amt) || 0, cur, st), 0);
}

function fxOf(currency, st) {
  if (currency === "USD") return Number(st.fxRate) || 0;
  if (currency === "EUR") return Number(st.fxRateEUR) || 0;
  return 1;
}

// baseCurrency is always KRW, so this only ever converts currency -> KRW.
function toBase(amount, currency, state) {
  return amount * fxOf(currency, state);
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
  return { account, ticker: "", name: "", currency: "KRW", shares: 0, price: 0, costKRW: 0, costNative: 0 };
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
    const costBase = Number(h.costKRW) || 0;
    return { ...h, i, valueBase, costBase, pnlBase: valueBase - costBase };
  });

  const totalCash = state.accounts.reduce((s, a) => s + cashTotal(a.cash, state), 0);
  const all = aggregate(enriched, totalCash);

  const perAccount = state.accounts.map(a => ({
    id: a.id,
    name: a.name,
    cashNote: foreignCashNote(a.cash),
    ...aggregate(enriched.filter(h => h.account === a.id), cashTotal(a.cash, state)),
  })).map(a => ({
    ...a,
    sharePct: all.totalBase > 0 ? (a.totalBase / all.totalBase) * 100 : 0,
  }));

  const inScope = state.scope === "all" ? enriched : enriched.filter(h => h.account === state.scope);
  const scopeCash = state.scope === "all"
    ? totalCash
    : cashTotal((state.accounts.find(a => a.id === state.scope) || {}).cash, state);
  const scoped = aggregate(inScope, scopeCash);

  const rows = inScope.map(h => ({
    ...h,
    costPerShare: Number(h.shares) ? (Number(h.costNative) || 0) / Number(h.shares) : 0,
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
        <div class="acct-row">
          <span>예수금${a.cashNote ? ` <em class="acct-fx">${a.cashNote}</em>` : ""}</span>
          <span>${fmtMoney(a.cashBase, "KRW")}</span>
        </div>
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
  // Pages caches index.html and js/ separately, so a returning visitor can get
  // a stale page with fresh script — never let a missing node kill the render
  const el = document.getElementById("dataUpdatedAt");
  if (!el) return;
  el.textContent = state.updatedAt ? `${state.updatedAt} 기준` : "전체 + 계좌별";
  el.title = state.source || "";
}

function renderPublishState() {
  const btn = document.getElementById("publishBtn");
  if (!btn) return;
  const dirty = hasUnpublishedChanges();
  btn.classList.toggle("has-changes", dirty);
  setText(
    document.getElementById("publishStatus"),
    dirty
      ? "이 브라우저에만 있는 변경이 있어요"
      : state.updatedAt ? `사이트 반영본과 같음 · ${state.updatedAt}` : ""
  );
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
    <div class="acct-field-row">
      <label class="inline-field" style="flex:1;">
        계좌명
        <input data-acct-field="name" data-acct="${i}" value="${escapeHtml(a.name)}" placeholder="계좌 이름">
      </label>
      ${CURRENCIES.map(cur => `
        <label class="inline-field" style="flex:${cur === "KRW" ? 1.4 : 1};">
          예수금 ${cur}
          <input class="cell-num" type="number" data-acct-field="cash" data-acct="${i}"
                 data-acct-cur="${cur}" value="${Number(a.cash[cur]) || 0}"
                 step="${cur === "KRW" ? 10000 : 0.01}">
        </label>
      `).join("")}
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
  if (field === "cash") {
    const cur = e.target.dataset.acctCur;
    state.accounts[i].cash = { ...state.accounts[i].cash, [cur]: Number(e.target.value) || 0 };
  } else {
    state.accounts[i][field] = e.target.value;
  }
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
  renderPublishState();
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
      <td><input class="cell-num" type="number" data-field="costPerShare" data-i="${i}"
                 value="${h.currency === "KRW" ? Math.round(row.costPerShare) : row.costPerShare.toFixed(2)}"
                 step="${h.currency === "KRW" ? 1 : 0.01}" title="${h.currency} 기준 평균 매입단가"></td>
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
  renderPublishState();
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

  // the table edits a per-share figure but the model stores the total basis
  if (field === "costPerShare") {
    const h = state.holdings[i];
    // Only the native figure moves. costKRW is what the brokerage actually
    // recorded at the exchange rate on each purchase day, and correcting a
    // 평단 estimate is no reason to overwrite it — for a KRW listing the two
    // are the same number, so there it has to follow.
    h.costNative = (Number(e.target.value) || 0) * (Number(h.shares) || 0);
    if (h.currency === "KRW") h.costKRW = Math.round(h.costNative);
    saveState(state);
    refreshAfterEdit();
    return;
  }

  const isNumeric = ["shares", "price", "costKRW"].includes(field);
  state.holdings[i][field] = isNumeric ? Number(e.target.value) : e.target.value;
  if (field === "ticker" || field === "name") e.target.title = e.target.value;
  saveState(state);

  refreshAfterEdit();
}

// Repaint everything a single cell edit can move, without rebuilding the table
// — rebuilding it mid-keystroke would steal focus from the input being typed in.
function refreshAfterEdit() {
  const d = computeDerived();
  renderStats(d);
  renderAccountCards(d);
  renderChart(d);
  renderRiskPanel();
  renderPublishState();

  // every row, not just the edited one: one edit moves every other row's weight
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
    state.accounts.push({ id: uid(), name: `계좌 ${state.accounts.length + 1}`, cash: { KRW: 0 } });
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
  initPublishModal();
  initTradeModal();
  initGithubSave();
  render();
}

function initPublishModal() {
  const modal = document.getElementById("publishModal");
  const textarea = document.getElementById("publishTextarea");
  if (!modal || !textarea) return;

  on("publishBtn", "click", () => {
    textarea.value = buildPublishPayload();
    renderGhState();
    setGhMsg("");
    modal.hidden = false;
    textarea.focus();
    textarea.select();
  });

  on("publishCopyBtn", "click", async e => {
    const btn = e.currentTarget;
    textarea.select();
    try {
      await navigator.clipboard.writeText(textarea.value);
      btn.textContent = "복사됨";
    } catch {
      // clipboard blocked — the text is selected, so the user can copy it
      btn.textContent = "Cmd/Ctrl+C";
    }
    setTimeout(() => { btn.textContent = "복사"; }, 1800);
  });

  on("publishCancelBtn", "click", () => { modal.hidden = true; });
  modal.addEventListener("click", e => {
    if (e.target === modal) modal.hidden = true;
  });
}

function initImportModal() {
  const modal = document.getElementById("importModal");
  const textarea = document.getElementById("importTextarea");
  const title = document.getElementById("importModalTitle");
  const hint = document.getElementById("importModalHint");

  on("importBtn", "click", () => {
    setText(title, "포지션 JSON 가져오기");
    setText(hint, "아래에 JSON을 붙여넣고 적용하세요. 이 브라우저의 localStorage에만 저장됩니다.");
    textarea.value = "";
    modal.hidden = false;
    textarea.focus();
  });

  on("copyJsonBtn", "click", async e => {
    const btn = e.currentTarget;
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

  on("importCancelBtn", "click", () => { modal.hidden = true; });

  modal.addEventListener("click", e => {
    if (e.target === modal) modal.hidden = true;
  });

  on("importApplyBtn", "click", () => {
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

/* ---------------- 매매 입력 ---------------- */

const NEW_HOLDING = "__new__";

function tradeCurrencyOf(t) {
  if (t.isNew) return document.getElementById("tradeCurrency").value;
  const h = state.holdings[t.idx];
  return (h && h.currency) || "KRW";
}

function readTradeForm() {
  const sel = document.getElementById("tradeHolding").value;
  const isNew = sel === NEW_HOLDING;
  const t = {
    accountId: document.getElementById("tradeAccount").value,
    isNew,
    idx: isNew ? -1 : Number(sel),
    side: document.getElementById("tradeSide").value,
    shares: Number(document.getElementById("tradeShares").value) || 0,
    price: Number(document.getElementById("tradePrice").value) || 0,
    fee: Number(document.getElementById("tradeFee").value) || 0,
    touchesCash: document.getElementById("tradeTouchesCash").checked,
    ticker: document.getElementById("tradeTicker").value.trim(),
    name: document.getElementById("tradeName").value.trim(),
  };
  t.currency = tradeCurrencyOf(t);
  return t;
}

// Pure: works out what a trade would do without touching state, so the preview
// and the apply path can never disagree about the numbers.
function evaluateTrade(t) {
  if (t.isNew && !t.ticker) return { error: "새 종목의 티커를 입력하세요." };
  if (t.isNew && t.side === "sell") return { error: "보유하지 않은 종목은 매도할 수 없어요." };
  if (t.shares <= 0) return { error: "수량을 입력하세요." };
  if (t.price <= 0) return { error: "체결단가를 입력하세요." };

  const h = t.isNew ? null : state.holdings[t.idx];
  const beforeShares = h ? Number(h.shares) || 0 : 0;
  const beforeCost = h ? Number(h.costKRW) || 0 : 0;
  const beforeCostNative = h ? Number(h.costNative) || 0 : 0;

  if (t.side === "sell" && t.shares > beforeShares) {
    return { error: `보유 수량 ${beforeShares}주보다 많이 팔 수 없어요.` };
  }

  const grossNative = t.shares * t.price;
  // cash moves in the trade's own currency: a USD buy draws down USD, not won
  const cashNative = t.side === "buy" ? -(grossNative + t.fee) : grossNative - t.fee;

  // Buying adds what was actually paid, in won, at today's rate. Selling takes
  // cost out in proportion to the shares leaving, which is what keeps 평단
  // unchanged on a partial sale.
  const soldRatio = t.side === "sell" ? t.shares / beforeShares : 0;
  const costDelta = t.side === "buy"
    ? toBase(grossNative + t.fee, t.currency, state)
    : -(beforeCost * soldRatio);
  const costDeltaNative = t.side === "buy"
    ? grossNative + t.fee
    : -(beforeCostNative * soldRatio);

  const afterShares = t.side === "buy" ? beforeShares + t.shares : beforeShares - t.shares;
  const afterCost = afterShares <= 0 ? 0 : beforeCost + costDelta;
  const afterCostNative = afterShares <= 0 ? 0 : beforeCostNative + costDeltaNative;
  const realized = t.side === "sell"
    ? toBase(grossNative - t.fee, t.currency, state) + costDelta
    : null;

  return {
    beforeShares, beforeCost, afterShares,
    afterCost: Math.max(0, afterCost),
    afterCostNative: Math.max(0, afterCostNative),
    costDelta, costDeltaNative, cashNative, realized,
    perShareBefore: beforeShares ? beforeCostNative / beforeShares : 0,
    perShareAfter: afterShares ? (beforeCostNative + costDeltaNative) / afterShares : 0,
    closesPosition: afterShares <= 0,
  };
}

function fmtNative(amount, currency) {
  const symbols = { KRW: "₩", USD: "$", EUR: "€" };
  const digits = currency === "KRW" ? 0 : 2;
  return `${symbols[currency] || ""}${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  })}`;
}

function renderTradePreview() {
  const el = document.getElementById("tradePreview");
  const t = readTradeForm();
  const ev = evaluateTrade(t);

  if (ev.error) {
    el.className = "trade-preview is-error";
    el.textContent = ev.error;
    return;
  }

  const lines = [];
  if (t.side === "buy") {
    lines.push(`매수 후 ${ev.afterShares}주 · 평단 ${ev.beforeShares ? `${fmtNative(ev.perShareBefore, t.currency)} → ` : ""}${fmtNative(ev.perShareAfter, t.currency)}`);
    lines.push(`매입금액 +${fmtMoney(ev.costDelta, "KRW")}`);
  } else {
    lines.push(ev.closesPosition
      ? `전량 매도 — 보유 종목에서 빠집니다`
      : `매도 후 ${ev.afterShares}주 · 평단 ${fmtNative(ev.perShareAfter, t.currency)} (변동 없음)`);
    lines.push(`실현손익 ${fmtSignedMoney(ev.realized)}`);
  }
  if (t.touchesCash) {
    lines.push(`예수금 ${t.currency} ${ev.cashNative >= 0 ? "+" : "-"}${fmtNative(Math.abs(ev.cashNative), t.currency)}`);
  }

  el.className = "trade-preview";
  el.textContent = lines.join("\n");
}

function applyTrade(t, ev) {
  let h;
  if (t.isNew) {
    h = {
      account: t.accountId, ticker: t.ticker, name: t.name || t.ticker,
      currency: t.currency, shares: 0, price: t.price, costKRW: 0,
    };
    state.holdings.push(h);
  } else {
    h = state.holdings[t.idx];
  }

  h.shares = ev.afterShares;
  h.costKRW = Math.round(ev.afterCost);
  h.costNative = ev.afterCostNative;

  if (t.touchesCash) {
    const acc = state.accounts.find(a => a.id === t.accountId);
    if (acc) {
      const cash = normaliseCash(acc.cash);
      cash[t.currency] = (Number(cash[t.currency]) || 0) + ev.cashNative;
      acc.cash = cash;
    }
  }

  if (ev.closesPosition) state.holdings = state.holdings.filter(x => x !== h);
}

function renderTradeAccountOptions() {
  const sel = document.getElementById("tradeAccount");
  const keep = sel.value;
  sel.innerHTML = state.accounts.map(a =>
    `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
  if (state.accounts.some(a => a.id === keep)) sel.value = keep;
  else if (state.scope !== "all") sel.value = state.scope;
}

function renderTradeHoldingOptions() {
  const sel = document.getElementById("tradeHolding");
  const accountId = document.getElementById("tradeAccount").value;
  const keep = sel.value;
  const opts = state.holdings
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.account === accountId)
    .map(({ h, i }) => `<option value="${i}">${escapeHtml(h.name || h.ticker || "?")}</option>`);
  sel.innerHTML = opts.join("") + `<option value="${NEW_HOLDING}">+ 새 종목</option>`;
  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
  onTradeHoldingChange();
}

function onTradeHoldingChange() {
  const isNew = document.getElementById("tradeHolding").value === NEW_HOLDING;
  document.getElementById("tradeNewFields").hidden = !isNew;
  const cur = tradeCurrencyOf(readTradeForm());
  setText(document.getElementById("tradePriceCur"), cur);
  setText(document.getElementById("tradeFeeCur"), cur);
  renderTradePreview();
}

function initTradeModal() {
  const modal = document.getElementById("tradeModal");
  if (!modal) return;

  on("tradeBtn", "click", () => {
    renderTradeAccountOptions();
    renderTradeHoldingOptions();
    modal.hidden = false;
  });
  on("tradeCancelBtn", "click", () => { modal.hidden = true; });
  modal.addEventListener("click", e => { if (e.target === modal) modal.hidden = true; });

  on("tradeAccount", "change", renderTradeHoldingOptions);
  on("tradeHolding", "change", onTradeHoldingChange);
  on("tradeCurrency", "change", onTradeHoldingChange);
  ["tradeSide", "tradeShares", "tradePrice", "tradeFee", "tradeTicker", "tradeTouchesCash"]
    .forEach(id => { on(id, "input", renderTradePreview); on(id, "change", renderTradePreview); });

  on("tradeApplyBtn", "click", () => {
    const t = readTradeForm();
    const ev = evaluateTrade(t);
    if (ev.error) { renderTradePreview(); return; }

    applyTrade(t, ev);
    persistAndRender();
    modal.hidden = true;

    document.getElementById("tradeShares").value = 0;
    document.getElementById("tradePrice").value = 0;
    document.getElementById("tradeFee").value = 0;
    document.getElementById("tradeTicker").value = "";
    document.getElementById("tradeName").value = "";
  });
}

/* ---------------- GitHub 자동 저장 ---------------- */

const GH_TOKEN_KEY = "igs-gh-token";
const GH_REPO = "ingyu-song/stock-analysis";
const GH_PATH = "data/my-portfolio.json";
const GH_CONTENTS_URL = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;

function ghToken() {
  try {
    return localStorage.getItem(GH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

// btoa() only takes latin-1, and the book is full of Hangul
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function ghFetch(method, url, body) {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${ghToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function ghErrorText(status) {
  if (status === 401) return "토큰이 유효하지 않아요 (만료됐거나 잘못 붙여넣었을 수 있어요).";
  if (status === 403) return "권한이 부족해요. 토큰에 Contents: Read and write 권한을 주세요.";
  if (status === 404) return "레포나 파일을 못 찾았어요. 토큰이 이 레포에 접근할 수 있는지 확인하세요.";
  return `GitHub이 ${status}를 돌려줬어요.`;
}

function setGhMsg(text, kind) {
  const el = document.getElementById("ghMsg");
  if (!el) return;
  el.textContent = text;
  el.className = `gh-msg${kind ? ` is-${kind}` : ""}`;
}

function renderGhState() {
  const connected = Boolean(ghToken());
  const state_ = document.getElementById("ghState");
  if (state_) {
    state_.textContent = connected ? "연결됨" : "연결 안 됨";
    state_.className = `gh-state${connected ? " is-on" : ""}`;
  }
  const c = document.getElementById("ghConnected");
  const s = document.getElementById("ghSetup");
  if (c) c.hidden = !connected;
  if (s) s.hidden = connected;
}

async function ghConnect() {
  const input = document.getElementById("ghToken");
  const token = input.value.trim();
  if (!token) return setGhMsg("토큰을 붙여넣으세요.", "error");

  localStorage.setItem(GH_TOKEN_KEY, token);
  input.value = "";
  setGhMsg("확인 중...");

  try {
    const res = await ghFetch("GET", `${GH_CONTENTS_URL}?ref=main`);
    if (!res.ok) {
      localStorage.removeItem(GH_TOKEN_KEY);
      renderGhState();
      return setGhMsg(ghErrorText(res.status), "error");
    }
  } catch {
    localStorage.removeItem(GH_TOKEN_KEY);
    renderGhState();
    return setGhMsg("GitHub에 닿지 못했어요. 네트워크를 확인하세요.", "error");
  }

  renderGhState();
  setGhMsg("연결됐어요. 이제 “사이트에 저장”으로 바로 커밋할 수 있어요.", "ok");
}

async function ghSave() {
  const btn = document.getElementById("ghSaveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "저장 중..."; }
  setGhMsg("저장 중...");

  const payload = buildPublishPayload();
  const stamp = JSON.parse(payload).updatedAt;

  try {
    // Re-read the sha each time: the nightly price bot commits to this same
    // file, so a sha cached from page load would be stale by morning.
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await ghFetch("GET", `${GH_CONTENTS_URL}?ref=main`);
      if (!head.ok) throw new Error(ghErrorText(head.status));
      const { sha } = await head.json();

      const put = await ghFetch("PUT", GH_CONTENTS_URL, {
        message: `Update position from dashboard (${stamp})`,
        content: toBase64Utf8(payload),
        sha,
        branch: "main",
      });

      if (put.ok) {
        // We know exactly what the site now holds, so clear the change flag
        // here instead of waiting for the next load to re-seed.
        state.updatedAt = stamp;
        state.seededFrom = stamp;
        state.publishedBook = bookFingerprint(state);
        saveState(state);
        render();
        setGhMsg(`저장했어요 · ${stamp} — 1~2분 뒤 사이트에 반영돼요.`, "ok");
        return;
      }
      // 409 means something else wrote first; loop re-reads the sha and retries
      if (put.status !== 409) throw new Error(ghErrorText(put.status));
    }
    throw new Error("다른 커밋과 계속 충돌해요. 잠시 뒤 다시 시도해 주세요.");
  } catch (err) {
    setGhMsg(err.message || "저장하지 못했어요.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "사이트에 저장"; }
  }
}

function initGithubSave() {
  if (!document.getElementById("ghBox")) return;
  renderGhState();
  on("ghConnectBtn", "click", ghConnect);
  on("ghSaveBtn", "click", ghSave);
  on("ghDisconnectBtn", "click", () => {
    localStorage.removeItem(GH_TOKEN_KEY);
    renderGhState();
    setGhMsg("토큰을 지웠어요.", "");
  });
}
