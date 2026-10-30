// The position book and the daily move explanations are committed encrypted:
// AES-256-GCM with a key derived from the password by PBKDF2-SHA256.
// scripts/book_crypto.py is the Python twin and writes the same envelope:
//   {v, kdf, iter, salt, iv, ct}   (base64; ct ends with the 16-byte GCM tag)
// Every file shares the book's salt, so one derived key opens all of them.
export const BOOK_URL = "data/my-portfolio.enc.json";
export const REASONS_URL = "data/move_reasons.enc.json";
// raw key bytes for this tab session, so a reload doesn't ask again
const KEY_CACHE = "igs-book-key";

let session = null; // { key: CryptoKey, salt, iter }

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function fetchEnvelope(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.json();
}

async function deriveRaw(password, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(salt), iterations: iter }, base, 256);
  return new Uint8Array(bits);
}

const importAes = raw => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

async function open(env, key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) }, key, fromB64(env.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

// Resolves to the decrypted book. A wrong password rejects with an
// OperationError (GCM tag mismatch); a missing file rejects with an Error.
export async function unlockWithPassword(password) {
  const env = await fetchEnvelope(BOOK_URL);
  const raw = await deriveRaw(password, env.salt, env.iter);
  const key = await importAes(raw);
  const book = await open(env, key);
  session = { key, salt: env.salt, iter: env.iter };
  try {
    sessionStorage.setItem(KEY_CACHE, JSON.stringify({ salt: env.salt, iter: env.iter, raw: toB64(raw) }));
  } catch { /* no session storage: just ask again next load */ }
  return book;
}

// The book, if this tab session already unlocked it; otherwise null.
export async function unlockFromSession() {
  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem(KEY_CACHE)); } catch { /* none */ }
  if (!cached || !cached.raw) return null;
  try {
    const env = await fetchEnvelope(BOOK_URL);
    if (env.salt !== cached.salt || env.iter !== cached.iter) throw new Error("rekeyed");
    const key = await importAes(fromB64(cached.raw));
    const book = await open(env, key);
    session = { key, salt: env.salt, iter: env.iter };
    return book;
  } catch {
    try { sessionStorage.removeItem(KEY_CACHE); } catch { /* ignore */ }
    return null;
  }
}

export const isUnlocked = () => session !== null;

// Another encrypted file under the same key, or null (locked, missing, unreadable).
export async function decryptUrl(url) {
  if (!session) return null;
  try {
    return await open(await fetchEnvelope(url), session.key);
  } catch {
    return null;
  }
}

// The envelope text to commit for `obj`, under the session key.
export async function encryptJson(obj) {
  if (!session) throw new Error("locked");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, session.key, new TextEncoder().encode(JSON.stringify(obj)));
  const env = { v: 1, kdf: "PBKDF2-SHA256", iter: session.iter, salt: session.salt, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
  return JSON.stringify(env) + "\n";
}
