import { db } from "hatchable";

const enc = new TextEncoder();
function b64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(s) { const raw = atob(s); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
async function digest(text) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))); }
async function aesKey() {
  const secret = process.env.UPSTOX_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 24) throw new Error("Set UPSTOX_TOKEN_ENCRYPTION_KEY (at least 24 characters) in project Setup.");
  const raw = await digest(secret);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function hashState(state) { return b64(await digest(state)); }
let tokenCache = null;
let tokenCacheAt = 0;
export async function saveToken(token, profile) {
  tokenCache = token; tokenCacheAt = Date.now();
  const key = await aesKey(); const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token)));
  await db.query("INSERT INTO upstox_connections (connection_id, encrypted_token, token_iv, updated_at, profile_json) VALUES ('primary', $1, $2, NOW(), $3::jsonb) ON CONFLICT (connection_id) DO UPDATE SET encrypted_token = EXCLUDED.encrypted_token, token_iv = EXCLUDED.token_iv, updated_at = NOW(), profile_json = EXCLUDED.profile_json", [b64(encrypted), b64(iv), JSON.stringify(profile || {})]);
}
export async function getToken() {
  if (tokenCache && Date.now() - tokenCacheAt < 5 * 60 * 1000) return tokenCache;
  const { rows } = await db.query("SELECT encrypted_token, token_iv FROM upstox_connections WHERE connection_id = 'primary' LIMIT 1");
  if (!rows.length) { tokenCache = null; tokenCacheAt = Date.now(); return null; }
  const key = await aesKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rows[0].token_iv) }, key, unb64(rows[0].encrypted_token));
  tokenCache = new TextDecoder().decode(plain); tokenCacheAt = Date.now();
  return tokenCache;
}
export async function apiFetch(path, options = {}) {
  const token = await getToken();
  if (!token) throw new Error("Upstox is not connected. Use Connect Upstox to authorize access.");
  const response = await fetch("https://api.upstox.com" + path, { ...options, headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(options.headers || {}) } });
  const text = await response.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 500) }; }
  if (!response.ok) { const err = new Error((data && data.errors && data.errors[0] && data.errors[0].message) || data.message || ("Upstox API returned HTTP " + response.status)); err.status = response.status; err.upstox = data; throw err; }
  return data;
}
export async function connectionStatus() {
  const { rows } = await db.query("SELECT updated_at FROM upstox_connections WHERE connection_id = 'primary' LIMIT 1");
  if (!rows.length) return { connected: false, message: "Upstox not connected" };
  try {
    await apiFetch("/v2/user/profile");
    return { connected: true, connectedAt: rows[0].updated_at, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { connected: false, message: e.status === 401 ? "Upstox access token expired or revoked. Reconnect Upstox." : e.message, connectedAt: rows[0].updated_at };
  }
}