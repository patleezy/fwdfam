import { GoogleGenAI, Type } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult, LLMPayload } from "./types";

const SYSTEM_PROMPT = `You are the intelligence engine for FwdFam, an automated family logistics assistant.
Your job is to extract schedule data from unstructured emails, newsletters, and photos of paper flyers.

Rules:
1. Extract Only Events: Ignore marketing text and pleasantries. Only extract actionable events, deadlines, theme days, or requirements.
2. Infer Dates Logically: If a document says "Next Tuesday," calculate the actual date using the email_received_date provided in the user message.
3. Smart Titles: If it's a Theme Day with no time, mark is_all_day=true. If it says "Early Dismissal at 1:00 PM," title it "Early Pickup."
4. Pack the Description: Put packing lists, rules, or instructions into the description field.
5. Timezone: All datetimes must be in the timezone provided in the user message. Use ISO 8601 with timezone offset.
6. Output: Respond ONLY with valid JSON matching the schema. No markdown. No explanation.`;

function buildUserMessage(payload: LLMPayload): string {
  const source = payload.attachments.length > 0 ? "image" : "email";
  return `email_received_date: ${payload.receivedAt}
parent_timezone: ${payload.timezone}
source: ${source}

---CONTENT START---
${payload.emailText}
---CONTENT END---`;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    events: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          start_datetime: { type: Type.STRING },
          end_datetime: { type: Type.STRING },
          is_all_day: { type: Type.BOOLEAN },
          description: { type: Type.STRING },
          confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
        },
        required: ["title", "start_datetime", "end_datetime", "is_all_day", "description", "confidence"],
      },
    },
    extraction_notes: { type: Type.STRING },
  },
  required: ["events"],
};

async function callGemini(payload: LLMPayload, model: string): Promise<ExtractionResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const parts: Array<Record<string, unknown>> = [{ text: buildUserMessage(payload) }];
  for (const att of payload.attachments) {
    parts.push({ inlineData: { mimeType: att.mimeType, data: att.base64Data } });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text ?? "{}";
  return JSON.parse(text) as ExtractionResult;
}

async function callClaude(payload: LLMPayload): Promise<ExtractionResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const content: Anthropic.MessageParam["content"] = [{ type: "text", text: buildUserMessage(payload) }];
  for (const att of payload.attachments) {
    if (att.mimeType === "application/pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: att.base64Data },
      });
    } else {
      content.push({
        type: "image",
        source: { type: "base64", media_type: att.mimeType as "image/jpeg" | "image/png" | "image/webp", data: att.base64Data },
      });
    }
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return JSON.parse(textBlock?.text ?? "{}") as ExtractionResult;
}

export async function extractEvents(payload: LLMPayload): Promise<ExtractionResult> {
  const provider = process.env.LLM_PROVIDER ?? "gemini-flash-lite";
  // 'gemini-flash-lite' -> gemini-3.1-flash-lite (primary -- fast, cost-efficient)
  // 'gemini-flash'      -> gemini-3.5-flash (fallback for low-quality flyer images)
  // 'claude'            -> claude-sonnet-4-6 (secondary fallback)
  if (provider === "gemini-flash-lite") return callGemini(payload, "gemini-3.1-flash-lite");
  if (provider === "gemini-flash") return callGemini(payload, "gemini-3.5-flash");
  if (provider === "claude") return callClaude(payload);
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}
