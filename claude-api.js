(() => {
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const RATE_LIMIT_KEY = "wellness-journal-claude-rate-log";
const MAX_CALLS_PER_MINUTE = 10;

const PARSER_SYSTEM_PROMPT = `You are a wellness journal parser. Extract activities, quantities, mood/feelings, and observations from natural language input. Return ONLY valid JSON with no preamble or markdown.

Schema:
{
  "activities": {"activity_name": count},
  "mood": {
    "feelings": ["feeling1", "feeling2"],
    "energy_level": null or 0-10,
    "pleasantness": null or 0-10
  },
  "observations": "any contextual notes"
}

Normalize activity names:
- "had coffee" -> "coffee"
- "walked the dog" -> "dog walk"
- "did laundry" -> "laundry"
- "made dinner" / "cooked" -> "made dinner"
- "took my meds" / "medication" -> "adderall"
- "smoked" / "edible" / "used weed" -> "cannabis"
- "drank" / "had a beer" / "wine" -> "alcohol"

Extract quantities when mentioned.`;

const PATTERN_SYSTEM_PROMPT = `You are a wellness pattern analyst. You have access to a user's wellness journal data. Analyze patterns objectively without judgment. Never use words like "goal," "streak," "only," "should." Use "and" not "but." Report facts and correlations only.

When asked about patterns, provide:
1. Relevant statistics
2. Correlations between activities and mood/energy
3. Temporal patterns
4. Concrete observations from the data

Format insights as clear bullet points or short paragraphs.`;

function getRateLog() {
  try {
    return JSON.parse(localStorage.getItem(RATE_LIMIT_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

function saveRateLog(log) {
  localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(log));
}

function enforceRateLimit() {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  const currentLog = getRateLog().filter((timestamp) => timestamp > oneMinuteAgo);

  if (currentLog.length >= MAX_CALLS_PER_MINUTE) {
    throw new Error("Rate limit reached. Try again in a minute.");
  }

  currentLog.push(now);
  saveRateLog(currentLog);
}

function extractJson(text) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first === -1 || last === -1) {
    throw new Error("Claude response did not contain JSON.");
  }

  return trimmed.slice(first, last + 1);
}

async function callClaude({ prompt, systemPrompt, apiKey, maxTokens = 1000 }) {
  if (!apiKey) {
    throw new Error("Anthropic API key not found.");
  }

  enforceRateLimit();

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data && data.content && data.content[0] && data.content[0].text ? data.content[0].text : "";
}

async function parseJournalEntryWithClaude(text, apiKey) {
  const responseText = await callClaude({
    prompt: `Parse this journal entry: "${text}"`,
    systemPrompt: PARSER_SYSTEM_PROMPT,
    apiKey,
    maxTokens: 500,
  });

  return JSON.parse(extractJson(responseText));
}

async function analyzePatternsWithClaude(entries, question, apiKey) {
  return callClaude({
    prompt: `Data: ${JSON.stringify(entries)}\n\nQuestion: "${question}"`,
    systemPrompt: PATTERN_SYSTEM_PROMPT,
    apiKey,
    maxTokens: 900,
  });
}

window.ClaudeApi = {
  analyzePatternsWithClaude,
  callClaude,
  parseJournalEntryWithClaude,
};
})();
