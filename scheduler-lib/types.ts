// ─── Core Types for the Fair Call Agentic Scheduler ───────────────────────────

export type ShiftSlot = "morning" | "afternoon" | "night";
export type DistributionPreference =
  | "auto"
  | "morning"
  | "morning-night"
  | "morning-afternoon-night";

export interface StaffMember {
  id: string;
  name: string;
  initials?: string;
  color?: string;
  isActive: boolean;
  joinedDate: string | Date;
  endDate?: string | Date;
  batch?: "A" | "B" | "C" | "D" | string;
}

export interface DayAssignment {
  date: string;
  morning?: string;
  afternoon?: string;
  night?: string;
  isManual: boolean;
}

export interface StaffStats {
  staffId: string;
  staffName: string;
  morningCount: number;
  afternoonCount: number;
  nightCount: number;
  weekendCount: number;
  holidayCount: number;
  totalCount: number;
}

export interface ScheduleError {
  type: string;
  message: string;
  date?: string | Date;
  slot?: ShiftSlot;
  staffId?: string;
}

export interface ScheduleResult {
  assignments: DayAssignment[];
  stats: StaffStats[];
  errors: ScheduleError[];
  warnings: string[];
}

// ─── Constraint Types ─────────────────────────────────────────────────────────

export type ConstraintType =
  | "unavailable"
  | "preferred"
  | "time_off"
  | "max_shifts"
  | "min_shifts"
  | "balance"
  | "no_back_to_back"
  | "no_night_to_morning"
  | "pair_together"
  | "pair_apart"
  | "specific_shift"
  | "availability"
  | "role"
  | "coverage";

export type ConstraintPriority = "hard" | "soft" | "preference";

export interface Constraint {
  id: string;
  type: ConstraintType;
  priority: ConstraintPriority;
  staffId: string;
  staffName: string;
  targetStaffId?: string;
  targetStaffName?: string;
  dates?: Date[] | string[];
  startDate?: Date | string;
  daysCount?: number;
  slots?: ShiftSlot[];
  daysOfWeek?: number[];
  value?: number;
  sourceText?: string;
  metadata?: Record<string, unknown>;
}
