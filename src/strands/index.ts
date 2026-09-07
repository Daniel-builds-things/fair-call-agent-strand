// ─── Fair Call Strands Agent — CLI Demo ───────────────────────────────────────
// Demonstrates the Strands Agents SDK integration with the Fair Call scheduler.
// Run: npm run strands:demo

import { createFairCallAgent } from "./scheduling-agent";
import { configureLogging } from "@strands-agents/sdk";

// Enable SDK logging for visibility
configureLogging({ level: "info" });

// Sample staff roster (matching the existing evaluation cases)
const sampleStaff = [
  {
    id: "staff_alice",
    name: "Alice",
    initials: "AL",
    isActive: true,
    joinedDate: "2025-01-15",
    batch: "A" as const,
  },
  {
    id: "staff_bob",
    name: "Bob",
    initials: "BO",
    isActive: true,
    joinedDate: "2025-02-01",
    batch: "B" as const,
  },
  {
    id: "staff_charlie",
    name: "Charlie",
    initials: "CH",
    isActive: true,
    joinedDate: "2025-03-10",
    batch: "A" as const,
  },
  {
    id: "staff_diana",
    name: "Diana",
    initials: "DI",
    isActive: true,
    joinedDate: "2025-04-01",
    batch: "C" as const,
  },
];

// Natural language constraints
const sampleConstraints = [
  "Alice is unavailable on August 15",
  "Bob needs 3 days off starting August 10",
  "Charlie and Diana must not work the same shift",
  "Alice prefers morning shifts",
];

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Fair Call Agent — Strands Agents SDK Integration Demo  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // Create the agent
  const agent = createFairCallAgent();

  console.log("Agent created with Strands Agents SDK");
  console.log("Staff: 4 members (Alice, Bob, Charlie, Diana)");
  console.log("Constraints:");
  sampleConstraints.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  console.log("\n---\n");

  // Invoke the agent with a natural language request
  const prompt =
    `Generate a fair schedule for August 2026 with these staff and constraints:\n\n` +
    `Staff: ${sampleStaff.map((s) => s.name).join(", ")}\n` +
    `Constraints:\n` +
    sampleConstraints.map((c) => `  - ${c}`).join("\n") +
    `\n\nUse the morning-afternoon-night distribution preference.`;

  console.log(`Prompt: "${prompt.substring(0, 100)}..."\n`);

  try {
    const result = await agent.invoke(prompt);

    console.log("\n─── Agent Response ───\n");
    console.log(result.output.text || "(no text output)");

    console.log("\n─── Tool Usage ───\n");
    for (const toolResult of result.toolResults) {
      console.log(`Tool: ${toolResult.toolName}`);
      console.log(`Status: ${toolResult.status}`);
      if (toolResult.result?.summary) {
        console.log(`Summary: ${toolResult.result.summary}`);
      }
    }

    console.log(`\n\nStop reason: ${result.stopReason}`);
    console.log(`Total tool calls: ${result.toolResults.length}`);
  } catch (err: any) {
    console.error(`\nAgent invocation failed: ${err.message}`);
    console.error(err.stack);
  }
}

main();
