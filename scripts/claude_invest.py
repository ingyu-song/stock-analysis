"""
Runs Claude's monthly fundamental paper-trading decision.

Reads data/claude-portfolio.json, prices the current holdings, asks Claude
(via a forced tool call so the response is structured) for buy/sell/hold
decisions across KR/SG/US listed stocks and ETFs, applies the trades, and
writes the updated portfolio + a decision-log entry back to the JSON file.

Usage:
    python scripts/claude_invest.py            # real run, calls the Claude API
    python scripts/claude_invest.py --dry-run  # skips the API call, uses a
                                                # canned "hold" decision so the
                                                # read -> apply -> write pipeline
                                                # can be tested without a key.
"""
import argparse
import datetime
import json
import os
import sys
from pathlib import Path

import yfinance as yf

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = REPO_ROOT / "data" / "claude-portfolio.json"

FX_TICKERS = {"USD": "USDKRW=X", "SGD": "SGDKRW=X"}

SYSTEM_PROMPT = """\
당신은 실제 자금은 아니지만 진짜처럼 취급되는 모의투자 포트폴리오를 운용하는 \
펀더멘털 투자자입니다. 매달 한 번, 포트폴리오를 점검하고 매매를 결정합니다.

투자 철학:
- 사업 모델의 질(경제적 해자, 수익구조)을 최우선으로 봅니다. 단기 모멘텀이나 \
차트 패턴은 근거로 쓰지 않습니다.
- 밸류에이션은 "지금 주가를 정당화하려면 얼마나 성장해야 하는가"를 역산하는 \
방식으로 접근합니다. 막연히 싸다/비싸다로 판단하지 않습니다.
- 과도한 매매를 피합니다. 확신 없는 종목은 보유하지 않고, 이미 보유한 종목은 \
논지가 훼손되지 않는 한 계속 들고 갑니다.
- 집중과 분산의 균형을 지킵니다 (한 종목에 전체 자산의 25%를 넘기지 않는 것을 \
기본 원칙으로 합니다).
- 투자 가능 유니버스는 한국(KRX), 싱가포르(SGX), 미국(NYSE/Nasdaq) 상장 \
주식과 ETF로 한정됩니다. 레버리지, 공매도, 옵션은 사용하지 않습니다.
- 티커는 반드시 Yahoo Finance 표기법을 그대로 사용합니다: 한국 = 6자리 \
숫자.KS 또는 .KQ (예: 005930.KS), 싱가포르 = 코드.SI (예: D05.SI), \
미국 = 접미사 없음 (예: AAPL, VOO).
- 현금 보유 자체도 하나의 포지션 선택입니다. 마땅한 기회가 없으면 매수를 \
강행하지 않습니다.

모든 판단은 반드시 record_decision 도구를 통해 구조화된 형태로 제출하세요. \
각 매매에는 사업의 질과 밸류에이션에 근거한 구체적인 rationale을 한국어로 \
작성하세요.
"""

RECORD_DECISION_TOOL = {
    "name": "record_decision",
    "description": "이번 달 포트폴리오 점검 결과와 매매 결정을 구조화된 형태로 기록합니다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "market_view": {
                "type": "string",
                "description": "이번 달 포트폴리오 전반에 대한 코멘트 (2~4문장, 한국어)",
            },
            "trades": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": ["buy", "sell"]},
                        "ticker": {
                            "type": "string",
                            "description": "Yahoo Finance 표기법 티커 (예: 005930.KS, D05.SI, AAPL)",
                        },
                        "name": {"type": "string", "description": "종목명"},
                        "shares": {"type": "integer", "minimum": 1},
                        "rationale": {"type": "string", "description": "사업 질/밸류에이션 근거 (한국어, 3문장 이상)"},
                    },
                    "required": ["action", "ticker", "name", "shares", "rationale"],
                },
            },
        },
        "required": ["market_view", "trades"],
    },
}


def load_portfolio() -> dict:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_portfolio(portfolio: dict) -> None:
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(portfolio, f, ensure_ascii=False, indent=2)
        f.write("\n")


def fetch_price_and_currency(ticker: str):
    tk = yf.Ticker(ticker)
    hist = tk.history(period="5d")
    if hist.empty:
        return None, None
    price = float(hist["Close"].iloc[-1])
    currency = None
    try:
        currency = tk.fast_info.get("currency")
    except Exception:
        pass
    return price, currency


def fetch_fx_rates() -> dict:
    rates = {"KRW": 1.0}
    for code, yf_ticker in FX_TICKERS.items():
        price, _ = fetch_price_and_currency(yf_ticker)
        if price:
            rates[code] = price
    return rates


def to_krw(amount: float, currency: str, fx: dict) -> float:
    if currency == "KRW" or currency is None:
        return amount
    rate = fx.get(currency)
    if not rate:
        raise ValueError(f"No FX rate available for {currency}")
    return amount * rate


def price_holdings(holdings: list, fx: dict) -> list:
    priced = []
    for h in holdings:
        price, currency = fetch_price_and_currency(h["ticker"])
        currency = currency or h.get("currency") or "KRW"
        if price is None:
            print(f"  ! could not price {h['ticker']}, keeping last known avgCost", file=sys.stderr)
            price = h["avgCost"]
        market_value_krw = to_krw(price * h["shares"], currency, fx)
        priced.append({
            **h,
            "currency": currency,
            "lastPrice": price,
            "lastPriceDate": datetime.date.today().isoformat(),
            "marketValueKRW": market_value_krw,
        })
    return priced


def build_prompt(portfolio: dict, priced_holdings: list, cash: float) -> str:
    equity_value = sum(h["marketValueKRW"] for h in priced_holdings)
    total_value = cash + equity_value
    lines = [
        f"오늘 날짜: {datetime.date.today().isoformat()}",
        f"시작 AUM: {portfolio['startingAUM']:,.0f}원 ({portfolio['startDate']})",
        f"현재 총자산(AUM): {total_value:,.0f}원",
        f"현금: {cash:,.0f}원 ({(cash/total_value*100 if total_value else 0):.1f}%)",
        "",
        "현재 보유 종목:",
    ]
    if priced_holdings:
        for h in priced_holdings:
            pnl_pct = (h["lastPrice"] / h["avgCost"] - 1) * 100 if h["avgCost"] else 0
            lines.append(
                f"- {h['ticker']} ({h['name']}): {h['shares']}주, 평단 {h['avgCost']:,.2f} {h['currency']}, "
                f"현재가 {h['lastPrice']:,.2f} {h['currency']} ({pnl_pct:+.1f}%), "
                f"평가액 {h['marketValueKRW']:,.0f}원 (전체의 {h['marketValueKRW']/total_value*100:.1f}%)"
            )
    else:
        lines.append("(없음 — 아직 전액 현금)")

    if portfolio["decisions"]:
        lines.append("")
        lines.append("최근 결정 이력 (최신순 최대 3건):")
        for d in list(reversed(portfolio["decisions"]))[:3]:
            lines.append(f"- {d['date']}: {d['marketView']}")
            for t in d["trades"]:
                lines.append(f"    · {t['action']} {t['ticker']} {t['shares']}주 — {t['rationale'][:80]}")

    lines.append("")
    lines.append(
        "이번 달 포트폴리오를 점검하고, record_decision 도구로 매매 결정을 제출하세요. "
        "매매가 필요 없다고 판단되면 trades를 빈 배열로 제출해도 됩니다."
    )
    return "\n".join(lines)


def call_claude(prompt: str) -> dict:
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[RECORD_DECISION_TOOL],
        tool_choice={"type": "tool", "name": "record_decision"},
        messages=[{"role": "user", "content": prompt}],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "record_decision":
            return block.input
    raise RuntimeError("Claude did not return a record_decision tool call")


def mock_decision() -> dict:
    return {
        "market_view": "[DRY RUN] 파이프라인 테스트용 더미 응답입니다. 실제 API 호출은 이루어지지 않았습니다.",
        "trades": [],
    }


def apply_trades(decision: dict, holdings: list, cash: float, fx: dict):
    holdings_by_ticker = {h["ticker"]: dict(h) for h in holdings}
    applied_trades = []

    for t in decision.get("trades", []):
        ticker = t["ticker"]
        action = t["action"]
        shares_requested = int(t["shares"])
        price, currency = fetch_price_and_currency(ticker)

        if price is None:
            applied_trades.append({**t, "shares": 0, "price": None, "status": "skipped_unresolvable_ticker"})
            continue
        currency = currency or "KRW"

        if action == "buy":
            cost_per_share_krw = to_krw(price, currency, fx)
            max_affordable = int(cash // cost_per_share_krw) if cost_per_share_krw > 0 else 0
            shares = min(shares_requested, max_affordable)
            if shares <= 0:
                applied_trades.append({**t, "shares": 0, "price": price, "status": "skipped_insufficient_cash"})
                continue
            total_cost_krw = shares * cost_per_share_krw
            cash -= total_cost_krw

            existing = holdings_by_ticker.get(ticker)
            if existing:
                new_shares = existing["shares"] + shares
                existing["avgCost"] = (existing["avgCost"] * existing["shares"] + price * shares) / new_shares
                existing["shares"] = new_shares
            else:
                holdings_by_ticker[ticker] = {
                    "ticker": ticker,
                    "name": t.get("name", ticker),
                    "currency": currency,
                    "shares": shares,
                    "avgCost": price,
                    "firstBought": datetime.date.today().isoformat(),
                }
            applied_trades.append({**t, "shares": shares, "price": price, "status": "filled"})

        elif action == "sell":
            existing = holdings_by_ticker.get(ticker)
            held = existing["shares"] if existing else 0
            shares = min(shares_requested, held)
            if shares <= 0:
                applied_trades.append({**t, "shares": 0, "price": price, "status": "skipped_not_held"})
                continue
            proceeds_krw = shares * to_krw(price, currency, fx)
            cash += proceeds_krw
            existing["shares"] -= shares
            if existing["shares"] <= 0:
                del holdings_by_ticker[ticker]
            applied_trades.append({**t, "shares": shares, "price": price, "status": "filled"})

    new_holdings = list(holdings_by_ticker.values())
    return new_holdings, cash, applied_trades


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Skip the Claude API call; use a canned decision")
    args = parser.parse_args()

    portfolio = load_portfolio()
    print("Fetching FX rates...")
    fx = fetch_fx_rates()
    print(f"  {fx}")

    print("Pricing current holdings...")
    priced_holdings = price_holdings(portfolio["holdings"], fx)
    cash_before = portfolio["cash"]
    equity_before = sum(h["marketValueKRW"] for h in priced_holdings)
    total_before = cash_before + equity_before
    print(f"  AUM before: {total_before:,.0f} KRW (cash {cash_before:,.0f}, equity {equity_before:,.0f})")

    prompt = build_prompt(portfolio, priced_holdings, cash_before)

    if args.dry_run:
        print("--dry-run set: skipping Claude API call")
        decision = mock_decision()
    else:
        print("Calling Claude API...")
        decision = call_claude(prompt)

    new_holdings, cash_after, applied_trades = apply_trades(
        decision, portfolio["holdings"], cash_before, fx
    )

    priced_after = price_holdings(new_holdings, fx)
    equity_after = sum(h["marketValueKRW"] for h in priced_after)
    total_after = cash_after + equity_after

    decision_entry = {
        "date": datetime.date.today().isoformat(),
        "portfolioValueBefore": round(total_before),
        "cashBefore": round(cash_before),
        "marketView": decision.get("market_view", ""),
        "trades": applied_trades,
        "portfolioValueAfter": round(total_after),
        "cashAfter": round(cash_after),
        "dryRun": args.dry_run,
    }

    portfolio["holdings"] = priced_after
    portfolio["cash"] = cash_after
    portfolio["decisions"].append(decision_entry)
    portfolio["valueHistory"].append(
        {
            "date": decision_entry["date"],
            "totalValue": round(total_after),
            "cash": round(cash_after),
            "equityValue": round(equity_after),
        }
    )
    portfolio["lastUpdated"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

    save_portfolio(portfolio)
    print(f"Saved. AUM after: {total_after:,.0f} KRW (cash {cash_after:,.0f}, equity {equity_after:,.0f})")
    print(f"Trades applied: {len(applied_trades)}")


if __name__ == "__main__":
    main()
