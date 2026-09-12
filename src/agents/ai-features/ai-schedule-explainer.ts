// ─── AI Schedule Explainer: LLM-powered assignment justifications ─────────────
// Generates human-readable explanations for WHY each staff member got their
// specific shifts, using the LLM to reason about constraints, fairness, and
// trade-offs — not just list numbers.

import Groq from "groq-sdk";
import OpenAI from "openai";
import type { StaffMember, Constraint, DayAssignment, StaffStats } from "../../../scheduler-lib/types";

// ─── Provider Resolution Layer ────────────────────────────────────────────────
// Supports Groq, OpenAI, and any OpenAI-compatible provider (NetMind, etc.).
// Priority: GROQ_API_KEY > OPENAI_API_KEY + OPENAI_BASE_URL > OPENAI_API_KEY only.

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

export interface AssignmentExplanation {
  staffId: string;
  staffName: string;
  totalShifts: number;
  shiftBreakdown: string;
  reasoning: string;
  constraintImpact: string[];
  fairnessNote: string;
}

export interface ScheduleExplanationResult {
  overallSummary: string;
  staffExplanations: AssignmentExplanation[];
  keyInsights: string[];
  processingTimeMs: number;
}

/**
 * Generate LLM-powered explanations for a completed schedule.
 * Analyzes WHY each person got their assignments, not just WHAT they got.
 */
export async function explainScheduleWithAI(
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  staff: StaffMember[],
  month: string,
  holidays: string[] = []
): Promise<ScheduleExplanationResult> {
  const startTime = Date.now();
  const resolved = resolveLLMProvider();

  if (!resolved) {
    return generateFallbackExplanation(assignments, stats, constraints, month);
  }

  // Build a per-staff assignment summary
  const staffAssignments = stats.map((s) => {
    const shifts = assignments
      .filter((a) => a.morning === s.staffId || a.afternoon === s.staffId || a.night === s.staffId)
      .map((a) => {
        if (a.morning === s.staffId) return `${a.date} morning`;
        if (a.afternoon === s.staffId) return `${a.date} afternoon`;
        if (a.night === s.staffId) return `${a.date} night`;
        return null;
      })
      .filter(Boolean);

    // Find constraints affecting this staff
    const staffConstraints = constraints
      .filter((c) => c.staffId === s.staffId)
      .map((c) => `${c.type}: ${c.sourceText || c.id}`);

    return {
      name: s.staffName,
      id: s.staffId,
      total: s.totalCount,
      morning: s.morningCount,
      afternoon: s.afternoonCount,
      night: s.nightCount,
      weekend: s.weekendCount,
      shifts: shifts.slice(0, 15), // cap for token limit
      totalShifts: shifts.length,
      constraints: staffConstraints,
    };
  });

  const avgShifts = stats.length > 0
    ? (stats.reduce((sum, s) => sum + s.totalCount, 0) / stats.length).toFixed(1)
    : "0";

  const systemPrompt = `You are a Schedule Explanation AI. Your job is to explain WHY each staff member received their specific shift assignments in a way that is transparent, fair, and actionable.

For each staff member:
1. Summarize their shift distribution
2. Explain the KEY reasons they got those shifts (constraints, fairness, availability)
3. Note which constraints affected them most
4. Give a fairness assessment relative to the team average

Be concise but insightful. Each explanation should be 2-4 sentences. Focus on the most interesting or unusual aspects — not generic observations.`;

  const userPrompt = `Month: ${month}
Average shifts per person: ${avgShifts}
Team size: ${staffAssignments.length}

Staff assignments:
${staffAssignments.map((s) => `
${s.name} (${s.id}):
  Total: ${s.total} shifts (M:${s.morning} A:${s.afternoon} N:${s.night})
  Weekend: ${s.weekend}
  Constraints: ${s.constraints.length > 0 ? s.constraints.join("; ") : "none"}
  Sample shifts: ${s.shifts.slice(0, 8).join(", ")}
`).join("\n")}

For each staff member, provide:
- A shift breakdown summary
- The reasoning behind their assignments
- How constraints impacted them
- A fairness note comparing them to the team average (${avgShifts} shifts)

Return a JSON object with this exact shape:
{
  "overallSummary": "2-3 sentence summary of the entire schedule",
  "staffExplanations": [
    {
      "staffId": "s1",
      "staffName": "Ada Obi",
      "totalShifts": 10,
      "shiftBreakdown": "10 shifts: 4 morning, 3 afternoon, 3 night",
      "reasoning": "Ada received...",
      "constraintImpact": ["time_off: needed 3 days off from Aug 14"],
      "fairnessNote": "Slightly above average (avg 9.2)"
    }
  ],
  "keyInsights": ["3 high-level insights about the schedule"]
}

Return ONLY the JSON object.`;

  try {
    if (resolved.provider === "groq" && resolved.groq) {
      const response = await resolved.groq.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model: resolved.model,
        temperature: 0.3,
        max_tokens: 4000,
      });
      const content = response.choices[0]?.message?.content?.trim();
      if (!content) return generateFallbackExplanation(assignments, stats, constraints, month);
      return parseAndReturn(content, assignments, stats, constraints, month, startTime);
    }
    if (resolved.openai) {
      const response = await resolved.openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model: resolved.model,
        temperature: 0.3,
        max_tokens: 4000,
      });
      const content = response.choices[0]?.message?.content?.trim();
      if (!content) return generateFallbackExplanation(assignments, stats, constraints, month);
      return parseAndReturn(content, assignments, stats, constraints, month, startTime);
    }
    return generateFallbackExplanation(assignments, stats, constraints, month);
  } catch (err) {
    console.error("[AI Explainer] Failed, using fallback:", err);
    return generateFallbackExplanation(assignments, stats, constraints, month);
  }
}

function parseAndReturn(
  content: string,
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  month: string,
  startTime: number
): ScheduleExplanationResult {
  const jsonStr = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(jsonStr);
  return {
    ...parsed,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Fallback explanation using deterministic rules (no LLM).
 */
function generateFallbackExplanation(
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  month: string
): ScheduleExplanationResult {
  const totalShifts = stats.reduce((sum, s) => sum + s.totalCount, 0);
  const avgShifts = stats.length > 0 ? totalShifts / stats.length : 0;

  const staffExplanations: AssignmentExplanation[] = stats.map((s) => {
    const staffConstraints = constraints.filter((c) => c.staffId === s.staffId);
    const constraintImpacts = staffConstraints.map((c) => {
      switch (c.type) {
        case "time_off": return `Time off ${c.startDate ? "from " + new Date(c.startDate as Date).toLocaleDateString() : ""}${c.daysCount ? ` for ${c.daysCount} days` : ""}`;
        case "unavailable": return `Unavailable on ${c.dates?.length || 0} dates${c.slots ? ` (${c.slots.join(", ")})` : ""}`;
        case "max_shifts": return `Capped at ${c.value} shifts`;
        case "preferred": return `Prefers ${c.slots?.join(", ")} shifts`;
        case "availability": return `Only available on specific days`;
        case "no_night_to_morning": return `Cannot do night then morning`;
        default: return `${c.type} constraint applied`;
      }
    });

    const diff = s.totalCount - avgShifts;
    let fairnessNote = `Exactly at average (${avgShifts.toFixed(1)})`;
    if (diff > 1) fairnessNote = `${diff.toFixed(1)} above average`;
    else if (diff > 0) fairnessNote = `Slightly above average`;
    else if (diff < -1) fairnessNote = `${Math.abs(diff).toFixed(1)} below average`;
    else if (diff < 0) fairnessNote = `Slightly below average`;

    return {
      staffId: s.staffId,
      staffName: s.staffName,
      totalShifts: s.totalCount,
      shiftBreakdown: `${s.totalCount} shifts: ${s.morningCount} morning, ${s.afternoonCount} afternoon, ${s.nightCount} night`,
      reasoning: s.totalCount > avgShifts * 1.3
        ? `${s.staffName} was assigned more shifts due to higher availability and fewer constraints. The LRU scheduler prioritized filling slots fairly while respecting their constraints.`
        : s.totalCount < avgShifts * 0.7 && s.totalCount > 0
        ? `${s.staffName} received fewer shifts due to their constraints (${constraintImpacts.length > 0 ? constraintImpacts.join(", ") : "limited availability"}). The scheduler had fewer eligible days to assign.`
        : `${s.staffName}'s schedule reflects a balance of their preferences and team-wide fairness requirements.`,
      constraintImpact: constraintImpacts,
      fairnessNote,
    };
  });

  return {
    overallSummary: `Schedule for ${month}: ${totalShifts} total shifts across ${stats.length} staff. Average ${avgShifts.toFixed(1)} shifts per person.`,
    staffExplanations,
    keyInsights: [
      stats.filter((s) => s.totalCount === 0).length > 0
        ? `${stats.filter((s) => s.totalCount === 0).length} staff member(s) received no shifts this month`
        : "All staff received at least one shift",
      `Shift type distribution: ${stats.reduce((s, st) => s + st.morningCount, 0)} morning, ${stats.reduce((s, st) => s + st.afternoonCount, 0)} afternoon, ${stats.reduce((s, st) => s + st.nightCount, 0)} night`,
    ],
    processingTimeMs: 0,
  };
}
