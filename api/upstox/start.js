export const access = "public";
import { db } from "hatchable";
import { hashState } from "lib/upstox.js";
export const methods = ["GET"];
export default async function (req, res) {
  const clientId = process.env.UPSTOX_CLIENT_ID;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI;
  if (!clientId || !redirectUri || !process.env.UPSTOX_CLIENT_SECRET || !process.env.UPSTOX_TOKEN_ENCRYPTION_KEY) return res.status(503).json({ error: "Upstox setup is incomplete. Add UPSTOX_CLIENT_ID, UPSTOX_CLIENT_SECRET, UPSTOX_REDIRECT_URI, and UPSTOX_TOKEN_ENCRYPTION_KEY in the project Setup page." });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let state = ""; for (const b of bytes) state += b.toString(16).padStart(2, "0");
  const stateHash = await hashState(state);
  await db.query("INSERT INTO upstox_oauth_states (state_hash, expires_at) VALUES ($1, NOW() + INTERVAL '10 minutes')", [stateHash]);
  const url = new URL("https://api.upstox.com/v2/login/authorization/dialog");
  url.searchParams.set("response_type", "code"); url.searchParams.set("client_id", clientId); url.searchParams.set("redirect_uri", redirectUri); url.searchParams.set("state", state);
  res.json({ url: url.toString(), redirectUri, expiresInMinutes: 10 });
}