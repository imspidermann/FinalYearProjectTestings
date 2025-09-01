import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const MODEL = "mixtral-8x7b"; // or llama3-70b-8192 depending on availability

export async function* streamLLM(prompt: string): AsyncGenerator<string> {
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: true
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      responseType: "stream"
    }
  );

  const stream = res.data;
  for await (const chunk of stream) {
    const text = chunk.toString();
    // naive parse
    const match = text.match(/"content":"(.*?)"/);
    if (match) yield match[1].replace(/\\n/g, "\n");
  }
}
