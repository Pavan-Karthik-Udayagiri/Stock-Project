export const access = "public";
import { db } from "hatchable";
import { hashState, saveToken } from "lib/upstox.js";
export const methods = ["GET"];
export default async function (req, res) {
  const q = req.query || {}; const code = q.code; const state = q.state;
  if (q.error) return res.status(400).send("<h2>Upstox authorization was not completed</h2><p>" + String(q.error_description || q.error).replace(/[<>]/g, "") + "</p><p><a href='/'>Return to India Swing Desk</a></p>");
  if (!code || !state) return res.status(400).send("Missing Upstox authorization code or state. Return to the dashboard and try Connect Upstox again.");
  const stateHash = await hashState(String(state));
  const check = await db.query("SELECT state_hash FROM upstox_oauth_states WHERE state_hash = $1 AND expires_at > NOW() LIMIT 1", [stateHash]);
  if (!check.rows.length) return res.status(400).send("This Upstox connection link expired or is invalid. Return to the dashboard and try again.");
  await db.query("DELETE FROM upstox_oauth_states WHERE state_hash = $1", [stateHash]);
  const form = new URLSearchParams({ code: String(code), client_id: process.env.UPSTOX_CLIENT_ID || "", client_secret: process.env.UPSTOX_CLIENT_SECRET || "", redirect_uri: process.env.UPSTOX_REDIRECT_URI || "", grant_type: "authorization_code" });
  const response = await fetch("https://api.upstox.com/v2/login/authorization/token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) return res.status(502).send("Upstox token exchange failed. Check that your API key, secret, and redirect URI match the Upstox Developer App, then retry. No token was saved.");
  let profile = {};
  try { const p = await fetch("https://api.upstox.com/v2/user/profile", { headers: { Accept: "application/json", Authorization: "Bearer " + data.access_token } }); const pd = await p.json(); if (p.ok) profile = pd.data || {}; } catch (_) {}
  await saveToken(data.access_token, profile);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send("<!doctype html><html><head><meta name='viewport' content='width=device-width'><title>Upstox Connected</title><style>body{font:16px system-ui;background:#0b1220;color:#e8eef8;display:grid;place-items:center;min-height:90vh}.box{max-width:520px;padding:28px;border:1px solid #26344b;border-radius:16px;background:#111b2d}a{color:#8ab4ff}</style></head><body><div class='box'><h2>Upstox authorization complete</h2><p>Your access token has been encrypted and stored server-side. It is never sent back to the browser.</p><p><a href='/'>Return to India Swing Desk and refresh connection status</a></p></div></body></html>");
}