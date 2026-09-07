// ─── Core Types for the Fair Call Agentic Scheduler ───────────────────────────

export type ShiftSlot = "morning" | "afternoon" | "night";

export interface StaffMember {
  id: string;
  name: string;
  initials?: string;
  color?: string;
  isActive: boolean;
  joinedDate: Date;
  endDate?: Date;
  batch?: "A" | "B" | "C" | "D";
}

export interface Assignment {
  id?: string;
  userId: string;
  rosterId?: string;
  staffId: string;
  staffName: string;
  staffInitials?: string;
  staffColor?: string;
  date: Date;
  slot: ShiftSlot;
  isManual: boolean;
  isHoliday?: boolean;
  isWeekend?: boolean;
}

export interface ScheduleStats {
  [staffId: string]: {
    morningCount: number;
    afternoonCount: number;
    nightCount: number;
    weekendCount: number;
    holidayCount: number;
    totalCount: number;
  };
}

export interface ScheduleError {
  type: string;
  message: string;
  date?: Date;
  slot?: ShiftSlot;
  staffId?: string;
}

export interface ScheduleResult {
  assignments: Assignment[];
  stats: ScheduleStats;
  errors: ScheduleError[];
  warnings: string[];
}

// ─── Constraint Types ─────────────────────────────────────────────────────────

export type ConstraintType =
  | "unavailable"        // staff cannot work on specific dates/slots
  | "preferred"          // staff prefers specific dates/slots
  | "time_off"           // staff needs N consecutive days off starting from date
  | "max_shifts"         // staff cannot work more than N shifts in the month
  | "min_shifts"         // staff must work at least N shifts in the month
  | "balance"            // balance shift types for a staff member
  | "no_back_to_back"    // staff cannot work consecutive days
  | "no_night_to_morning"// staff cannot do night shift then morning next day
  | "pair_together"      // two staff must work the same shift on same day
  | "pair_apart"         // two staff must NOT work the same shift on same day
  | "specific_shift"     // staff must work a specific shift on a specific date
  | "availability"       // staff is only available on specific days of week
  | "role"               // staff has a role (e.g., "senior") for priority
  | "coverage"           // minimum staff per shift slot
  ;

export type ConstraintPriority = "hard" | "soft" | "preference";

export interface Constraint {
  id: string;
  type: ConstraintType;
  priority: ConstraintPriority;
  staffId: string;        // primary staff this constraint applies to
  staffName: string;
  targetStaffId?: string; // for pair_together / pair_apart
  targetStaffName?: string;
  dates?: Date[];         // specific dates
  startDate?: Date;       // for time_off ranges
  daysCount?: number;     // for time_off duration or max/min shifts
  slots?: ShiftSlot[];    // applicable shift slots
  daysOfWeek?: number[];  // 0=Sun, 1=Mon, ... 6=Sat
  value?: number;         // numeric value (e.g., max shifts count)
  sourceText?: string;    // original natural language text
  metadata?: Record<string, unknown>;
}

// ─── Evaluation Types ─────────────────────────────────────────────────────────

export interface EvaluationCase {
  id: string;
  name: string;
  description: string;
  staff: StaffMember[];
  month: Date;
  holidays: string[];
  distributionPreference: string;
  constraints: Constraint[];
  expectedOutcomes: string[];
}

export interface EvaluationMetrics {
  caseId: string;
  caseName: string;

  // Coverage metrics
  totalSlots: number;
  filledSlotsBaseline: number;
  filledSlotsAgent: number;
  coverageBaseline: number;    // percentage
  coverageAgent: number;       // percentage

  // Fairness metrics
  fairnessScoreBaseline: number;  // 0-100, higher = fairer
  fairnessScoreAgent: number;

  // Constraint satisfaction
  totalConstraints: number;
  satisfiedBaseline: number;
  satisfiedAgent: number;
  constraintSatisfactionBaseline: number;  // percentage
  constraintSatisfactionAgent: number;     // percentage

  // Per-constraint breakdown
  constraintBreakdown: {
    constraintId: string;
    type: ConstraintType;
    satisfiedByBaseline: boolean;
    satisfiedByAgent: boolean;
  }[];

  // Back-to-back violations
  backToBackViolationsBaseline: number;
  backToBackViolationsAgent: number;

  // Night-to-morning violations
  nightToMorningViolationsBaseline: number;
  nightToMorningViolationsAgent: number;

  // Shift balance (std dev of shift counts per staff)
  shiftBalanceBaseline: number;
  shiftBalanceAgent: number;
}

export interface EvaluationResult {
  metrics: EvaluationMetrics[];
  summary: {
    avgCoverageBaseline: number;
    avgCoverageAgent: number;
    avgFairnessBaseline: number;
    avgFairnessAgent: number;
    avgConstraintSatisfactionBaseline: number;
    avgConstraintSatisfactionAgent: number;
    improvementCoverage: number;
    improvementFairness: number;
    improvementConstraintSatisfaction: number;
  };
}

// ─── Explanation Types ────────────────────────────────────────────────────────

export interface ScheduleExplanation {
  summary: string;
  fairnessAnalysis: {
    overallScore: number;
    mostLoadedStaff: { name: string; count: number }[];
    leastLoadedStaff: { name: string; count: number }[];
    balanceNotes: string[];
  };
  constraintDecisions: {
    constraint: Constraint;
    applied: boolean;
    reasoning: string;
  }[];
  anomalies: {
    description: string;
    severity: "low" | "medium" | "high";
    suggestion?: string;
  }[];
  hotTake: string;  // The "insight" for hackathon scoring
}
