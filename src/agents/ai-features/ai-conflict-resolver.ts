// ─── AI Conflict Resolver: LLM-powered conflict analysis and suggestions ──────
// When constraints conflict (e.g., two people want the same day off, or a
// constraint makes a slot unfillable), the LLM analyzes the conflict and
// suggests concrete, actionable alternatives.

import Groq from "groq-sdk";
import type { StaffMember, Constraint, DayAssignment, StaffStats, ScheduleError } from "../../../scheduler-lib/types";

export interface ConflictAnalysis {
  id: string;
  severity: "high" | "medium" | "low";
  type: string;
  description: string;
  affectedStaff: string[];
  affectedDates: string[];
  suggestions: string[];
  tradeOffAnalysis: string;
}

export interface ConflictResolutionResult {
  conflicts: ConflictAnalysis[];
  overallRisk: "high" | "medium" | "low";
  processingTimeMs: number;
}

/**
 * Detect conflicts in constraints and generate AI-powered resolution suggestions.
 */
export async function analyzeConflictsWithAI(
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  errors: ScheduleError[],
  staff: StaffMember[],
  month: string
): Promise<ConflictResolutionResult> {
  const startTime = Date.now();
  const apiKey = process.env.GROQ_API_KEY;

  // First, detect conflicts programmatically
  const detectedConflicts = detectConflicts(assignments, stats, constraints, errors, staff);

  if (detectedConflicts.length === 0) {
    return {
      conflicts: [],
      overallRisk: "low",
      processingTimeMs: Date.now() - startTime,
    };
  }

  if (!apiKey) {
    return {
      conflicts: generateFallbackSuggestions(detectedConflicts),
      overallRisk: detectedConflicts.some((c) => c.severity === "high") ? "high" : "medium",
      processingTimeMs: Date.now() - startTime,
    };
  }

  const groq = new Groq({ apiKey });

  const systemPrompt = `You are a Schedule Conflict Resolution AI. When scheduling constraints conflict, you analyze the trade-offs and suggest concrete, actionable alternatives.

For each conflict:
1. Explain what's in conflict and WHY
2. Analyze the trade-offs of each resolution option
3. Suggest 2-3 concrete alternatives the user could try
4. Be fair — don't always suggest the same person gives in

Be practical and specific. Each suggestion should be something a manager could actually implement.`;

  const userPrompt = `Month: ${month}

Detected conflicts:
${detectedConflicts.map((c, i) => `
Conflict ${i + 1} (${c.severity}):
  Type: ${c.type}
  Description: ${c.description}
  Affected staff: ${c.affectedStaff.join(", ")}
  Affected dates: ${c.affectedDates.join(", ")}
  Unfilled slots: ${c.unfilledSlots || "N/A"}
`).join("\n")}

Schedule stats:
${stats.map((s) => `${s.staffName}: ${s.totalCount} shifts (M:${s.morningCount} A:${s.afternoonCount} N:${s.nightCount})`).join("\n")}

Constraints:
${constraints.map((c) => `- ${c.staffName}: ${c.sourceText || c.type}`).join("\n")}

For each conflict, provide:
- A trade-off analysis (who benefits from each resolution?)
- 2-3 concrete suggestions the manager could implement

Return a JSON object:
{
  "conflicts": [
    {
      "id": "conflict_1",
      "severity": "high",
      "type": "time_off_overlap",
      "description": "...",
      "affectedStaff": ["Alice", "Bob"],
      "affectedDates": ["2026-08-14", "2026-08-15"],
      "suggestions": ["Suggestion 1", "Suggestion 2"],
      "tradeOffAnalysis": "If Alice gets her dates..."
    }
  ],
  "overallRisk": "medium"
}

Return ONLY the JSON object.`;

  try {
    const response = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      return {
        conflicts: generateFallbackSuggestions(detectedConflicts),
        overallRisk: "medium",
        processingTimeMs: Date.now() - startTime,
      };
    }

    const jsonStr = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(jsonStr);

    return {
      ...parsed,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error("[AI Conflict Resolver] Failed, using fallback:", err);
    return {
      conflicts: generateFallbackSuggestions(detectedConflicts),
      overallRisk: "medium",
      processingTimeMs: Date.now() - startTime,
    };
  }
}

// ─── Programmatic Conflict Detection ──────────────────────────────────────────

interface RawConflict {
  type: string;
  severity: "high" | "medium" | "low";
  description: string;
  affectedStaff: string[];
  affectedDates: string[];
  unfilledSlots?: number;
  constraintIds?: string[];
}

function detectConflicts(
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  errors: ScheduleError[],
  staff: StaffMember[]
): RawConflict[] {
  const conflicts: RawConflict[] = [];
  const staffMap = new Map(staff.map((s) => [s.id, s]));

  // 1. Time-off overlaps: two staff requesting same dates off
  const timeOffConstraints = constraints.filter((c) => c.type === "time_off" && c.startDate);
  for (let i = 0; i < timeOffConstraints.length; i++) {
    for (let j = i + 1; j < timeOffConstraints.length; j++) {
      const a = timeOffConstraints[i];
      const b = timeOffConstraints[j];
      const aStart = new Date(a.startDate as Date).getTime();
      const aEnd = aStart + ((a.daysCount || 1) - 1) * 86400000;
      const bStart = new Date(b.startDate as Date).getTime();
      const bEnd = bStart + ((b.daysCount || 1) - 1) * 86400000;

      if (aStart <= bEnd && bStart <= aEnd) {
        conflicts.push({
          type: "time_off_overlap",
          severity: "medium",
          description: `${a.staffName} and ${b.staffName} both requested time off during overlapping dates`,
          affectedStaff: [a.staffName, b.staffName],
          affectedDates: [],
          constraintIds: [a.id, b.id],
        });
      }
    }
  }

  // 2. Unfilled slots
  const unfilledSlots = errors.filter((e) => e.type === "UNFILLABLE_SLOT");
  if (unfilledSlots.length > 0) {
    const affectedDates = [...new Set(unfilledSlots.map((e) => (e.date ? String(e.date) : "")))].filter(Boolean);
    conflicts.push({
      type: "unfilled_slots",
      severity: unfilledSlots.length > 5 ? "high" : "medium",
      description: `${unfilledSlots.length} shift slot(s) could not be filled — not enough available staff`,
      affectedStaff: [],
      affectedDates,
      unfilledSlots: unfilledSlots.length,
    });
  }

  // 3. Staff with zero shifts
  const zeroShiftStaff = stats.filter((s) => s.totalCount === 0);
  if (zeroShiftStaff.length > 0) {
    conflicts.push({
      type: "zero_shift_staff",
      severity: "high",
      description: `${zeroShiftStaff.map((s) => s.staffName).join(", ")} received no shifts this month`,
      affectedStaff: zeroShiftStaff.map((s) => s.staffName),
      affectedDates: [],
    });
  }

  // 4. Heavy imbalance
  if (stats.length > 1) {
    const avg = stats.reduce((s, st) => s + st.totalCount, 0) / stats.length;
    const over = stats.filter((s) => s.totalCount > avg * 1.5);
    const under = stats.filter((s) => s.totalCount < avg * 0.5 && s.totalCount > 0);
    if (over.length > 0 && under.length > 0) {
      conflicts.push({
        type: "shift_imbalance",
        severity: "medium",
        description: `Significant imbalance: ${over.map((s) => s.staffName).join(", ")} (${over.map((s) => s.totalCount).join(", ")} shifts) vs ${under.map((s) => s.staffName).join(", ")} (${under.map((s) => s.totalCount).join(", ")} shifts)`,
        affectedStaff: [...over.map((s) => s.staffName), ...under.map((s) => s.staffName)],
        affectedDates: [],
      });
    }
  }

  // 5. Conflicting pair constraints
  const pairTogether = constraints.filter((c) => c.type === "pair_together");
  const pairApart = constraints.filter((c) => c.type === "pair_apart");
  for (const pt of pairTogether) {
    const pa = pairApart.find(
      (p) =>
        (p.staffId === pt.staffId && p.targetStaffId === pt.targetStaffId) ||
        (p.staffId === pt.targetStaffId && p.targetStaffId === pt.staffId)
    );
    if (pa) {
      conflicts.push({
        type: "pair_constraint_conflict",
        severity: "high",
        description: `${pt.staffName} and ${pt.targetStaffName} are required to work together AND kept apart`,
        affectedStaff: [pt.staffName, pt.targetStaffName!],
        affectedDates: [],
        constraintIds: [pt.id, pa.id],
      });
    }
  }

  return conflicts;
}

// ─── Fallback Suggestions (no LLM) ────────────────────────────────────────────

function generateFallbackSuggestions(conflicts: RawConflict[]): ConflictAnalysis[] {
  return conflicts.map((c, i) => {
    let suggestions: string[] = [];
    let tradeOffAnalysis = "";

    switch (c.type) {
      case "time_off_overlap":
        suggestions = [
          `Split the overlap: ${c.affectedStaff[0]} takes first half, ${c.affectedStaff[1]} takes second half`,
          "Prioritize by seniority or first-come-first-served",
          "Offer one staff member an alternative date range with similar length",
        ];
        tradeOffAnalysis = `Both ${c.affectedStaff[0]} and ${c.affectedStaff[1]} have valid time-off requests. Denying either creates dissatisfaction. Splitting the overlap gives each person partial time off while maintaining coverage.`;
        break;
      case "unfilled_slots":
        suggestions = [
          "Add temporary/contract staff for the affected dates",
          "Reduce shift coverage requirements (e.g., remove night shifts on weekends)",
          "Relax max_shifts constraints to allow existing staff to cover more",
        ];
        tradeOffAnalysis = `Unfilled slots mean understaffing on ${c.unfilledSlots || "some"} dates. Adding headcount costs money; reducing coverage risks service quality; relaxing constraints risks burnout.`;
        break;
      case "zero_shift_staff":
        suggestions = [
          "Check if availability constraints are too restrictive",
          "Manually assign shifts to affected staff",
          "Review if staff member's date range covers this month",
        ];
        tradeOffAnalysis = `Staff with zero shifts may have overly restrictive constraints, may be outside their employment dates, or may be excluded by other rules. Manual review needed.`;
        break;
      case "shift_imbalance":
        suggestions = [
          "Relax max_shifts constraints for under-scheduled staff",
          "Add min_shifts constraints for under-scheduled staff",
          "Review availability constraints for over-scheduled staff",
        ];
        tradeOffAnalysis = `Imbalance occurs when constraints force the scheduler to repeatedly assign the same available staff. Adding minimum shift requirements or relaxing availability for over-worked staff can help.`;
        break;
      case "pair_constraint_conflict":
        suggestions = [
          `Remove either the "pair together" or "pair apart" constraint — they cannot both be satisfied`,
          "Clarify with the manager which constraint takes priority",
        ];
        tradeOffAnalysis = "These two constraints directly contradict each other. One must be removed or modified.";
        break;
    }

    return {
      id: `conflict_${i + 1}`,
      severity: c.severity,
      type: c.type,
      description: c.description,
      affectedStaff: c.affectedStaff,
      affectedDates: c.affectedDates,
      suggestions,
      tradeOffAnalysis,
    };
  });
}
