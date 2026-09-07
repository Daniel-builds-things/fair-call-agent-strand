// ─── Schedule Explainer Agent ────────────────────────────────────────────────
// Analyzes a generated schedule and produces human-readable explanations,
// fairness analysis, constraint compliance report, and a "hot take" insight.

import { parseISO, isWeekend, format } from "date-fns";
import type {
  ScheduleResult,
  StaffStats,
  DayAssignment,
  Constraint,
  ScheduleExplanation,
} from "../types.js";

// ─── Public API ───────────────────────────────────────────────────────────────

export function explainSchedule(
  result: ScheduleResult & { constraintDecisions?: { constraintId: string; applied: boolean; reasoning: string }[] },
  constraints: Constraint[],
  holidays: string[] = [],
  label: string = "Schedule"
): ScheduleExplanation {
  const holidaySet = new Set(holidays);
  const { assignments, stats, errors } = result;

  // ─── Fairness Analysis ─────────────────────────────────────────────────

  const staffEntries = Object.values(stats);
  const totalShifts = staffEntries.reduce((sum, s) => sum + s.totalCount, 0);
  const avgShifts = staffEntries.length > 0 ? totalShifts / staffEntries.length : 0;

  // Calculate Gini-like fairness score (0-100)
  let fairnessScore = 100;
  if (staffEntries.length > 1) {
    const deviations = staffEntries.map((s) => Math.abs(s.totalCount - avgShifts));
    const maxPossibleDeviation = avgShifts; // worst case: one person gets everything
    if (maxPossibleDeviation > 0) {
      const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
      fairnessScore = Math.max(0, Math.round(100 - (avgDeviation / maxPossibleDeviation) * 100));
    }
  }

  // Sort staff by total count
  const sorted = [...staffEntries].sort((a, b) => b.totalCount - a.totalCount);
  const mostLoaded = sorted.slice(0, 3).map((s) => ({ name: s.staffName, count: s.totalCount }));
  const leastLoaded = sorted.slice(-3).reverse().map((s) => ({ name: s.staffName, count: s.totalCount }));

  // Balance notes
  const balanceNotes: string[] = [];
  const overScheduled = staffEntries.filter((s) => s.totalCount > avgShifts * 1.3);
  const underScheduled = staffEntries.filter((s) => s.totalCount < avgShifts * 0.7 && s.totalCount > 0);

  if (overScheduled.length > 0) {
    balanceNotes.push(
      `${overScheduled.map((s) => s.staffName).join(", ")} ${overScheduled.length === 1 ? "is" : "are"} scheduled for significantly more shifts than average (${avgShifts.toFixed(1)})`
    );
  }
  if (underScheduled.length > 0) {
    balanceNotes.push(
      `${underScheduled.map((s) => s.staffName).join(", ")} ${underScheduled.length === 1 ? "is" : "are"} under-scheduled compared to average`
    );
  }

  // Check shift type balance
  for (const s of staffEntries) {
    if (s.totalCount > 0) {
      const morningRatio = s.morningCount / s.totalCount;
      const nightRatio = s.nightCount / s.totalCount;
      if (morningRatio > 0.8) {
        balanceNotes.push(`${s.staffName} is heavily weighted toward morning shifts (${Math.round(morningRatio * 100)}%)`);
      }
      if (nightRatio > 0.5) {
        balanceNotes.push(`${s.staffName} has a high proportion of night shifts (${Math.round(nightRatio * 100)}%)`);
      }
    }
  }

  // ─── Back-to-back violations ───────────────────────────────────────────

  const backToBackViolations = countBackToBackViolations(assignments, stats);
  const nightToMorningViolations = countNightToMorningViolations(assignments, stats);

  if (backToBackViolations > 0) {
    balanceNotes.push(`${backToBackViolations} back-to-back day violation(s) detected`);
  }
  if (nightToMorningViolations > 0) {
    balanceNotes.push(`${nightToMorningViolations} night-to-morning crossover violation(s)`);
  }

  // ─── Constraint Compliance ─────────────────────────────────────────────

  const constraintDecisions = result.constraintDecisions || [];
  const appliedConstraints = constraintDecisions.filter((d) => d.applied);
  const unappliedConstraints = constraintDecisions.filter((d) => !d.applied);

  // ─── Anomalies ─────────────────────────────────────────────────────────

  const anomalies: ScheduleExplanation["anomalies"] = [];

  // Unassigned slots
  const unassignedSlots = errors.filter((e) => e.type === "UNFILLABLE_SLOT");
  if (unassignedSlots.length > 0) {
    anomalies.push({
      description: `${unassignedSlots.length} shift slot(s) could not be filled — insufficient staff coverage`,
      severity: unassignedSlots.length > 3 ? "high" : "medium",
      suggestion: "Consider adding more staff or reducing shift coverage requirements",
    });
  }

  // Fairness issues
  if (fairnessScore < 60) {
    anomalies.push({
      description: `Low fairness score (${fairnessScore}/100) — shift distribution is significantly uneven`,
      severity: fairnessScore < 40 ? "high" : "medium",
      suggestion: "Review constraints that may be forcing uneven distribution",
    });
  }

  // Staff with zero shifts
  const zeroShiftStaff = staffEntries.filter((s) => s.totalCount === 0);
  if (zeroShiftStaff.length > 0) {
    anomalies.push({
      description: `${zeroShiftStaff.map((s) => s.staffName).join(", ")} received no shifts this month`,
      severity: "medium",
      suggestion: "Check if constraints or date ranges are excluding these staff members",
    });
  }

  // ─── Hot Take ──────────────────────────────────────────────────────────

  const hotTake = generateHotTake(
    fairnessScore,
    backToBackViolations,
    nightToMorningViolations,
    unassignedSlots.length,
    constraints.length,
    appliedConstraints.length,
    staffEntries
  );

  return {
    summary: `${label}: ${totalShifts} total shifts across ${staffEntries.length} staff over ${assignments.length} days. Fairness score: ${fairnessScore}/100. ${errors.length} error(s), ${unassignedSlots.length} unfilled slot(s).`,
    fairnessAnalysis: {
      overallScore: fairnessScore,
      mostLoaded,
      leastLoaded,
      balanceNotes,
    },
    constraintDecisions: constraintDecisions.map((d) => {
      const constraint = constraints.find((c) => c.id === d.constraintId);
      return {
        constraint: constraint || ({ id: d.constraintId, type: "unknown", priority: "hard", staffId: "", staffName: "" } as Constraint),
        applied: d.applied,
        reasoning: d.reasoning,
      };
    }),
    anomalies,
    hotTake,
  };
}

// ─── Violation Counters ───────────────────────────────────────────────────────

function countBackToBackViolations(
  assignments: DayAssignment[],
  stats: Record<string, StaffStats> | StaffStats[]
): number {
  const staffStats = Array.isArray(stats) ? stats : Object.values(stats);
  let violations = 0;
  const sorted = [...assignments].sort((a, b) => a.date.localeCompare(b.date));

  for (const s of staffStats) {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevWorked =
        prev.morning === s.staffId || prev.afternoon === s.staffId || prev.night === s.staffId;
      const currWorked =
        curr.morning === s.staffId || curr.afternoon === s.staffId || curr.night === s.staffId;
      if (prevWorked && currWorked) violations++;
    }
  }

  return violations;
}

function countNightToMorningViolations(
  assignments: DayAssignment[],
  stats: Record<string, StaffStats> | StaffStats[]
): number {
  const staffStats = Array.isArray(stats) ? stats : Object.values(stats);
  let violations = 0;
  const sorted = [...assignments].sort((a, b) => a.date.localeCompare(b.date));

  for (const s of staffStats) {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.night === s.staffId && curr.morning === s.staffId) {
        violations++;
      }
    }
  }

  return violations;
}

// ─── Hot Take Generator ───────────────────────────────────────────────────────

function generateHotTake(
  fairnessScore: number,
  backToBack: number,
  nightToMorning: number,
  unassigned: number,
  totalConstraints: number,
  appliedConstraints: number,
  stats: StaffStats[] | Record<string, StaffStats>
): string {
  const staffStats = Array.isArray(stats) ? stats : Object.values(stats);
  const totalShifts = staffStats.reduce((sum, s) => sum + s.totalCount, 0);

  const insights: string[] = [];

  if (backToBack > 0) {
    insights.push(
      `Back-to-back violations (${backToBack}) are inevitable when coverage demands exceed staff capacity — no algorithm can fully eliminate them without adding headcount.`
    );
  }

  if (nightToMorning > 0) {
    insights.push(
      `The night-to-morning crossover (${nightToMorning} violation(s)) is the single biggest source of staff burnout; it's the one constraint that should always be hard.`
    );
  }

  if (totalConstraints > 0 && appliedConstraints < totalConstraints) {
    insights.push(
      `${totalConstraints - appliedConstraints} of ${totalConstraints} constraints couldn't be fully applied — constraint conflicts force trade-offs that pure algorithms can't reason about.`
    );
  }

  if (unassigned > 0) {
    insights.push(
      `${unassigned} unfilled slots reveal a fundamental truth: scheduling is a supply-and-demand problem, not just an optimization problem.`
    );
  }

  if (fairnessScore > 80) {
    insights.push(
      `High fairness (${fairnessScore}/100) comes not from perfect equality but from transparent, consistent rules that staff can understand and trust.`
    );
  } else if (fairnessScore < 60) {
    insights.push(
      `Low fairness (${fairnessScore}/100) isn't an algorithm failure — it's a signal that constraints are fundamentally at odds with equal distribution.`
    );
  }

  if (insights.length === 0) {
    return "Clean schedule with no major anomalies — the real test is how it handles edge cases like sudden staff absences.";
  }

  return insights[0]; // Lead with the strongest insight
}
