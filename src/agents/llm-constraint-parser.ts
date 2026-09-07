// ─── LLM Constraint Parser: Groq-powered Natural Language → Structured Constraints ─
// Uses Groq's LLM to semantically understand scheduling constraints.
// Falls back to regex parser when GROQ_API_KEY is not configured.

import Groq from "groq-sdk";
import type { Constraint, StaffMember } from "../types.js";

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

The current month context will be provided. Use it to resolve relative dates like "Aug 5" or "next Monday".

Return ONLY a JSON array of constraint objects. If you cannot parse a constraint, return null for that item.
Do NOT include any text outside the JSON array.`;

/**
 * Parse constraints using Groq LLM.
 * Returns structured Constraint objects.
 */
export async function parseConstraintsWithLLM(
  requests: string[],
  staff: StaffMember[],
  month: Date
): Promise<Constraint[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return []; // No API key, caller should fall back to regex
  }

  const groq = new Groq({ apiKey });

  const staffList = staff.map((s) => s.name).join(", ");
  const monthStr = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const userPrompt = `Current month: ${monthStr}
Available staff: ${staffList}

Parse these constraints:
${requests.map((r, i) => `${i + 1}. "${r}"`).join("\n")}

Return a JSON array only.`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: "qwen/qwen3-32b",
      temperature: 0,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content?.trim();
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
      .filter((c: Constraint) => c.staffId || c.type === "coverage"); // filter unresolvable
  } catch (err) {
    console.error("[LLM Parser] Failed to parse constraints:", err);
    return []; // Fall back to regex on error
  }
}

/**
 * Check if LLM parser is available (API key configured).
 */
export function isLLMAvailable(): boolean {
  return !!process.env.GROQ_API_KEY;
}
