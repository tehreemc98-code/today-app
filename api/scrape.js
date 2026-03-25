export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { city = "Calgary", date, query = "all events", dateRange = "today" } = req.body || {};
  const today = date || new Date().toISOString().split("T")[0];

  // Build a human-readable date/time context
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
    ? `The user searched for: "${query}". Focus on events matching this query but include related events too.`
    : `Return a broad mix of all event types.`;

  const prompt = `You are an expert local events researcher for ${city}, Canada. Generate a realistic list of events happening in ${city} ${dateContext} based on your knowledge of real venues, neighbourhoods, and event culture.

Use REAL venue names and REAL neighbourhoods from ${city}:
Neighbourhoods: Kensington, Inglewood, Beltline, Mission, Bridgeland, Eau Claire, East Village, Marda Loop, Hillhurst, Sunnyside, 17th Ave SW, 4th Street SW
Venues: The Palace Theatre, Commonwealth Bar, Arts Commons, Glenbow Museum, National Music Centre, Studio Bell, Calgary Farmers Market, Crossroads Market, Olympic Plaza, Prince's Island Park, The Ironwood Stage, Broken City, Palomino Smokehouse, The Ship & Anchor, TELUS Spark Science Centre, Repsol Sport Centre, Yoga Santosha, YYC Cycle, GoodLife Fitness Beltline, The Rec Room, Globe Cinema, Cineplex Odeon Sunridge, Jubilee Auditorium, Big Rock Brewery, Trolley 5 Brewpub, Lulu's Fashion Lounge

${queryContext}

CRITICAL RULES:
- Event NAMES must be SPECIFIC and DESCRIPTIVE. Never generic names like "Fitness Class" or "Music Show".
- Include a "url" field for each event — use the real event website if you know it, or a Google search URL like "https://www.google.com/search?q=EVENT+NAME+Calgary" otherwise.
- For date: use the specific date string like "Saturday, March 29" or "Today" if today.
- Descriptions must include specific details: instructor name, genre, theme, featured artist, or format.
- Tags should be specific: #hot-yoga, #jazz, #crossfit — NOT just #fitness or #music.
- Vary times across morning (7-10am), afternoon (12-5pm), and evening (6pm-midnight).
- Mix free and paid events. Paid events should have specific amounts like "$18", "$12-$20", "$35".

Respond with ONLY valid JSON in this exact format, no other text:
{
  "events": [
    {
      "name": "Event Name",
      "category": "music",
      "description": "One to two sentence description with specific details.",
      "venue": "Venue Name",
      "neighbourhood": "Neighbourhood",
      "date": "Today",
      "time": "8:00 PM",
      "price": "Free",
      "url": "https://www.google.com/search?q=Event+Name+Calgary",
      "tags": ["tag1", "tag2"],
      "hot": true,
      "curated": false
    }
  ]
}

category must be one of: music, food, arts, sports, fitness, community, nightlife, film, markets, outdoor
price: "Free", "$10", "$25-$40", etc.
Generate ${eventCount} diverse, specific, realistic events for ${city} ${dateContext}.`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 8000
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      throw new Error(`Groq API error: ${groqRes.status} ${errText}`);
    }

    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content?.trim();

    if (!text) throw new Error("Empty response from Groq");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.events || !Array.isArray(parsed.events)) throw new Error("No events array in response");

    return res.status(200).json({
      events: parsed.events,
      city,
      date: today,
      dateRange,
      query,
      count: parsed.events.length
    });

  } catch (error) {
    console.error("Scrape error:", error);
    return res.status(500).json({
      error: error.message || "Failed to load events",
      events: []
    });
  }
}
