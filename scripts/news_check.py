"""
커버리지 종목의 한국어 뉴스를 네이버 검색 API로 훑어 data/news.json에 적재.

영문 검색만으로는 국내 상장·국내 언론 기사를 놓치기 때문에 붙인 보조 경로입니다.

자격증명은 .env (gitignore됨) 또는 환경변수로 받습니다:
    NAVER_CLIENT_ID / NAVER_CLIENT_SECRET

Usage:
    python scripts/news_check.py
    python scripts/news_check.py --days 3 --dry-run
"""
import argparse
import datetime
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zoneinfo
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
COVERAGE_PATH = REPO_ROOT / "data" / "coverage.json"
NEWS_PATH = REPO_ROOT / "data" / "news.json"
ENV_PATH = REPO_ROOT / ".env"

API = "https://openapi.naver.com/v1/search/news.json"
KST = zoneinfo.ZoneInfo("Asia/Seoul")
TAG_RE = re.compile(r"<[^>]+>")


def load_env():
    """Reads .env without adding a dependency; real env vars win."""
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def clean(text):
    return html.unescape(TAG_RE.sub("", text or "")).strip()


def search(query, client_id, client_secret, display=15):
    url = f"{API}?{urllib.parse.urlencode({'query': query, 'display': display, 'sort': 'date'})}"
    req = urllib.request.Request(url, headers={
        "X-Naver-Client-Id": client_id,
        "X-Naver-Client-Secret": client_secret,
    })
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read().decode("utf-8"))


def parse_pub_date(raw):
    # RFC 1123, e.g. "Thu, 03 Sep 2026 14:00:00 +0900"
    try:
        return datetime.datetime.strptime(raw, "%a, %d %b %Y %H:%M:%S %z").astimezone(KST)
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=5, help="이 일수 안의 기사만 보관")
    parser.add_argument("--dry-run", action="store_true", help="출력만 하고 파일은 쓰지 않음")
    args = parser.parse_args()

    load_env()
    client_id = os.environ.get("NAVER_CLIENT_ID", "").strip()
    client_secret = os.environ.get("NAVER_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        print(
            "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET이 없습니다.\n"
            f"  {ENV_PATH} 에 값을 넣거나 환경변수로 지정하세요.",
            file=sys.stderr,
        )
        return 1

    coverage = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))
    cutoff = datetime.datetime.now(KST) - datetime.timedelta(days=args.days)

    out = []
    for c in coverage["names"]:
        # a name can override the search term when its plain name is too noisy
        query = c.get("newsQuery") or c["name"]
        try:
            data = search(query, client_id, client_secret)
        except urllib.error.HTTPError as err:
            print(f"  {c['ticker']:<11} HTTP {err.code} — {err.reason}", file=sys.stderr)
            continue
        except Exception as err:
            print(f"  {c['ticker']:<11} 실패: {err}", file=sys.stderr)
            continue

        items = []
        for it in data.get("items", []):
            when = parse_pub_date(it.get("pubDate", ""))
            if when and when < cutoff:
                continue
            items.append({
                "title": clean(it.get("title")),
                "summary": clean(it.get("description")),
                "link": it.get("originallink") or it.get("link"),
                "publishedAt": when.strftime("%Y-%m-%d %H:%M") if when else None,
            })

        print(f"  {c['ticker']:<11} {c['name']:<14} {len(items)}건")
        for i in items[:3]:
            print(f"      · {i['publishedAt']}  {i['title'][:60]}")
        if items:
            out.append({"ticker": c["ticker"], "name": c["name"], "query": query, "items": items})

    book = {
        "updatedAt": datetime.datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "windowDays": args.days,
        "source": "네이버 뉴스 검색 API",
        "coverage": out,
    }

    if args.dry_run:
        print("\n--dry-run: 파일 쓰지 않음")
        return 0

    NEWS_PATH.write_text(json.dumps(book, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {NEWS_PATH.name} — {sum(len(c['items']) for c in out)}건 / {len(out)}종목")
    return 0


if __name__ == "__main__":
    sys.exit(main())
