# India Swing Desk — v0.2

## What is implemented
- Upstox OAuth authorization-code flow with one-time state validation.
- Access token encrypted server-side with AES-GCM before storage in the project's PostgreSQL database.
- Connection-status check using the Upstox profile endpoint.
- Nifty 500 constituent download from Nifty Indices, matched against Upstox's NSE equity instrument master.
- Upstox V3 quote snapshot for the matched universe (up to 500 instruments per request).
- Daily-candle analysis for up to 60 of the highest traded-value names in each scan, using EMA20/50/200 where available, RSI14, ATR, relative volume, 20-session high and 10-session low.
- Rule-based setup score and trade-plan estimates. Quote-only rows do not get fabricated entry/stop/target/score values.
- Demo mode remains available until a live scan succeeds; live scan errors never silently fall back to sample prices.
- Paper trades remain browser-local and do not place broker orders.
- Account paper-trade risk limits use a server-configured INR 100,000 capital baseline; client-supplied capital values are ignored.

## One-time setup required
1. Create an app in Upstox Developer Apps and enable the market data access required by your account.
2. Set its registered redirect URI to exactly:
   `https://india-swing-trading.hatchable.site/api/upstox/callback`
3. In the Hatchable project console Setup page, configure these project secrets:
   - `UPSTOX_CLIENT_ID` — your Upstox API key/client ID.
   - `UPSTOX_CLIENT_SECRET` — your Upstox API secret.
   - `UPSTOX_REDIRECT_URI` — the exact callback URL above.
   - `UPSTOX_TOKEN_ENCRYPTION_KEY` — a unique random secret at least 24 characters long. Generate locally, for example with `openssl rand -hex 32`. Never commit or send it in chat.
4. Open the dashboard while signed in to the private project and click **Connect Upstox**. Complete the login on Upstox. The callback exchanges the single-use authorization code server-side and stores only an AES-GCM encrypted access token.
5. Return to the dashboard, confirm the status reads connected, and click **Scan Nifty 500**.

If you change the project's domain, update the redirect URI in both Upstox Developer Apps and the project secret. Never paste the API secret, access token, or encryption key into the frontend or a chat.

## Scanner scope and limits
The scanner requests quotes for the matched Nifty 500 universe in a single quote request (Upstox supports up to 500 instruments for full quote snapshots). To respect request latency and API rate limits, technical candle analysis is attempted for up to 60 names ranked by current traded value. The rest are shown as quote-only with no trade plan or score. This is not the same as technical-indicator analysis for every constituent; full-universe candle analysis needs caching, scheduled refresh, and further rate-limit validation.

Indicators are calculated from the available daily candle history. Signals are rule-based examples for research, not a probability of profit. Verify quote and candle timestamps, corporate actions, liquidity, and current market conditions. No live order placement exists.

## Official references
- Upstox OAuth authentication: https://upstox.com/developer/api-documentation/authentication/
- Upstox NSE instrument master: https://upstox.com/developer/api-documentation/instruments/
- Upstox V3 full market quotes: https://upstox.com/developer/api-documentation/get-full-market-quote-v3/
- Upstox V3 historical candles: https://upstox.com/developer/api-documentation/v3/get-historical-candle-data/
- Nifty Indices Nifty 500 constituents: https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv