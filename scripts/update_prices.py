"""
Refreshes the live prices in data/my-portfolio.json.

Only prices and FX rates are touched — shares, cost basis, cash and account
names are the user's to change, and this script must never overwrite them.

Usage:
    python scripts/update_prices.py            # fetch and write
    python scripts/update_prices.py --dry-run  # fetch and print, write nothing
"""
import argparse
import datetime
import json
import sys
import zoneinfo
from pathlib import Path

import yfinance as yf

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = REPO_ROOT / "data" / "my-portfolio.json"

FX_TICKERS = {"fxRate": "USDKRW=X", "fxRateEUR": "EURKRW=X"}
KST = zoneinfo.ZoneInfo("Asia/Seoul")


def last_price(ticker):
    """Latest close for `ticker`, or None if Yahoo has nothing usable."""
    tk = yf.Ticker(ticker)
    try:
        px = tk.fast_info.get("lastPrice")
        if px:
            return float(px)
    except Exception:
        pass
    # fast_info can come back empty for thin listings — fall back to history
    try:
        hist = tk.history(period="5d")
        if not hist.empty:
            return float(hist["Close"].dropna().iloc[-1])
    except Exception:
        pass
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print the new prices without writing")
    args = parser.parse_args()

    book = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    failures = []

    print("Fetching FX...")
    for field, ticker in FX_TICKERS.items():
        px = last_price(ticker)
        if px is None:
            failures.append(ticker)
            print(f"  {ticker}: FAILED, keeping {book.get(field)}")
            continue
        print(f"  {ticker}: {book.get(field)} -> {px:,.2f}")
        book[field] = round(px, 2)

    print("Fetching holdings...")
    for h in book["holdings"]:
        px = last_price(h["ticker"])
        if px is None:
            failures.append(h["ticker"])
            print(f"  {h['ticker']:<12} FAILED, keeping {h.get('price')}")
            continue
        prev = h.get("price")
        # KRW listings quote in whole won; USD/EUR need the cents
        h["price"] = round(px, 0 if h.get("currency") == "KRW" else 4)
        print(f"  {h['ticker']:<12} {prev} -> {h['price']}")

    # Every holding failing means Yahoo is down or the network is gone. Writing
    # a fresh updatedAt then would push every browser to re-seed identical
    # numbers and, worse, drop anyone's unpublished local edits for nothing.
    if len(failures) >= len(book["holdings"]):
        print(f"\nAll {len(failures)} lookups failed — leaving the file untouched.", file=sys.stderr)
        return 1

    book["updatedAt"] = datetime.datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    book["source"] = "Yahoo Finance 종가 (scripts/update_prices.py)"

    if args.dry_run:
        print("\n--dry-run: not writing")
        return 0

    DATA_PATH.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {DATA_PATH.name} @ {book['updatedAt']}" + (f" ({len(failures)} stale: {', '.join(failures)})" if failures else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
