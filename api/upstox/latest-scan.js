import { db } from "hatchable";
export const methods = ["GET"];
export const access = "public";

async function officialHolidayDates() {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*",
      Referer: "https://www.nseindia.com/"
    };
    const home = await fetch("https://www.nseindia.com/", { headers });
    const cookie = home.headers.get("set-cookie") || "";
    const response = await fetch("https://www.nseindia.com/api/holiday-master?type=trading", {
      headers: { ...headers, Cookie: cookie }
    });
    if (!response.ok) return null;

    const data = await response.json();
    const rows = Array.isArray(data)
      ? data
      : Object.values(data || {}).flat().filter(row => row && typeof row === "object");
    const months = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
    };

    return new Set(rows.map(row => row.tradingDate || row.date || row.holidayDate || row.Date)
      .filter(Boolean)
      .map(value => {
        const date = String(value);
        const numeric = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        const named = date.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
        if (numeric) return numeric[3] + "-" + numeric[2] + "-" + numeric[1];
        if (named && months[named[2]]) return named[3] + "-" + months[named[2]] + "-" + named[1];
        return date.slice(0, 10);
      }));
  } catch (_) {
    return null;
  }
}

export default async function (req, res) {
  const result = await db.query(
    "SELECT generated_at, mode, universe_count, quoted_count, analyzed_count, qualified_count, payload, error_text FROM daily_scan_snapshots WHERE mode = 'live' AND payload IS NOT NULL ORDER BY generated_at DESC LIMIT 1"
  );
  const attempt = await db.query(
    "SELECT generated_at, mode, error_text FROM daily_scan_snapshots ORDER BY generated_at DESC LIMIT 1"
  );
  if (!result.rows.length) {
    return res.json({
      available: false,
      message: "No successful scheduled scan is saved yet.",
      lastAttempt: attempt.rows[0] || null
    });
  }

  const snapshot = result.rows[0];
  const age = Date.now() - new Date(snapshot.generated_at).getTime();
  const indiaDay = new Date(Date.now() + 330 * 60000).getUTCDay();
  const ageThresholdHours = indiaDay === 0 || indiaDay === 6 ? 72 : 36;
  const ageStale = age > ageThresholdHours * 60 * 60 * 1000;
  const analyzed = (snapshot.payload?.stocks || []).filter(stock => stock.analyzed);
  const candleDates = analyzed.map(stock =>
    stock.candleTime ? String(stock.candleTime).slice(0, 10) : null
  );
  const datedCandles = candleDates.filter(Boolean).sort();
  const oldestCandleDate = datedCandles.length ? datedCandles[0] : null;
  const lastCandleDate = datedCandles.length ? datedCandles[datedCandles.length - 1] : null;
  const holidays = await officialHolidayDates();
  const expectedSession = (() => {
    const date = new Date(Date.now() + 330 * 60000);
    for (let i = 0; i < 15; i++) {
      const isoDate = date.toISOString().slice(0, 10);
      if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !(holidays && holidays.has(isoDate))) break;
      date.setUTCDate(date.getUTCDate() - 1);
    }
    return date.toISOString().slice(0, 10);
  })();
  const staleCandleCount = candleDates.filter(date => !date || date < expectedSession).length;
  const candleStale = staleCandleCount > 0;
  const latestAttempt = attempt.rows[0] || null;
  const failedAfterSnapshot = !!(
    latestAttempt &&
    new Date(latestAttempt.generated_at) > new Date(snapshot.generated_at) &&
    (latestAttempt.mode === "partial" || latestAttempt.mode === "error")
  );
  const stale = ageStale || candleStale || failedAfterSnapshot;
  const freshnessReason = failedAfterSnapshot
    ? "A newer scheduled scan was partial or failed; showing the last successful full scan."
    : candleStale
      ? staleCandleCount + " analyzed stocks have candles older than the latest expected trading session or no candle date; holiday calendar availability: " + !!holidays + "."
      : ageStale
        ? "Saved scan is older than the freshness window."
        : "Saved scan is within the freshness checks.";

  return res.json({
    available: true,
    generatedAt: snapshot.generated_at,
    mode: snapshot.mode,
    universeCount: snapshot.universe_count,
    quotedCount: snapshot.quoted_count,
    analyzedCount: snapshot.analyzed_count,
    qualifiedCount: snapshot.qualified_count,
    payload: snapshot.payload,
    lastAttempt: latestAttempt,
    lastCandleDate,
    oldestCandleDate,
    expectedSession,
    staleCandleCount,
    holidayCalendarAvailable: !!holidays,
    stale,
    freshnessReason
  });
}
