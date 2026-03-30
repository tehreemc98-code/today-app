export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { city = "Calgary", date, query = "all events", dateRange = "today" } = req.body || {};
  const today = date || new Date().toISOString().split("T")[0];

  // --- Real web scraping helpers ---
  async function scrapeGoogleEvents(q, dateCtx) {
    try {
      const searchQ = encodeURIComponent(q + " events Calgary " + dateCtx);
      const url = "https://www.google.com/search?q=" + searchQ + "&ibp=htl;events";
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(7000)
      });
      const html = await r.text();
      return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 3000);
    } catch (e) { return ""; }
  }

  async function scrapeEventbrite(q) {
    try {
      const slug = (q === "all events" ? "events" : q).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const r = await fetch("https://www.eventbrite.ca/d/canada--calgary/" + slug + "/", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
        signal: AbortSignal.timeout(7000)
      });
      const html = await r.text();
      return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 3000);
    } catch (e) { return ""; }
  }

  async function scrapeMeetup(q) {
    try {
      const r = await fetch("https://www.meetup.com/find/?location=ca--ab--Calgary&source=EVENTS&keywords=" + encodeURIComponent(q === "all events" ? "Calgary" : q), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        signal: AbortSignal.timeout(6000)
      });
      const html = await r.text();
      return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000);
    } catch (e) { return ""; }
  }

  async function scrapeVisitCalgary() {
    try {
      const r = await fetch("https://visitcalgary.com/events/", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        signal: AbortSignal.timeout(6000)
      });
      const html = await r.text();
      return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000);
    } catch (e) { return ""; }
  }

  async function scrapeLuma() {
    try {
      const r = await fetch("https://lu.ma/calgary", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        signal: AbortSignal.timeout(6000)
      });
      const html = await r.text();
      return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000);
    } catch (e) { return ""; }
  }

  async function scrapeTicketmaster() {
    try {
      const r = await fetch("https://www.ticketmaster.ca/search?q=events+calgary", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        signal: AbortSignal.timeout(6000)
      });
      const html = await r.text();
      return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000);
    } catch (e) { return ""; }
  }

  const CATEGORY_IMAGES = {
    music: ["https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&q=80","https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&q=80","https://images.unsplash.com/photo-1501386761578-eaa54b3498b9?w=600&q=80"],
    food: ["https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80","https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80","https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80"],
    arts: ["https://images.unsplash.com/photo-1578926288207-a90a5366759d?w=600&q=80","https://images.unsplash.com/photo-1531243269054-5ebf6f34081e?w=600&q=80","https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=600&q=80"],
    sports: ["https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=600&q=80","https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=600&q=80","https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80"],
    fitness: ["https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&q=80","https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600&q=80","https://images.unsplash.com/photo-1518611012118-696072aa579a?w=600&q=80"],
    nightlife: ["https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=600&q=80","https://images.unsplash.com/photo-1528495612343-9ca9f4a4de28?w=600&q=80","https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&q=80"],
    markets: ["https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=600&q=80","https://images.unsplash.com/photo-1550989460-0adf9ea622e2?w=600&q=80","https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80"],
    outdoor: ["https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&q=80","https://images.unsplash.com/photo-1551632811-561732d1e306?w=600&q=80","https://images.unsplash.com/photo-1533240332313-0db49b459ad6?w=600&q=80"],
    film: ["https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=80","https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=600&q=80"],
    community: ["https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600&q=80","https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=600&q=80"],
    default: ["https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&q=80","https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=80"]
  };

  function getImage(category, index) {
    const imgs = CATEGORY_IMAGES[category] || CATEGORY_IMAGES.default;
    return imgs[index % imgs.length];
  }

  function getDateContext(dateRange, baseDate) {
    const d = new Date(baseDate + "T12:00:00");
    const opts = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
    if (dateRange === "today") return "today, " + d.toLocaleDateString("en-US", opts);
    if (dateRange === "tomorrow") return "tomorrow, " + d.toLocaleDateString("en-US", opts);
    if (dateRange === "weekend") {
      const sat = new Date(d); const sun = new Date(d); sun.setDate(d.getDate()+1);
      return "this weekend (" + sat.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"}) + " and " + sun.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"}) + ")";
    }
    if (dateRange === "week") return "this week (the 7 days starting " + d.toLocaleDateString("en-US", opts) + ")";
    return "today, " + d.toLocaleDateString("en-US", opts);
  }

  const dateContext = getDateContext(dateRange, today);
  const eventCount = dateRange === "week" ? "30-40" : dateRange === "weekend" ? "20-25" : "16-20";
  const queryContext = query && query !== "all events"
    ? 'The user searched for: "' + query + '". Focus on events matching this query but include related events too.'
    : "Return a broad mix of all event types.";

  const [googleSnippet, eventbriteSnippet, meetupSnippet, visitCalgarySnippet, lumaSnippet, ticketmasterSnippet] = await Promise.all([
    scrapeGoogleEvents(query === "all events" ? "Calgary" : query, dateContext),
    scrapeEventbrite(query),
    scrapeMeetup(query),
    scrapeVisitCalgary(),
    scrapeLuma(),
    scrapeTicketmaster()
  ]);

  const scrapedContext = [
    googleSnippet ? "=== Google Events ===\n" + googleSnippet : "",
    eventbriteSnippet ? "=== Eventbrite Calgary ===\n" + eventbriteSnippet : "",
    meetupSnippet ? "=== Meetup Calgary ===\n" + meetupSnippet : "",
    visitCalgarySnippet ? "=== VisitCalgary.com ===\n" + visitCalgarySnippet : "",
    lumaSnippet ? "=== Lu.ma Calgary ===\n" + lumaSnippet : "",
    ticketmasterSnippet ? "=== Ticketmaster Calgary ===\n" + ticketmasterSnippet : ""
  ].filter(Boolean).join("\n\n").substring(0, 7000);

  const imageOptionsText = Object.entries(CATEGORY_IMAGES).map(([cat, urls]) => cat + ": " + urls.join(" | ")).join("\n");

  const prompt = `You are an expert local events researcher for ${city}, Canada.

LIVE DATA FROM REAL SOURCES (use this to inform REAL event names, venues, times, and URLs where possible):
${scrapedContext || "(no live data available - use your knowledge of Calgary events)"}

Based on the above live data AND your knowledge of real Calgary venues, generate events happening in ${city} ${dateContext}.

Use REAL venue names and REAL neighbourhoods:
Neighbourhoods: Kensington, Inglewood, Beltline, Mission, Bridgeland, Eau Claire, East Village, Marda Loop, Hillhurst, Sunnyside, 17th Ave SW, 4th Street SW
Venues: The Palace Theatre, Commonwealth Bar, Arts Commons, Glenbow Museum, National Music Centre, Studio Bell, Calgary Farmers Market, Crossroads Market, Olympic Plaza, Prince's Island Park, The Ironwood Stage, Broken City, Palomino Smokehouse, The Ship & Anchor, TELUS Spark, Repsol Sport Centre, YYC Cycle, The Rec Room, Globe Cinema, Jubilee Auditorium, Big Rock Brewery, Trolley 5 Brewpub, Lulu's Fashion Lounge

${queryContext}

RULES:
- Event NAMES must be SPECIFIC and DESCRIPTIVE.
- Include a "url" field: use REAL URLs from scraped data if found, otherwise use Eventbrite search: "https://www.eventbrite.ca/d/canada--calgary/EVENT-SLUG/" or Google: "https://www.google.com/search?q=EVENT+NAME+Calgary"
- Descriptions must include specific details: instructor name, genre, theme, featured artist.
- Tags should be specific: #hot-yoga, #jazz, #crossfit.
- Vary times: morning (7-10am), afternoon (12-5pm), evening (6pm-midnight).
- Mix free and paid events with specific prices like "$18", "$12-$20", "$35".
- Include an "image" field: pick the most appropriate URL from these options:
${imageOptionsText}

Respond with ONLY valid JSON, no other text:
{
  "events": [
    {
      "name": "Event Name",
      "category": "music",
      "description": "Specific description with details.",
      "venue": "Venue Name",
      "neighbourhood": "Neighbourhood",
      "date": "Today",
      "time": "8:00 PM",
      "price": "Free",
      "url": "https://www.eventbrite.ca/d/canada--calgary/event-slug/",
      "image": "https://images.unsplash.com/photo-XXXXX?w=600&q=80",
      "tags": ["tag1", "tag2"],
      "hot": true,
      "curated": false
    }
  ]
}

category: music, food, arts, sports, fitness, community, nightlife, film, markets, outdoor
Generate ${eventCount} diverse events for ${city} ${dateContext}.`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.ROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.75, max_tokens: 8000 })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      throw new Error("Groq API error: " + groqRes.status + " " + errText);
    }

    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty response from Groq");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.events || !Array.isArray(parsed.events)) throw new Error("No events array in response");

    parsed.events = parsed.events.map((e, i) => ({
      ...e,
      image: e.image || getImage(e.category || "default", i)
    }));

    return res.status(200).json({
      events: parsed.events,
      city,
      date: today,
      dateRange,
      query,
      count: parsed.events.length,
      sources: ["Google Events", "Eventbrite", "Meetup", "VisitCalgary", "Lu.ma", "Ticketmaster"]
    });
  } catch (error) {
    console.error("Scrape error:", error);
    return res.status(500).json({ error: error.message || "Failed to load events", events: [] });
  }
}
