// ─── Fair Call Agent — Main Entry Point ───────────────────────────────────────
// Demo: Natural language scheduling with constraint-aware agent.

import { format, startOfMonth, endOfMonth } from "date-fns";
import { parseConstraints } from "./agents/constraint-parser.js";
import { generateAgentSchedule } from "./agents/enhanced-scheduler.js";
import { generateBaselineSchedule } from "./lib/baseline-scheduler.js";
import { explainSchedule } from "./agents/schedule-explainer.js";
import { runEvaluation } from "./eval/evaluate.js";
import type { StaffMember } from "./types.js";

// ─── Demo Staff ───────────────────────────────────────────────────────────────

const demoStaff: StaffMember[] = [
  { id: "s1", name: "Ada Obi", isActive: true, joinedDate: "2024-01-15", batch: "A" },
  { id: "s2", name: "Chidi Nwosu", isActive: true, joinedDate: "2024-03-01", batch: "A" },
  { id: "s3", name: "Funke Adeyemi", isActive: true, joinedDate: "2024-06-10", batch: "B" },
  { id: "s4", name: "Ibrahim Musa", isActive: true, joinedDate: "2024-02-20", batch: "B" },
  { id: "s5", name: "Kemi Balogun", isActive: true, joinedDate: "2024-08-05", batch: "C" },
  { id: "s6", name: "Ladi Okonkwo", isActive: true, joinedDate: "2024-04-12", batch: "C" },
  { id: "s7", name: "Musa Abubakar", isActive: true, joinedDate: "2024-07-01", batch: "D" },
  { id: "s8", name: "Nneka Eze", isActive: true, joinedDate: "2024-05-18", batch: "D" },
];

// ─── Natural Language Constraints ─────────────────────────────────────────────

const managerInstructions = [
  "Ada Obi needs time off from Aug 14 for 3 days",
  "Chidi Nwosu is only available on Monday Tuesday Wednesday Thursday Friday",
  "Funke Adeyemi prefers morning shifts",
  "Ibrahim Musa cannot do night shift followed by morning",
  "Kemi Balogun can work at most 18 shifts",
  "Musa Abubakar must work morning shift on Aug 5",
  "Nneka Eze is not available on weekends",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const month = new Date(2026, 7, 1); // August 2026
  const holidays: string[] = [];

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         Fair Call Pro — Agentic Scheduler Demo           ║");
  console.log("║   Natural Language Constraints → Constraint-Aware Plan   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`📅 Scheduling: ${format(month, "MMMM yyyy")}`);
  console.log(`👥 Staff: ${demoStaff.length}`);
  console.log(`📝 Manager Instructions:`);
  for (const inst of managerInstructions) {
    console.log(`   • "${inst}"`);
  }
  console.log("");

  // Step 1: Parse constraints
  console.log("─── Step 1: Parsing Natural Language Constraints ───");
  const parsed = parseConstraints(managerInstructions, demoStaff, month);
  console.log(`   ✅ Parsed ${parsed.constraints.length} constraints`);
  if (parsed.unrecognized.length > 0) {
    console.log(`   ⚠️  Could not parse: ${parsed.unrecognized.join(", ")}`);
  }
  for (const c of parsed.constraints) {
    console.log(`   • [${c.type}] ${c.staffName}: ${c.sourceText}`);
  }
  console.log("");

  // Step 2: Generate baseline (no constraints)
  console.log("─── Step 2: Baseline Scheduler (Original LRU) ───");
  const baseline = generateBaselineSchedule(demoStaff, month, holidays, [], "morning-afternoon-night");
  const baselineFilled = baseline.assignments.filter(
    (a) => a.morning || a.afternoon || a.night
  ).length;
  console.log(`   Filled slots: ${baselineFilled}`);
  console.log(`   Errors: ${baseline.errors.length}`);
  console.log("");

  // Step 3: Generate agent schedule (with constraints)
  console.log("─── Step 3: Agent Scheduler (Constraint-Aware) ───");
  const agentResult = generateAgentSchedule(demoStaff, month, parsed.constraints, holidays, "morning-afternoon-night");
  const agentFilled = agentResult.assignments.filter(
    (a) => a.morning || a.afternoon || a.night
  ).length;
  console.log(`   Filled slots: ${agentFilled}`);
  console.log(`   Errors: ${agentResult.errors.length}`);
  console.log(`   Constraint decisions: ${agentResult.constraintDecisions.length}`);
  console.log("");

  // Step 4: Explain agent schedule
  console.log("─── Step 4: Schedule Explanation ───");
  const explanation = explainSchedule(agentResult, parsed.constraints, holidays, "Agent Schedule");
  console.log(`   ${explanation.summary}`);
  console.log(`   Fairness: ${explanation.fairnessAnalysis.overallScore}/100`);
  for (const note of explanation.fairnessAnalysis.balanceNotes) {
    console.log(`   • ${note}`);
  }
  console.log("");
  console.log(`   💡 Hot Take: ${explanation.hotTake}`);
  console.log("");

  // Step 5: Run full evaluation
  console.log("─── Step 5: Full Evaluation (12 Cases) ───");
  console.log("");
  const evalResult = runEvaluation();

  console.log("");
  console.log("✅ Demo complete. Run `npm run eval` for the full evaluation suite.");
}

main().catch(console.error);
