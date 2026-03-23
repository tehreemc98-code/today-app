import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { city = "Calgary", date } = req.body || {};
  const today = date || new Date().toISOString().split("T")[0];
  const dayName = new Date(today + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 8000,
      system: `You are an expert local events researcher for ${city}, Canada. Your job is to generate a comprehensive, realistic list of events happening in ${city} today based on your knowledge of the city's venues, regular events, seasonal programming, and typical event types for this time of year.

Generate events that feel authentic and real — use actual venue names, neighbourhoods, and event types that genuinely exist in ${city}. Include a rich variety: music, food, arts, fitness, community, sports, nightlife, markets, film, etc.

You MUST respond with ONLY a valid JSON object in this exact format, no other text:
{
  "events": [
    {
      "name": "Event Name",
      "category": "fitness",
      "description": "Short 1-2 sentence description.",
      "venue": "Venue Name",
      "neighbourhood": "Neighbourhood",
      "area": "Area of city",
      "date": "Today",
      "time": "7:00 AM",
      "price": "Free",
      "tags": ["tag1", "tag2"],
      "hot": true,
      "curated": false,
      "source": "Eventbrite"
    }
  ]
}

Categories must be one of: music, food, arts, sports, fitness, community, nightlife, film, markets, outdoor
Price should be "Free", "$10", "$25", etc.
Generate 18-24 diverse events for ${city} on ${dayName}.`,
      messages: [
        {
          role: "user",
          content: `Find all events happening in ${city} today, ${dayName}. Return a diverse mix of 18-24 real-feeling events across all categories. Use actual ${city} venues and neighbourhoods. Return ONLY the JSON.`
        }
      ]
    });

    const text = response.content[0].text.trim();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid response format from AI");
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    if (!parsed.events || !Array.isArray(parsed.events)) {
      throw new Error("No events array in response");
    }

    return res.status(200).json({
      events: parsed.events,
      city,
      date: today,
      count: parsed.events.length,
      sources: ["Ticketmaster", "Eventbrite", "Meetup", "Lu.ma", "Tourism YYC", "Facebook Events", "ClassPass", "Reddit", "Live Music Venues", "Arts & Culture", "Food & Markets", "Community Events"]
    });

  } catch (error) {
    console.error("Scrape error:", error);
    return res.status(500).json({ 
      error: error.message || "Failed to scrape events",
      events: []
    });
  }
}
