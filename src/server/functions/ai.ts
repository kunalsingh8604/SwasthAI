import { createServerFn } from "@tanstack/react-start";
import { getServerEnv } from "../env";
import { TRIAGE_TOOL_PROPERTIES, TRIAGE_TOOL_REQUIRED, normalizeTriage } from "@/lib/triage-care";

type Msg = { role: "user" | "assistant" | "system"; content: string | unknown };

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TEXT_MODEL = getServerEnv("GROQ_TEXT_MODEL") || "openai/gpt-oss-20b";
const GROQ_TEXT_FALLBACKS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const GROQ_VISION_MODEL = getServerEnv("GROQ_VISION_MODEL") || "qwen/qwen3.6-27b";
const GROQ_VISION_FALLBACKS = ["qwen/qwen3.8-27b"];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getGroqKey() {
  const key = getServerEnv("GROQ_API_KEY");
  if (!key) {
    throw new Error("GROQ_API_KEY is missing. Add it to .env and restart npm run dev.");
  }
  return key;
}

function uniqueModels(primary: unknown, fallbacks: string[]) {
  return [...new Set([String(primary || ""), ...fallbacks].filter(Boolean))];
}

function isTimeoutError(e: unknown) {
  if (!(e instanceof Error)) return false;
  return (
    e.name === "AbortError" ||
    e.name === "TimeoutError" ||
    /aborted|timeout|took too long/i.test(e.message)
  );
}

async function groqFetch(body: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getGroqKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Keep retrying Groq vision models. Never fall back to a text model (it cannot see photos). */
async function groqVisionChat(body: Record<string, unknown>) {
  const models = uniqueModels(body.model, GROQ_VISION_FALLBACKS);
  const deadline = Date.now() + 75000;
  let delay = 1500;

  while (Date.now() < deadline) {
    for (const model of models) {
      let response: Response;
      try {
        response = await groqFetch({ ...body, model }, 28000);
      } catch {
        continue;
      }

      if (response.ok) return response.json();

      const errText = await response.text();
      console.error("Groq vision error", model, response.status, errText);

      const busy = response.status === 429 || response.status === 503;
      if (!busy && response.status !== 404) {
        throw new Error(`Groq API failed (${response.status}): ${errText.slice(0, 200)}`);
      }
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), 8000);
  }

  throw new Error(
    "Groq photo models are overloaded right now (503). Your photo was not analysed. Wait 30–60 seconds and send the same photo again."
  );
}

async function groqChat(
  body: Record<string, unknown>,
  fallbacks: string[] = [],
  timeoutMs = 20000
) {
  const models = uniqueModels(body.model, fallbacks);
  let lastMessage = "Groq API failed.";

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await groqFetch({ ...body, model }, timeoutMs);
      } catch (e) {
        lastMessage = isTimeoutError(e)
          ? "The photo AI is still working on Groq's side and hit a wait limit. Send the same photo once more."
          : e instanceof Error
            ? e.message
            : "Network error talking to Groq.";
        console.error("Groq request failed", model, lastMessage);
        if (attempt < 2) {
          await sleep(800 * 2 ** attempt);
          continue;
        }
        break;
      }

      if (response.ok) return response.json();

      const errText = await response.text();
      lastMessage = `Groq API failed (${response.status}): ${errText.slice(0, 240)}`;
      console.error("Groq API error", model, response.status, errText);

      const busy = response.status === 429 || response.status === 503;
      const badModel = response.status === 404 || /model_not_found|does not exist/i.test(errText);
      const skipModel =
        response.status === 400 && /image|vision|reasoning|unsupported/i.test(errText);

      if (busy && attempt < 2) {
        await sleep(1200 * 2 ** attempt);
        continue;
      }
      if (busy || badModel || skipModel) break;
      throw new Error(lastMessage);
    }
  }

  throw new Error(
    /busy|over capacity|503|429/i.test(lastMessage)
      ? "The photo AI is busy on Groq right now. Wait about 20 seconds, then send the photo again."
      : lastMessage
  );
}

function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/^\s*(?:analysis|analyze the image|internal monologue)[:\s].*$/gim, "")
    .trim();
}

function assistantText(message: { content?: unknown } | undefined): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content !== "string") return "";
  return stripThinkTags(content);
}

function parseToolArgs(raw: unknown) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

export const triageAiFn = createServerFn({ method: "POST" })
  .inputValidator((data: { messages: Msg[]; language?: "en" | "hi"; userContext?: string }) => data)
  .handler(async ({ data }) => {
    const lang = data.language === "hi" ? "Hindi" : "English";

    const system = `You are Swasthya AI, a powerful and compassionate Agentic Health Companion.
Your goal is to provide the BEST health guidance using available tools and user history.

USER CONTEXT:
${data.userContext || "No history available yet."}

COMMUNICATION STYLE:
- Language: ${lang}.
- Tone: Empathetic, professional, and clear.
- Avoid jargon. Use simple analogies for complex medical terms.

YOUR CAPABILITIES (TOOLS):
1. triage_decision: Use this when the user reports symptoms. Classify as emergency, moderate, or mild.
2. find_nearby_facilities: Use this if the user asks for a hospital, clinic, or pharmacy.
3. analyze_health_history: Use this if the user asks about trends in their past reports or periods.
4. provide_first_aid: Provide immediate, safe first-aid steps while waiting for care.

IMPORTANT RULES:
- NEVER prescribe medication or give final diagnoses.
- For emergencies, ALWAYS prioritize the triage_decision tool and advise immediate hospital visit.
- When using triage_decision, always set condition_label (simple concern name) and care_type (hospital/clinic/doctor/pharmacy) so the app can open the nearby map for the right care.
- If history shows recurring symptoms (e.g., frequent fever), mention it and suggest a detailed checkup.
- Be proactive. If a user asks about a symptom, offer to find a nearby clinic.

Always remind the user that you are an AI and not a replacement for a doctor.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "triage_decision",
          description: "Final triage classification for reported symptoms, plus where to seek care on the map.",
          parameters: {
            type: "object",
            properties: TRIAGE_TOOL_PROPERTIES,
            required: [...TRIAGE_TOOL_REQUIRED],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "find_nearby_facilities",
          description: "Search for hospitals, clinics, or pharmacies nearby.",
          parameters: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["hospital", "clinic", "pharmacy", "doctor"] },
              urgency: { type: "string", enum: ["high", "normal"] },
            },
            required: ["type"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "analyze_health_history",
          description: "Summarize and find trends in user's historical health data.",
          parameters: {
            type: "object",
            properties: {
              focus_area: { type: "string", description: "e.g., symptoms, periods, or prescriptions" },
            },
          },
        },
      },
    ];

    const resData = await groqChat(
      {
        model: GROQ_TEXT_MODEL,
        include_reasoning: false,
        messages: [{ role: "system", content: system }, ...data.messages],
        tools,
      },
      GROQ_TEXT_FALLBACKS
    );

    const choice = resData.choices?.[0]?.message;
    const toolCalls = choice?.tool_calls;

    let triage = null;
    const triageCall = toolCalls?.find((tc: { function?: { name?: string } }) => tc.function?.name === "triage_decision");
    if (triageCall) {
      triage = normalizeTriage(parseToolArgs(triageCall.function.arguments));
    }

    return {
      assistant: assistantText(choice),
      triage,
      toolCalls: toolCalls?.map((tc: { function: { name: string; arguments: unknown } }) => ({
        name: tc.function.name,
        arguments: parseToolArgs(tc.function.arguments),
      })),
    };
  });

export const scanPrescriptionAiFn = createServerFn({ method: "POST" })
  .inputValidator((data: { imageBase64: string; language?: "en" | "hi" }) => data)
  .handler(async ({ data }) => {
    if (!data.imageBase64) {
      throw new Error("imageBase64 required");
    }

    const lang = data.language === "hi" ? "Hindi" : "English";

    const system = `You help ordinary patients understand a prescription photo.
Reply ONLY in ${lang}. Write like you are talking to a family member with no medical training.

STRICT RULES:
- Do NOT show thinking, analysis steps, or tags like <think>.
- Do NOT use Latin or clinic shorthand (no AC, BD, TDS, HS, ante cibum). Say "before food", "twice a day", "at night".
- Do NOT list how you read the image (no "Header", "Analyze the image", "Wait, let's look closer").
- Short sentences. Everyday words only.
- For each medicine: common name, what it is usually for (very short), how to take it, one simple tip.
- Skip anything you cannot read clearly.
- This is not a diagnosis. Do not tell the patient they have a disease.

Use this shape:

Here is your prescription in simple words:

1. Medicine name
   Used for: …
   How to take: …
   Tip: …

2. …

End with: This is only a simple explanation. Follow your doctor, and ask a pharmacist if you are unsure.`;

    const dataUrl = data.imageBase64.startsWith("data:")
      ? data.imageBase64
      : `data:image/jpeg;base64,${data.imageBase64}`;

    const resData = await groqVisionChat({
      model: GROQ_VISION_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Explain only the medicines in this photo, in very simple words. No thinking out loud.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const explanation = assistantText(resData.choices?.[0]?.message);
    return { explanation };
  });

export const visualSymptomAiFn = createServerFn({ method: "POST" })
  .inputValidator((data: { imageBase64: string; note?: string; language?: "en" | "hi" }) => data)
  .handler(async ({ data }) => {
    if (!data.imageBase64) {
      throw new Error("imageBase64 required");
    }

    const lang = data.language === "hi" ? "Hindi" : "English";
    const note = data.note?.trim() || "";

    const dataUrl = data.imageBase64.startsWith("data:")
      ? data.imageBase64
      : `data:image/jpeg;base64,${data.imageBase64}`;

    const visionSystem = `You help patients understand a photo of a physical symptom (skin, rash, acne, wound, swelling, eye, etc.).
Reply ONLY in ${lang}. Write a short, simple answer the patient can read.

RULES:
- Describe what you see in everyday words.
- Say what it may look like (possible concern), not a confirmed disease name.
- Say what they should do next (home care vs clinic vs hospital).
- Never prescribe named medicines.
- No <think> tags. No step-by-step analysis of the image.
- End with: This is an AI opinion, not a doctor's diagnosis.`;

    const userText = note
      ? `Look at this photo. The patient says: "${note}". Explain simply what you notice and what they should do.`
      : "Look at this photo of a physical symptom. Explain simply what you notice and what the patient should do.";

    const visionRes = await groqVisionChat({
      model: GROQ_VISION_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: visionSystem },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const assistant = assistantText(visionRes.choices?.[0]?.message);
    if (!assistant) {
      throw new Error(
        lang === "Hindi"
          ? "फोटो पढ़ नहीं सकी। कृपया साफ़ फोटो भेजें या थोड़ी देर बाद कोशिश करें।"
          : "Could not read that photo. Try a clearer picture, or wait a moment if the photo AI is busy."
      );
    }

    let triage = null;
    try {
      const triageRes = await groqChat(
        {
          model: GROQ_TEXT_MODEL,
          include_reasoning: false,
          messages: [
            {
              role: "system",
              content: `Based on this photo explanation, call triage_decision once. Language: ${lang}.
Photo explanation:
${assistant.slice(0, 2500)}`,
            },
            { role: "user", content: "Classify urgency and where to seek care." },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "triage_decision",
                description: "Classify urgency and suggest nearby care type.",
                parameters: {
                  type: "object",
                  properties: TRIAGE_TOOL_PROPERTIES,
                  required: [...TRIAGE_TOOL_REQUIRED],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "triage_decision" } },
        },
        GROQ_TEXT_FALLBACKS,
        15000
      );

      const triageCall = triageRes.choices?.[0]?.message?.tool_calls?.find(
        (tc: { function?: { name?: string } }) => tc.function?.name === "triage_decision"
      );
      triage = triageCall ? normalizeTriage(parseToolArgs(triageCall.function.arguments)) : null;
    } catch (e) {
      console.error("Photo triage follow-up failed", e);
    }

    return { assistant, triage };
  });
