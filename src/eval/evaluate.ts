// ─── Evaluation Runner: Baseline vs Agent ─────────────────────────────────────
// Runs all evaluation cases through both schedulers and compares metrics.

import { parseISO, isWeekend, format, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from "date-fns";
import { generateBaselineSchedule } from "../lib/baseline-scheduler.js";
import { generateAgentSchedule } from "../agents/enhanced-scheduler.js";
import { parseConstraints } from "../agents/constraint-parser.js";
import { explainSchedule } from "../agents/schedule-explainer.js";
import { evaluationCases } from "./cases.js";
import type { EvaluationMetrics, EvaluationResult, Constraint, ScheduleResult, StaffMember, DayAssignment, ShiftSlot, StaffStats } from "../types.js";

// ─── Metric Calculators ──────────────────────────────────────────────────────

function countTotalSlots(assignments: DayAssignment[], preference: string): number {
  let count = 0;
  for (const a of assignments) {
    if (preference === "morning") count += 1;
    else if (preference === "morning-night") count += 2;
    else count += 3; // morning-afternoon-night or auto
  }
  return count;
}

function countFilledSlots(assignments: DayAssignment[]): number {
  let count = 0;
  for (const a of assignments) {
    if (a.morning) count++;
    if (a.afternoon) count++;
    if (a.night) count++;
  }
  return count;
}

function countBackToBackViolations(assignments: DayAssignment[], stats: StaffStats[]): number {
  let violations = 0;
  const sorted = [...assignments].sort((a, b) => a.date.localeCompare(b.date));
  for (const s of stats) {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevWorked = prev.morning === s.staffId || prev.afternoon === s.staffId || prev.night === s.staffId;
      const currWorked = curr.morning === s.staffId || curr.afternoon === s.staffId || curr.night === s.staffId;
      if (prevWorked && currWorked) violations++;
    }
  }
  return violations;
}

function countNightToMorningViolations(assignments: DayAssignment[], stats: StaffStats[]): number {
  let violations = 0;
  const sorted = [...assignments].sort((a, b) => a.date.localeCompare(b.date));
  for (const s of stats) {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.night === s.staffId && curr.morning === s.staffId) violations++;
    }
  }
  return violations;
}

function calculateFairnessScore(stats: StaffStats[]): number {
  if (stats.length <= 1) return 100;
  const totalShifts = stats.reduce((sum, s) => sum + s.totalCount, 0);
  const avg = totalShifts / stats.length;
  if (avg === 0) return 100;
  const deviations = stats.map((s) => Math.abs(s.totalCount - avg));
  const maxDeviation = avg;
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  return Math.max(0, Math.round(100 - (avgDeviation / maxDeviation) * 100));
}

function calculateShiftBalance(stats: StaffStats[]): number {
  if (stats.length <= 1) return 0;
  const counts = stats.map((s) => s.totalCount);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + (c - avg) ** 2, 0) / counts.length;
  return Math.round(Math.sqrt(variance) * 100) / 100; // lower is better
}

// Check if a specific constraint is satisfied
function checkConstraintSatisfaction(
  constraint: Constraint,
  assignments: DayAssignment[],
  stats: StaffStats[]
): boolean {
  const sorted = [...assignments].sort((a, b) => a.date.localeCompare(b.date));
  const staffStat = stats.find((s) => s.staffId === constraint.staffId);

  switch (constraint.type) {
    case "unavailable": {
      if (constraint.dates) {
        for (const d of constraint.dates) {
          const ds = format(d, "yyyy-MM-dd");
          const day = assignments.find((a) => a.date === ds);
          if (day) {
            if (constraint.slots) {
              for (const slot of constraint.slots) {
                if (day[slot as keyof DayAssignment] === constraint.staffId) return false;
              }
            } else {
              if (day.morning === constraint.staffId || day.afternoon === constraint.staffId || day.night === constraint.staffId) return false;
            }
          }
        }
      }
      if (constraint.daysOfWeek && staffStat) {
        for (const a of sorted) {
          const dow = getDay(parseISO(a.date));
          if (constraint.daysOfWeek!.includes(dow)) {
            if (a.morning === constraint.staffId || a.afternoon === constraint.staffId || a.night === constraint.staffId) {
              // Check if it's a violation — the staff should NOT work on these days
              return false;
            }
          }
        }
      }
      return true;
    }

    case "time_off": {
      if (constraint.startDate && constraint.daysCount) {
        const start = constraint.startDate;
        for (let i = 0; i < constraint.daysCount; i++) {
          const ds = format(start, "yyyy-MM-dd");
          const day = sorted.find((a) => a.date === ds);
          if (day && (day.morning === constraint.staffId || day.afternoon === constraint.staffId || day.night === constraint.staffId)) {
            return false;
          }
        }
      }
      if (constraint.dates) {
        for (const d of constraint.dates) {
          const ds = format(d, "yyyy-MM-dd");
          const day = sorted.find((a) => a.date === ds);
          if (day && (day.morning === constraint.staffId || day.afternoon === constraint.staffId || day.night === constraint.staffId)) {
            return false;
          }
        }
      }
      return true;
    }

    case "max_shifts": {
      if (!staffStat) return true;
      return staffStat.totalCount <= (constraint.value || 999);
    }

    case "min_shifts": {
      if (!staffStat) return false;
      return staffStat.totalCount >= (constraint.value || 0);
    }

    case "no_night_to_morning": {
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i - 1].night === constraint.staffId && sorted[i].morning === constraint.staffId) {
          return false;
        }
      }
      return true;
    }

    case "specific_shift": {
      if (constraint.dates && constraint.slots) {
        for (const d of constraint.dates) {
          const ds = format(d, "yyyy-MM-dd");
          const day = sorted.find((a) => a.date === ds);
          if (day) {
            for (const slot of constraint.slots) {
              if (day[slot as keyof DayAssignment] !== constraint.staffId) return false;
            }
          }
        }
      }
      return true;
    }

    case "pair_apart": {
      for (const a of sorted) {
        for (const slot of ["morning", "afternoon", "night"] as ShiftSlot[]) {
          if (a[slot as keyof DayAssignment] === constraint.staffId) {
            // Check if target staff is also on this slot
            // (pair_apart means they shouldn't work same shift same day)
            if (a[slot as keyof DayAssignment] === constraint.targetStaffId) return false;
          }
        }
        // Simpler: if both are on the same day on any slot, it's only a violation
        // if they're on the SAME slot
        // Already checked above
      }
      // Also check: if they're assigned to the same slot on the same day
      for (const a of sorted) {
        if (a.morning === constraint.staffId && a.morning === constraint.targetStaffId) return false;
        if (a.afternoon === constraint.staffId && a.afternoon === constraint.targetStaffId) return false;
        if (a.night === constraint.staffId && a.night === constraint.targetStaffId) return false;
      }
      return true;
    }

    case "availability": {
      if (constraint.daysOfWeek && constraint.daysOfWeek.length > 0) {
        for (const a of sorted) {
          const dow = getDay(parseISO(a.date));
          if (!constraint.daysOfWeek.includes(dow)) {
            if (a.morning === constraint.staffId || a.afternoon === constraint.staffId || a.night === constraint.staffId) {
              return false; // Working on a day they're NOT available
            }
          }
        }
      }
      return true;
    }

    case "preferred": {
      if (!staffStat || !constraint.slots || constraint.slots.length === 0) return true;
      // Check if majority of their shifts are in preferred slots
      const preferredSet = new Set(constraint.slots);
      let preferredCount = 0;
      for (const slot of ["morning", "afternoon", "night"] as ShiftSlot[]) {
        if (preferredSet.has(slot)) {
          preferredCount += staffStat[`${slot}Count` as keyof StaffStats] as number;
        }
      }
      return staffStat.totalCount === 0 || (preferredCount / staffStat.totalCount) > 0.5;
    }

    case "no_back_to_back": {
      if ((constraint.metadata as any)?.appliesToAll) {
        // Check all staff
        for (let i = 1; i < sorted.length; i++) {
          for (const s of stats) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            const prevWorked = prev.morning === s.staffId || prev.afternoon === s.staffId || prev.night === s.staffId;
            const currWorked = curr.morning === s.staffId || curr.afternoon === s.staffId || curr.night === s.staffId;
            if (prevWorked && currWorked) return false;
          }
        }
        return true;
      }
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const prevWorked = prev.morning === constraint.staffId || prev.afternoon === constraint.staffId || prev.night === constraint.staffId;
        const currWorked = curr.morning === constraint.staffId || curr.afternoon === constraint.staffId || curr.night === constraint.staffId;
        if (prevWorked && currWorked) return false;
      }
      return true;
    }

    default:
      return true;
  }
}

// ─── Run Single Case ─────────────────────────────────────────────────────────

function runCase(caseData: typeof evaluationCases[0]): EvaluationMetrics {
  const staff = caseData.staff;
  const month = caseData.month;
  const holidays = caseData.holidays;
  const preference = caseData.distributionPreference;

  // Parse constraints
  const constraintTexts = caseData.constraints.map((c: any) => c.sourceText || "");
  const parsed = parseConstraints(constraintTexts, staff, month);
  const constraints = parsed.constraints;

  // Run baseline (no constraints)
  const baseline = generateBaselineSchedule(staff, month, holidays, [], preference as any);

  // Run agent (with constraints)
  const agentResult = generateAgentSchedule(staff, month, constraints, holidays, preference);

  const agent: ScheduleResult = {
    assignments: agentResult.assignments,
    stats: agentResult.stats,
    errors: agentResult.errors,
    warnings: agentResult.warnings,
  };

  // Calculate metrics
  const totalSlots = countTotalSlots(baseline.assignments, preference);
  const filledBaseline = countFilledSlots(baseline.assignments);
  const filledAgent = countFilledSlots(agent.assignments);

  const constraintBreakdown = constraints.map((c) => ({
    constraintId: c.id,
    type: c.type,
    satisfiedByBaseline: checkConstraintSatisfaction(c, baseline.assignments, baseline.stats),
    satisfiedByAgent: checkConstraintSatisfaction(c, agent.assignments, agent.stats),
  }));

  const satisfiedBaseline = constraintBreakdown.filter((b) => b.satisfiedByBaseline).length;
  const satisfiedAgent = constraintBreakdown.filter((b) => b.satisfiedByAgent).length;

  return {
    caseId: caseData.id,
    caseName: caseData.name,
    totalSlots,
    filledSlotsBaseline: filledBaseline,
    filledSlotsAgent: filledAgent,
    coverageBaseline: totalSlots > 0 ? Math.round((filledBaseline / totalSlots) * 1000) / 10 : 100,
    coverageAgent: totalSlots > 0 ? Math.round((filledAgent / totalSlots) * 1000) / 10 : 100,
    fairnessScoreBaseline: calculateFairnessScore(baseline.stats),
    fairnessScoreAgent: calculateFairnessScore(agent.stats),
    totalConstraints: constraints.length,
    satisfiedBaseline,
    satisfiedAgent,
    constraintSatisfactionBaseline: constraints.length > 0 ? Math.round((satisfiedBaseline / constraints.length) * 1000) / 10 : 100,
    constraintSatisfactionAgent: constraints.length > 0 ? Math.round((satisfiedAgent / constraints.length) * 1000) / 10 : 100,
    constraintBreakdown,
    backToBackViolationsBaseline: countBackToBackViolations(baseline.assignments, baseline.stats),
    backToBackViolationsAgent: countBackToBackViolations(agent.assignments, agent.stats),
    nightToMorningViolationsBaseline: countNightToMorningViolations(baseline.assignments, baseline.stats),
    nightToMorningViolationsAgent: countNightToMorningViolations(agent.assignments, agent.stats),
    shiftBalanceBaseline: calculateShiftBalance(baseline.stats),
    shiftBalanceAgent: calculateShiftBalance(agent.stats),
  };
}

// ─── Run All Cases ───────────────────────────────────────────────────────────

export function runEvaluation(): EvaluationResult {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Fair Call Agent — Evaluation Suite                     ║");
  console.log("║   Baseline (LRU) vs Agent (Constraint-Aware)            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");

  const metrics: EvaluationMetrics[] = [];

  for (const caseData of evaluationCases) {
    console.log(`\n▶ Running: ${caseData.name} (${caseData.id})`);
    console.log(`   ${caseData.description}`);
    console.log(`   Staff: ${caseData.staff.length} | Constraints: ${caseData.constraints.length} | Month: ${format(caseData.month, "MMMM yyyy")}`);

    try {
      const m = runCase(caseData);
      metrics.push(m);

      console.log(`   Coverage:    Baseline ${m.coverageBaseline}% → Agent ${m.coverageAgent}%`);
      console.log(`   Fairness:    Baseline ${m.fairnessScoreBaseline}/100 → Agent ${m.fairnessScoreAgent}/100`);
      console.log(`   Constraints: Baseline ${m.constraintSatisfactionBaseline}% → Agent ${m.constraintSatisfactionAgent}%`);
      console.log(`   B2B Viol.:   Baseline ${m.backToBackViolationsBaseline} → Agent ${m.backToBackViolationsAgent}`);
      console.log(`   N→M Viol.:   Baseline ${m.nightToMorningViolationsBaseline} → Agent ${m.nightToMorningViolationsAgent}`);

      if (m.constraintBreakdown.length > 0) {
        for (const cb of m.constraintBreakdown) {
          const baselineStatus = cb.satisfiedByBaseline ? "✓" : "✗";
          const agentStatus = cb.satisfiedByAgent ? "✓" : "✗";
          console.log(`     [${cb.type}] Baseline: ${baselineStatus}  Agent: ${agentStatus}`);
        }
      }
    } catch (err) {
      console.error(`   ERROR: ${err}`);
    }
  }

  // Summary
  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const summary = {
    avgCoverageBaseline: Math.round(avg(metrics.map((m) => m.coverageBaseline)) * 10) / 10,
    avgCoverageAgent: Math.round(avg(metrics.map((m) => m.coverageAgent)) * 10) / 10,
    avgFairnessBaseline: Math.round(avg(metrics.map((m) => m.fairnessScoreBaseline)) * 10) / 10,
    avgFairnessAgent: Math.round(avg(metrics.map((m) => m.fairnessScoreAgent)) * 10) / 10,
    avgConstraintSatisfactionBaseline: Math.round(avg(metrics.map((m) => m.constraintSatisfactionBaseline)) * 10) / 10,
    avgConstraintSatisfactionAgent: Math.round(avg(metrics.map((m) => m.constraintSatisfactionAgent)) * 10) / 10,
    improvementCoverage: 0,
    improvementFairness: 0,
    improvementConstraintSatisfaction: 0,
  };

  summary.improvementCoverage = Math.round((summary.avgCoverageAgent - summary.avgCoverageBaseline) * 10) / 10;
  summary.improvementFairness = Math.round((summary.avgFairnessAgent - summary.avgFairnessBaseline) * 10) / 10;
  summary.improvementConstraintSatisfaction = Math.round((summary.avgConstraintSatisfactionAgent - summary.avgConstraintSatisfactionBaseline) * 10) / 10;

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                    SUMMARY                              ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║ Metric              │ Baseline  │ Agent     │ Δ         ║`);
  const fmtNum = (n: number) => String(n).padStart(9);
  const fmtDelta = (n: number) => { const s = String(n); return (n >= 0 ? "+" : "") + s.padStart(9); };
  console.log(`║ Coverage            │ ${fmtNum(summary.avgCoverageBaseline)}% │ ${fmtNum(summary.avgCoverageAgent)}% │ ${fmtDelta(summary.improvementCoverage)}% ║`);
  console.log(`║ Fairness            │ ${fmtNum(summary.avgFairnessBaseline)}/100│ ${fmtNum(summary.avgFairnessAgent)}/100│ ${fmtDelta(summary.improvementFairness)}/100║`);
  console.log(`║ Constraint Sat.     │ ${fmtNum(summary.avgConstraintSatisfactionBaseline)}% │ ${fmtNum(summary.avgConstraintSatisfactionAgent)}% │ ${fmtDelta(summary.improvementConstraintSatisfaction)}% ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  console.log(`\nTotal cases: ${metrics.length}`);
  const totalB2BBaseline = metrics.reduce((s, m) => s + m.backToBackViolationsBaseline, 0);
  const totalB2BAgent = metrics.reduce((s, m) => s + m.backToBackViolationsAgent, 0);
  const totalN2MBaseline = metrics.reduce((s, m) => s + m.nightToMorningViolationsBaseline, 0);
  const totalN2MAgent = metrics.reduce((s, m) => s + m.nightToMorningViolationsAgent, 0);
  console.log(`Total B2B violations: Baseline ${totalB2BBaseline} → Agent ${totalB2BAgent}`);
  console.log(`Total N→M violations: Baseline ${totalN2MBaseline} → Agent ${totalN2MAgent}`);

  return { metrics, summary };
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runEvaluation();
  console.log("\nEvaluation complete.");
}
