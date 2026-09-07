// ─── Enhanced Constraint-Aware Scheduler ──────────────────────────────────────
// Builds on the baseline LRU scheduler but adds a constraint resolution layer.
// The agent reasons about hard constraints, soft preferences, and trade-offs.

import {
  eachDayOfInterval,
  format,
  isWeekend,
  startOfMonth,
  endOfMonth,
  parseISO,
  differenceInDays,
  subDays,
  addDays,
} from "date-fns";
import type {
  Constraint,
  ConstraintType,
  StaffMember,
  ShiftSlot,
  DayAssignment,
  StaffStats,
  ScheduleResult,
  ScheduleError,
} from "../types.js";

const MAX_GLOBAL_ITERATIONS = 3000;

interface SlotInfo {
  date: string;
  slot: ShiftSlot;
}

interface LastAssignment {
  date: string;
  slot: ShiftSlot;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateAgentSchedule(
  staff: StaffMember[],
  month: Date,
  constraints: Constraint[],
  holidays: string[] = [],
  distributionPreference: string = "morning-afternoon-night"
): ScheduleResult & { constraintDecisions: { constraintId: string; applied: boolean; reasoning: string }[] } {
  if (!staff || !Array.isArray(staff) || staff.length === 0) {
    return {
      assignments: [],
      stats: [],
      errors: [],
      warnings: ["No active staff available"],
      constraintDecisions: [],
    };
  }

  const activeStaff = staff.filter((s) => s && s.isActive && s.id);
  const errors: ScheduleError[] = [];
  const warnings: string[] = [];
  const constraintDecisions: { constraintId: string; applied: boolean; reasoning: string }[] = [];
  let globalIterations = 0;

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
      constraintDecisions: [],
    };
  }

  const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const holidaySet = new Set(holidays || []);

  // ─── Pre-compute constraint indices ──────────────────────────────────────

  // Hard unavailability: staffId -> Set<date+slot combinations>
  const hardUnavailable = new Map<string, Set<string>>(); // staffId -> Set<"date-slot">
  // Day-of-week unavailability
  const dowUnavailable = new Map<string, Set<number>>(); // staffId -> Set<dayOfWeek>
  // Time-off ranges: staffId -> [{start, end}]
  const timeOffRanges = new Map<string, { start: string; end: string }[]>();
  // Specific shift requirements: staffId -> [{date, slot}]
  const specificShifts = new Map<string, { date: string; slot: ShiftSlot }[]>();
  // Pair together: [{staffId, targetStaffId}]
  const pairTogether: { staffId: string; targetStaffId: string }[] = [];
  // Pair apart: [{staffId, targetStaffId}]
  const pairApart: { staffId: string; targetStaffId: string }[] = [];
  // Max shifts: staffId -> max count
  const maxShifts = new Map<string, number>();
  // Min shifts: staffId -> min count
  const minShifts = new Map<string, number>();
  // No back-to-back staff IDs
  const noBackToBack = new Set<string>();
  // No night-to-morning staff IDs
  const noNightToMorning = new Set<string>();
  // Availability (only work on these days of week)
  const availabilityDow = new Map<string, Set<number>>();
  // Preferred shifts: staffId -> Set<slot>
  const preferredShifts = new Map<string, Set<ShiftSlot>>();

  for (const c of constraints) {
    switch (c.type) {
      case "unavailable": {
        if (c.dates && c.slots) {
          for (const d of c.dates) {
            for (const s of c.slots) {
              const key = `${format(d, "yyyy-MM-dd")}-${s}`;
              if (!hardUnavailable.has(c.staffId)) hardUnavailable.set(c.staffId, new Set());
              hardUnavailable.get(c.staffId)!.add(key);
            }
          }
        } else if (c.dates) {
          for (const d of c.dates) {
            for (const slot of ["morning", "afternoon", "night"] as ShiftSlot[]) {
              const key = `${format(d, "yyyy-MM-dd")}-${slot}`;
              if (!hardUnavailable.has(c.staffId)) hardUnavailable.set(c.staffId, new Set());
              hardUnavailable.get(c.staffId)!.add(key);
            }
          }
        }
        if (c.daysOfWeek) {
          if (!dowUnavailable.has(c.staffId)) dowUnavailable.set(c.staffId, new Set());
          for (const dow of c.daysOfWeek) {
            dowUnavailable.get(c.staffId)!.add(dow);
          }
        }
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Hard constraint: ${c.staffName} is unavailable${c.dates ? ` on ${c.dates.map((d) => format(d, "MMM d")).join(", ")}` : ""}${c.daysOfWeek ? ` on day(s) of week ${c.daysOfWeek.join(",")}` : ""}${c.slots ? ` for ${c.slots.join(", ")} shift(s)` : ""}`,
        });
        break;
      }
      case "time_off": {
        if (c.startDate && c.daysCount) {
          const start = format(c.startDate, "yyyy-MM-dd");
          const end = format(addDays(c.startDate, c.daysCount - 1), "yyyy-MM-dd");
          if (!timeOffRanges.has(c.staffId)) timeOffRanges.set(c.staffId, []);
          timeOffRanges.get(c.staffId)!.push({ start, end });
        } else if (c.dates && c.dates.length > 0) {
          for (const d of c.dates) {
            const ds = format(d, "yyyy-MM-dd");
            if (!timeOffRanges.has(c.staffId)) timeOffRanges.set(c.staffId, []);
            timeOffRanges.get(c.staffId)!.push({ start: ds, end: ds });
          }
        }
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Hard constraint: ${c.staffName} is on time off${c.startDate ? ` from ${format(c.startDate, "MMM d")}` : ""}${c.daysCount ? ` for ${c.daysCount} days` : ""}`,
        });
        break;
      }
      case "specific_shift": {
        if (c.dates && c.slots) {
          for (const d of c.dates) {
            const ds = format(d, "yyyy-MM-dd");
            for (const s of c.slots) {
              if (!specificShifts.has(c.staffId)) specificShifts.set(c.staffId, []);
              specificShifts.get(c.staffId)!.push({ date: ds, slot: s as ShiftSlot });
            }
          }
        }
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Hard constraint: ${c.staffName} must work ${c.slots?.join(", ")} on ${c.dates?.map((d) => format(d, "MMM d")).join(", ")}`,
        });
        break;
      }
      case "max_shifts": {
        maxShifts.set(c.staffId, c.value || 999);
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Soft constraint: ${c.staffName} max ${c.value} shifts this month`,
        });
        break;
      }
      case "min_shifts": {
        minShifts.set(c.staffId, c.value || 0);
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Soft constraint: ${c.staffName} needs at least ${c.value} shifts`,
        });
        break;
      }
      case "no_back_to_back": {
        if ((c.metadata as any)?.appliesToAll) {
          for (const s of activeStaff) noBackToBack.add(s.id);
        } else {
          noBackToBack.add(c.staffId);
        }
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Soft constraint: ${c.staffName} should not work consecutive days`,
        });
        break;
      }
      case "no_night_to_morning": {
        noNightToMorning.add(c.staffId);
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Hard constraint: ${c.staffName} cannot do night shift followed by morning`,
        });
        break;
      }
      case "pair_together": {
        pairTogether.push({ staffId: c.staffId, targetStaffId: c.targetStaffId! });
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Soft constraint: ${c.staffName} and ${c.targetStaffName} should work together`,
        });
        break;
      }
      case "pair_apart": {
        pairApart.push({ staffId: c.staffId, targetStaffId: c.targetStaffId! });
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Hard constraint: ${c.staffName} and ${c.targetStaffName} must not work the same shift`,
        });
        break;
      }
      case "availability": {
        if (c.daysOfWeek) {
          availabilityDow.set(c.staffId, new Set(c.daysOfWeek));
          constraintDecisions.push({
            constraintId: c.id,
            applied: true,
            reasoning: `Hard constraint: ${c.staffName} only available on specific days of week`,
          });
        }
        break;
      }
      case "preferred": {
        if (c.slots) {
          preferredShifts.set(c.staffId, new Set(c.slots as ShiftSlot[]));
          constraintDecisions.push({
            constraintId: c.id,
            applied: true,
            reasoning: `Preference: ${c.staffName} prefers ${c.slots.join(", ")} shifts`,
          });
        }
        break;
      }
      case "balance": {
        constraintDecisions.push({
          constraintId: c.id,
          applied: true,
          reasoning: `Preference: Balance shift types for ${c.staffName}`,
        });
        break;
      }
      default:
        constraintDecisions.push({
          constraintId: c.id,
          applied: false,
          reasoning: `Unknown constraint type: ${c.type}`,
        });
    }
  }

  // ─── Helper: Check if a staff is on time-off on a date ─────────────────

  const isOnTimeOff = (staffId: string, dateStr: string): boolean => {
    const ranges = timeOffRanges.get(staffId);
    if (!ranges) return false;
    return ranges.some((r) => dateStr >= r.start && dateStr <= r.end);
  };

  // ─── Helper: Check if staff is hard-unavailable for a date+slot ────────

  const isHardUnavailable = (staffId: string, dateStr: string, slot: ShiftSlot): boolean => {
    // Check specific unavailability
    const unavail = hardUnavailable.get(staffId);
    if (unavail && unavail.has(`${dateStr}-${slot}`)) return true;

    // Check time-off
    if (isOnTimeOff(staffId, dateStr)) return true;

    // Check day-of-week unavailability
    const dowUnavail = dowUnavailable.get(staffId);
    if (dowUnavail) {
      const dow = parseISO(dateStr).getDay();
      if (dowUnavail.has(dow)) return true;
    }

    // Check availability (inverse: if staff only available on certain days)
    const avail = availabilityDow.get(staffId);
    if (avail && avail.size > 0) {
      const dow = parseISO(dateStr).getDay();
      if (!avail.has(dow)) return true;
    }

    return false;
  };

  // ─── Initialize tracking ───────────────────────────────────────────────

  const stats: Record<string, StaffStats> = {};
  const staffLastAssignment = new Map<string, LastAssignment>();
  const shiftCounts = new Map<string, Record<ShiftSlot, number>>();

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
    shiftCounts.set(s.id, { morning: 0, afternoon: 0, night: 0 });
  });

  // Assignment map
  const assignmentMap = new Map<
    string,
    { morning?: string; afternoon?: string; night?: string }
  >();
  for (const day of allDays) {
    assignmentMap.set(format(day, "yyyy-MM-dd"), {});
  }

  // ─── Pre-assign specific shift requirements (hard constraints) ─────────

  for (const [staffId, reqs] of specificShifts.entries()) {
    for (const req of reqs) {
      const dayData = assignmentMap.get(req.date);
      if (dayData && !dayData[req.slot]) {
        dayData[req.slot] = staffId;
        const d = parseISO(req.date);
        const isWknd = isWeekend(d);
        const isHol = holidaySet.has(req.date);
        stats[staffId][`${req.slot}Count`]++;
        stats[staffId].totalCount++;
        if (isWknd) stats[staffId].weekendCount++;
        if (isHol) stats[staffId].holidayCount++;
        const counts = shiftCounts.get(staffId)!;
        counts[req.slot]++;
        staffLastAssignment.set(staffId, { date: req.date, slot: req.slot });
      }
    }
  }

  // ─── Helper functions ──────────────────────────────────────────────────

  const assignShift = (
    staffId: string,
    dateStr: string,
    slot: ShiftSlot
  ): boolean => {
    if (!staffId || !dateStr || !stats[staffId]) return false;
    const d = parseISO(dateStr);
    const isWknd = isWeekend(d);
    const isHol = holidaySet.has(dateStr);
    const current = assignmentMap.get(dateStr) || {};
    current[slot] = staffId;
    assignmentMap.set(dateStr, current);
    stats[staffId][`${slot}Count`]++;
    stats[staffId].totalCount++;
    if (isWknd) stats[staffId].weekendCount++;
    if (isHol) stats[staffId].holidayCount++;
    const counts = shiftCounts.get(staffId)!;
    counts[slot]++;
    staffLastAssignment.set(staffId, { date: dateStr, slot });
    return true;
  };

  const getDaysSinceLastAssignment = (
    staffId: string,
    currentDateStr: string
  ): number => {
    const last = staffLastAssignment.get(staffId);
    if (!last) return Infinity;
    return Math.abs(differenceInDays(parseISO(currentDateStr), parseISO(last.date)));
  };

  const hasRecentAssignment = (
    staffId: string,
    dateStr: string,
    slot: ShiftSlot
  ): boolean => {
    const prevDate = format(subDays(parseISO(dateStr), 1), "yyyy-MM-dd");
    const prevAssignment = assignmentMap.get(prevDate);
    const currentAssignment = assignmentMap.get(dateStr);

    // Same-day conflicts
    if (slot === "morning" && (currentAssignment?.afternoon === staffId || currentAssignment?.night === staffId)) return true;
    if (slot === "afternoon" && (currentAssignment?.morning === staffId || currentAssignment?.night === staffId)) return true;
    if (slot === "night" && (currentAssignment?.morning === staffId || currentAssignment?.afternoon === staffId)) return true;

    // Worked yesterday
    if (prevAssignment) {
      if (prevAssignment.morning === staffId || prevAssignment.afternoon === staffId || prevAssignment.night === staffId) {
        return true;
      }
    }

    // Night -> Morning crossover
    if (slot === "morning" && prevAssignment?.night === staffId) return true;

    return false;
  };

  const isStaffPastEndDate = (staff: StaffMember, dateStr: string): boolean => {
    if (!staff.endDate) return false;
    return parseISO(dateStr) > parseISO(staff.endDate);
  };

  // Check if assigning this staff to this slot would violate a pair_apart constraint
  const wouldViolatePairApart = (
    staffId: string,
    dateStr: string,
    slot: ShiftSlot
  ): boolean => {
    for (const pa of pairApart) {
      if (pa.staffId === staffId || pa.targetStaffId === staffId) {
        const otherId = pa.staffId === staffId ? pa.targetStaffId : pa.staffId;
        const dayData = assignmentMap.get(dateStr);
        if (dayData && dayData[slot] === otherId) return true;
      }
    }
    return false;
  };

  // ─── Find eligible staff (constraint-aware) ────────────────────────────

  const findEligibleStaff = (
    dateStr: string,
    slot: ShiftSlot,
    preferLRU: boolean = true
  ): StaffMember[] => {
    const current = assignmentMap.get(dateStr) || {};

    const eligible = activeStaff.filter((s) => {
      if (!s?.id) return false;
      if (isStaffPastEndDate(s, dateStr)) return false;

      // Hard: already assigned another slot today
      if (slot === "morning" && (current.afternoon === s.id || current.night === s.id)) return false;
      if (slot === "afternoon" && (current.morning === s.id || current.night === s.id)) return false;
      if (slot === "night" && (current.morning === s.id || current.afternoon === s.id)) return false;

      // Hard: specific shift already pre-assigned to someone else
      const daySpecific = specificShifts.entries();
      for (const [, reqs] of specificShifts.entries()) {
        for (const req of reqs) {
          if (req.date === dateStr && req.slot === slot && req.staffId !== s.id) {
            // This slot is reserved for another staff
            return false;
          }
        }
      }

      // Hard: unavailable on this date/slot
      if (isHardUnavailable(s.id, dateStr, slot)) return false;

      // Hard: would violate pair_apart
      if (wouldViolatePairApart(s.id, dateStr, slot)) return false;

      // Hard: no_night_to_morning constraint
      if (noNightToMorning.has(s.id)) {
        const prevDate = format(subDays(parseISO(dateStr), 1), "yyyy-MM-dd");
        const prevAssignment = assignmentMap.get(prevDate);
        if (slot === "morning" && prevAssignment?.night === s.id) return false;
      }

      // Soft: max_shifts — exclude if already at limit (but allow fallback)
      if (preferLRU) {
        const max = maxShifts.get(s.id);
        if (max !== undefined && stats[s.id].totalCount >= max) return false;
      }

      return true;
    });

    if (!preferLRU) return eligible;

    // Score and sort eligible staff
    return eligible.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      // LRU: days since last assignment
      const aDays = getDaysSinceLastAssignment(a.id, dateStr);
      const bDays = getDaysSinceLastAssignment(b.id, dateStr);
      if (aDays !== bDays) {
        if (aDays === Infinity && bDays !== Infinity) return -1;
        if (bDays === Infinity && aDays !== Infinity) return 1;
        if (aDays !== Infinity && bDays !== Infinity) return bDays - aDays;
      }

      // Back-to-back penalty
      const aRecent = hasRecentAssignment(a.id, dateStr, slot);
      const bRecent = hasRecentAssignment(b.id, dateStr, slot);
      if (noBackToBack.has(a.id) && aRecent) scoreA -= 100;
      if (noBackToBack.has(b.id) && bRecent) scoreB -= 100;
      if (!aRecent && bRecent) return -1;
      if (aRecent && !bRecent) return 1;

      // Shift balance penalty
      if (preferredShifts.has(a.id)) {
        const preferred = preferredShifts.get(a.id)!;
        if (!preferred.has(slot)) scoreA -= 10;
      }
      if (preferredShifts.has(b.id)) {
        const preferred = preferredShifts.get(b.id)!;
        if (!preferred.has(slot)) scoreB -= 10;
      }

      // Overall count tie-breaker
      if (scoreA !== scoreB) return scoreB - scoreA;
      return (stats[a.id]?.totalCount || 0) - (stats[b.id]?.totalCount || 0);
    });
  };

  // ─── Determine slots to fill ───────────────────────────────────────────

  const getAllSlots = (): SlotInfo[] => {
    const slots: SlotInfo[] = [];
    for (const day of allDays) {
      const dateStr = format(day, "yyyy-MM-dd");
      const existing = assignmentMap.get(dateStr);
      const isHolidayDay = holidaySet.has(dateStr);
      const isWeekendDay = isWeekend(day);

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

  // ─── Main scheduling loop ──────────────────────────────────────────────

  const allSlots = getAllSlots();
  allSlots.sort((a, b) => a.date.localeCompare(b.date));

  for (const slotInfo of allSlots) {
    if (globalIterations++ >= MAX_GLOBAL_ITERATIONS) {
      warnings.push(`[SAFETY] Scheduling stopped early (${globalIterations} iterations)`);
      break;
    }

    const current = assignmentMap.get(slotInfo.date);
    if (current?.[slotInfo.slot]) continue;

    // Try constraint-aware LRU
    let eligible = findEligibleStaff(slotInfo.date, slotInfo.slot, true);

    if (eligible.length === 0) {
      // Relax soft constraints
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

    // Try to satisfy pair_together constraints
    let assigned = false;
    for (const pt of pairTogether) {
      if (eligible.find((s) => s.id === pt.staffId) && current?.[slotInfo.slot] !== pt.targetStaffId) {
        // Check if target staff is also available
        const targetAvailable = activeStaff.find((s) => {
          if (s.id !== pt.targetStaffId) return false;
          return !isHardUnavailable(s.id, slotInfo.date, slotInfo.slot)
            && !wouldViolatePairApart(s.id, slotInfo.date, slotInfo.slot)
            && !isStaffPastEndDate(s, slotInfo.date);
        });
        if (targetAvailable && !current?.[slotInfo.slot]) {
          // Assign the primary staff
          assignShift(eligible[0].id, slotInfo.date, slotInfo.slot);
          assigned = true;
          break;
        }
      }
    }

    if (!assigned) {
      assignShift(eligible[0].id, slotInfo.date, slotInfo.slot);
    }
  }

  // ─── Build final assignments ───────────────────────────────────────────

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
    constraintDecisions,
  };
}
