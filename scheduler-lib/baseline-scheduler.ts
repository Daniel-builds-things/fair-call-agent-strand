// ─── Baseline LRU Scheduler (adapted from Fair Call Pro) ──────────────────────
// This is the ORIGINAL deterministic scheduler — our hackathon baseline.
// It uses a greedy LRU (Least Recently Used) algorithm with no agent reasoning.

import {
  eachDayOfInterval,
  format,
  isWeekend,
  startOfMonth,
  endOfMonth,
  parseISO,
  differenceInDays,
  addDays,
  subDays,
  getDay,
} from "date-fns";

const MIN_GAP_DAYS = 1;
const MAX_GLOBAL_ITERATIONS = 3000;

export type ShiftSlot = "morning" | "afternoon" | "night";
export type DistributionPreference =
  | "auto"
  | "morning"
  | "morning-night"
  | "morning-afternoon-night";

export interface StaffMember {
  id: string;
  name: string;
  isActive: boolean;
  joinedDate?: string;
  endDate?: string;
  batch?: string;
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
  date?: string;
}

export interface ScheduleResult {
  assignments: DayAssignment[];
  stats: StaffStats[];
  errors: ScheduleError[];
  warnings: string[];
}

interface SlotInfo {
  date: string;
  slot: ShiftSlot;
}

interface LastAssignment {
  date: string;
  slot: ShiftSlot;
}

/**
 * Generate a schedule using the baseline LRU algorithm.
 * No constraint awareness — pure deterministic greedy scheduling.
 */
export function generateBaselineSchedule(
  staff: StaffMember[],
  month: Date,
  holidays: string[] = [],
  existingAssignments: DayAssignment[] = [],
  distributionPreference: DistributionPreference = "morning-afternoon-night"
): ScheduleResult {
  if (!staff || !Array.isArray(staff)) {
    return {
      assignments: [],
      stats: [],
      errors: [],
      warnings: ["Invalid staff data"],
    };
  }

  const activeStaff = staff.filter((s) => s && s.isActive && s.id);
  const errors: ScheduleError[] = [];
  const warnings: string[] = [];
  let globalIterations = 0;

  if (activeStaff.length === 0) {
    return {
      assignments: [],
      stats: [],
      errors: [],
      warnings: ["No active staff available"],
    };
  }

  let monthStart: Date, monthEnd: Date;
  try {
    monthStart = startOfMonth(month);
    monthEnd = endOfMonth(month);
  } catch {
    return {
      assignments: [],
      stats: [],
      errors: [],
      warnings: ["Invalid date"],
    };
  }

  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  if (allDays.length === 0) {
    return {
      assignments: [],
      stats: [],
      errors: [],
      warnings: ["No days in range"],
    };
  }

  // Initialize tracking
  const stats: Record<string, StaffStats> = {};
  const staffLastAssignment = new Map<string, LastAssignment>();

  activeStaff.forEach((s) => {
    stats[s.id] = {
      staffId: s.id,
      staffName: s.name,
      morningCount: 0,
      afternoonCount: 0,
      nightCount: 0,
      weekendCount: 0,
      holidayCount: 0,
      totalCount: 0,
    };
  });

  const holidaySet = new Set(holidays || []);

  // Assignment map
  const assignmentMap = new Map<
    string,
    { morning?: string; afternoon?: string; night?: string; isManual?: boolean }
  >();
  for (const day of allDays) {
    assignmentMap.set(format(day, "yyyy-MM-dd"), {});
  }

  // Process existing manual assignments
  for (const day of allDays) {
    const dateStr = format(day, "yyyy-MM-dd");
    const existing = existingAssignments.find(
      (a) => a.date === dateStr && a.isManual
    );
    if (existing) {
      assignmentMap.set(dateStr, {
        morning: existing.morning,
        afternoon: existing.afternoon,
        night: existing.night,
        isManual: true,
      });
      const isHoliday = holidaySet.has(dateStr);
      const isWknd = isWeekend(day);
      for (const slot of ["morning", "afternoon", "night"] as ShiftSlot[]) {
        const sid = existing[slot];
        if (sid && stats[sid]) {
          stats[sid][`${slot}Count`]++;
          stats[sid].totalCount++;
          if (isWknd) stats[sid].weekendCount++;
          if (isHoliday) stats[sid].holidayCount++;
          staffLastAssignment.set(sid, { date: dateStr, slot });
        }
      }
    }
  }

  const assignShift = (
    staffId: string,
    dateStr: string,
    slot: ShiftSlot
  ): boolean => {
    if (!staffId || !dateStr || !stats[staffId]) return false;
    const day = parseISO(dateStr);
    const isHoliday = holidaySet.has(dateStr);
    const isWknd = isWeekend(day);
    const current = assignmentMap.get(dateStr) || {};
    current[slot] = staffId;
    assignmentMap.set(dateStr, current);
    stats[staffId][`${slot}Count`]++;
    stats[staffId].totalCount++;
    if (isWknd) stats[staffId].weekendCount++;
    if (isHoliday) stats[staffId].holidayCount++;
    staffLastAssignment.set(staffId, { date: dateStr, slot });
    return true;
  };

  const hasRecentAssignment = (
    staffId: string,
    dateStr: string,
    slot: ShiftSlot
  ): boolean => {
    const targetDate = parseISO(dateStr);
    const prevDate = format(subDays(targetDate, 1), "yyyy-MM-dd");
    const prevAssignment = assignmentMap.get(prevDate);
    const currentAssignment = assignmentMap.get(dateStr);

    // Same-day conflicts
    if (
      slot === "morning" &&
      (currentAssignment?.afternoon === staffId ||
        currentAssignment?.night === staffId)
    )
      return true;
    if (
      slot === "afternoon" &&
      (currentAssignment?.morning === staffId ||
        currentAssignment?.night === staffId)
    )
      return true;
    if (
      slot === "night" &&
      (currentAssignment?.morning === staffId ||
        currentAssignment?.afternoon === staffId)
    )
      return true;

    // Worked yesterday
    if (prevAssignment) {
      if (
        prevAssignment.morning === staffId ||
        prevAssignment.afternoon === staffId ||
        prevAssignment.night === staffId
      ) {
        return true;
      }
    }

    // Night -> Morning crossover
    if (slot === "morning" && prevAssignment?.night === staffId) {
      return true;
    }

    return false;
  };

  const getDaysSinceLastAssignment = (
    staffId: string,
    currentDateStr: string
  ): number => {
    const last = staffLastAssignment.get(staffId);
    if (!last) return Infinity;
    return Math.abs(
      differenceInDays(parseISO(currentDateStr), parseISO(last.date))
    );
  };

  const isStaffPastEndDate = (staff: StaffMember, dateStr: string): boolean => {
    if (!staff.endDate) return false;
    return parseISO(dateStr) > parseISO(staff.endDate);
  };

  const findEligibleStaff = (
    dateStr: string,
    slot: ShiftSlot,
    preferLRU: boolean = true
  ): StaffMember[] => {
    const current = assignmentMap.get(dateStr) || {};

    const eligible = activeStaff.filter((s) => {
      if (!s?.id) return false;
      if (isStaffPastEndDate(s, dateStr)) return false;
      if (
        slot === "morning" &&
        (current.afternoon === s.id || current.night === s.id)
      )
        return false;
      if (
        slot === "afternoon" &&
        (current.morning === s.id || current.night === s.id)
      )
        return false;
      if (
        slot === "night" &&
        (current.morning === s.id || current.afternoon === s.id)
      )
        return false;
      return true;
    });

    if (!preferLRU) return eligible;

    return eligible.sort((a, b) => {
      const aDays = getDaysSinceLastAssignment(a.id, dateStr);
      const bDays = getDaysSinceLastAssignment(b.id, dateStr);
      const aRecent = hasRecentAssignment(a.id, dateStr, slot);
      const bRecent = hasRecentAssignment(b.id, dateStr, slot);

      if (!aRecent && bRecent) return -1;
      if (aRecent && !bRecent) return 1;
      if (aDays !== bDays) return bDays - aDays;
      return (stats[a.id]?.totalCount || 0) - (stats[b.id]?.totalCount || 0);
    });
  };

  const getAllSlots = (): SlotInfo[] => {
    const slots: SlotInfo[] = [];
    for (const day of allDays) {
      const dateStr = format(day, "yyyy-MM-dd");
      const existing = assignmentMap.get(dateStr);
      const isHolidayDay = holidaySet.has(dateStr);
      const isWeekendDay = isWeekend(day);

      if (existing?.isManual) continue;

      let includeMorning = false;
      let includeAfternoon = false;
      let includeNight = false;

      switch (distributionPreference) {
        case "morning":
          includeMorning = true;
          break;
        case "morning-night":
          includeMorning = true;
          includeNight = true;
          break;
        case "morning-afternoon-night":
          includeMorning = true;
          includeAfternoon = true;
          includeNight = true;
          break;
        case "auto":
        default:
          includeMorning = true;
          if (isWeekendDay || isHolidayDay) includeNight = true;
          break;
      }

      if (includeMorning && !existing?.morning) {
        slots.push({ date: dateStr, slot: "morning" });
      }
      if (includeAfternoon && !existing?.afternoon) {
        slots.push({ date: dateStr, slot: "afternoon" });
      }
      if (includeNight && !existing?.night) {
        slots.push({ date: dateStr, slot: "night" });
      }
    }
    return slots;
  };

  // Main scheduling loop
  const allSlots = getAllSlots();
  allSlots.sort((a, b) => a.date.localeCompare(b.date));

  for (const slotInfo of allSlots) {
    if (globalIterations++ >= MAX_GLOBAL_ITERATIONS) {
      warnings.push(
        `[SAFETY] Scheduling stopped early (${globalIterations} iterations)`
      );
      break;
    }

    const current = assignmentMap.get(slotInfo.date);
    if (current?.[slotInfo.slot]) continue;

    let eligible = findEligibleStaff(slotInfo.date, slotInfo.slot, true);
    if (eligible.length === 0) {
      eligible = findEligibleStaff(slotInfo.date, slotInfo.slot, false);
    }

    if (eligible.length === 0) {
      errors.push({
        type: "UNFILLABLE_SLOT",
        message: `No eligible staff for ${slotInfo.slot} on ${slotInfo.date}`,
        date: slotInfo.date,
      });
      continue;
    }

    assignShift(eligible[0].id, slotInfo.date, slotInfo.slot);
  }

  // Build final assignments
  const assignments: DayAssignment[] = [];
  for (const day of allDays) {
    const dateStr = format(day, "yyyy-MM-dd");
    const data = assignmentMap.get(dateStr);
    assignments.push({
      date: dateStr,
      morning: data?.morning,
      afternoon: data?.afternoon,
      night: data?.night,
      isManual: false,
    });
  }

  return {
    assignments,
    stats: Object.values(stats),
    errors,
    warnings,
  };
}
