// Password gate for the tabs built from the position book (내 포지션, 매매 기록).
// The book is committed encrypted, so the password is checked by decrypting
// it — there is no stored hash to test guesses against offline faster than
// the PBKDF2 key derivation allows.
import { unlockWithPassword, unlockFromSession } from "./book-crypto.js";

const LOCKED_PANELS = ["panel-position", "panel-journal"];

export async function initPositionLock(onUnlock) {
  const panels = LOCKED_PANELS.map(id => document.getElementById(id)).filter(Boolean);
  const forms = Array.from(document.querySelectorAll(".lock-form"));

  let done = false;
  function unlock(book) {
    if (done) return;
    done = true;
    panels.forEach(p => p.classList.remove("is-locked"));
    onUnlock(book);
    window.dispatchEvent(new CustomEvent("igs:unlocked", { detail: { book } }));
    // the map and chart measured a hidden panel; let them re-measure
    window.dispatchEvent(new Event("resize"));
  }

  const remembered = await unlockFromSession();
  if (remembered) { unlock(remembered); return; }

  const active = panels.find(p => p.classList.contains("is-active"));
  active?.querySelector(".lock-form input")?.focus();

  // wrong answers just clear the field: no limit on tries, no lockout
  forms.forEach(form => {
    const input = form.querySelector("input");
    const btn = form.querySelector("button");
    const error = form.parentElement.querySelector(".lock-error");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!input.value) return;
      btn.disabled = true;
      btn.textContent = "확인 중...";
      try {
        const book = await unlockWithPassword(input.value);
        input.value = "";
        unlock(book);
      } catch (err) {
        error.textContent = err && err.name === "OperationError"
          ? "비밀번호가 틀렸어요. 다시 입력해 주세요."
          : "데이터를 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.";
        error.hidden = false;
        input.value = "";
        input.focus();
      } finally {
        btn.disabled = false;
        btn.textContent = "열기";
      }
    });
  });
}
