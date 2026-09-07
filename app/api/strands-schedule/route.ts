// ─── Strands-Powered Schedule API Route ───────────────────────────────────────
// Next.js API route that invokes the Fair Call Strands Agent.
// POST /api/strands-schedule
//
// Request body matches the existing /api/schedule endpoint for compatibility:
//   { staff, constraints: string[], month: "YYYY-MM", preference }
//
// Response includes the agent's natural language explanation + the raw schedule.

import { NextRequest, NextResponse } from "next/server";
import { createFairCallAgent } from "../../../src/strands/scheduling-agent";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { staff, constraints: constraintTexts, month: monthStr, preference } = body;

    if (!staff || !Array.isArray(staff) || staff.length === 0) {
      return NextResponse.json(
        { error: "No staff provided. Include a 'staff' array with at least one active member." },
        { status: 400 }
      );
    }

    if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
      return NextResponse.json(
        { error: "Invalid month. Use 'YYYY-MM' format, e.g. '2026-08'." },
        { status: 400 }
      );
    }

    // Build natural language prompt from structured input
    const staffList = staff
      .filter((s: any) => s.isActive)
      .map((s: any) => s.name)
      .join(", ");

    const constraintsSection = constraintTexts && constraintTexts.length > 0
      ? `Constraints:\n${constraintTexts.map((c: string) => `  - ${c}`).join("\n")}`
      : "No additional constraints.";

    const prompt =
      `Generate a fair schedule for ${monthStr} with the following:\n\n` +
      `Staff: ${staffList}\n` +
      constraintsSection +
      `\n\nDistribution preference: ${preference || "morning-afternoon-night"}.`;

    // Create agent and invoke
    const agent = createFairCallAgent();
    const result = await agent.invoke(prompt);

    // Extract tool results (the schedule data)
    const scheduleToolResult = result.toolResults.find(
      (tr) => tr.toolName === "generate_fair_schedule"
    );

    const scheduleData = scheduleToolResult?.result;
    const agentExplanation = result.output.text || "";

    return NextResponse.json({
      // Agent's natural language explanation
      explanation: agentExplanation,

      // Raw schedule data (same shape as existing API, plus metadata)
      schedule: scheduleData?.schedule || {
        assignments: [],
        stats: [],
        errors: [],
        warnings: [],
      },

      // Constraint analysis
      constraints: scheduleData?.constraints || {
        parsed: [],
        unrecognized: [],
        decisions: [],
      },

      // Metadata
      metadata: scheduleData?.metadata || {
        month: monthStr,
        staffCount: staff.filter((s: any) => s.isActive).length,
        constraintCount: (constraintTexts || []).length,
        distributionPreference: preference || "morning-afternoon-night",
      },

      // Whether the agent successfully called the tool
      success: scheduleToolResult?.status === "success",

      // Agent stop reason (useful for debugging)
      stopReason: result.stopReason,
    });
  } catch (err: any) {
    console.error("Strands schedule generation error:", err);
    return NextResponse.json(
      {
        error: err.message || "Internal server error",
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
