"""
커버리지 종목이 언급된 글로벌 매체 기사를 RSS로 수집해 data/news_global.json 에 적재.

네이버 검색 API(news_check.py)가 국내 기사를 맡고, 이쪽은 CNBC·FT·Reuters 등
영문 매체를 맡습니다. 소스 목록은 data/sources.json.

Usage:
    python scripts/news_rss.py
    python scripts/news_rss.py --days 3 --dry-run
"""
import argparse
import datetime
import html
import json
import re
import ssl
import sys
import urllib.parse
import urllib.request
import zoneinfo
from pathlib import Path

import feedparser

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA = REPO_ROOT / "data"
SOURCES_PATH = DATA / "sources.json"
COVERAGE_PATH = DATA / "coverage.json"
OUT_PATH = DATA / "news_global.json"

KST = zoneinfo.ZoneInfo("Asia/Seoul")
TAG_RE = re.compile(r"<[^>]+>")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def clean(text):
    return html.unescape(TAG_RE.sub("", text or "")).strip()


def alias_pattern(aliases):
    """Word-boundary match so Intel does not fire on 'intelligence'. Aliases
    with punctuation (P&G, COIN)) are matched literally instead."""
    parts = []
    for a in aliases:
        esc = re.escape(a)
        if a.replace(" ", "").isalnum():
            parts.append(rf"\b{esc}\b")
        else:
            parts.append(esc)
    return re.compile("|".join(parts), re.IGNORECASE)


def entry_time(entry):
    for key in ("published_parsed", "updated_parsed"):
        st = entry.get(key)
        if st:
            try:
                return datetime.datetime(*st[:6], tzinfo=datetime.timezone.utc).astimezone(KST)
            except Exception:
                pass
    return None


def ssl_context():
    """Framework Python on macOS has no usable root store, and feedparser fetches
    through urllib — so hand it bytes we fetched with certifi instead of a URL."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL_CTX = ssl_context()


def fetch_feed(url):
    try:
        # some feed URLs carry non-ASCII query terms (工商時報); urllib needs them
        # percent-encoded before it will build the request
        safe_url = urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=%~")
        req = urllib.request.Request(safe_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as res:
            raw = res.read()
    except Exception as err:
        print(f"    {url[:52]} 실패: {type(err).__name__} {str(err)[:50]}", file=sys.stderr)
        return []
    try:
        return feedparser.parse(raw).entries or []
    except Exception as err:
        print(f"    {url[:52]} 파싱 실패: {str(err)[:50]}", file=sys.stderr)
        return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=5, help="이 일수 안의 기사만 보관")
    parser.add_argument("--dry-run", action="store_true", help="출력만 하고 파일은 쓰지 않음")
    args = parser.parse_args()

    sources = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
    max_items = sources.get("max_items_per_source", 12)
    cutoff = datetime.datetime.now(KST) - datetime.timedelta(days=args.days)

    matchers = [
        (c, alias_pattern(c.get("newsAliases") or [c["name"]]))
        for c in coverage["names"]
    ]

    # ticker -> {link -> item}; the same wire story shows up in several feeds
    hits = {c["ticker"]: {} for c in coverage["names"]}
    scanned = 0

    for src in sources["sources"]:
        found = 0
        for url in src.get("feeds", []):
            for entry in fetch_feed(url)[:max_items]:
                scanned += 1
                when = entry_time(entry)
                if when and when < cutoff:
                    continue
                title = clean(entry.get("title"))
                summary = clean(entry.get("summary") or entry.get("description"))
                if not title:
                    continue
                hay = f"{title} {summary}"
                for c, pattern in matchers:
                    if not pattern.search(hay):
                        continue
                    link = entry.get("link") or ""
                    bucket = hits[c["ticker"]]
                    if link in bucket:
                        continue
                    bucket[link] = {
                        "title": title,
                        "summary": summary[:400],
                        "link": link,
                        "publishedAt": when.strftime("%Y-%m-%d %H:%M") if when else None,
                        "outlet": src["name"],
                    }
                    found += 1
        print(f"  {src['name']:<34} {found}건")

    out = []
    for c in coverage["names"]:
        items = sorted(
            hits[c["ticker"]].values(),
            key=lambda i: i["publishedAt"] or "",
            reverse=True,
        )
        if items:
            out.append({"ticker": c["ticker"], "name": c["name"], "items": items})

    total = sum(len(c["items"]) for c in out)
    print(f"\n기사 {scanned}건 훑어 {total}건 매칭 / {len(out)}종목")
    for c in out:
        print(f"  {c['ticker']:<11} {c['name']:<16} {len(c['items']):>2}건   {c['items'][0]['title'][:52]}")

    book = {
        "updatedAt": datetime.datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "windowDays": args.days,
        "source": "글로벌 매체 RSS",
        "sourceCount": len(sources["sources"]),
        "coverage": out,
    }

    if args.dry_run:
        print("\n--dry-run: 파일 쓰지 않음")
        return 0

    OUT_PATH.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {OUT_PATH.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
