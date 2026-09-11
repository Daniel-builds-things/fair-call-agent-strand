// ─── AI Schedule Query: Natural language questions about the schedule ──────────
// Users can ask questions like:
//   - "Who's working nights this week?"
//   - "What if I add 2 more staff?"
//   - "Can Ada swap with Bob on Aug 20?"
//   - "How many weekend shifts did Chidi get?"
// The LLM analyzes the schedule data and answers in natural language.

import Groq from "groq-sdk";
import type { StaffMember, Constraint, DayAssignment, StaffStats } from "../../../scheduler-lib/types";

export interface ScheduleQueryResult {
  answer: string;
  confidence: "high" | "medium" | "low";
  supportingData?: string;
  suggestedFollowUp?: string[];
  processingTimeMs: number;
}

/**
 * Answer natural language questions about a generated schedule.
 */
export async function queryScheduleWithAI(
  query: string,
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  staff: StaffMember[],
  month: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<ScheduleQueryResult> {
  const startTime = Date.now();
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return generateFallbackQueryAnswer(query, assignments, stats, constraints, staff, month);
  }

  const groq = new Groq({ apiKey });

  // Build schedule context
  const scheduleContext = {
    month,
    staffCount: staff.length,
    staff: staff.map((s) => s.name).join(", "),
    totalAssignments: assignments.filter((a) => a.morning || a.afternoon || a.night).length,
    totalDays: assignments.length,
    stats: stats.map((s) => `${s.staffName}: ${s.totalCount} shifts (M:${s.morningCount} A:${s.afternoonCount} N:${s.nightCount}, W:${s.weekendCount})`),
    recentAssignments: assignments
      .filter((a) => a.morning || a.afternoon || a.night)
      .slice(-20)
      .map((a) => `${a.date}: M=${a.morning || "—"} A=${a.afternoon || "—"} N=${a.night || "—"}`),
    constraints: constraints.map((c) => `${c.staffName}: ${c.sourceText || c.type}`),
  };

  const systemPrompt = `You are a Schedule Query AI. Users ask you questions about a generated shift schedule. You have full access to the schedule data and answer accurately.

Rules:
- Be concise and direct. Answer the question first, then add supporting detail.
- If asked about a specific person, give their exact numbers from the data.
- If asked about "what if" scenarios, reason about the impact but clarify you can't re-run the scheduler.
- If asked about swap feasibility, check both people's constraints.
- If the question can't be answered from the schedule data, say so honestly.
- Suggest 1-2 follow-up questions at the end.

Use the schedule data provided — don't make up numbers.`;

  const userPrompt = `Schedule context:
Month: ${scheduleContext.month}
Staff (${scheduleContext.staffCount}): ${scheduleContext.staff}
Total assignments: ${scheduleContext.totalAssignments} across ${scheduleContext.totalDays} days

Staff stats:
${scheduleContext.stats.join("\n")}

Recent assignments:
${scheduleContext.recentAssignments.join("\n")}

Constraints:
${scheduleContext.constraints.join("\n")}

Conversation history:
${conversationHistory.map((m) => `${m.role}: ${m.content}`).join("\n")}

User question: "${query}"

Answer the question using the schedule data above. Include specific numbers where relevant.

Return a JSON object:
{
  "answer": "Your answer here",
  "confidence": "high",
  "supportingData": "Key data points that support the answer",
  "suggestedFollowUp": ["Follow-up question 1", "Follow-up question 2"]
}

Return ONLY the JSON object.`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userPrompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return generateFallbackQueryAnswer(query, assignments, stats, constraints, staff, month);
    }

    const jsonStr = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonStr);

    return {
      ...parsed,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error("[AI Query] Failed, using fallback:", err);
    return generateFallbackQueryAnswer(query, assignments, stats, constraints, staff, month);
  }
}

// ─── Fallback Query Answer (no LLM) ───────────────────────────────────────────

function generateFallbackQueryAnswer(
  query: string,
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  staff: StaffMember[],
  month: string
): ScheduleQueryResult {
  const lower = query.toLowerCase();
  const staffMap = new Map(staff.map((s) => [s.name.toLowerCase(), s]));

  // Try to match the query to a staff member
  let targetStaff: StaffMember | null = null;
  for (const [name, s] of staffMap) {
    if (lower.includes(name)) {
      targetStaff = s;
      break;
    }
  }

  let answer = "";
  let supportingData = "";
  let suggestedFollowUp: string[] = [];

  if (lower.includes("who") && lower.includes("night") && (lower.includes("week") || lower.includes("this"))) {
    // "Who's working nights this week?"
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const nightWorkers = assignments
      .filter((a) => {
        const d = new Date(a.date + "T00:00:00");
        return d >= weekStart && d <= weekEnd && a.night;
      })
      .map((a) => `${a.date}: ${a.night}`);

    answer = nightWorkers.length > 0
      ? `Night shifts this week:\n${nightWorkers.join("\n")}`
      : "No night shifts found for the current week.";
    supportingData = `Scanned ${assignments.length} days, found ${nightWorkers.length} night assignments in the current week.`;
    suggestedFollowUp = ["Who's working mornings?", "How many total night shifts are there this month?"];
  } else if (lower.includes("how many") && targetStaff) {
    const s = stats.find((st) => st.staffId === targetStaff!.id);
    if (s) {
      answer = `${s.staffName} has ${s.totalCount} total shifts: ${s.morningCount} morning, ${s.afternoonCount} afternoon, ${s.nightCount} night, ${s.weekendCount} weekend.`;
      supportingData = `Stats for ${s.staffName}: ${JSON.stringify(s)}`;
    }
    suggestedFollowUp = ["How does that compare to the average?", "What constraints affect this person?"];
  } else if (lower.includes("swap") && lower.includes("with")) {
    answer = `To analyze a swap, I need to check both staff members' constraints and current assignments. The scheduler would need to re-run to confirm feasibility.`;
    supportingData = "Swap analysis requires constraint checking for both parties.";
    suggestedFollowUp = ["What constraints affect each person?", "Can you show me both their schedules?"];
  } else if (lower.includes("average")) {
    const avg = stats.length > 0 ? (stats.reduce((sum, s) => sum + s.totalCount, 0) / stats.length).toFixed(1) : "0";
    answer = `The average is ${avg} shifts per person across ${stats.length} staff. Total shifts: ${stats.reduce((s, st) => s + st.totalCount, 0)}.`;
    supportingData = stats.map((s) => `${s.staffName}: ${s.totalCount}`).join(", ");
    suggestedFollowUp = ["Who's above average?", "Who's below average?"];
  } else if (lower.includes("constraint") || lower.includes("rule")) {
    answer = `There are ${constraints.length} constraints:\n${constraints.map((c) => `- ${c.staffName}: ${c.sourceText || c.type}`).join("\n")}`;
    supportingData = `${constraints.length} constraints parsed.`;
    suggestedFollowUp = ["Which constraints are hard vs soft?", "What if I remove a constraint?"];
  } else if (targetStaff) {
    const s = stats.find((st) => st.staffId === targetStaff!.id);
    if (s) {
      const shifts = assignments
        .filter((a) => a.morning === s.staffId || a.afternoon === s.staffId || a.night === s.staffId)
        .map((a) => {
          if (a.morning === s.staffId) return `${a.date} morning`;
          if (a.afternoon === s.staffId) return `${a.date} afternoon`;
          return `${a.date} night`;
        });

      answer = `${s.staffName} is scheduled for ${s.totalCount} shifts:\n${shifts.slice(0, 15).join("\n")}${shifts.length > 15 ? `\n...and ${shifts.length - 15} more` : ""}`;
      supportingData = `Total: ${s.totalCount} (${s.morningCount}M, ${s.afternoonCount}A, ${s.nightCount}N)`;
    }
  } else {
    answer = `I can help you analyze the schedule for ${month}. Try asking about specific staff members, shift types, constraints, or fairness.`;
    supportingData = "";
    suggestedFollowUp = ["Who has the most shifts?", "How many weekend shifts total?", "Are there any conflicts?"];
  }

  return {
    answer,
    confidence: "medium",
    supportingData,
    suggestedFollowUp,
    processingTimeMs: 0,
  };
}
