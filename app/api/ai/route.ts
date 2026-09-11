// ─── AI Features API Route ────────────────────────────────────────────────────
// Unified endpoint for all 4 AI-powered scheduling features:
// POST /api/ai
//
// Actions:
//   - "explain": Schedule Explanation & Reasoning
//   - "conflicts": Conflict Resolution Suggestions
//   - "query": Natural Language Schedule Queries
//   - "predict": Predictive Staffing Recommendations

import { NextRequest, NextResponse } from "next/server";
import {
  explainScheduleWithAI,
  analyzeConflictsWithAI,
  queryScheduleWithAI,
  predictStaffingWithAI,
} from "../../../src/agents/ai-features";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, schedule, staff, constraints, month, query, conversationHistory } = body;

    // Validate required fields
    if (!action) {
      return NextResponse.json(
        { error: "Missing 'action'. Use: explain, conflicts, query, or predict." },
        { status: 400 }
      );
    }

    if (!schedule?.assignments || !schedule?.stats) {
      return NextResponse.json(
        { error: "Missing schedule data. Include 'schedule.assignments' and 'schedule.stats'." },
        { status: 400 }
      );
    }

    const assignments = schedule.assignments;
    const stats = schedule.stats;
    const errors = schedule.errors || [];
    const constraintsList = constraints || [];
    const staffList = staff || [];
    const monthStr = month || "unknown";
    const holidays = body.holidays || [];

    switch (action) {
      case "explain": {
        const result = await explainScheduleWithAI(
          assignments, stats, constraintsList, staffList, monthStr, holidays
        );
        return NextResponse.json({ action: "explain", data: result });
      }

      case "conflicts": {
        const result = await analyzeConflictsWithAI(
          assignments, stats, constraintsList, errors, staffList, monthStr
        );
        return NextResponse.json({ action: "conflicts", data: result });
      }

      case "query": {
        if (!query) {
          return NextResponse.json(
            { error: "Missing 'query' for action=query" },
            { status: 400 }
          );
        }
        const result = await queryScheduleWithAI(
          query, assignments, stats, constraintsList, staffList, monthStr, conversationHistory || []
        );
        return NextResponse.json({ action: "query", data: result });
      }

      case "predict": {
        const result = await predictStaffingWithAI(
          assignments, stats, constraintsList, errors, staffList, monthStr, holidays
        );
        return NextResponse.json({ action: "predict", data: result });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: '${action}'. Use: explain, conflicts, query, or predict.` },
          { status: 400 }
        );
    }
  } catch (err: any) {
    console.error("AI features API error:", err);
    return NextResponse.json(
      {
        error: err.message || "Internal server error",
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
