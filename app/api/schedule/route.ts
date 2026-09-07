import { NextRequest, NextResponse } from "next/server";
import { parseConstraintsAsync, isLLMAvailable } from "../../../scheduler-lib/constraint-parser";
import { generateAgentSchedule } from "../../../scheduler-lib/enhanced-scheduler";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { staff, constraints: constraintTexts, month: monthStr, preference } = body;

    if (!staff || !Array.isArray(staff) || staff.length === 0) {
      return NextResponse.json({ error: "No staff provided" }, { status: 400 });
    }

    // Parse month string (e.g., "2026-08") to Date
    const [year, month] = monthStr.split("-").map(Number);
    const monthDate = new Date(year, month - 1, 1);

    // Fix joinedDate to be Date objects
    const staffWithDates = staff.map((s: any) => ({
      ...s,
      joinedDate: new Date(s.joinedDate),
      endDate: s.endDate ? new Date(s.endDate) : undefined,
    }));

    // Parse constraints — LLM first, regex fallback
    const parsed = await parseConstraintsAsync(constraintTexts || [], staffWithDates, monthDate);

    // Generate schedule
    const schedule = generateAgentSchedule(
      staffWithDates,
      monthDate,
      parsed.constraints,
      [],
      preference || "morning-afternoon-night"
    );

    // Serialize dates to strings for JSON response
    const serializedAssignments = schedule.assignments.map((a: any) => ({
      ...a,
      date: typeof a.date === "string" ? a.date : a.date.toISOString?.().split("T")[0] || String(a.date),
    }));

    const serializedStats = schedule.stats.map((s: any) => ({ ...s }));

    return NextResponse.json({
      assignments: serializedAssignments,
      stats: serializedStats,
      errors: schedule.errors.map((e: any) => ({
        ...e,
        date: e.date ? (typeof e.date === "string" ? e.date : String(e.date)) : undefined,
      })),
      warnings: schedule.warnings,
      constraintDecisions: schedule.constraintDecisions,
      parsedConstraints: parsed.constraints,
      unrecognizedConstraints: parsed.unrecognized,
      llmPowered: isLLMAvailable(),
    });
  } catch (err: any) {
    console.error("Schedule generation error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error", stack: process.env.NODE_ENV === "development" ? err.stack : undefined },
      { status: 500 }
    );
  }
}
