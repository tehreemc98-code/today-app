export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url param required" });
  try {
    const decoded = decodeURIComponent(url);
    const allowed = ['eventbrite.ca','eventbrite.com','meetup.com','lu.ma','ticketmaster.ca','visitcalgary.com','artscommons.ca'];
    const hostname = new URL(decoded).hostname.replace('www.','');
    if (!allowed.some(d => hostname.endsWith(d))) {
      return res.status(200).json({ excerpt: null });
    }
    const r = await fetch(decoded, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)", "Accept": "text/html" },
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) return res.status(200).json({ excerpt: null });
    const html = await r.text();
    const ogDesc = (html.match(/<meta[^>]+(?:og:description|description)[^>]+content="([^"]{20,500})"/) || [])[1];
    if (ogDesc) return res.status(200).json({ excerpt: ogDesc.trim() });
    const text = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    return res.status(200).json({ excerpt: text.substring(0,400).trim() || null });
  } catch (error) {
    return res.status(200).json({ excerpt: null });
  }
}
