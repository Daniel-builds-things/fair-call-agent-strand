// ─── LLM Constraint Parser: Provider-agnostic Natural Language → Structured Constraints ─
// Supports Groq, OpenAI, and any OpenAI-compatible provider (NetMind, etc.).
// Priority: GROQ_API_KEY > OPENAI_API_KEY + OPENAI_BASE_URL > OPENAI_API_KEY only.
// Falls back to regex parser when no LLM key is configured.

import Groq from "groq-sdk";
import OpenAI from "openai";
import type { Constraint, StaffMember } from "./types";

// ─── Provider Resolution Layer ────────────────────────────────────────────────

type LLMProvider = "groq" | "openai" | "netmind";

interface ResolvedProvider {
  provider: LLMProvider;
  model: string;
  groq?: Groq;
  openai?: OpenAI;
}

function resolveLLMProvider(): ResolvedProvider | null {
  const groqApiKey = process.env.GROQ_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.OPENAI_BASE_URL;

  // Priority 1: Groq
  if (groqApiKey) {
    return {
      provider: "groq",
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      groq: new Groq({ apiKey: groqApiKey }),
    };
  }

  // Priority 2: OpenAI-compatible (NetMind, etc.) — key + custom base URL
  if (openaiApiKey && openaiBaseUrl) {
    return {
      provider: "netmind",
      model: process.env.OPENAI_MODEL_ID || "gpt-4o-mini",
      openai: new OpenAI({ apiKey: openaiApiKey, baseURL: openaiBaseUrl }),
    };
  }

  // Priority 3: OpenAI.com — key only
  if (openaiApiKey) {
    return {
      provider: "openai",
      model: "gpt-4o-mini",
      openai: new OpenAI({ apiKey: openaiApiKey }),
    };
  }

  return null;
}

// ─── Constraint Parsing ───────────────────────────────────────────────────────

let constraintCounter = 0;
function nextId(): string {
  return `constraint_llm_${++constraintCounter}`;
}

// System prompt for constraint parsing
const SYSTEM_PROMPT = `You are a scheduling constraint parser. Convert natural language scheduling instructions into structured JSON.

Supported constraint types and their JSON shapes:

1. time_off: Staff needs N consecutive days off
   {"type":"time_off","staff":"Name","startDate":"YYYY-MM-DD","daysCount":N,"priority":"hard"}

2. unavailable: Staff cannot work on specific dates
   {"type":"unavailable","staff":"Name","dates":["YYYY-MM-DD"],"priority":"hard"}

3. availability: Staff only available on specific days of week
   {"type":"availability","staff":"Name","daysOfWeek":[1,2,3,4,5],"priority":"hard"}
   (daysOfWeek: 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat)

4. specific_shift: Staff must work specific shift on specific date
   {"type":"specific_shift","staff":"Name","date":"YYYY-MM-DD","slot":"morning|afternoon|night","priority":"hard"}

5. no_night_to_morning: Staff cannot do night then morning next day
   {"type":"no_night_to_morning","staff":"Name","priority":"hard"}

6. pair_apart: Two staff must NOT work same shift same day
   {"type":"pair_apart","staff":"Name1","targetStaff":"Name2","priority":"hard"}

7. pair_together: Two staff must work same shift same day
   {"type":"pair_together","staff":"Name1","targetStaff":"Name2","priority":"soft"}

8. max_shifts: Staff can work at most N shifts
   {"type":"max_shifts","staff":"Name","value":N,"priority":"soft"}

9. min_shifts: Staff must work at least N shifts
   {"type":"min_shifts","staff":"Name","value":N,"priority":"soft"}

10. no_back_to_back: Staff cannot work consecutive days
    {"type":"no_back_to_back","staff":"Name","priority":"soft"}

11. preferred: Staff prefers certain shift type
    {"type":"preferred","staff":"Name","slot":"morning|afternoon|night","priority":"preference"}

12. balance: Balance shift types for staff
    {"type":"balance","staff":"Name","priority":"preference"}

13. coverage: Minimum staff per shift
    {"type":"coverage","value":N,"slot":"morning|afternoon|night","priority":"soft"}

14. role: Staff has a role
    {"type":"role","staff":"Name","metadata":{"role":"senior|junior|lead"},"priority":"preference"}

15. max_total_slots: Global cap on total filled slots across the entire schedule
    {"type":"max_total_slots","value":N,"priority":"hard"}
    Example: "fill only 10 slots" → {"type":"max_total_slots","value":10,"priority":"hard"}
    Example: "limit the schedule to 15 shifts total" → {"type":"max_total_slots","value":15,"priority":"hard"}

The current month context will be provided. Use it to resolve relative dates like "Aug 5" or "next Monday".

Return ONLY a JSON array of constraint objects. If you cannot parse a constraint, return null for that item.
Do NOT include any text outside the JSON array.`;

/**
 * Parse constraints using LLM (Groq, OpenAI, or compatible).
 * Returns structured Constraint objects.
 */
export async function parseConstraintsWithLLM(
  requests: string[],
  staff: StaffMember[],
  month: Date
): Promise<Constraint[]> {
  const resolved = resolveLLMProvider();
  if (!resolved) {
    return []; // No API key configured, caller should fall back to regex
  }

  const staffList = staff.map((s) => s.name).join(", ");
  const monthStr = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const userPrompt = `Current month: ${monthStr}
Available staff: ${staffList}

Parse these constraints:
${requests.map((r, i) => `${i + 1}. "${r}"`).join("\n")}

Return a JSON array only.`;

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ];

  try {
    let content: string | undefined;

    if (resolved.provider === "groq" && resolved.groq) {
      content = await callGroq(resolved.groq, resolved.model, messages);
    } else if (resolved.openai) {
      content = await callOpenAI(resolved.openai, resolved.model, messages);
    }

    if (!content) return [];

    // Strip markdown code fences if present
    const jsonStr = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonStr) as any[];

    if (!Array.isArray(parsed)) return [];

    const staffMap = new Map(staff.map((s) => [s.name.toLowerCase(), s]));

    return parsed
      .filter(Boolean)
      .map((raw: any) => {
        const primaryStaff = staffMap.get(raw.staff?.toLowerCase());
        const targetStaff = raw.targetStaff
          ? staffMap.get(raw.targetStaff.toLowerCase())
          : undefined;

        const constraint: Constraint = {
          id: nextId(),
          type: raw.type,
          priority: raw.priority || "hard",
          staffId: primaryStaff?.id || "",
          staffName: raw.staff || "",
          targetStaffId: targetStaff?.id,
          targetStaffName: raw.targetStaff,
          sourceText: requests[parsed.indexOf(raw)] || "",
        };

        // Map fields based on constraint type
        if (raw.startDate) constraint.startDate = new Date(raw.startDate);
        if (raw.dates) constraint.dates = raw.dates.map((d: string) => new Date(d));
        if (raw.daysCount) constraint.daysCount = raw.daysCount;
        if (raw.value !== undefined) constraint.value = raw.value;
        if (raw.slot) constraint.slots = [raw.slot];
        if (raw.slots) constraint.slots = raw.slots;
        if (raw.daysOfWeek) constraint.daysOfWeek = raw.daysOfWeek;
        if (raw.metadata) constraint.metadata = raw.metadata;

        // Compute endDate for time_off
        if (raw.type === "time_off" && constraint.startDate && constraint.daysCount) {
          constraint.endDate = new Date(constraint.startDate);
          constraint.endDate.setDate(constraint.endDate.getDate() + constraint.daysCount - 1);
        }

        return constraint;
      })
      .filter((c: Constraint) => c.staffId || c.type === "coverage" || c.type === "max_total_slots"); // filter unresolvable
  } catch (err) {
    console.error("[LLM Parser] Failed to parse constraints:", err);
    return []; // Fall back to regex on error
  }
}

async function callGroq(
  groq: Groq,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<string | undefined> {
  const response = await groq.chat.completions.create({
    messages,
    model,
    temperature: 0,
    max_tokens: 2000,
  });
  return response.choices[0]?.message?.content?.trim();
}

async function callOpenAI(
  openai: OpenAI,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<string | undefined> {
  const response = await openai.chat.completions.create({
    messages,
    model,
    temperature: 0,
    max_tokens: 2000,
  });
  return response.choices[0]?.message?.content?.trim();
}

/**
 * Check if LLM parser is available (any provider configured).
 */
export function isLLMAvailable(): boolean {
  return !!resolveLLMProvider();
}
