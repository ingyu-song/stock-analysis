"""
Daily price refresh.

Touches prices only. Share counts, cost basis, cash and the monthly rebalance
decisions belong to the user and to claude_invest.py — this script must never
rewrite them.

  data/my-portfolio.json     실제 보유 포지션 (평가금액/손익)
  data/claude-portfolio.json 클로드 모의투자 (평가금액만; 매매는 월 1회 리밸런싱)
  data/coverage.json         커버리지 종목 시세

Usage:
    python scripts/update_prices.py
    python scripts/update_prices.py --dry-run
"""
import argparse
import datetime
import json
import sys
import zoneinfo
from pathlib import Path

import yfinance as yf

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA = REPO_ROOT / "data"
POSITION_PATH = DATA / "my-portfolio.json"
CLAUDE_PATH = DATA / "claude-portfolio.json"
COVERAGE_PATH = DATA / "coverage.json"
BENCHMARK_PATH = DATA / "benchmarks.json"

FX_TICKERS = {"USD": "USDKRW=X", "EUR": "EURKRW=X", "SGD": "SGDKRW=X"}
KST = zoneinfo.ZoneInfo("Asia/Seoul")

_quote_cache = {}


def quote(ticker):
    """(last, previous close) for `ticker`; (None, None) if Yahoo has nothing."""
    if ticker in _quote_cache:
        return _quote_cache[ticker]

    last = prev = None
    tk = yf.Ticker(ticker)
    try:
        fi = tk.fast_info
        last = fi.get("lastPrice")
        prev = fi.get("previousClose")
    except Exception:
        pass

    if not last or not prev:
        # fast_info comes back empty for some thin listings
        try:
            closes = tk.history(period="5d")["Close"].dropna()
            if len(closes):
                last = last or float(closes.iloc[-1])
            if len(closes) > 1:
                prev = prev or float(closes.iloc[-2])
        except Exception:
            pass

    result = (float(last) if last else None, float(prev) if prev else None)
    _quote_cache[ticker] = result
    return result


def next_earnings(ticker):
    """Next scheduled earnings date, or None. Yahoo returns a list; past dates
    still show up for names that have already reported, so filter them out."""
    try:
        cal = yf.Ticker(ticker).calendar
        dates = (cal or {}).get("Earnings Date") or []
        if not isinstance(dates, (list, tuple)):
            dates = [dates]
        today = datetime.date.today()
        upcoming = sorted(d for d in dates if isinstance(d, datetime.date) and d >= today)
        return upcoming[0].isoformat() if upcoming else None
    except Exception:
        return None


def round_for(currency, px):
    return round(px, 0 if currency == "KRW" else 4)


def now_kst():
    return datetime.datetime.now(KST)


def fetch_fx(failures):
    rates = {"KRW": 1.0}
    for code, ticker in FX_TICKERS.items():
        px, _ = quote(ticker)
        if px is None:
            failures.append(ticker)
            print(f"  {ticker}: FAILED")
            continue
        rates[code] = round(px, 2)
        print(f"  {ticker}: {rates[code]:,.2f}")
    return rates


def refresh_positions(rates, failures, dry_run):
    book = json.loads(POSITION_PATH.read_text(encoding="utf-8"))
    if "USD" in rates:
        book["fxRate"] = rates["USD"]
    if "EUR" in rates:
        book["fxRateEUR"] = rates["EUR"]

    local_fail = 0
    for h in book["holdings"]:
        px, _ = quote(h["ticker"])
        if px is None:
            local_fail += 1
            failures.append(h["ticker"])
            print(f"  {h['ticker']:<12} FAILED, keeping {h.get('price')}")
            continue
        print(f"  {h['ticker']:<12} {h.get('price')} -> {round_for(h['currency'], px)}")
        h["price"] = round_for(h["currency"], px)

    # Every lookup failing means Yahoo is down. Stamping a fresh updatedAt then
    # would push every browser to re-seed identical numbers for nothing.
    if local_fail >= len(book["holdings"]):
        print("  all lookups failed — leaving my-portfolio.json alone", file=sys.stderr)
        return False

    book["updatedAt"] = now_kst().strftime("%Y-%m-%d %H:%M")
    book["source"] = "Yahoo Finance 종가 (scripts/update_prices.py)"
    if not dry_run:
        POSITION_PATH.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def refresh_claude(rates, failures, dry_run):
    """Marks the paper portfolio to market. Trades stay monthly (claude_invest.py)."""
    book = json.loads(CLAUDE_PATH.read_text(encoding="utf-8"))
    today = now_kst().strftime("%Y-%m-%d")

    local_fail = 0
    for h in book["holdings"]:
        px, _ = quote(h["ticker"])
        if px is None:
            local_fail += 1
            failures.append(h["ticker"])
            print(f"  {h['ticker']:<12} FAILED, keeping {h.get('lastPrice')}")
            continue
        rate = rates.get(h["currency"])
        if rate is None:
            print(f"  {h['ticker']:<12} no {h['currency']} rate, skipping")
            continue
        print(f"  {h['ticker']:<12} {h.get('lastPrice')} -> {px}")
        h["lastPrice"] = px
        h["lastPriceDate"] = today
        h["marketValueKRW"] = h["shares"] * px * rate

    if local_fail >= len(book["holdings"]):
        print("  all lookups failed — leaving claude-portfolio.json alone", file=sys.stderr)
        return False

    equity = sum(h.get("marketValueKRW", 0) for h in book["holdings"])
    total = book["cash"] + equity
    entry = {"date": today, "totalValue": total, "cash": book["cash"], "equityValue": equity}

    # One point per day: re-running replaces today's rather than stacking.
    history = [v for v in book.get("valueHistory", []) if v.get("date") != today]
    history.append(entry)
    book["valueHistory"] = history
    book["lastUpdated"] = now_kst().isoformat()

    ret = (total / book["startingAUM"] - 1) * 100 if book.get("startingAUM") else 0
    print(f"  AUM {total:,.0f} KRW ({ret:+.2f}% vs 시작)")

    if not dry_run:
        CLAUDE_PATH.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def refresh_coverage(failures, dry_run):
    book = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))

    local_fail = 0
    for c in book["names"]:
        px, prev = quote(c["ticker"])
        if px is None:
            local_fail += 1
            failures.append(c["ticker"])
            print(f"  {c['ticker']:<12} FAILED, keeping {c.get('price')}")
            continue
        c["price"] = round_for(c["currency"], px)
        if prev:
            c["prevClose"] = round_for(c["currency"], prev)
        earnings = next_earnings(c["ticker"])
        if earnings:
            c["nextEarnings"] = earnings
        else:
            c.pop("nextEarnings", None)
        chg = (px / prev - 1) * 100 if prev else float("nan")
        print(f"  {c['ticker']:<12} {c['price']:>12,.2f} {c['currency']}  {chg:+7.2f}%  실적 {earnings or '-'}")

    if local_fail >= len(book["names"]):
        print("  all lookups failed — leaving coverage.json alone", file=sys.stderr)
        return False

    book["updatedAt"] = now_kst().strftime("%Y-%m-%d %H:%M")
    if not dry_run:
        COVERAGE_PATH.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def close_on_or_after(ticker, start):
    """First close at or after `start`, plus the latest close. Indices skip
    holidays, so the baseline is the first session on or after the start date."""
    hist = yf.Ticker(ticker).history(start=start, auto_adjust=False)
    closes = hist["Close"].dropna() if not hist.empty else None
    if closes is None or not len(closes):
        return None, None, None
    return float(closes.iloc[0]), float(closes.iloc[-1]), str(closes.index[0].date())


def refresh_benchmarks(failures, dry_run):
    book = json.loads(BENCHMARK_PATH.read_text(encoding="utf-8"))
    start = book["startDate"]

    fx_start, fx_now, _ = close_on_or_after(FX_TICKERS["USD"], start)
    if fx_start:
        book["fxStart"] = round(fx_start, 2)
        book["fxNow"] = round(fx_now, 2)
        book["fxReturnPct"] = round((fx_now / fx_start - 1) * 100, 2)

    local_fail = 0
    for b in book["items"]:
        first, last, first_date = close_on_or_after(b["ticker"], start)
        if first is None:
            local_fail += 1
            failures.append(b["ticker"])
            print(f"  {b['ticker']:<10} FAILED, keeping {b.get('returnPct')}")
            continue
        b["startPrice"] = round(first, 2)
        b["startDateActual"] = first_date
        b["price"] = round(last, 2)
        b["returnPct"] = round((last / first - 1) * 100, 2)
        # also stored in won terms: the user's own return carries FX, so the
        # like-for-like figure is here even though the strip shows the headline one
        if b["currency"] == "KRW" or not fx_start:
            b["returnPctKRW"] = b["returnPct"]
        else:
            b["returnPctKRW"] = round((last * fx_now) / (first * fx_start) * 100 - 100, 2)
        print(f"  {b['ticker']:<10} {b['name']:<12} {b['returnPct']:+7.2f}%  (원화 {b['returnPctKRW']:+.2f}%)  기준 {first_date}")

    if local_fail >= len(book["items"]):
        print("  all lookups failed — leaving benchmarks.json alone", file=sys.stderr)
        return False

    book["updatedAt"] = now_kst().strftime("%Y-%m-%d %H:%M")
    if not dry_run:
        BENCHMARK_PATH.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print the new prices without writing")
    args = parser.parse_args()

    failures = []
    print("FX...")
    rates = fetch_fx(failures)

    print("\n보유 포지션...")
    ok_pos = refresh_positions(rates, failures, args.dry_run)
    print("\n클로드 모의투자...")
    ok_claude = refresh_claude(rates, failures, args.dry_run)
    print("\n커버리지...")
    ok_cov = refresh_coverage(failures, args.dry_run)
    print("\n벤치마크...")
    ok_bm = refresh_benchmarks(failures, args.dry_run)

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0
    if not (ok_pos or ok_claude or ok_cov or ok_bm):
        print("\nEverything failed — nothing written.", file=sys.stderr)
        return 1

    stale = f" ({len(failures)} stale: {', '.join(sorted(set(failures)))})" if failures else ""
    print(f"\nDone @ {now_kst():%Y-%m-%d %H:%M}{stale}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
