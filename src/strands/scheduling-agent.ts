// ─── Fair Call Strands Agent ──────────────────────────────────────────────────
// Creates a Strands Agent that wraps the Fair Call scheduling engine.
// The agent accepts natural language requests and delegates to the scheduler tool.

import { Agent, type AgentConfig } from "@strands-agents/sdk";
import { fairScheduleTool } from "./fair-schedule-tool";

/**
 * Creates a Fair Call scheduling agent powered by the Strands Agents SDK.
 *
 * @param options - Optional AgentConfig overrides (model, hooks, etc.)
 * @returns Configured Strands Agent with fair-schedule tool
 */
export function createFairCallAgent(options?: Partial<AgentConfig>): Agent {
  return new Agent({
    model: options?.model ?? "global.anthropic.claude-sonnet-4-20250514-v1:0",
    systemPrompt: options?.systemPrompt ??
      `You are a Fair Call scheduling assistant. You help healthcare managers and administrators create fair, constraint-aware shift schedules.

## Capabilities
- Generate fair monthly schedules for healthcare teams
- Parse natural language constraints (time off, unavailability, pairing rules, etc.)
- Ensure equitable distribution of shifts across staff
- Provide explanations for scheduling decisions

## Workflow
1. When given a scheduling request, collect: staff roster, constraints, target month
2. Use the generate_fair_schedule tool to create the schedule
3. Present results clearly: assignments overview, fairness stats, any warnings
4. Explain constraint decisions and suggest improvements if there are errors

## Response Guidelines
- Be concise and professional
- Present schedule data in clear tables
- Highlight any unfilled slots or constraint violations
- Suggest remedies when schedules have issues`,
    tools: [fairScheduleTool],
    ...options,
  });
}
