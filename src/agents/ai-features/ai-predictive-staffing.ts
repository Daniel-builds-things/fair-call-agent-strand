// ─── AI Predictive Staffing: LLM-powered recommendations ─────────────────────
// Analyzes historical patterns, current schedule data, and constraints to
// generate forward-looking staffing recommendations:
//   - Understaffed days/slots
//   - Burnout risk indicators
//   - Hiring suggestions
//   - Constraint optimization tips

import Groq from "groq-sdk";
import OpenAI from "openai";
import type { StaffMember, Constraint, DayAssignment, StaffStats, ScheduleError } from "../../../scheduler-lib/types";

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

  if (groqApiKey) {
    return { provider: "groq", model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", groq: new Groq({ apiKey: groqApiKey }) };
  }
  if (openaiApiKey && openaiBaseUrl) {
    return { provider: "netmind", model: process.env.OPENAI_MODEL_ID || "gpt-4o-mini", openai: new OpenAI({ apiKey: openaiApiKey, baseURL: openaiBaseUrl }) };
  }
  if (openaiApiKey) {
    return { provider: "openai", model: "gpt-4o-mini", openai: new OpenAI({ apiKey: openaiApiKey }) };
  }
  return null;
}

export interface StaffingRecommendation {
  id: string;
  category: "understaffing" | "burnout_risk" | "hiring" | "constraint_optimization" | "efficiency";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  impact: string;
  actionItems: string[];
}

export interface PredictiveStaffingResult {
  recommendations: StaffingRecommendation[];
  overallHealth: "good" | "warning" | "critical";
  burnoutRiskStaff: { name: string; reason: string; risk: "high" | "medium" | "low" }[];
  understaffedDates: { date: string; slot: string; reason: string }[];
  processingTimeMs: number;
}

/**
 * Generate AI-powered predictive staffing recommendations.
 */
export async function predictStaffingWithAI(
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  errors: ScheduleError[],
  staff: StaffMember[],
  month: string,
  holidays: string[] = []
): Promise<PredictiveStaffingResult> {
  const startTime = Date.now();
  const resolved = resolveLLMProvider();

  // Detect issues programmatically first
  const detectedIssues = detectStaffingIssues(assignments, stats, constraints, errors, staff);

  if (!resolved) {
    return generateFallbackRecommendations(detectedIssues, stats, assignments, month);
  }

  const systemPrompt = `You are a Predictive Staffing AI. Analyze schedules and provide forward-looking recommendations to improve staffing, reduce burnout risk, and optimize constraint usage.

Categories:
- understaffing: Days/slots with insufficient coverage
- burnout_risk: Staff at risk of exhaustion (too many shifts, too many consecutive days, heavy night load)
- hiring: Recommendations for additional staff
- constraint_optimization: How to adjust constraints for better outcomes
- efficiency: Ways to improve schedule quality

For each recommendation:
- Be specific about WHO, WHAT, and WHY
- Quantify the impact where possible
- Suggest concrete action items

Be honest about risks. Don't sugarcoat burnout or understaffing.`;

  const userPrompt = `Month: ${month}

Schedule data:
${stats.map((s) => `${s.staffName}: ${s.totalCount} shifts (M:${s.morningCount} A:${s.afternoonCount} N:${s.nightCount}, W:${s.weekendCount})`).join("\n")}

Assignments (${assignments.filter((a) => a.morning || a.afternoon || a.night).length} filled):
${assignments.filter((a) => a.morning || a.afternoon || a.night).map((a) => `${a.date}: M=${a.morning || "—"} A=${a.afternoon || "—"} N=${a.night || "—"}`).join("\n")}

Errors/Unfilled slots:
${errors.map((e) => `[${e.type}] ${e.message}`).join("\n") || "None"}

Constraints:
${constraints.map((c) => `${c.staffName}: ${c.sourceText || c.type}`).join("\n")}

Detected issues:
${detectedIssues.map((d) => `- ${d.type}: ${d.description}`).join("\n")}

Provide recommendations with action items. Also identify:
1. Staff at burnout risk (too many shifts, consecutive days, night-heavy)
2. Dates that are understaffed
3. Whether hiring is needed

Return a JSON object:
{
  "recommendations": [
    {
      "id": "rec_1",
      "category": "burnout_risk",
      "priority": "high",
      "title": "...",
      "description": "...",
      "impact": "...",
      "actionItems": ["action 1", "action 2"]
    }
  ],
  "overallHealth": "warning",
  "burnoutRiskStaff": [{"name": "...", "reason": "...", "risk": "high"}],
  "understaffedDates": [{"date": "...", "slot": "...", "reason": "..."}]
}

Return ONLY the JSON object.`;

  try {
    if (resolved.provider === "groq" && resolved.groq) {
      const response = await resolved.groq.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        model: resolved.model, temperature: 0.3, max_tokens: 4000,
      });
      return parsePredictiveResponse(response.choices[0]?.message?.content, detectedIssues, stats, assignments, month, startTime);
    }
    if (resolved.openai) {
      const response = await resolved.openai.chat.completions.create({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        model: resolved.model, temperature: 0.3, max_tokens: 4000,
      });
      return parsePredictiveResponse(response.choices[0]?.message?.content, detectedIssues, stats, assignments, month, startTime);
    }
    return generateFallbackRecommendations(detectedIssues, stats, assignments, month);
  } catch (err) {
    console.error("[AI Predictive] Failed, using fallback:", err);
    return generateFallbackRecommendations(detectedIssues, stats, assignments, month);
  }
}

function parsePredictiveResponse(
  content: string | undefined | null,
  detectedIssues: DetectedIssue[],
  stats: StaffStats[],
  assignments: DayAssignment[],
  month: string,
  startTime: number
): PredictiveStaffingResult {
  if (!content) return generateFallbackRecommendations(detectedIssues, stats, assignments, month);
  const jsonStr = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(jsonStr);
  return { ...parsed, processingTimeMs: Date.now() - startTime };
}

// ─── Programmatic Issue Detection ─────────────────────────────────────────────

interface DetectedIssue {
  type: string;
  description: string;
  severity: "high" | "medium" | "low";
  affectedStaff?: string[];
}

function detectStaffingIssues(
  assignments: DayAssignment[],
  stats: StaffStats[],
  constraints: Constraint[],
  errors: ScheduleError[],
  staff: StaffMember[]
): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  // Burnout risk: staff with too many shifts
  const avgShifts = stats.length > 0 ? stats.reduce((s, st) => s + st.totalCount, 0) / stats.length : 0;
  for (const s of stats) {
    if (s.totalCount > avgShifts * 1.4) {
      issues.push({
        type: "burnout_risk_high_load",
        description: `${s.staffName} has ${s.totalCount} shifts (${((s.totalCount - avgShifts) / avgShifts * 100).toFixed(0)}% above average) — potential burnout risk`,
        severity: s.totalCount > avgShifts * 1.6 ? "high" : "medium",
        affectedStaff: [s.staffName],
      });
    }

    // Night-heavy schedule
    if (s.totalCount > 0) {
      const nightRatio = s.nightCount / s.totalCount;
      if (nightRatio > 0.5) {
        issues.push({
          type: "burnout_risk_night_heavy",
          description: `${s.staffName} has ${Math.round(nightRatio * 100)}% night shifts (${s.nightCount}/${s.totalCount}) — disrupts sleep cycle`,
          severity: nightRatio > 0.7 ? "high" : "medium",
          affectedStaff: [s.staffName],
        });
      }
    }

    // Consecutive days (rough check)
    const staffAssignments = assignments.filter(
      (a) => a.morning === s.staffId || a.afternoon === s.staffId || a.night === s.staffId
    ).sort((a, b) => a.date.localeCompare(b.date));

    let maxConsecutive = 0;
    let currentConsecutive = 0;
    let lastDate = "";
    for (const a of staffAssignments) {
      if (lastDate) {
        const lastDay = new Date(lastDate + "T00:00:00").getDate();
        const currDay = new Date(a.date + "T00:00:00").getDate();
        if (currDay === lastDay + 1) {
          currentConsecutive++;
          maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
        } else {
          currentConsecutive = 1;
        }
      } else {
        currentConsecutive = 1;
      }
      lastDate = a.date;
    }
    if (maxConsecutive >= 7) {
      issues.push({
        type: "burnout_risk_consecutive",
        description: `${s.staffName} worked ${maxConsecutive} consecutive days — no rest period`,
        severity: maxConsecutive >= 10 ? "high" : "medium",
        affectedStaff: [s.staffName],
      });
    }
  }

  // Understaffing
  const unfilledSlots = errors.filter((e) => e.type === "UNFILLABLE_SLOT");
  if (unfilledSlots.length > 0) {
    issues.push({
      type: "understaffing",
      description: `${unfilledSlots.length} unfilled slots indicate insufficient staff coverage`,
      severity: unfilledSlots.length > 5 ? "high" : "medium",
    });
  }

  // Zero-shift staff
  const zeroShiftStaff = stats.filter((s) => s.totalCount === 0);
  if (zeroShiftStaff.length > 0) {
    issues.push({
      type: "unused_staff",
      description: `${zeroShiftStaff.map((s) => s.staffName).join(", ")} received no shifts — wasted capacity or over-constrained`,
      severity: "medium",
      affectedStaff: zeroShiftStaff.map((s) => s.staffName),
    });
  }

  return issues;
}

// ─── Fallback Recommendations (no LLM) ────────────────────────────────────────

function generateFallbackRecommendations(
  issues: DetectedIssue[],
  stats: StaffStats[],
  assignments: DayAssignment[],
  month: string
): PredictiveStaffingResult {
  const recommendations: StaffingRecommendation[] = [];
  const burnoutRiskStaff: { name: string; reason: string; risk: "high" | "medium" | "low" }[] = [];
  const understaffedDates: { date: string; slot: string; reason: string }[] = [];

  for (const issue of issues) {
    switch (issue.type) {
      case "burnout_risk_high_load":
        burnoutRiskStaff.push({
          name: issue.affectedStaff?.[0] || "",
          reason: issue.description,
          risk: issue.severity,
        });
        recommendations.push({
          id: `rec_${recommendations.length + 1}`,
          category: "burnout_risk",
          priority: issue.severity,
          title: `${issue.affectedStaff?.[0] || "Staff"} at burnout risk — high shift load`,
          description: issue.description,
          impact: "Increased risk of errors, absenteeism, and staff turnover",
          actionItems: [
            "Consider redistributing shifts to less-loaded staff",
            "Add a max_shifts constraint for this person",
            "Review if other staff have availability that could be relaxed",
          ],
        });
        break;

      case "burnout_risk_night_heavy":
        burnoutRiskStaff.push({
          name: issue.affectedStaff?.[0] || "",
          reason: issue.description,
          risk: issue.severity,
        });
        recommendations.push({
          id: `rec_${recommendations.length + 1}`,
          category: "burnout_risk",
          priority: issue.severity,
          title: `${issue.affectedStaff?.[0] || "Staff"} — night-heavy schedule`,
          description: issue.description,
          impact: "Sleep disruption, health risks, reduced performance",
          actionItems: [
            "Add a constraint limiting consecutive night shifts",
            "Ensure adequate recovery time between night shifts",
            "Rotate night shifts more evenly across staff",
          ],
        });
        break;

      case "burnout_risk_consecutive":
        recommendations.push({
          id: `rec_${recommendations.length + 1}`,
          category: "burnout_risk",
          priority: issue.severity,
          title: `${issue.affectedStaff?.[0] || "Staff"} — too many consecutive work days`,
          description: issue.description,
          impact: "Physical and mental exhaustion, increased error rate",
          actionItems: [
            "Add a 'no back-to-back' constraint for this staff member",
            "Enforce a maximum of 5-6 consecutive work days",
            "Schedule mandatory rest days",
          ],
        });
        break;

      case "understaffing":
        recommendations.push({
          id: `rec_${recommendations.length + 1}`,
          category: "understaffing",
          priority: "high",
          title: "Insufficient staff coverage",
          description: issue.description,
          impact: "Service quality degradation, increased stress on existing staff",
          actionItems: [
            "Hire 1-2 additional staff members",
            "Use part-time or contract staff for peak periods",
            "Review and relax unnecessary constraints",
          ],
        });
        break;

      case "unused_staff":
        recommendations.push({
          id: `rec_${recommendations.length + 1}`,
          category: "constraint_optimization",
          priority: "medium",
          title: `${issue.affectedStaff?.join(", ") || "Staff"} — no shifts assigned`,
          description: issue.description,
          impact: "Wasted staffing capacity; potential dissatisfaction",
          actionItems: [
            "Review their availability and constraint settings",
            "Check if their employment dates cover this month",
            "Manually assign shifts if constraints are too restrictive",
          ],
        });
        break;
    }
  }

  return {
    recommendations,
    overallHealth: recommendations.some((r) => r.priority === "high") ? "warning" : "good",
    burnoutRiskStaff,
    understaffedDates,
    processingTimeMs: 0,
  };
}
