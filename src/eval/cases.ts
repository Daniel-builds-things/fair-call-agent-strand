// ─── Evaluation Test Cases ───────────────────────────────────────────────────
// 12 realistic scheduling scenarios with constraints for benchmarking
// baseline vs agent-enhanced scheduler.

import { parseISO } from "date-fns";
import type { EvaluationCase, Constraint, StaffMember } from "../types.js";

function makeStaff(count: number, prefix: string = "Staff"): StaffMember[] {
  const names = [
    "Ada Obi", "Chidi Nwosu", "Funke Adeyemi", "Ibrahim Musa",
    "Kemi Balogun", "Ladi Okonkwo", "Musa Abubakar", "Nneka Eze",
    "Olu Adebayo", "Patience Okafor", "Rasheed Bello", "Sade Lawal",
    "Tunde Bakare", "Uche Nnamdi", "Vivian Chukwu", "Wale Ogundimu",
    "Yemi Ajayi", "Zainab Hassan", "Aisha Mohammed", "Bola Fashola",
  ];
  return Array.from({ length: Math.min(count, names.length) }, (_, i) => ({
    id: `staff_${i + 1}`,
    name: count <= names.length ? names[i] : `${prefix} ${i + 1}`,
    isActive: true,
    joinedDate: `2024-${String((i % 12) + 1).padStart(2, "0")}-01`,
    batch: (["A", "B", "C", "D"] as const)[i % 4],
  }));
}

const AUG_2026 = new Date(2026, 7, 1); // August 2026
const SEP_2026 = new Date(2026, 8, 1);
const OCT_2026 = new Date(2026, 9, 1);

const nigerianHolidays = ["2026-10-01"]; // Independence Day

function constraint(text: string, staff: StaffMember[], month: Date): Partial<Constraint> & { sourceText: string } {
  return { sourceText: text };
}

export const evaluationCases: EvaluationCase[] = [
  {
    id: "case_01",
    name: "Basic 8-Staff Clinic",
    description: "Small clinic with 8 staff, standard 3-shift coverage, no special constraints.",
    staff: makeStaff(8),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [],
    expectedOutcomes: ["All slots filled", "Reasonable fairness"],
  },
  {
    id: "case_02",
    name: "Wedding Conflict",
    description: "Ada has a wedding on Aug 15 and needs 3 days off (Aug 14-16). Tests time-off handling.",
    staff: makeStaff(8),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Ada Obi needs time off from Aug 14 for 3 days" },
    ],
    expectedOutcomes: ["Ada has zero shifts Aug 14-16", "Other staff absorb the load", "Coverage maintained"],
  },
  {
    id: "case_03",
    name: "Weekend Availability Constraint",
    description: "Chidi can only work weekdays (Mon-Fri). Tests day-of-week availability.",
    staff: makeStaff(8),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Chidi Nwosu is only available on Monday Tuesday Wednesday Thursday Friday" },
    ],
    expectedOutcomes: ["Chidi has zero weekend shifts", "Weekend coverage distributed among others"],
  },
  {
    id: "case_04",
    name: "Night-to-Morning Prohibition",
    description: "Funke cannot do night shifts followed by morning. Tests crossover constraint.",
    staff: makeStaff(8),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Funke Adeyemi cannot do night shift followed by morning" },
    ],
    expectedOutcomes: ["Zero night-to-morning violations for Funke", "Baseline may have violations"],
  },
  {
    id: "case_05",
    name: "Max Shift Cap",
    description: "Ibrahim can work at most 15 shifts this month. Tests max-shift constraint.",
    staff: makeStaff(8),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Ibrahim Musa can work at most 15 shifts" },
    ],
    expectedOutcomes: ["Ibrahim has ≤ 15 total shifts", "Other staff absorb excess"],
  },
  {
    id: "case_06",
    name: "Pair Apart (Conflict)",
    description: "Kemi and Ladi have a personal conflict and must not work the same shift on the same day.",
    staff: makeStaff(10),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Kemi Balogun and Ladi Okonkwo should not work together" },
    ],
    expectedOutcomes: ["Kemi and Ladi never on same shift same day", "Baseline may violate this"],
  },
  {
    id: "case_07",
    name: "Multi-Constraint Hospital",
    description: "12 staff with multiple overlapping constraints: time-off, max shifts, no back-to-back, preferences.",
    staff: makeStaff(12),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Ada Obi needs time off from Aug 10 for 5 days" },
      { sourceText: "Chidi Nwosu can work at most 18 shifts" },
      { sourceText: "Funke Adeyemi prefers morning shifts" },
      { sourceText: "Ibrahim Musa cannot do night shift followed by morning" },
      { sourceText: "Kemi Balogun is not available on weekends" },
    ],
    expectedOutcomes: [
      "Ada off Aug 10-14",
      "Chidi ≤ 18 shifts",
      "Funke mostly morning",
      "No night-to-morning for Ibrahim",
      "Kemi zero weekend shifts",
    ],
  },
  {
    id: "case_08",
    name: "Understaffed Emergency Ward",
    description: "Only 4 staff for 3 shifts/day — intentionally tight to test constraint trade-offs.",
    staff: makeStaff(4),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Ada Obi needs time off from Aug 20 for 2 days" },
    ],
    expectedOutcomes: [
      "Some unfilled slots expected (only 4 staff)",
      "Agent handles Ada's time-off gracefully",
      "Baseline may fail more slots",
    ],
  },
  {
    id: "case_09",
    name: "Shift Preference Diversity",
    description: "Staff have diverse shift preferences testing the agent's ability to honor preferences while maintaining fairness.",
    staff: makeStaff(10),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Ada Obi prefers morning shifts" },
      { sourceText: "Chidi Nwosu prefers night shifts" },
      { sourceText: "Funke Adeyemi prefers afternoon shifts" },
      { sourceText: "Ibrahim Musa prefers morning shifts" },
      { sourceText: "Kemi Balogun prefers night shifts" },
    ],
    expectedOutcomes: [
      "Ada mostly morning",
      "Chidi mostly night",
      "Funke mostly afternoon",
      "Fairness maintained despite preferences",
    ],
  },
  {
    id: "case_10",
    name: "No Back-to-Back Policy",
    description: "All staff have a strict no-back-to-back-days policy — tests constraint at scale.",
    staff: makeStaff(10),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "No back-to-back consecutive days for all staff" },
    ],
    expectedOutcomes: [
      "Reduced back-to-back violations vs baseline",
      "May have unfilled slots if 10 staff can't cover 31×3 with gaps",
    ],
  },
  {
    id: "case_11",
    name: "Holiday Month Scheduling",
    description: "October scheduling with Independence Day holiday, testing holiday-aware fairness.",
    staff: makeStaff(8),
    month: OCT_2026,
    holidays: ["2026-10-01"],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Ada Obi cannot work on Oct 1" },
      { sourceText: "Chidi Nwosu prefers morning shifts" },
    ],
    expectedOutcomes: [
      "Oct 1 treated as holiday",
      "Ada off on Oct 1",
      "Chidi mostly morning",
    ],
  },
  {
    id: "case_12",
    name: "Specific Shift Assignment",
    description: "Ada must work morning on Aug 5 (she's running a training). Tests hard shift pinning.",
    staff: makeStaff(8),
    month: AUG_2026,
    holidays: [],
    distributionPreference: "morning-afternoon-night",
    constraints: [
      { sourceText: "Ada Obi must work morning shift on Aug 5" },
      { sourceText: "Chidi Nwosu must work night shift on Aug 12" },
    ],
    expectedOutcomes: [
      "Ada assigned morning on Aug 5",
      "Chidi assigned night on Aug 12",
      "Baseline may not honor these",
    ],
  },
];
