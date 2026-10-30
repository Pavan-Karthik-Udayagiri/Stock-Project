export const access = "admin";
import { connectionStatus } from "lib/upstox.js";
export const methods = ["GET"];
export default async function (req, res) {
  try { return res.json(await connectionStatus()); }
  catch (e) { return res.status(500).json({ connected: false, message: e.message || "Could not check Upstox status" }); }
}