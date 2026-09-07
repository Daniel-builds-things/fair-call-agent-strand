// ─── Fair Schedule Tool for Strands Agents SDK ───────────────────────────────
// Wraps the existing Fair Call Agent scheduling engine as a Strands Agent tool.
// Zero rewrite of domain logic — the existing scheduler runs inside the tool callback.

import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import { parseConstraintsAsync } from "../../scheduler-lib/constraint-parser";
import { generateAgentSchedule } from "../../scheduler-lib/enhanced-scheduler";

// ─── Zod schemas matching existing types ──────────────────────────────────────

const StaffMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string().optional(),
  color: z.string().optional(),
  isActive: z.boolean(),
  joinedDate: z.string(),      // ISO date string
  endDate: z.string().optional(),
  batch: z.enum(["A", "B", "C", "D"]).optional(),
});

const ConstraintInputSchema = z.object({
  id: z.string(),
  type: z.enum([
    "unavailable", "preferred", "time_off", "max_shifts", "min_shifts",
    "balance", "no_back_to_back", "no_night_to_morning", "pair_together",
    "pair_apart", "specific_shift", "availability", "role", "coverage",
  ]),
  priority: z.enum(["hard", "soft", "preference"]).default("soft"),
  staffId: z.string(),
  staffName: z.string(),
  targetStaffId: z.string().optional(),
  targetStaffName: z.string().optional(),
  dates: z.array(z.string()).optional(),    // ISO date strings
  startDate: z.string().optional(),
  daysCount: z.number().optional(),
  slots: z.array(z.enum(["morning", "afternoon", "night"])).optional(),
  daysOfWeek: z.array(z.number()).optional(),
  value: z.number().optional(),
  sourceText: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ToolInputSchema = z.object({
  staff: z.array(StaffMemberSchema).min(1, "At least one active staff member is required"),
  constraints: z.array(z.string()).optional().default([]).describe(
    "Natural language constraint strings, e.g. 'Alice is unavailable on Dec 25', " +
    "'Bob needs 3 days off starting Jan 1', 'Alice and Charlie must not work together'"
  ),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format").describe(
    "The target month for scheduling, e.g. '2026-08'"
  ),
  preference: z.enum(["auto", "morning", "morning-night", "morning-afternoon-night"])
    .default("morning-afternoon-night")
    .describe("Distribution preference for shift assignments"),
  holidays: z.array(z.string()).optional().default([]).describe(
    "Holiday dates as ISO strings (YYYY-MM-DD)"
  ),
});

type ToolInput = z.infer<typeof ToolInputSchema>;

// ─── The Tool ─────────────────────────────────────────────────────────────────

export const fairScheduleTool = tool({
  name: "generate_fair_schedule",
  description:
    "Generates a fair shift schedule for a team of healthcare workers. " +
    "Accepts staff roster, natural language constraints, target month, and distribution preference. " +
    "Uses a constraint-aware LRU scheduler that ensures fairness while respecting hard constraints " +
    "(unavailability, time off, pair rules) and optimizing soft constraints (preferences, balance). " +
    "Returns assignments, fairness stats, constraint decisions, and any warnings or errors.",

  inputSchema: ToolInputSchema,

  callback: async (input: ToolInput) => {
    const startTime = Date.now();

    try {
      // Parse month string
      const [year, month] = input.month.split("-").map(Number);
      const monthDate = new Date(year, month - 1, 1);

      // Convert joinedDate strings to Date objects
      const staffWithDates = input.staff.map((s) => ({
        ...s,
        joinedDate: new Date(s.joinedDate),
        endDate: s.endDate ? new Date(s.endDate) : undefined,
      }));

      // Step 1: Parse natural language constraints → structured Constraint[]
      const parsed = await parseConstraintsAsync(
        input.constraints,
        staffWithDates,
        monthDate
      );

      // Step 2: Run the existing enhanced scheduler (no rewrite needed!)
      const schedule = generateAgentSchedule(
        staffWithDates,
        monthDate,
        parsed.constraints,
        input.holidays,
        input.preference
      );

      const elapsed = Date.now() - startTime;

      // Step 3: Serialize dates for JSON response
      const assignments = schedule.assignments.map((a: any) => ({
        ...a,
        date: typeof a.date === "string" ? a.date : a.date.toISOString?.().split("T")[0] || String(a.date),
      }));

      const errors = schedule.errors.map((e: any) => ({
        ...e,
        date: e.date ? (typeof e.date === "string" ? e.date : String(e.date)) : undefined,
      }));

      // Step 4: Build summary for the agent's reasoning
      const totalSlots = assignments.length;
      const filledSlots = assignments.filter((a: any) => a.morning || a.afternoon || a.night).length;
      const constraintSummary = schedule.constraintDecisions.map((d: any) => ({
        constraintId: d.constraintId,
        applied: d.applied,
        reasoning: d.reasoning,
      }));

      return {
        success: true,
        schedule: {
          assignments,
          stats: schedule.stats,
          errors,
          warnings: schedule.warnings,
        },
        constraints: {
          parsed: parsed.constraints,
          unrecognized: parsed.unrecognized,
          decisions: constraintSummary,
        },
        metadata: {
          month: input.month,
          staffCount: staffWithDates.filter((s) => s.isActive).length,
          constraintCount: parsed.constraints.length,
          distributionPreference: input.preference,
          processingTimeMs: elapsed,
        },
        summary: `Schedule generated for ${input.month}: ${filledSlots}/${totalSlots} slots filled, ` +
          `${schedule.errors.length} errors, ${schedule.warnings.length} warnings, ` +
          `${parsed.constraints.length} constraints applied. ` +
          `Processing time: ${elapsed}ms.`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Unknown error during schedule generation",
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      };
    }
  },
});
