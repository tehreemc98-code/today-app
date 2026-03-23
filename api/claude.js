import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid messages" });
  }

  try {
    const response = await client.messages.create({
                                                        model: "claude-opus-4-5",
                                                        max_tokens: 8096,
                                                        system: system || "You are a helpful assistant for a Today task app. Help users plan their day, manage tasks, and stay productive.",
                                                        messages,
                                                      });

    res.status(200).json({
                               content: response.content[0].text,
    });
  } catch (error) {
    console.error("Claude API error:", error);
    res.status(500).json({ error: "Failed to get response from Claude" });
  }
}
