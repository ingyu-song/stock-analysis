"""
One-off exploration script — NOT part of any automation yet.

Authenticates against the Toss Securities Open API and pretty-prints the raw
JSON for /api/accounts and /api/assets so we can see the real response shape
before writing a parser against guessed field names.

This script never runs in CI/GitHub Actions (Toss requires an allow-listed
IP, and hosted Actions runners don't have a stable one) — run it locally.

Setup:
    Set these as local environment variables (never commit them):
        TOSS_CLIENT_ID
        TOSS_CLIENT_SECRET

    PowerShell (persists for future sessions too):
        [Environment]::SetEnvironmentVariable("TOSS_CLIENT_ID", "xxx", "User")
        [Environment]::SetEnvironmentVariable("TOSS_CLIENT_SECRET", "yyy", "User")
        # then open a NEW terminal so the vars are picked up

Usage:
    python scripts/toss_explore.py
"""
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error

BASE_URL = "https://openapi.tossinvest.com"


def get_token(client_id: str, client_secret: str) -> str:
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/oauth2/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        payload = json.load(resp)
    return payload["access_token"]


def get_json(path: str, token: str, account_seq: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if account_seq:
        headers["X-Tossinvest-Account"] = account_seq
    req = urllib.request.Request(f"{BASE_URL}{path}", headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def main():
    client_id = os.environ.get("TOSS_CLIENT_ID")
    client_secret = os.environ.get("TOSS_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("Set TOSS_CLIENT_ID and TOSS_CLIENT_SECRET as environment variables first.", file=sys.stderr)
        sys.exit(1)

    print("Requesting access token...")
    try:
        token = get_token(client_id, client_secret)
    except urllib.error.HTTPError as e:
        print(f"Token request failed: {e.code} {e.read().decode()}", file=sys.stderr)
        print("If this is a 403, double-check the IP allowlist in Toss WTS settings.", file=sys.stderr)
        sys.exit(1)
    print("Got token.\n")

    print("=" * 60)
    print("GET /api/accounts")
    print("=" * 60)
    try:
        accounts = get_json("/api/accounts", token)
        print(json.dumps(accounts, indent=2, ensure_ascii=False))
    except urllib.error.HTTPError as e:
        print(f"FAILED: {e.code} {e.read().decode()}")
        accounts = None

    # Try to find an account identifier to use for the assets call.
    account_seq = None
    if accounts:
        try:
            first = accounts.get("result", accounts) if isinstance(accounts, dict) else accounts
            if isinstance(first, list) and first:
                first = first[0]
            account_seq = str(first.get("accountSeq") or first.get("accountNo") or first.get("id"))
            print(f"\nUsing account identifier for /api/assets: {account_seq}")
        except Exception as e:
            print(f"\nCouldn't auto-detect account identifier from the response above ({e}).")
            print("Paste the accountSeq/id field name you see above and we'll wire it in.")

    print("\n" + "=" * 60)
    print("GET /api/assets")
    print("=" * 60)
    if account_seq:
        try:
            assets = get_json("/api/assets", token, account_seq=account_seq)
            print(json.dumps(assets, indent=2, ensure_ascii=False))
        except urllib.error.HTTPError as e:
            print(f"FAILED: {e.code} {e.read().decode()}")
    else:
        print("Skipped — no account identifier found above. Re-run after we adjust the accountSeq lookup.")


if __name__ == "__main__":
    main()
