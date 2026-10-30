// A viewing gate for the 내 포지션 tab. It is not encryption: the book itself
// is still the public data/my-portfolio.json, so this only keeps the tab
// closed to someone browsing the site. Only a hash of the password lives here.
const SALT = "igs-position:";
const HASH = "f977fa3b015eb67e6759df749a9dcd6b8d8ac114724e70ab271c8f4c4a6a9fac";
// unlocked for this browser tab session; a new session asks again
const SESSION_KEY = "igs-position-unlocked";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

export function initPositionLock() {
  const panel = document.getElementById("panel-position");
  const form = document.getElementById("positionLockForm");
  const input = document.getElementById("positionLockInput");
  const error = document.getElementById("positionLockError");

  function unlock() {
    panel.classList.remove("is-locked");
    // the map and chart measured a hidden panel; let them re-measure
    window.dispatchEvent(new Event("resize"));
  }

  let remembered = false;
  try { remembered = sessionStorage.getItem(SESSION_KEY) === "1"; } catch { /* ask every time */ }
  if (remembered) { unlock(); return; }

  if (panel.classList.contains("is-active")) input.focus();

  // wrong answers just clear the field: no limit on tries, no lockout
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const ok = (await sha256Hex(SALT + input.value)) === HASH;
    if (!ok) {
      error.hidden = false;
      input.value = "";
      input.focus();
      return;
    }
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* fine, ask again next load */ }
    error.hidden = true;
    input.value = "";
    unlock();
  });
}
