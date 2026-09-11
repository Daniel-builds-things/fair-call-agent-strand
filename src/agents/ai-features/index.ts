// ─── AI Features Index ────────────────────────────────────────────────────────
// Exports all AI-powered scheduling features:
// 1. Schedule Explanation & Reasoning
// 2. Conflict Resolution Suggestions
// 3. Natural Language Schedule Queries
// 4. Predictive Staffing Recommendations

export { explainScheduleWithAI } from "./ai-schedule-explainer";
export { analyzeConflictsWithAI } from "./ai-conflict-resolver";
export { queryScheduleWithAI } from "./ai-schedule-query";
export { predictStaffingWithAI } from "./ai-predictive-staffing";

export type { AssignmentExplanation, ScheduleExplanationResult } from "./ai-schedule-explainer";
export type { ConflictAnalysis, ConflictResolutionResult } from "./ai-conflict-resolver";
export type { ScheduleQueryResult } from "./ai-schedule-query";
export type { StaffingRecommendation, PredictiveStaffingResult } from "./ai-predictive-staffing";
