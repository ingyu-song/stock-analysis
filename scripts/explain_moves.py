"""
보유 종목이 전일 대비 왜 움직였는지 한두 문장으로 설명해 data/move_reasons.json 에 적재.

설명은 이미 수집해 둔 뉴스(data/news.json 네이버, data/news_global.json 해외 RSS)와
당일 시장 지수 변동만을 근거로 쓴다. 근거가 없으면 "확인된 원인 없음"이라고 쓰게 하고,
기사 번호를 돌려받아 링크는 스크립트가 직접 붙인다 — 모델이 URL을 만들어낼 수 없다.

Usage:
    python scripts/explain_moves.py             # 실제 호출 (ANTHROPIC_API_KEY 필요)
    python scripts/explain_moves.py --dry-run   # 프롬프트만 출력, API 호출 안 함
"""
import argparse
import datetime
import json
import os
import re
import sys
import zoneinfo
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA = REPO_ROOT / "data"
PORTFOLIO_PATH = DATA / "my-portfolio.json"
OUT_PATH = DATA / "move_reasons.json"
NEWS_FILES = ("news.json", "news_global.json")

KST = zoneinfo.ZoneInfo("Asia/Seoul")
MODEL = "claude-sonnet-5"
WINDOW_DAYS = 6        # 수집 상한(안전장치). 실제 필터는 각 종목의 거래일 전후로 좁힌다
MAX_HEADLINES = 6      # 종목당 모델에 보여주는 기사 수
ATTEMPTS = 3

MARKET_TICKERS = {
    "S&P 500": "^GSPC",
    "Nasdaq 100": "^NDX",
    "KOSPI": "^KS11",
    "Nikkei 225": "^N225",
    "SOX (미국 반도체)": "^SOX",
    "VIX": "^VIX",
    "USD/KRW": "USDKRW=X",
    "JPY/KRW": "JPYKRW=X",
}

SYSTEM_PROMPT = """\
당신은 개인 투자자의 포트폴리오 대시보드에 붙는 '왜 움직였나' 설명을 쓰는 애널리스트입니다.
각 보유 종목의 전일 대비 등락 원인을, 제공된 기사 제목·요약과 시장 지수 변동만을 근거로 설명합니다.

규칙:
- 한국어 1~2문장, 120자 안팎. 방향(올랐다/내렸다)과 이유를 함께 씁니다.
- 제공된 기사에 없는 사건·수치·인용을 만들어내지 않습니다. 기사가 원인을 직접 말하지 않으면 지어내지 말고
  basis를 "market" 또는 "none"으로 둡니다.
- basis는 세 가지입니다.
  · news   — 제공된 기사가 이 종목의 움직임을 직접 설명할 때. headline_ids에 근거 기사 번호를 넣습니다.
  · market — 기사로는 설명되지 않지만 같은 방향으로 움직인 지수·환율·섹터가 있어 그 영향으로 보이는 때.
             이 경우 "~와 같이 움직여 시장 영향으로 보임"처럼 추정임을 드러냅니다.
  · none   — 확인된 원인이 없을 때. "뉴스로 확인된 뚜렷한 원인은 없음"이라고 씁니다.
- 변동폭이 0.5% 미만이면 "큰 변동 없음"으로 충분하고 basis는 none입니다.
- ETF는 기초지수나 연동된 시장의 움직임이 곧 원인이므로, 해당하는 지수 변동을 근거로 basis=market으로 씁니다.
  단 종목마다 거래일이 다르니 그 종목에 함께 제공된 같은 날의 시장 변동만 인용합니다. 해외 지수 날짜가 종목의
  거래일과 다르면 "미국 시장은 그날 열리지 않았거나 별도 날"이므로 인용하지 마세요.
- 환율(USD/KRW 등)은 원화로 환산한 가격에만 영향을 주고 현지통화 등락의 원인이 아닙니다.
- 기사 제목이 종목과 무관해 보이면(동음이의어 등) 무시합니다.
- 기사가 그날의 주가 움직임을 직접 설명해야 basis=news 입니다. 같은 시기에 나온 사건 보도라는 이유만으로
  원인으로 삼지 마세요. 업종 전체가 함께 움직였다면(같은 날 비슷한 종목들이 같은 방향) 개별 호재가 아니라
  업종·시장 요인입니다. 오래전부터 이어진 배경 사실(수주 지연 등)을 그날 급락·급등의 원인으로 단정하지 마세요.
- 반드시 record_move_reasons 도구로 제출합니다. 요청받은 모든 티커를 빠짐없이 포함합니다.
"""

TOOL = {
    "name": "record_move_reasons",
    "description": "각 보유 종목의 전일 대비 등락 원인 설명을 제출합니다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "moves": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ticker": {"type": "string"},
                        "reason": {"type": "string", "description": "한국어 1~2문장, 120자 안팎"},
                        "basis": {"type": "string", "enum": ["news", "market", "none"]},
                        "headline_ids": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "description": "근거로 쓴 기사 번호(H번호의 숫자). basis가 news가 아니면 빈 배열",
                        },
                    },
                    "required": ["ticker", "reason", "basis", "headline_ids"],
                },
            }
        },
        "required": ["moves"],
    },
}


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


def market_series():
    """Daily closes per index and currency, keyed by date.

    The dates matter. Korea and the US do not trade on the same days (10/9 was
    a Korean holiday), so "the latest close" is a different calendar day for a
    KRX ETF than for a US stock. Handing the model one global set of index moves
    produced an explanation that set a KOSPI fall on 10/8 against an S&P rise on
    10/9 — two different days — so each holding is given the moves of its own
    trading day instead.
    """
    import yfinance as yf

    series = {}
    for name, ticker in MARKET_TICKERS.items():
        try:
            closes = yf.Ticker(ticker).history(period="15d")["Close"].dropna()
        except Exception:
            continue
        rows = {d.strftime("%Y-%m-%d"): float(v) for d, v in closes.items()}
        if len(rows) >= 2:
            series[name] = rows
    return series


def moves_on(series, date):
    """Each series' % change on `date` vs its prior close, where it traded."""
    out = {}
    for name, rows in series.items():
        days = sorted(rows)
        if date in rows:
            i = days.index(date)
            if i > 0:
                out[name] = round((rows[date] / rows[days[i - 1]] - 1) * 100, 2)
    return out


def last_session(ticker):
    """The date of a holding's latest close, as yfinance reports it."""
    import yfinance as yf

    try:
        closes = yf.Ticker(ticker).history(period="10d")["Close"].dropna()
        return closes.index[-1].strftime("%Y-%m-%d") if len(closes) else None
    except Exception:
        return None


def parse_time(s):
    try:
        return datetime.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=KST)
    except Exception:
        return None


def gather_headlines(ticker, now, session=None):
    """Articles that could actually explain `session`'s move.

    A story has to be *about* that day, so it is kept only if it was published
    from the day before the session through the day after it. Without the upper
    bound the model was handed weekend features published two days after a
    Thursday's close and cited them as the cause; without the lower bound it
    gets stale background that has nothing to do with the day.
    """
    cutoff = now - datetime.timedelta(days=WINDOW_DAYS)
    lo = hi = None
    if session:
        try:
            d = datetime.datetime.strptime(session, "%Y-%m-%d").replace(tzinfo=KST)
            lo = d - datetime.timedelta(days=1)
            hi = d + datetime.timedelta(days=2)  # up to the end of the next day
        except ValueError:
            pass
    seen, items = set(), []
    for fname in NEWS_FILES:
        data = load_json(DATA / fname) or {}
        for c in data.get("coverage", []):
            if c.get("ticker") != ticker:
                continue
            for it in c.get("items", []):
                when = parse_time(it.get("publishedAt") or "")
                if not when or when < cutoff:
                    continue
                if lo and not (lo <= when < hi):
                    continue
                key = re.sub(r"[^0-9a-z가-힣]", "", (it.get("title") or "").lower())[:32]
                if not key or key in seen:
                    continue
                seen.add(key)
                items.append({
                    "title": it.get("title", ""),
                    "summary": (it.get("summary") or "")[:160],
                    "link": it.get("link", ""),
                    "outlet": it.get("outlet") or "네이버 뉴스",
                    "publishedAt": it.get("publishedAt"),
                })
    items.sort(key=lambda i: i["publishedAt"] or "", reverse=True)
    return items[:MAX_HEADLINES]


def build_prompt(holdings, now):
    lines = [
        f"기준 시각: {now:%Y-%m-%d %H:%M} KST",
        "한국과 미국은 휴장일이 달라 종목마다 '최근 거래일'이 다를 수 있습니다. 아래에서 각 종목은 "
        "자기 거래일에 해당하는 시장 지수·환율 변동만 함께 제공되며, 다른 날짜의 변동은 근거로 쓰지 마세요.",
        "",
    ]

    numbered, hid = {}, 0
    for h in holdings:
        lines.append(f"[{h['ticker']}] {h['name']} — {h['session']} 종가, 전일 대비 {h['changePct']:+.2f}% ({h['currency']})")
        if h["market"]:
            ctx = ", ".join(f"{k} {v:+.2f}%" for k, v in h["market"].items())
            lines.append(f"    같은 날({h['session']}) 시장: {ctx}")
        else:
            lines.append(f"    같은 날({h['session']}) 시장 지수 데이터 없음")
        if h["headlines"]:
            for it in h["headlines"]:
                hid += 1
                numbered[hid] = (h["ticker"], it)
                summ = f" — {it['summary']}" if it["summary"] else ""
                lines.append(f"    H{hid} [{it['outlet']} {it['publishedAt']}] {it['title']}{summ}")
        else:
            lines.append("    (수집된 관련 기사 없음)")
        lines.append("")
    lines.append("위 종목 전부에 대해 record_move_reasons 도구로 설명을 제출하세요.")
    return "\n".join(lines), numbered


def validate(result, expected, numbered):
    """Returns (cleaned, problems). A tool call that did not split into fields
    cleanly has produced garbage here before (claude_invest.py, 2026-09-30), so
    nothing from the model is trusted until it has passed this."""
    problems, cleaned = [], {}
    moves = result.get("moves") if isinstance(result, dict) else None
    if not isinstance(moves, list):
        return {}, ["moves 가 배열이 아님"]

    allowed_ids = {}
    for hid, (tk, _) in numbered.items():
        allowed_ids.setdefault(tk, set()).add(hid)

    for m in moves:
        tk = m.get("ticker") if isinstance(m, dict) else None
        reason = m.get("reason") if isinstance(m, dict) else None
        if tk not in expected:
            problems.append(f"알 수 없는 티커 {tk!r}")
            continue
        if not isinstance(reason, str) or not (6 <= len(reason.strip()) <= 320):
            problems.append(f"{tk}: reason 길이/형식 이상")
            continue
        if any(x in reason for x in ("<", ">", "parameter", "record_move_reasons")):
            problems.append(f"{tk}: reason 에 도구 호출 조각이 섞임")
            continue
        basis = m.get("basis")
        if basis not in ("news", "market", "none"):
            problems.append(f"{tk}: basis 이상 {basis!r}")
            continue
        ids = [i for i in (m.get("headline_ids") or []) if isinstance(i, int) and i in allowed_ids.get(tk, set())]
        if basis == "news" and not ids:
            problems.append(f"{tk}: basis=news 인데 유효한 기사 번호가 없음")
            continue
        cleaned[tk] = {"reason": reason.strip(), "basis": basis, "ids": ids}

    for tk in expected:
        if tk not in cleaned and not any(tk in p for p in problems):
            problems.append(f"{tk}: 누락")
    return cleaned, problems


def call_model(prompt):
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[TOOL],
        tool_choice={"type": "tool", "name": "record_move_reasons"},
        messages=[{"role": "user", "content": prompt}],
    )
    for block in resp.content:
        if block.type == "tool_use" and block.name == "record_move_reasons":
            return block.input
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="프롬프트만 출력하고 API는 호출하지 않음")
    args = parser.parse_args()

    book = load_json(PORTFOLIO_PATH)
    if not book:
        print("my-portfolio.json 을 읽지 못했습니다.", file=sys.stderr)
        return 1

    now = datetime.datetime.now(KST)
    print("시장 지수 시계열 조회...")
    series = market_series()

    holdings = []
    for h in book.get("holdings", []):
        px, prev = h.get("price"), h.get("prevClose")
        if not (px and prev):
            continue
        session = last_session(h["ticker"])
        holdings.append({
            "ticker": h["ticker"], "name": h.get("name") or h["ticker"], "currency": h.get("currency", ""),
            "changePct": round((px / prev - 1) * 100, 2),
            "session": session or "날짜 미상",
            "market": moves_on(series, session) if session else {},
            "headlines": gather_headlines(h["ticker"], now, session),
        })
    if not holdings:
        print("전일 종가가 있는 보유 종목이 없습니다 — update_prices.py 를 먼저 실행하세요.", file=sys.stderr)
        return 1

    for h in holdings:
        print(f"  {h['ticker']:<11} {h['session']}  {h['changePct']:+.2f}%  시장 {h['market']}")

    prompt, numbered = build_prompt(holdings, now)
    expected = [h["ticker"] for h in holdings]
    print(f"\n종목 {len(holdings)}개, 기사 {len(numbered)}건을 근거로 제공")

    if args.dry_run:
        print("\n----- PROMPT -----\n" + prompt + "\n----- END -----")
        return 0

    cleaned, problems = {}, []
    for attempt in range(1, ATTEMPTS + 1):
        print(f"\nClaude 호출 {attempt}/{ATTEMPTS}...")
        try:
            result = call_model(prompt)
        except Exception as err:
            print(f"  호출 실패: {type(err).__name__}: {str(err)[:140]}", file=sys.stderr)
            continue
        if result is None:
            print("  도구 호출이 반환되지 않음", file=sys.stderr)
            continue
        cleaned, problems = validate(result, expected, numbered)
        print(f"  통과 {len(cleaned)}/{len(expected)}" + (f" · 문제 {len(problems)}건" if problems else ""))
        for p in problems[:6]:
            print(f"    ! {p}", file=sys.stderr)
        if not problems:
            break

    # An incomplete answer is still worth publishing for the tickers that passed;
    # a run where nothing passed must not overwrite yesterday's good file.
    if not cleaned:
        print("\n유효한 설명이 하나도 없어 파일을 갱신하지 않습니다.", file=sys.stderr)
        return 1

    by_ticker = {h["ticker"]: h for h in holdings}
    moves = {}
    for tk in expected:
        h = by_ticker[tk]
        entry = cleaned.get(tk)
        if entry:
            srcs = []
            for hid in entry["ids"]:
                _, it = numbered[hid]
                srcs.append({"title": it["title"], "link": it["link"], "outlet": it["outlet"], "publishedAt": it["publishedAt"]})
            moves[tk] = {"name": h["name"], "changePct": h["changePct"], "session": h["session"],
                         "reason": entry["reason"], "basis": entry["basis"], "sources": srcs}
        else:
            moves[tk] = {"name": h["name"], "changePct": h["changePct"], "session": h["session"],
                         "reason": "설명을 생성하지 못했어요.", "basis": "none", "sources": []}

    out = {
        "generatedAt": now.strftime("%Y-%m-%d %H:%M"),
        "model": MODEL,
        "windowDays": WINDOW_DAYS,
        "moves": moves,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {OUT_PATH.name} — {len(cleaned)}/{len(expected)}종목")
    return 0


if __name__ == "__main__":
    sys.exit(main())
