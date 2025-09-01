import axios from "axios";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.GROQ_API_KEY || "";
const MODEL = "llama-3.1-8b-instant";

export async function* streamLLM(prompt: string): AsyncGenerator<string> {
  if (!API_KEY) {
    console.warn("[Groq] Missing API key, simulating response...");
    yield `Simulated response for: ${prompt}`;
    return;
  }

  const url = "https://api.groq.com/openai/v1/chat/completions";

  console.log("[Groq] Sending request to:", url);

  const response = await axios.post(
    url,
    {
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      responseType: "stream",
      timeout: 0,
    }
  );

  let buffer: string[] = [];
  const parser = createParser({
    onEvent: (event: EventSourceMessage) => {
      if (event.data === "[DONE]") return;
      try {
        const obj = JSON.parse(event.data);
        const delta = obj?.choices?.[0]?.delta?.content;
        if (delta) {
          buffer.push(delta);
        }
      } catch (err) {
        console.error("[Groq] Parse error:", err);
      }
    },
  });

  for await (const chunk of response.data) {
    const str = chunk.toString();
    console.log("[Groq RAW CHUNK]", str.trim());
    parser.feed(str);

    while (buffer.length) {
      const part = buffer.shift()!;
      console.log("[Groq STREAM]", part);
      yield part;
    }
  }
}
