// ─── Constraint Parser: Natural Language → Structured Constraints ─────────────
// Parses human-readable scheduling constraints into machine-processable form.
// Uses pattern matching for reliability (no external API keys required).
// An LLM-based parser can be substituted via the parseWithLLM() hook.

import {
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  format,
  addDays,
  parse,
  getDay,
} from "date-fns";
import type { Constraint, ConstraintType, ConstraintPriority, StaffMember } from "../types.js";
import { parseConstraintsWithLLM, isLLMAvailable } from "./llm-constraint-parser.js";

let constraintCounter = 0;
function nextId(): string {
  return `constraint_${++constraintCounter}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ParseResult {
  constraints: Constraint[];
  unrecognized: string[];
}

/**
 * Parse a batch of natural language constraint strings.
 * Each string is one constraint request from a user/manager.
 */
export function parseConstraints(
  requests: string[],
  staff: StaffMember[],
  month: Date
): ParseResult {
  constraintCounter = 0;
  const constraints: Constraint[] = [];
  const unrecognized: string[] = [];

  for (const request of requests) {
    const trimmed = request.trim();
    if (!trimmed) continue;

    const parsed = parseSingleConstraint(trimmed, staff, month);
    if (parsed) {
      constraints.push(parsed);
    } else {
      unrecognized.push(trimmed);
    }
  }

  return { constraints, unrecognized };
}

// ─── Single Constraint Parser ────────────────────────────────────────────────

function parseSingleConstraint(
  text: string,
  staff: StaffMember[],
  month: Date
): Constraint | null {
  const lower = text.toLowerCase();

  // Try each pattern in order of specificity
  const parsers: Array<(text: string, lower: string, staff: StaffMember[], month: Date) => Constraint | null> = [
    parseTimeOff,
    parseUnavailable,
    parseSpecificShift,
    parseMaxShifts,
    parseMinShifts,
    parseNoBackToBack,
    parseNoNightToMorning,
    parsePairTogether,
    parsePairApart,
    parseAvailability,
    parsePreferredShift,
    parseBalance,
    parseCoverage,
    parseRole,
  ];

  for (const parser of parsers) {
    const result = parser(text, lower, staff, month);
    if (result) return result;
  }

  return null;
}

// ─── Helper: Resolve Staff ───────────────────────────────────────────────────

function resolveStaff(name: string, staff: StaffMember[]): StaffMember | null {
  const normalized = name.toLowerCase().trim();
  // Exact match
  let found = staff.find((s) => s.name.toLowerCase() === normalized);
  if (found) return found;
  // Partial match (first name or last name)
  const parts = normalized.split(/\s+/);
  for (const part of parts) {
    found = staff.find((s) => s.name.toLowerCase().includes(part));
    if (found) return found;
  }
  return null;
}

function resolveTwoStaff(
  text: string,
  staff: StaffMember[]
): [StaffMember, StaffMember] | null {
  // Try to find two staff names in the text
  const found: StaffMember[] = [];
  for (const s of staff) {
    if (text.toLowerCase().includes(s.name.toLowerCase())) {
      found.push(s);
    }
    if (found.length >= 2) break;
  }
  if (found.length >= 2) return [found[0], found[1]];
  return null;
}

function daysInMonth(month: Date): string[] {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const days = eachDayOfInterval({ start, end });
  return days.map((d) => format(d, "yyyy-MM-dd"));
}

function datesFromList(text: string, month: Date): Date[] {
  // Try to parse dates like "Aug 5, Aug 12, Aug 19" or "5th, 12th, 19th"
  const dates: Date[] = [];

  // Pattern: Month Day (e.g., "Aug 5", "August 15")
  const monthDayPattern =
    /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}/gi;
  for (const match of text.matchAll(monthDayPattern)) {
    try {
      const year = month.getFullYear();
      const d = parse(`${match[0]} ${year}`, "MMMM d yyyy", new Date());
      if (!isNaN(d.getTime()) && d.getMonth() === month.getMonth()) {
        dates.push(d);
      }
    } catch {
      // try short month
      try {
        const year = month.getFullYear();
        const d = parse(`${match[0]} ${year}`, "MMM d yyyy", new Date());
        if (!isNaN(d.getTime()) && d.getMonth() === month.getMonth()) {
          dates.push(d);
        }
      } catch {
        // skip
      }
    }
  }

  // Pattern: just day numbers (e.g., "5, 12, 19" or "5th, 12th")
  if (dates.length === 0) {
    const dayNums = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g);
    if (dayNums) {
      for (const dn of dayNums) {
        const num = parseInt(dn.replace(/\D/g, ""), 10);
        if (num >= 1 && num <= 31) {
          const d = new Date(month.getFullYear(), month.getMonth(), num);
          if (d.getMonth() === month.getMonth()) {
            dates.push(d);
          }
        }
      }
    }
  }

  return dates;
}

function daysOfWeekFromNames(names: string[]): number[] {
  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    weekends: 6,
    weekend: 6,
    weekdays: 1,
    weekday: 1,
  };
  const result: number[] = [];
  for (const name of names) {
    const n = name.toLowerCase().trim();
    // Handle "weekends" -> Saturday + Sunday
    if (n === "weekends" || n === "weekend") {
      result.push(0, 6);
      continue;
    }
    if (n === "weekdays" || n === "weekday") {
      result.push(1, 2, 3, 4, 5);
      continue;
    }
    if (dayMap[n] !== undefined) result.push(dayMap[n]);
  }
  return [...new Set(result)];
}

// ─── Individual Parsers ──────────────────────────────────────────────────────

function parseTimeOff(
  text: string,
  lower: string,
  staff: StaffMember[],
  month: Date
): Constraint | null {
  // "{name} needs time off from {date} for {N} days"
  // "{name} is on leave from {date}"
  // "{name} needs {N} days off starting {date}"
  const patterns = [
    /(.+?)\s+(?:needs?\s+time\s+off|is\s+on\s+leave|needs?\s+.*?\s+off)\s+(?:from\s+)?(.+)/i,
    /(.+?)\s+needs?\s+(\d+)\s+days?\s+off\s+(?:starting\s+)?(.+)/i,
    /(.+?)\s+(?:has\s+a\s+wedding|has\s+vacation|is\s+away|is\s+unavailable)\s+(?:from\s+)?(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const staffMember = resolveStaff(match[1], staff);
    if (!staffMember) continue;

    // Try to extract start date and duration
    const datePart = match[2] || match[3] || "";
    const dates = datesFromList(datePart, month);

    // Try to extract duration
    const durMatch = text.match(/(\d+)\s*days?/i);
    const daysCount = durMatch ? parseInt(durMatch[1], 10) : undefined;

    if (dates.length > 0) {
      return {
        id: nextId(),
        type: "time_off",
        priority: "hard",
        staffId: staffMember.id,
        staffName: staffMember.name,
        startDate: dates[0],
        dates: dates,
        daysCount: daysCount,
        sourceText: text,
      };
    }
  }

  return null;
}

function parseUnavailable(
  text: string,
  lower: string,
  staff: StaffMember[],
  month: Date
): Constraint | null {
  // "{name} cannot work on {dates}"
  // "{name} is not available on {dates}"
  // "{name} can't work {slot} shifts"
  const patterns = [
    /(.+?)\s+cannot\s+work\s+(?:on\s+)?(.+)/i,
    /(.+?)\s+can't\s+work\s+(?:on\s+)?(.+)/i,
    /(.+?)\s+is\s+not\s+available\s+(?:on\s+)?(.+)/i,
    /(.+?)\s+unavailable\s+(?:on\s+)?(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const staffMember = resolveStaff(match[1], staff);
    if (!staffMember) continue;

    const rest = match[2] || "";
    const dates = datesFromList(rest, month);

    // Check for specific slots
    const slots: string[] = [];
    if (rest.toLowerCase().includes("morning")) slots.push("morning");
    if (rest.toLowerCase().includes("afternoon")) slots.push("afternoon");
    if (rest.toLowerCase().includes("night")) slots.push("night");

    // Check for day-of-week patterns
    const dayNames = rest.match(
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekends?|weekdays?|mon|tue|wed|thu|fri|sat|sun)\b/gi
    );
    const daysOfWeek = dayNames ? daysOfWeekFromNames(dayNames) : undefined;

    return {
      id: nextId(),
      type: "unavailable",
      priority: "hard",
      staffId: staffMember.id,
      staffName: staffMember.name,
      dates: dates.length > 0 ? dates : undefined,
      slots: slots.length > 0 ? (slots as any[]) : undefined,
      daysOfWeek,
      sourceText: text,
    };
  }

  return null;
}

function parseSpecificShift(
  text: string,
  lower: string,
  staff: StaffMember[],
  month: Date
): Constraint | null {
  // "{name} must work {slot} on {date}"
  // "{name} should take {slot} shift on {date}"
  const match = text.match(
    /(.+?)\s+(?:must\s+work|should\s+(?:take\s+)?work|needs?\s+to\s+work|has\s+to\s+work)\s+(morning|afternoon|night)\s+(?:shift\s+)?(?:on\s+)?(.+)/i
  );
  if (!match) return null;

  const staffMember = resolveStaff(match[1], staff);
  if (!staffMember) return null;

  const slot = match[2].toLowerCase() as "morning" | "afternoon" | "night";
  const dates = datesFromList(match[3], month);

  if (dates.length === 0) return null;

  return {
    id: nextId(),
    type: "specific_shift",
    priority: "hard",
    staffId: staffMember.id,
    staffName: staffMember.name,
    dates,
    slots: [slot],
    sourceText: text,
  };
}

function parseMaxShifts(
  text: string,
  lower: string,
  staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "{name} can work at most {N} shifts"
  // "{name} max {N} shifts"
  const match = text.match(
    /(.+?)\s+(?:can\s+work\s+at\s+most|maximum|max|no\s+more\s+than|at\s+most)\s+(\d+)\s+shifts?/i
  );
  if (!match) return null;

  const staffMember = resolveStaff(match[1], staff);
  if (!staffMember) return null;

  return {
    id: nextId(),
    type: "max_shifts",
    priority: "soft",
    staffId: staffMember.id,
    staffName: staffMember.name,
    value: parseInt(match[2], 10),
    sourceText: text,
  };
}

function parseMinShifts(
  text: string,
  lower: string,
  staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "{name} needs at least {N} shifts"
  // "{name} must work minimum {N} shifts"
  const match = text.match(
    /(.+?)\s+(?:needs?\s+at\s+least|must\s+work\s+(?:at\s+)?minimum|minimum|at\s+least)\s+(\d+)\s+shifts?/i
  );
  if (!match) return null;

  const staffMember = resolveStaff(match[1], staff);
  if (!staffMember) return null;

  return {
    id: nextId(),
    type: "min_shifts",
    priority: "soft",
    staffId: staffMember.id,
    staffName: staffMember.name,
    value: parseInt(match[2], 10),
    sourceText: text,
  };
}

function parseNoBackToBack(
  text: string,
  lower: string,
  staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "{name} should not work back-to-back days"
  // "no consecutive days for {name}"
  const match = text.match(
    /(?:no\s+consecutive\s+(?:days?\s+)?(?:for\s+)?|(.+?)\s+(?:should\s+not\s+work|must\s+not\s+work|cannot\s+work|no)\s+(back[-\s]?to[-\s]?back|consecutive))/i
  );
  if (!match) return null;

  const namePart = match[1] || match[2];
  const staffMember = resolveStaff(namePart, staff);
  if (!staffMember) {
    // Try all staff if it's a general rule
    if (lower.includes("back") && (lower.includes("to") || lower.includes("consecutive"))) {
      // Apply to all staff as a general rule — use first staff as anchor
      return {
        id: nextId(),
        type: "no_back_to_back",
        priority: "soft",
        staffId: staff[0]?.id || "",
        staffName: "All staff",
        metadata: { appliesToAll: true },
        sourceText: text,
      };
    }
    return null;
  }

  return {
    id: nextId(),
    type: "no_back_to_back",
    priority: "soft",
    staffId: staffMember.id,
    staffName: staffMember.name,
    sourceText: text,
  };
}

function parseNoNightToMorning(
  text: string,
  lower: string,
  staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "{name} cannot do night shift followed by morning"
  const match = text.match(
    /(.+?)\s+(?:cannot|should\s+not|must\s+not)\s+(?:do\s+)?(?:night\s+shift\s+(?:followed\s+by|then|and)\s+morning|night.*morning)/i
  );
  if (!match) return null;

  const staffMember = resolveStaff(match[1], staff);
  if (!staffMember) return null;

  return {
    id: nextId(),
    type: "no_night_to_morning",
    priority: "hard",
    staffId: staffMember.id,
    staffName: staffMember.name,
    sourceText: text,
  };
}

function parsePairTogether(
  text: string,
  lower: string,
  staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "{name1} and {name2} should work together"
  // "always pair {name1} with {name2}"
  const match = text.match(
    /(?:always\s+pair\s+|(.+?)\s+and\s+(.+?)\s+(?:should\s+)?work\s+together)/i
  );
  if (!match) return null;

  let s1: StaffMember | null, s2: StaffMember | null;
  if (match[1] && match[2]) {
    s1 = resolveStaff(match[1], staff);
    s2 = resolveStaff(match[2], staff);
  } else {
    const pair = resolveTwoStaff(text, staff);
    if (!pair) return null;
    [s1, s2] = pair;
  }

  if (!s1 || !s2) return null;

  return {
    id: nextId(),
    type: "pair_together",
    priority: "soft",
    staffId: s1.id,
    staffName: s1.name,
    targetStaffId: s2.id,
    targetStaffName: s2.name,
    sourceText: text,
  };
}

function parsePairApart(
  text: string,
  lower: string,
  staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "{name1} and {name2} should not work together"
  // "never pair {name1} with {name2}"
  const match = text.match(
    /(?:never\s+pair\s+|(.+?)\s+and\s+(.+?)\s+(?:should\s+)?not\s+work\s+together)/i
  );
  if (!match) return null;

  let s1: StaffMember | null, s2: StaffMember | null;
  if (match[1] && match[2]) {
    s1 = resolveStaff(match[1], staff);
    s2 = resolveStaff(match[2], staff);
  } else {
    const pair = resolveTwoStaff(text, staff);
    if (!pair) return null;
    [s1, s2] = pair;
  }

  if (!s1 || !s2) return null;

  return {
    id: nextId(),
    type: "pair_apart",
    priority: "hard",
    staffId: s1.id,
    staffName: s1.name,
    targetStaffId: s2.id,
    targetStaffName: s2.name,
    sourceText: text,
  };
}

function parseAvailability(
  text: string,
  lower: string,
  staff: StaffMember[],
  month: Date
): Constraint | null {
  // "{name} is only available on {days}"
  // "{name} can only work {days}"
  const match = text.match(
    /(.+?)\s+(?:is\s+only\s+available\s+(?:on\s+)?|can\s+only\s+work\s+(?:on\s+)?|works\s+only\s+(?:on\s+)?)(.+)/i
  );
  if (!match) return null;

  const staffMember = resolveStaff(match[1], staff);
  if (!staffMember) return null;

  const rest = match[2];
  const dayNames = rest.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekends?|weekdays?|mon|tue|wed|thu|fri|sat|sun)\b/gi
  );
  if (!dayNames) return null;

  const daysOfWeek = daysOfWeekFromNames(dayNames);

  return {
    id: nextId(),
    type: "availability",
    priority: "hard",
    staffId: staffMember.id,
    staffName: staffMember.name,
    daysOfWeek,
    sourceText: text,
  };
}

function parsePreferredShift(
  text: string,
  lower: string,
  staff: StaffMember[],
  month: Date
): Constraint | null {
  // "{name} prefers {slot} shifts"
  // "{name} would rather work {slot}"
  const match = text.match(
    /(.+?)\s+(?:prefers?|would\s+rather\s+work|likes?\s+to\s+work)\s+(morning|afternoon|night)/i
  );
  if (!match) return null;

  const staffMember = resolveStaff(match[1], staff);
  if (!staffMember) return null;

  const slot = match[2].toLowerCase() as "morning" | "afternoon" | "night";

  return {
    id: nextId(),
    type: "preferred",
    priority: "preference",
    staffId: staffMember.id,
    staffName: staffMember.name,
    slots: [slot],
    sourceText: text,
  };
}

function parseBalance(
  text: string,
  lower: string,
  staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "balance shifts for {name}"
  // "ensure {name} gets equal morning/afternoon/night"
  const match = text.match(
    /(?:balance|equalize|ensure.*equal)\s+(?:shifts?\s+(?:for|among|between)\s+)?(.+)/i
  );
  if (!match) return null;

  const staffMember = resolveStaff(match[1], staff);
  if (!staffMember) return null;

  return {
    id: nextId(),
    type: "balance",
    priority: "preference",
    staffId: staffMember.id,
    staffName: staffMember.name,
    sourceText: text,
  };
}

function parseCoverage(
  text: string,
  lower: string,
  _staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "minimum {N} staff per {slot} shift"
  const match = text.match(
    /minimum\s+(\d+)\s+(?:staff|people|workers)\s+(?:per\s+)?(?:shift\s+)?(morning|afternoon|night)?/i
  );
  if (!match) return null;

  const slots: string[] = match[2] ? [match[2].toLowerCase()] : [
    "morning",
    "afternoon",
    "night",
  ];

  return {
    id: nextId(),
    type: "coverage",
    priority: "soft",
    staffId: "",
    staffName: "All staff",
    slots: slots as any[],
    value: parseInt(match[1], 10),
    sourceText: text,
  };
}

function parseRole(
  text: string,
  lower: string,
  staff: StaffMember[],
  _month: Date
): Constraint | null {
  // "{name} is a senior"
  // "{name} is a trainee"
  const match = text.match(
    /(.+?)\s+is\s+(a\s+)?(senior|trainee|lead|supervisor|junior|experienced)/i
  );
  if (!match) return null;

  const staffMember = resolveStaff(match[1], staff);
  if (!staffMember) return null;

  return {
    id: nextId(),
    type: "role",
    priority: "preference",
    staffId: staffMember.id,
    staffName: staffMember.name,
    metadata: { role: match[3].toLowerCase() },
    sourceText: text,
  };
}

// ─── Async LLM-Aware Entry Point ──────────────────────────────────────────────

/**
 * Parse constraints with LLM first, regex fallback.
 * This is the recommended entry point for production use.
 */
export async function parseConstraintsAsync(
  requests: string[],
  staff: StaffMember[],
  month: Date
): Promise<ParseResult> {
  if (isLLMAvailable()) {
    try {
      const llmConstraints = await parseConstraintsWithLLM(requests, staff, month);
      if (llmConstraints.length > 0) {
        const llmSourceTexts = new Set(llmConstraints.map((c) => c.sourceText));
        const missed = requests.filter((r) => r.trim() && !llmSourceTexts.has(r.trim()));
        if (missed.length === 0) {
          return { constraints: llmConstraints, unrecognized: [] };
        }
        const regexResult = parseConstraints(missed, staff, month);
        return {
          constraints: [...llmConstraints, ...regexResult.constraints],
          unrecognized: regexResult.unrecognized,
        };
      }
    } catch (err) {
      console.warn("[LLM Parser] Error, falling back to regex:", err);
    }
  }
  return parseConstraints(requests, staff, month);
}

export { isLLMAvailable };
