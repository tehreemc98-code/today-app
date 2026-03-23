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
    ? `The user searched for: "${query}". Focus on events matching this query but include related events too.`
    : `Return a broad mix of all event types happening today.`;

  const prompt = `You are an expert local events researcher for ${city}, Canada. Generate a realistic list of events happening in ${city} today based on your knowledge of real venues, neighbourhoods, and event culture.

Use REAL venue names and REAL neighbourhoods from ${city}:
Neighbourhoods: Kensington, Inglewood, Beltline, Mission, Bridgeland, Eau Claire, East Village, Marda Loop, Hillhurst, Sunnyside, 17th Ave SW, 4th Street SW
Venues: The Palace Theatre, Commonwealth Bar, Arts Commons, Glenbow Museum, National Music Centre, Studio Bell, Calgary Farmers Market, Crossroads Market, Olympic Plaza, Prince's Island Park, The Ironwood Stage, Broken City, Palomino Smokehouse, The Ship & Anchor, TELUS Spark Science Centre

${queryContext}

Respond with ONLY valid JSON in this exact format, no other text:
{
  "events": [
    {
      "name": "Event Name",
      "category": "music",
      "description": "One to two sentence description.",
      "venue": "Venue Name",
      "neighbourhood": "Neighbourhood",
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
price: "Free", "$10", "$25-$40", etc.
Generate 16-20 diverse, specific, realistic events for ${city} on ${dayName}.`;

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 6000
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
