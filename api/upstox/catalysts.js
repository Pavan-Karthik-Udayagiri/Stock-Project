export const access = "public";
export const methods = ["GET"];

function xmlText(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
export default async function (req, res) {
  const started = Date.now();
  try {
    const q = new URL(req.url || "https://local.invalid").searchParams;
    const symbols = (q.get("symbols") || "").split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9&.-]{1,24}$/.test(s)).slice(0, 8);
    const queries = symbols.length ? symbols.map(s => s + " NSE stock company results order announcement") : ["NSE India listed companies quarterly results order announcement"];
    const results = await Promise.all(queries.map(async query => {
      const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=en-IN&gl=IN&ceid=IN:en";
      const r = await fetch(url, { headers: { Accept: "application/rss+xml,application/xml,text/xml" } });
      if (!r.ok) return [];
      const xml = await r.text();
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map(m => {
        const block = m[1];
        const get = tag => { const x = block.match(new RegExp("<" + tag + ">([\\s\\S]*?)<\\/" + tag + ">")); return x ? xmlText(x[1]) : ""; };
        const link = get("link");
        return { title: get("title"), source: get("source"), publishedAt: get("pubDate"), url: link, query, type: /quarter|profit|revenue|earnings|result/i.test(get("title")) ? "Earnings/results" : /order|contract|deal|approval|acqui|expan/i.test(get("title")) ? "Company announcement" : "News", disclaimer: "Headline only; verify against the official company/NSE/BSE filing." };
      }).filter(x => x.title && x.url);
    }));
    const items = results.flat().sort((a,b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()).slice(0, 30);
    return res.json({ ok: true, source: "Google News RSS search", generatedAt: new Date().toISOString(), symbols, items, note: "News headlines are a discovery aid, not verified exchange filings or a buy signal. Check the linked source and official NSE/BSE/company announcement before acting.", durationMs: Date.now()-started });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || "Catalyst headlines unavailable", generatedAt: new Date().toISOString() });
  }
}