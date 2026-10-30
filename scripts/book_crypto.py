"""
암호화된 포트폴리오 파일 읽기/쓰기. js/book-crypto.js 와 같은 형식이다.

  {"v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": b64, "iv": b64, "ct": b64}

AES-256-GCM (ct 끝 16바이트가 인증 태그), 키는 비밀번호에서 PBKDF2-SHA256으로 만든다.
비밀번호는 환경변수 PORTFOLIO_PASSWORD (GitHub secret), 로컬에서는 .env 에서 읽는다.
move_reasons 같은 다른 파일도 장부와 같은 salt를 써서, 브라우저가 키 하나로 다 연다.

Usage:
    python scripts/book_crypto.py decrypt data/my-portfolio.enc.json > /tmp/book.json
    python scripts/book_crypto.py encrypt /tmp/book.json data/my-portfolio.enc.json
"""
import base64
import json
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOK_PATH = REPO_ROOT / "data" / "my-portfolio.enc.json"
REASONS_PATH = REPO_ROOT / "data" / "move_reasons.enc.json"
ENV_VAR = "PORTFOLIO_PASSWORD"
ITERATIONS = 600_000

_keys = {}


class NoPassword(RuntimeError):
    pass


def password():
    pw = os.environ.get(ENV_VAR)
    if pw:
        return pw
    env = REPO_ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            k, _, v = line.partition("=")
            if k.strip() == ENV_VAR and v.strip():
                return v.strip().strip('"').strip("'")
    return None


def _b64(b):
    return base64.b64encode(b).decode("ascii")


def _key(pw, salt, iterations):
    cache = (pw, salt, iterations)
    if cache not in _keys:
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
        _keys[cache] = kdf.derive(pw.encode("utf-8"))
    return _keys[cache]


def load(path):
    """Decrypted JSON at `path`, or None if the file is not there. Raises NoPassword."""
    path = Path(path)
    if not path.exists():
        return None
    pw = password()
    if not pw:
        raise NoPassword(f"{ENV_VAR} 가 없어 {path.name} 을 열 수 없습니다.")
    env = json.loads(path.read_text(encoding="utf-8"))
    key = _key(pw, base64.b64decode(env["salt"]), env["iter"])
    plain = AESGCM(key).decrypt(base64.b64decode(env["iv"]), base64.b64decode(env["ct"]), None)
    return json.loads(plain)


def save(path, obj):
    """Encrypt `obj` to `path`, reusing the book's salt so one key opens every file."""
    path = Path(path)
    pw = password()
    if not pw:
        raise NoPassword(f"{ENV_VAR} 가 없어 {path.name} 을 저장할 수 없습니다.")
    salt, iterations = None, ITERATIONS
    for src in (BOOK_PATH, path):
        if src.exists():
            env = json.loads(src.read_text(encoding="utf-8"))
            salt, iterations = base64.b64decode(env["salt"]), env["iter"]
            break
    if salt is None:
        salt = os.urandom(16)
    iv = os.urandom(12)
    plain = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    ct = AESGCM(_key(pw, salt, iterations)).encrypt(iv, plain, None)
    env = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": iterations, "salt": _b64(salt), "iv": _b64(iv), "ct": _b64(ct)}
    path.write_text(json.dumps(env) + "\n", encoding="utf-8")


def main(argv):
    if len(argv) >= 2 and argv[0] == "decrypt":
        print(json.dumps(load(argv[1]), ensure_ascii=False, indent=2))
        return 0
    if len(argv) >= 3 and argv[0] == "encrypt":
        save(argv[2], json.loads(Path(argv[1]).read_text(encoding="utf-8")))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
