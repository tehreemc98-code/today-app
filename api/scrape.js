import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { city = "Calgary", date, query = "all events" } = req.body || {};
  const today = date || new Date().toISOString().split("T")[0];
  const dayName = new Date(today + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });

  const queryContext = query && query !== "all events"
    ? `The user searched for: "${query}". Focus on events matching this query, but also include related events.`
    : `Return a broad mix of all event types happening today.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 8000,
      system: `You are an expert local events researcher for ${city}, Canada. Generate a comprehensive, realistic list of events happening in ${city} today based on your deep knowledge of the city's venues, regular programming, seasonal events, and neighbourhood culture.

Use REAL venue names, REAL neighbourhoods, and event types that genuinely exist in ${city}. Make events feel authentic and specific to the city.

${city} neighbourhoods to use: Kensington, Inglewood, Beltline, Mission, Bridgeland, Eau Claire, East Village, Marda Loop, Hillhurst, Sunnyside, Chinatown, 17th Ave SW, 4th Street SW, Stampede Park area, NW Calgary, NE Calgary.

Real ${city} venues to reference: The Palace Theatre, Commonwealth Bar, Music Mile venues, Arts Commons, Glenbow Museum, National Music Centre, Studio Bell, Calgary Farmers Market, Crossroads Market, Olympic Plaza, Prince's Island Park, Bow River pathways, Eau Claire Market area, TELUS Spark, The Ironwood Stage, Broken City, Commonwealth, Palomino Smokehouse, Analog Bar, The Ship & Anchor, Raw Bar, Catch & The Oyster Bar.

You MUST respond with ONLY valid JSON in this exact format:
{
  "events": [
    {
      "name": "Event Name",
      "category": "music",
      "description": "One to two sentence description.",
      "venue": "Venue Name",
      "neighbourhood": "Neighbourhood",
      "area": "Area",
      "date": "Today",
      "time": "8:00 PM",
      "price": "Free",
      "tags": ["tag1", "tag2"],
      "hot": true,
      "curated": false
    }
  ]
}

category must be one of: music, food, arts, sports, fitness, community, nightlife, film, markets, outdoor
price: "Free", "$10", "$25–$40", etc.
Generate 16–22 events.`,
      messages: [{
        role: "user",
        content: `Find events in ${city} for ${dayName}. ${queryContext} Return ONLY the JSON, no other text.`
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/{[sS]*}/);
    if (!jsonMatch) throw new Error("Invalid response format");

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.events || !Array.isArray(parsed.events)) throw new Error("No events in response");

    return res.status(200).json({
      events: parsed.events,
      city,
      date: today,
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
