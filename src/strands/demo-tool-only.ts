// ─── Fair Schedule Tool — Direct Demo (No LLM Required) ───────────────────────
// Tests the Strands tool directly without invoking the Agent/LLM.
// Useful for verifying the integration works before configuring a model.
// Run: npm run strands:demo:tool

import { fairScheduleTool } from "./fair-schedule-tool";

// Sample staff roster
const sampleStaff = [
  {
    id: "staff_alice",
    name: "Alice",
    initials: "AL",
    isActive: true,
    joinedDate: "2025-01-15T00:00:00.000Z",
    batch: "A" as const,
  },
  {
    id: "staff_bob",
    name: "Bob",
    initials: "BO",
    isActive: true,
    joinedDate: "2025-02-01T00:00:00.000Z",
    batch: "B" as const,
  },
  {
    id: "staff_charlie",
    name: "Charlie",
    initials: "CH",
    isActive: true,
    joinedDate: "2025-03-10T00:00:00.000Z",
    batch: "A" as const,
  },
  {
    id: "staff_diana",
    name: "Diana",
    initials: "DI",
    isActive: true,
    joinedDate: "2025-04-01T00:00:00.000Z",
    batch: "C" as const,
  },
];

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   Fair Schedule Tool — Direct Strands Tool Test      ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log(`Tool name: ${fairScheduleTool.name}`);
  console.log(`Tool description: ${fairScheduleTool.description}\n`);

  // Invoke the tool directly (no LLM involved)
  console.log("Invoking tool with test input...\n");

  const result = await fairScheduleTool.invoke({
    staff: sampleStaff,
    constraints: [
      "Alice is unavailable on August 15",
      "Bob needs 3 days off starting August 10",
      "Charlie and Diana must not work the same shift",
    ],
    month: "2026-08",
    preference: "morning-afternoon-night",
    holidays: ["2026-08-14"],
  });

  // Print results
  if (result.success) {
    console.log("✅ Tool execution successful!\n");

    const { schedule, constraints, metadata, summary } = result as any;

    console.log("─── Summary ───");
    console.log(summary);
    console.log();

    console.log("─── Metadata ───");
    console.log(`  Month: ${metadata.month}`);
    console.log(`  Active staff: ${metadata.staffCount}`);
    console.log(`  Constraints parsed: ${metadata.constraintCount}`);
    console.log(`  Preference: ${metadata.distributionPreference}`);
    console.log(`  Processing time: ${metadata.processingTimeMs}ms`);
    console.log();

    console.log("─── Schedule Stats ───");
    for (const stat of schedule.stats) {
      console.log(
        `  ${stat.staffName}: ${stat.totalCount} shifts ` +
        `(M:${stat.morningCount} A:${stat.afternoonCount} N:${stat.nightCount})`
      );
    }
    console.log();

    console.log("─── Constraint Decisions ───");
    for (const decision of constraints.decisions) {
      const icon = decision.applied ? "✅" : "❌";
      console.log(`  ${icon} [${decision.constraintId}] ${decision.reasoning}`);
    }
    console.log();

    if (schedule.warnings.length > 0) {
      console.log("─── Warnings ───");
      schedule.warnings.forEach((w: string) => console.log(`  ⚠️  ${w}`));
      console.log();
    }

    if (schedule.errors.length > 0) {
      console.log("─── Errors ───");
      schedule.errors.forEach((e: any) => console.log(`  ❌ ${e.type}: ${e.message}`));
      console.log();
    }

    // Show first few assignments as a sample
    console.log("─── Sample Assignments (first 5 days) ───");
    const first5Days = new Set(
      [...new Set(schedule.assignments.map((a: any) => a.date))].slice(0, 5)
    );
    for (const day of first5Days) {
      const dayAssignments = schedule.assignments.filter(
        (a: any) => a.date === day
      );
      console.log(`  ${day}:`, dayAssignments.map((a: any) => {
        const parts: string[] = [];
        if (a.morning) parts.push(`M:${a.morning}`);
        if (a.afternoon) parts.push(`A:${a.afternoon}`);
        if (a.night) parts.push(`N:${a.night}`);
        return parts.join(", ");
      }).join(" | "));
    }
  } else {
    console.log("❌ Tool execution failed!");
    console.log(`Error: ${result.error}`);
    if (result.stack) {
      console.log(result.stack);
    }
  }
}

main();
