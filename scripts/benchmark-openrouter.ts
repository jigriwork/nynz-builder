import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OpenRouter configuration missing");
const models = process.argv.slice(2);
for (const model of models) {
  const started = Date.now();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4000, reasoning: { effort: "low" }, provider: { sort: "throughput", require_parameters: true, data_collection: "deny" }, response_format: { type: "json_schema", json_schema: { name: "calculator", strict: true, schema: { type: "object", additionalProperties: false, properties: { code: { type: "string" } }, required: ["code"] } } }, messages: [{ role: "user", content: "Return a complete, concise React TypeScript calculator component with arithmetic, decimal input, clear, backspace, keyboard support, accessible labelled buttons and a polished inline CSS layout. No eval or Function constructor. One code string, at most 100 lines. No explanations." }] }),
    });
    if (!response.ok) { console.log(JSON.stringify({ model, status: response.status, seconds: (Date.now() - started) / 1000 })); continue; }
    const body = await response.json();
    console.log(JSON.stringify({ model, served: body.model, seconds: (Date.now() - started) / 1000, outputTokens: body.usage?.completion_tokens, costInr: Number(body.usage?.cost || 0) * 95, finish: body.choices?.[0]?.finish_reason, hasCode: Boolean(JSON.parse(body.choices?.[0]?.message?.content || "{}").code) }));
  } catch (error) { console.log(JSON.stringify({ model, seconds: (Date.now() - started) / 1000, error: error instanceof Error ? error.name : "Request failed" })); }
}
