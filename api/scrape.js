export default async function handler(req, res) {
    if (req.method !== "POST") {
          return res.status(405).json({ error: "Method not allowed" });
    }

  const { city = "Calgary", date, query = "all events", dateRange = "today" } = req.body || {};
    const today = date || new Date().toISOString().split("T")[0];

  // ── Robust fetch with retries ──────────────────────────────────────────────
  async function robustFetch(url, options = {}, retries = 2) {
        const UA_POOL = [
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like ecko) Chrome/124.0.0.0 Safari/537.36",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like ecko) Chrome/123.0.0.0 Safari/537.36",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like ecko) Chrome/120.0.0.0 Safari/537.36",
                "Mozilla/5.0 (compatible; ooglebot/2.1; +http://www.google.com/bot.html)"
              ];
        const ua = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
        const defaultHeaders = {
                "User-Agent": ua,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-CA,en;q=0.9",
                "Cache-Control": "no-cache"
        };
        for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                          const r = await fetch(url, {
                                      ...options,
                                      headers: { ...defaultHeaders, ...(options.headers || {}) },
                                      signal: AbortSignal.timeout(options.timeout || 8000)
                          });
                          if (!r.ok && attempt < retries) {
                                      await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
                                      continue;
                          }
                          return r;
                } catch (e) {
                          if (attempt === retries) throw e;
                          await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
                }
        }
  }

  // ── HTML → clean text helper ────────────────────────────────────────────────
  function htmlToText(html, maxLen = 3000) {
        return html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, maxLen);
  }

  // ── Extract JSON-LD structured data (Event schema) ─────────────────────────
  function extractJsonLd(html) {
        const events = [];
        const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let m;
        while ((m = regex.exec(html)) !== null) {
                try {
                          const data = JSON.parse(m[1].trim());
                          const items = Array.isArray(data) ? data : [data];
                          for (const item of items) {
                                      if (item["@type"] === "Event" || item["@type"] === "MusicEvent" || item["@type"] === "SportsEvent") {
                                                    events.push({
                                                                    name: item.name,
                                                                    date: item.startDate,
                                                                    venue: item.location?.name,
                                                                    address: item.location?.address?.streetAddress,
                                                                    description: (item.description || "").substring(0, 200),
                                                                    url: item.url,
                                                                    price: item.offers?.price || item.offers?.[0]?.price
                                                    });
                                      }
                                      // Handle @graph arrays
                            if (item["@graph"]) {
                                          for (const node of item["@graph"]) {
                                                          if (node["@type"] === "Event") {
                                                                            events.push({
                                                                                                name: node.name,
                                                                                                date: node.startDate,
                                                                                                venue: node.location?.name,
                                                                                                description: (node.description || "").substring(0, 200),
                                                                                                url: node.url
                                                                            });
                                                          }
                                          }
                            }
                          }
                } catch (e) {}
        }
        return events;
  }

  // ── Extract O meta tags ────────────────────────────────────────────────────
  function extractOgMeta(html) {
        const get = (prop) => {
                const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']{1,300})["']`, "i"))
                  || html.match(new RegExp(`<meta[^>]+content=["']([^"']{1,300})["'][^>]+(?:property|name)=["']${prop}["']`, "i"));
                return m ? m[1] : null;
        };
        return {
                title: get("og:title") || get("twitter:title"),
                description: get("og:description") || get("twitter:description") || get("description")
        };
  }

  // ── Eventbrite — scrape listing page + extract structured data ─────────────
  async function scrapeEventbrite(q) {
        try {
                const slug = (q === "all events" ? "events" : q).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                const urls = [
                          `https://www.eventbrite.ca/d/canada--calgary/${slug}/`,
                          `https://www.eventbrite.ca/d/canada--calgary/events/`
                        ];
                for (const url of urls) {
                          const r = await robustFetch(url, { timeout: 9000 });
                          if (!r || !r.ok) continue;
                          const html = await r.text();
                          const ldEvents = extractJsonLd(html);
                          if (ldEvents.length > 0) {
                                      return "=== Eventbrite (structured) ===\n" + JSON.stringify(ldEvents.slice(0, 10), null, 2).substring(0, 3000);
                          }
                          // Fall back to text scrape
                  const text = htmlToText(html, 2500);
                          if (text.length > 100) return "=== Eventbrite Calgary ===\n" + text;
                }
                return "";
        } catch (e) { return ""; }
  }

  // ── Lu.ma — try their public API first, then scrape ────────────────────────
  async function scrapeLuma() {
        try {
                // Try Lu.ma's unofficial public endpoint
          const apiUrl = "https://api.lu.ma/public/v1/calendar/list-events?pagination_limit=20&geo_city=Calgary";
                const apiRes = await robustFetch(apiUrl, {
                          headers: { "Accept": "application/json" },
                          timeout: 7000
                });
                if (apiRes && apiRes.ok) {
                          const data = await apiRes.json();
                          const entries = data.entries || data.events || [];
                          if (entries.length > 0) {
                                      const summaries = entries.slice(0, 10).map(e => ({
                                                    name: e.event?.name || e.name,
                                                    startAt: e.event?.start_at || e.start_at,
                                                    url: e.event?.url ? "https://lu.ma/" + e.event.url : null,
                                                    venue: e.event?.geo_address_info?.city_state || "Calgary",
                                                    description: (e.event?.description || "").substring(0, 150)
                                      }));
                                      return "=== Lu.ma Calgary (API) ===\n" + JSON.stringify(summaries, null, 2).substring(0, 2500);
                          }
                }
        } catch (e) {}
        // Fallback scrape
      try {
              const r = await robustFetch("https://lu.ma/calgary", { timeout: 7000 });
              if (!r || !r.ok) return "";
              const html = await r.text();
              const ldEvents = extractJsonLd(html);
              if (ldEvents.length > 0) return "=== Lu.ma (structured) ===\n" + JSON.stringify(ldEvents.slice(0, 8), null, 2).substring(0, 2000);
              return "=== Lu.ma Calgary ===\n" + htmlToText(html, 2000);
      } catch (e) { return ""; }
  }

  // ── Meetup — scrape with structured extraction ─────────────────────────────
  async function scrapeMeetup(q) {
        try {
                const kw = q === "all events" ? "Calgary" : encodeURIComponent(q);
                const r = await robustFetch(
                          `https://www.meetup.com/find/?location=ca--ab--Calgary&source=EVENTS&keywords=${kw}`,
                  { timeout: 8000 }
                        );
                if (!r || !r.ok) return "";
                const html = await r.text();
                const ldEvents = extractJsonLd(html);
                if (ldEvents.length > 0) return "=== Meetup (structured) ===\n" + JSON.stringify(ldEvents.slice(0, 8), null, 2).substring(0, 2000);
                return "=== Meetup Calgary ===\n" + htmlToText(html, 2000);
        } catch (e) { return ""; }
  }

  // ── VisitCalgary — scrape with RSS fallback
  async function scrapeVisitCalgary() {
        try {
                const rssR = await robustFetch("https://visitcalgary.com/feed/?post_type=event", { timeout: 7000 });
                if (rssR && rssR.ok) {
                          const rssText = await rssR.text();
                          if (rssText.includes("<item>")) {
                                      const items = [];
                                      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
                                      let m;
                                      while ((m = itemRegex.exec(rssText)) !== null && items.length < 12) {
                                                    const ih = m[1];
                                                    const title = (ih.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || ih.match(/<title>(.*?)<\/title>/) || [])[1] || "";
                                                    const link = (ih.match(/<link>(.*?)<\/link>/) || [])[1] || "";
                                                    const desc = (ih.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || "";
                                                    const pubDate = (ih.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";
                                                    if (title) items.push({ title, link, pubDate, description: htmlToText(desc, 200) });
                                      }
                                      if (items.length > 0) return "=== VisitCalgary (RSS) ===\n" + JSON.stringify(items, null, 2).substring(0, 2500);
                          }
                }
        } catch (e) {}
        try {
                const r = await robustFetch("https://visitcalgary.com/events/", { timeout: 7000 });
                if (!r || !r.ok) return "";
                const html = await r.text();
                const ldEvents = extractJsonLd(html);
                if (ldEvents.length > 0) return "=== VisitCalgary (structured) ===\n" + JSON.stringify(ldEvents.slice(0, 8), null, 2).substring(0, 2000);
                return "=== VisitCalgary ===\n" + htmlToText(html, 2000);
        } catch (e) { return ""; }
  }

  // ── oogle Events ─────────────────────────────────────────────────────────
  async function scrapeoogleEvents(q, dateCtx) {
        try {
                const searchQ = encodeURIComponent((q === "all events" ? "Calgary" : q) + " events Calgary " + dateCtx);
                const url = `https://www.google.com/search?q=${searchQ}&ibp=htl;events`;
                const r = await robustFetch(url, {
                          headers: {
                                      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like ecko) Chrome/124.0.0.0 Safari/537.36",
                                      "Accept": "text/html,application/xhtml+xml",
                                      "Accept-Language": "en-CA,en;q=0.9",
                                      "Referer": "https://www.google.com/"
                          },
                          timeout: 9000
                });
                if (!r || !r.ok) return "";
                const html = await r.text();
                const vcardMatch = html.match(/"title":"([^"]{5,80})","when":"([^"]{5,50})","where":"([^"]{5,80})"/g);
                if (vcardMatch && vcardMatch.length > 0) {
                          return "=== oogle Events (extracted) ===\n" + vcardMatch.slice(0, 15).join("\n");
                }
                return "=== oogle Events ===\n" + htmlToText(html, 3000);
        } catch (e) { return ""; }
  }

  // ── Ticketmaster ─────────────────────────────────────────────────────────
  async function scrapeTicketmaster() {
        try {
                const r = await robustFetch(
                          "https://app.ticketmaster.com/discovery/v2/events.json?city=Calgary&countryCode=CA&size=10&sort=date%2Casc",
                  { headers: { "Accept": "application/json" }, timeout: 7000 }
                        );
                if (r && r.ok) {
                          const data = await r.json();
                          const events = (data?._embedded?.events || []).map(e => ({
                                      name: e.name,
                                      date: e.dates?.start?.localDate,
                                      time: e.dates?.start?.localTime,
                                      venue: e._embedded?.venues?.[0]?.name,
                                      url: e.url,
                                      priceRange: e.priceRanges ? `$${e.priceRanges[0]?.min}-$${e.priceRanges[0]?.max}` : null
                          }));
                          if (events.length > 0) return "=== Ticketmaster (API) ===\n" + JSON.stringify(events, null, 2).substring(0, 2500);
                }
        } catch (e) {}
        try {
                const r = await robustFetch("https://www.ticketmaster.ca/search?q=events+calgary", { timeout: 7000 });
                if (!r || !r.ok) return "";
                const html = await r.text();
                return "=== Ticketmaster Calgary ===\n" + htmlToText(html, 2000);
        } catch (e) { return ""; }
  }

  // ── Arts Commons ──────────────────────────────────────────────────────────
  async function scrapeArtsCommons() {
        try {
                const r = await robustFetch("https://artscommons.ca/events/", { timeout: 7000 });
                if (!r || !r.ok) return "";
                const html = await r.text();
                const ldEvents = extractJsonLd(html);
                if (ldEvents.length > 0) return "=== Arts Commons (structured) ===\n" + JSON.stringify(ldEvents.slice(0, 8), null, 2).substring(0, 2000);
                return "=== Arts Commons ===\n" + htmlToText(html, 1500);
        } catch (e) { return ""; }
  }

  // ── Calgary Open Data ─────────────────────────────────────────────────────
  async function scrapeCalgaryOpenData() {
        try {
                const r = await robustFetch(
                          "https://data.calgary.ca/resource/events.json?$limit=20&$order=start_datetime%20ASC",
                  { headers: { "Accept": "application/json" }, timeout: 7000 }
                        );
                if (r && r.ok) {
                          const data = await r.json();
                          if (Array.isArray(data) && data.length > 0) {
                                      const evts = data.map(e => ({
                                                    name: e.event_name || e.title,
                                                    date: e.start_datetime,
                                                    venue: e.facility_name || e.location,
                                                    description: (e.description || "").substring(0, 200)
                                      })).filter(e => e.name);
                                      if (evts.length > 0) return "=== Calgary Open Data ===\n" + JSON.stringify(evts, null, 2).substring(0, 2000);
                          }
                }
        } catch (e) {}
        return "";
  }

  // ── Image pool ────────────────────────────────────────────────────────────
  const CATEORY_IMAES = {
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
        const imgs = CATEORY_IMAES[category] || CATEORY_IMAES.default;
        return imgs[index % imgs.length];
  }

  function getDateContext(dateRange, baseDate) {
        const d = new Date(baseDate + "T12:00:00");
        const opts = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
        if (dateRange === "today") return "today, " + d.toLocaleDateString("en-US", opts);
        if (dateRange === "tomorrow") return "tomorrow, " + d.toLocaleDateString("en-US", opts);
        if (dateRange === "weekend") {
                const sat = new Date(d);
                const sun = new Date(d);
                sun.setDate(d.getDate() + 1);
                return "this weekend (" + sat.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) +
                          " and " + sun.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) + ")";
        }
        if (dateRange === "week") return "this week (the 7 days starting " + d.toLocaleDateString("en-US", opts) + ")";
        return "today, " + d.toLocaleDateString("en-US", opts);
  }

  const dateContext = getDateContext(dateRange, today);
    const eventCount = dateRange === "week" ? "30-40" : dateRange === "weekend" ? "20-25" : "16-20";
    const queryContext = query && query !== "all events"
      ? `The user searched for: "${query}". Focus on events matching this query but include related events too.`
          : "Return a broad mix of all event types.";

  // Run all scrapers in parallel
  const scraperResults = await Promise.allSettled([
        scrapeoogleEvents(query === "all events" ? "Calgary" : query, dateContext),
        scrapeEventbrite(query),
        scrapeMeetup(query),
        scrapeVisitCalgary(),
        scrapeLuma(),
        scrapeTicketmaster(),
        scrapeArtsCommons(),
        scrapeCalgaryOpenData()
      ]);

  const [
        googleSnippet, eventbriteSnippet, meetupSnippet, visitCalgarySnippet,
        lumaSnippet, ticketmasterSnippet, artsCommonsSnippet, openDataSnippet
      ] = scraperResults.map(r => r.status === "fulfilled" ? (r.value || "") : "");

  const sourceMap = {
        "oogle Events": googleSnippet, "Eventbrite": eventbriteSnippet,
        "Meetup": meetupSnippet, "VisitCalgary": visitCalgarySnippet,
        "Lu.ma": lumaSnippet, "Ticketmaster": ticketmasterSnippet,
        "Arts Commons": artsCommonsSnippet, "Calgary Open Data": openDataSnippet
  };
    const successfulSources = Object.entries(sourceMap)
      .filter(([, v]) => v && v.length > 50).map(([k]) => k);

  const scrapedContext = [
        googleSnippet, eventbriteSnippet, meetupSnippet, visitCalgarySnippet,
        lumaSnippet, ticketmasterSnippet, artsCommonsSnippet, openDataSnippet
      ].filter(Boolean).join("\n\n").substring(0, 9000);

  const imageOptionsText = Object.entries(CATEORY_IMAES)
      .map(([cat, urls]) => cat + ": " + urls.join(" | ")).join("\n");

  const prompt = `You are an expert local events researcher for ${city}, Canada. Today is ${today}.

  LIVE DATA FROM REAL SOURCES (prioritize REAL event names, venues, dates, URLs from here):
  ${scrapedContext || "(no live data available — use your knowledge of real Calgary events and venues)"}

  enerate events happening in ${city} ${dateContext}.
  Real neighbourhoods: Kensington, Inglewood, Beltline, Mission, Bridgeland, Eau Claire, East Village, Marda Loop, Hillhurst, Sunnyside, 17th Ave SW, 4th Street SW
  Real venues: The Palace Theatre, Commonwealth Bar, Arts Commons, lenbow Museum, National Music Centre, Studio Bell, Calgary Farmers Market, Crossroads Market, Olympic Plaza, Prince's Island Park, The Ironwood Stage, Broken City, Palomino Smokehouse, The Ship & Anchor, TELUS Spark, Repsol Sport Centre, YYC Cycle, The Rec Room, lobe Cinema, Jubilee Auditorium, Big Rock Brewery, Trolley 5 Brewpub, Lulu's Fashion Lounge

  ${queryContext}

  RULES:
  - If scraped data has REAL event names, use them exactly. Do NOT fabricate events when real data is available.
  - Event NAMES must be SPECIFIC and DESCRIPTIVE (not generic like "Live Music Night").
  - "url": use REAL URLs from scraped data where found. Otherwise use Eventbrite or oogle search URL.
  - Descriptions must include specific details: instructor name, genre, theme, featured artist.
  - Tags must be specific: #hot-yoga, #jazz, #crossfit.
  - Vary times: morning (7-10am), afternoon (12-5pm), evening (6pm-midnight).
  - Mix free and paid events: "$18", "$12-$20", "$35".
  - "image" field from these options:
  ${imageOptionsText}

  Respond ONLY with valid JSON:
  {
    "events": [
        {
              "name": "Event Name", "category": "music", "description": "Specific description.",
                    "venue": "Venue Name", "neighbourhood": "Neighbourhood", "date": "Today",
                          "time": "8:00 PM", "price": "Free", "url": "https://...",
                                "image": "https://images.unsplash.com/...", "tags": ["tag1", "tag2"],
                                      "hot": true, "curated": false
                                          }
                                            ]
                                            }
                                            category: music, food, arts, sports, fitness, community, nightlife, film, markets, outdoor
                                            eneerate ${eventCount} diverse events for ${city} ${dateContext}.\`;

                                              try {
                                                  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                                        method: "POST",
                                                              headers: {
                                                                      "Content-Type": "application/json",
                                                                              "Authorization": `Bearer ${process.env.ROQ_API_KEY}`
                                                                                    },
                                                                                          body: JSON.stringify({
                                                                                                  model: "llama-3.3-70b-versatile",
                                                                                                          messages: [{ role: "user", content: prompt }],
                                                                                                                  temperature: 0.65,
                                                                                                                          max_tokens: 8000
                                                                                                                                })
                                                                                                                                    });
                                                                                                                                    
                                                                                                                                        if (!groqRes.ok) {
                                                                                                                                              const errText = await groqRes.text();
                                                                                                                                                    throw new Error("roq API error: " + groqRes.status + " " + errText);
                                                                                                                                                        }
                                                                                                                                                        
                                                                                                                                                            const groqData = await groqRes.json();
                                                                                                                                                                const text = groqData.choices?.[0]?.message?.content?.trim();
                                                                                                                                                                    if (!text) throw new Error("Empty response from roq");
                                                                                                                                                                    
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
                                                                                                                                                                                                                        city, date: today, dateRange, query,
                                                                                                                                                                                                                              count: parsed.events.length,
                                                                                                                                                                                                                                    sources: successfulSources.length > 0 ? successfulSources : ["AI generated"],
                                                                                                                                                                                                                                          liveDataFound: successfulSources.length > 0
                                                                                                                                                                                                                                              });
                                                                                                                                                                                                                                                } catch (error) {
                                                                                                                                                                                                                                                    console.error("Scrape error:", error);
                                                                                                                                                                                                                                                        return res.status(500).json({ error: error.message || "Failed to load events", events: [] });
                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                          }
