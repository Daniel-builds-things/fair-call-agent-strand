"use client";

import { useState, useCallback, useRef } from "react";

// Default staff matching the demo
const defaultStaff = [
  { id: "s1", name: "Ada Obi", isActive: true, joinedDate: "2024-01-15", batch: "A" },
  { id: "s2", name: "Chidi Nwosu", isActive: true, joinedDate: "2024-03-01", batch: "A" },
  { id: "s3", name: "Funke Adeyemi", isActive: true, joinedDate: "2024-06-10", batch: "B" },
  { id: "s4", name: "Ibrahim Musa", isActive: true, joinedDate: "2024-02-20", batch: "B" },
  { id: "s5", name: "Kemi Balogun", isActive: true, joinedDate: "2024-08-05", batch: "C" },
  { id: "s6", name: "Ladi Okonkwo", isActive: true, joinedDate: "2024-04-12", batch: "C" },
  { id: "s7", name: "Musa Abubakar", isActive: true, joinedDate: "2024-07-01", batch: "D" },
  { id: "s8", name: "Nneka Eze", isActive: true, joinedDate: "2024-05-18", batch: "D" },
];

const defaultConstraints = [
  "Ada Obi needs time off from Aug 14 for 3 days",
  "Chidi Nwosu is only available on Monday Tuesday Wednesday Thursday Friday",
  "Funke Adeyemi prefers morning shifts",
  "Ibrahim Musa cannot do night shift followed by morning",
  "Kemi Balogun can work at most 18 shifts",
  "Musa Abubakar must work morning shift on Aug 5",
  "Nneka Eze is not available on weekends",
];

interface DayAssignment {
  date: string;
  morning?: string;
  afternoon?: string;
  night?: string;
  isManual: boolean;
}

interface StaffStats {
  staffId: string;
  staffName: string;
  morningCount: number;
  afternoonCount: number;
  nightCount: number;
  weekendCount: number;
  holidayCount: number;
  totalCount: number;
}

interface ScheduleError {
  type: string;
  message: string;
}

interface ConstraintDecision {
  constraintId: string;
  applied: boolean;
  reasoning: string;
}

interface ScheduleResult {
  assignments: DayAssignment[];
  stats: StaffStats[];
  errors: ScheduleError[];
  warnings: string[];
  constraintDecisions?: ConstraintDecision[];
}

// AI Feature types
interface AssignmentExplanation {
  staffId: string;
  staffName: string;
  totalShifts: number;
  shiftBreakdown: string;
  reasoning: string;
  constraintImpact: string[];
  fairnessNote: string;
}

interface ConflictAnalysis {
  id: string;
  severity: "high" | "medium" | "low";
  type: string;
  description: string;
  affectedStaff: string[];
  affectedDates: string[];
  suggestions: string[];
  tradeOffAnalysis: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface StaffingRecommendation {
  id: string;
  category: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  impact: string;
  actionItems: string[];
}

const SLOT_COLORS: Record<string, string> = {
  morning: "#3b82f6",
  afternoon: "#f59e0b",
  night: "#6366f1",
};

const BATCH_COLORS: Record<string, string> = {
  A: "#10b981",
  B: "#3b82f6",
  C: "#f59e0b",
  D: "#ef4444",
};

function getStaffName(staff: typeof defaultStaff, id: string): string {
  return staff.find((s) => s.id === id)?.name || id;
}

function getDayName(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  return d.getDay() === 0 || d.getDay() === 6;
}

export default function Home() {
  const [staff, setStaff] = useState(defaultStaff);
  const [constraints, setConstraints] = useState(defaultConstraints.join("\n"));
  const [month, setMonth] = useState("2026-08");
  const [preference, setPreference] = useState("morning-afternoon-night");
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("calendar");
  const [newStaffName, setNewStaffName] = useState("");

  // AI feature states
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{ staffExplanations: AssignmentExplanation[]; overallSummary: string; keyInsights: string[] } | null>(null);
  const [conflicts, setConflicts] = useState<{ conflicts: ConflictAnalysis[]; overallRisk: string } | null>(null);
  const [predictions, setPredictions] = useState<{ recommendations: StaffingRecommendation[]; overallHealth: string; burnoutRiskStaff: { name: string; reason: string; risk: string }[] } | null>(null);

  // Query chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [queryLoading, setQueryLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setExplanation(null);
    setConflicts(null);
    setPredictions(null);
    setChatMessages([]);

    try {
      const staffList = staff.filter((s) => s.isActive);
      const constraintLines = constraints
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staff: staffList,
          constraints: constraintLines,
          month,
          preference,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server error: ${res.status} - ${errText}`);
      }

      const data = await res.json();
      setResult(data);
      setActiveTab("calendar");
    } catch (e: any) {
      setError(e.message || "Failed to generate schedule");
    } finally {
      setLoading(false);
    }
  }, [staff, constraints, month, preference]);

  const handleAddStaff = () => {
    if (!newStaffName.trim()) return;
    const id = `s${Date.now()}`;
    setStaff([...staff, { id, name: newStaffName.trim(), isActive: true, joinedDate: new Date().toISOString().split("T")[0], batch: "A" }]);
    setNewStaffName("");
  };

  const handleToggleStaff = (id: string) => {
    setStaff(staff.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s)));
  };

  // ─── AI Feature Handlers ─────────────────────────────────────────────────

  const getSchedulePayload = () => ({
    schedule: {
      assignments: result?.assignments || [],
      stats: result?.stats || [],
      errors: result?.errors || [],
    },
    staff: staff.filter((s) => s.isActive),
    constraints: constraints.split("\n").map((l) => l.trim()).filter((l) => l.length > 0),
    month,
  });

  const handleExplain = async () => {
    setAiLoading("explain");
    setAiError(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...getSchedulePayload(), action: "explain" }),
      });
      const data = await res.json();
      if (res.ok) {
        setExplanation(data.data);
      } else {
        setAiError(data.error || "Failed to generate explanation");
      }
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiLoading(null);
    }
  };

  const handleConflicts = async () => {
    setAiLoading("conflicts");
    setAiError(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...getSchedulePayload(), action: "conflicts" }),
      });
      const data = await res.json();
      if (res.ok) {
        setConflicts(data.data);
      } else {
        setAiError(data.error || "Failed to analyze conflicts");
      }
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiLoading(null);
    }
  };

  const handlePredict = async () => {
    setAiLoading("predict");
    setAiError(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...getSchedulePayload(), action: "predict" }),
      });
      const data = await res.json();
      if (res.ok) {
        setPredictions(data.data);
      } else {
        setAiError(data.error || "Failed to generate predictions");
      }
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setAiLoading(null);
    }
  };

  const handleQuery = async () => {
    if (!queryInput.trim()) return;
    const userMsg: ChatMessage = { role: "user", content: queryInput };
    setChatMessages((prev) => [...prev, userMsg]);
    setQueryLoading(true);
    setAiError(null);

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...getSchedulePayload(),
          action: "query",
          query: queryInput,
          conversationHistory: chatMessages.slice(-6),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setChatMessages((prev) => [...prev, { role: "assistant", content: data.data.answer }]);
      } else {
        setAiError(data.error || "Query failed");
      }
    } catch (e: any) {
      setAiError(e.message);
    } finally {
      setQueryLoading(false);
      setQueryInput("");
    }
  };

  const allTabs = ["calendar", "stats", "constraints", "explain", "conflicts", "query", "predict"];
  const tabLabels: Record<string, string> = {
    calendar: "Calendar",
    stats: "Stats",
    constraints: "Constraints",
    explain: "AI Explain",
    conflicts: "AI Conflicts",
    query: "AI Query",
    predict: "AI Predict",
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 28, color: "#1a1a2e" }}>
          Fair Call Agent — Live Scheduler
        </h1>
        <p style={{ margin: 0, color: "#666", fontSize: 14 }}>
          Natural language constraints → AI-powered schedule generation with intelligent analysis
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 24, alignItems: "start" }}>
        {/* Left Panel: Controls */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#1a1a2e" }}>Configuration</h2>

          {/* Month Selector */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Month</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
            />
          </div>

          {/* Distribution Preference */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 14 }}>Shift Distribution</label>
            <select
              value={preference}
              onChange={(e) => setPreference(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
            >
              <option value="morning-afternoon-night">Morning + Afternoon + Night</option>
              <option value="morning-night">Morning + Night</option>
              <option value="morning">Morning Only</option>
              <option value="auto">Auto (weekends get night)</option>
            </select>
          </div>

          {/* Staff Roster */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
              Staff Roster ({staff.filter((s) => s.isActive).length} active)
            </label>
            <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
              {staff.map((s) => (
                <div
                  key={s.id}
                  onClick={() => handleToggleStaff(s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    cursor: "pointer",
                    borderRadius: 6,
                    opacity: s.isActive ? 1 : 0.5,
                    background: s.isActive ? "#f0fdf4" : "#fef2f2",
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: BATCH_COLORS[s.batch || "A"] || "#999",
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 13 }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: "#999" }}>{s.batch}</span>
                  <span style={{ fontSize: 12 }}>{s.isActive ? "✅" : "⬜"}</span>
                </div>
              ))}
            </div>
            {/* Add Staff */}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                value={newStaffName}
                onChange={(e) => setNewStaffName(e.target.value)}
                placeholder="Add new staff..."
                onKeyDown={(e) => e.key === "Enter" && handleAddStaff()}
                style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}
              />
              <button
                onClick={handleAddStaff}
                style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#10b981", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                + Add
              </button>
            </div>
          </div>

          {/* Constraints */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
              Constraints (one per line)
            </label>
            <textarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              rows={8}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #ddd",
                fontSize: 13,
                fontFamily: "inherit",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px 20px",
              borderRadius: 10,
              border: "none",
              background: loading ? "#94a3b8" : "#3b82f6",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "⏳ Generating..." : "Generate Schedule"}
          </button>

          {error && (
            <div style={{ marginTop: 12, padding: 12, background: "#fef2f2", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        {/* Right Panel: Results */}
        <div>
          {!result && !loading && (
            <div style={{ background: "#fff", borderRadius: 12, padding: 48, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
              <h2 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>Ready to Schedule</h2>
              <p style={{ color: "#666", margin: 0 }}>Configure your staff and constraints, then click "Generate Schedule"</p>
            </div>
          )}

          {loading && (
            <div style={{ background: "#fff", borderRadius: 12, padding: 48, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>⏳</div>
              <h2 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>Generating Schedule...</h2>
              <p style={{ color: "#666", margin: 0 }}>The agent is parsing constraints and building an optimal schedule</p>
            </div>
          )}

          {result && (
            <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden" }}>
              {/* Summary Bar */}
              <div style={{ display: "flex", gap: 16, padding: "16px 20px", background: "#f8fafc", borderBottom: "1px solid #eee" }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#3b82f6" }}>
                    {result.assignments.filter((a) => a.morning || a.afternoon || a.night).length}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>Slots Filled</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: result.errors.length > 0 ? "#ef4444" : "#10b981" }}>
                    {result.errors.length}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>Errors</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#6366f1" }}>
                    {result.constraintDecisions?.length || 0}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>Constraints</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>
                    {result.stats.length}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>Staff</div>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
                {allTabs.map((tab) => {
                  const isAi = tab === "explain" || tab === "conflicts" || tab === "query" || tab === "predict";
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      style={{
                        flex: 1,
                        minWidth: 80,
                        padding: "10px 12px",
                        border: "none",
                        borderBottom: activeTab === tab ? `3px solid ${isAi ? "#8b5cf6" : "#3b82f6"}` : "3px solid transparent",
                        background: activeTab === tab ? (isAi ? "#f5f3ff" : "#eff6ff") : "transparent",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: activeTab === tab ? 700 : 400,
                        color: activeTab === tab ? (isAi ? "#7c3aed" : "#3b82f6") : "#666",
                        textTransform: "capitalize",
                      }}
                    >
                      {tabLabels[tab]}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              <div style={{ padding: 20 }}>
                {activeTab === "calendar" && (
                  <CalendarView assignments={result.assignments} staff={staff} />
                )}
                {activeTab === "stats" && (
                  <StatsView stats={result.stats} />
                )}
                {activeTab === "constraints" && (
                  <ConstraintsView decisions={result.constraintDecisions || []} errors={result.errors} warnings={result.warnings} />
                )}
                {activeTab === "explain" && (
                  <ExplainView
                    explanation={explanation}
                    loading={aiLoading === "explain"}
                    onExplain={handleExplain}
                    error={aiError}
                  />
                )}
                {activeTab === "conflicts" && (
                  <ConflictsView
                    conflicts={conflicts}
                    loading={aiLoading === "conflicts"}
                    onAnalyze={handleConflicts}
                    error={aiError}
                  />
                )}
                {activeTab === "query" && (
                  <QueryView
                    messages={chatMessages}
                    onSend={handleQuery}
                    loading={queryLoading}
                    input={queryInput}
                    onInputChange={setQueryInput}
                    error={aiError}
                    chatEndRef={chatEndRef}
                  />
                )}
                {activeTab === "predict" && (
                  <PredictView
                    predictions={predictions}
                    loading={aiLoading === "predict"}
                    onPredict={handlePredict}
                    error={aiError}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Calendar View ─────────────────────────────────────────────────────────────

function CalendarView({ assignments, staff }: { assignments: DayAssignment[]; staff: typeof defaultStaff }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 800 }}>
        <thead>
          <tr>
            <th style={{ padding: "8px", textAlign: "left", borderBottom: "2px solid #eee", position: "sticky", left: 0, background: "#fff" }}>Date</th>
            <th style={{ padding: "8px", textAlign: "center", borderBottom: "2px solid #eee" }}>Morning</th>
            <th style={{ padding: "8px", textAlign: "center", borderBottom: "2px solid #eee" }}>Afternoon</th>
            <th style={{ padding: "8px", textAlign: "center", borderBottom: "2px solid #eee" }}>Night</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => {
            const we = isWeekend(a.date);
            return (
              <tr key={a.date} style={{ background: we ? "#fafafa" : "#fff" }}>
                <td style={{ padding: "6px 8px", borderBottom: "1px solid #f0f0f0", fontWeight: 600, position: "sticky", left: 0, background: we ? "#fafafa" : "#fff" }}>
                  {getDayName(a.date)}<br />
                  <span style={{ fontWeight: 400, color: "#999" }}>{a.date}</span>
                </td>
                {(["morning", "afternoon", "night"] as const).map((slot) => {
                  const staffId = a[slot];
                  const name = staffId ? getStaffName(staff, staffId) : "—";
                  const color = SLOT_COLORS[slot];
                  return (
                    <td key={slot} style={{ padding: "6px 8px", borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      {staffId ? (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            borderRadius: 12,
                            background: `${color}18`,
                            color: color,
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                        >
                          {name}
                        </span>
                      ) : (
                        <span style={{ color: "#ccc" }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Stats View ────────────────────────────────────────────────────────────────

function StatsView({ stats }: { stats: StaffStats[] }) {
  const sorted = [...stats].sort((a, b) => b.totalCount - a.totalCount);
  const maxTotal = Math.max(...sorted.map((s) => s.totalCount), 1);

  return (
    <div>
      <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Shift Distribution by Staff</h3>
      {sorted.map((s) => (
        <div key={s.staffId} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{s.staffName}</span>
            <span style={{ fontSize: 13, color: "#666" }}>{s.totalCount} shifts</span>
          </div>
          <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", background: "#f0f0f0" }}>
            {s.morningCount > 0 && (
              <div style={{ width: `${(s.morningCount / maxTotal) * 100}%`, background: SLOT_COLORS.morning, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 600 }}>
                {s.morningCount}
              </div>
            )}
            {s.afternoonCount > 0 && (
              <div style={{ width: `${(s.afternoonCount / maxTotal) * 100}%`, background: SLOT_COLORS.afternoon, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 600 }}>
                {s.afternoonCount}
              </div>
            )}
            {s.nightCount > 0 && (
              <div style={{ width: `${(s.nightCount / maxTotal) * 100}%`, background: SLOT_COLORS.night, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 600 }}>
                {s.nightCount}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 2, fontSize: 11, color: "#999" }}>
            <span>🌅 Morning: {s.morningCount}</span>
            <span>☀️ Afternoon: {s.afternoonCount}</span>
            <span>🌙 Night: {s.nightCount}</span>
            <span>📅 Weekend: {s.weekendCount}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Constraints View ──────────────────────────────────────────────────────────

function ConstraintsView({ decisions, errors, warnings }: { decisions: ConstraintDecision[]; errors: ScheduleError[]; warnings: string[] }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>Constraint Decisions</h3>
      {decisions.length === 0 && <p style={{ color: "#999" }}>No constraints were processed.</p>}
      {decisions.map((d, i) => (
        <div key={d.constraintId || i} style={{ padding: "10px 14px", marginBottom: 8, borderRadius: 8, background: d.applied ? "#f0fdf4" : "#fefce8", borderLeft: `4px solid ${d.applied ? "#10b981" : "#f59e0b"}` }}>
          <div style={{ fontSize: 13, color: "#1a1a2e" }}>{d.reasoning}</div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>{d.constraintId}</div>
        </div>
      ))}

      {errors.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 12px", fontSize: 16, color: "#dc2626" }}>Errors</h3>
          {errors.map((e, i) => (
            <div key={i} style={{ padding: "8px 12px", marginBottom: 6, borderRadius: 6, background: "#fef2f2", fontSize: 13, color: "#dc2626" }}>
              [{e.type}] {e.message}
            </div>
          ))}
        </>
      )}

      {warnings.length > 0 && (
        <>
          <h3 style={{ margin: "24px 0 12px", fontSize: 16, color: "#f59e0b" }}>Warnings</h3>
          {warnings.map((w, i) => (
            <div key={i} style={{ padding: "8px 12px", marginBottom: 6, borderRadius: 6, background: "#fefce8", fontSize: 13, color: "#a16207" }}>
              {w}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── AI Explain View ───────────────────────────────────────────────────────────

function ExplainView({ explanation, loading, onExplain, error }: {
  explanation: { staffExplanations: AssignmentExplanation[]; overallSummary: string; keyInsights: string[] } | null;
  loading: boolean;
  onExplain: () => void;
  error: string | null;
}) {
  if (!explanation && !loading) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🧠</div>
        <h3 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>AI Schedule Explanation</h3>
        <p style={{ color: "#666", fontSize: 14, marginBottom: 16 }}>
          The AI analyzes WHY each person got their shifts — not just the numbers.
        </p>
        <button
          onClick={onExplain}
          style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Generate Explanation
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
        <p style={{ color: "#666" }}>AI is analyzing the schedule...</p>
      </div>
    );
  }

  if (error) {
    return <div style={{ padding: 12, background: "#fef2f2", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>{error}</div>;
  }

  return (
    <div>
      <div style={{ padding: 16, background: "#f5f3ff", borderRadius: 8, marginBottom: 20, borderLeft: "4px solid #7c3aed" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#7c3aed" }}>Overall Summary</h3>
        <p style={{ margin: 0, fontSize: 14, color: "#333" }}>{explanation!.overallSummary}</p>
        {explanation!.keyInsights.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 13 }}>Key Insights:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 20, fontSize: 13, color: "#555" }}>
              {explanation!.keyInsights.map((insight, i) => (
                <li key={i}>{insight}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Per-Staff Explanations</h3>
      {explanation!.staffExplanations.map((exp) => (
        <div key={exp.staffId} style={{ padding: 14, marginBottom: 10, borderRadius: 8, background: "#fafafa", borderLeft: "4px solid #3b82f6" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong style={{ fontSize: 15 }}>{exp.staffName}</strong>
            <span style={{ fontSize: 12, color: "#666", background: "#e0e7ff", padding: "2px 8px", borderRadius: 10 }}>{exp.fairnessNote}</span>
          </div>
          <p style={{ margin: "0 0 6px", fontSize: 13, color: "#333" }}>{exp.shiftBreakdown}</p>
          <p style={{ margin: "0 0 6px", fontSize: 13, color: "#555" }}>{exp.reasoning}</p>
          {exp.constraintImpact.length > 0 && (
            <div style={{ fontSize: 12, color: "#666" }}>
              Constraints: {exp.constraintImpact.join(" • ")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── AI Conflicts View ─────────────────────────────────────────────────────────

function ConflictsView({ conflicts, loading, onAnalyze, error }: {
  conflicts: { conflicts: ConflictAnalysis[]; overallRisk: string } | null;
  loading: boolean;
  onAnalyze: () => void;
  error: string | null;
}) {
  if (!conflicts && !loading) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <h3 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>AI Conflict Analysis</h3>
        <p style={{ color: "#666", fontSize: 14, marginBottom: 16 }}>
          Detects constraint conflicts, unfilled slots, and imbalances — with actionable suggestions.
        </p>
        <button
          onClick={onAnalyze}
          style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Analyze Conflicts
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
        <p style={{ color: "#666" }}>AI is analyzing conflicts...</p>
      </div>
    );
  }

  if (error) {
    return <div style={{ padding: 12, background: "#fef2f2", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>{error}</div>;
  }

  const data = conflicts!;
  const riskColor = data.overallRisk === "high" ? "#ef4444" : data.overallRisk === "medium" ? "#f59e0b" : "#10b981";

  if (data.conflicts.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <h3 style={{ margin: "0 0 8px", color: "#10b981" }}>No Conflicts Detected</h3>
        <p style={{ color: "#666", fontSize: 14 }}>All constraints are compatible and all slots are filled.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: 12, background: riskColor + "18", borderRadius: 8, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{data.overallRisk === "high" ? "🔴" : data.overallRisk === "medium" ? "🟡" : "🟢"}</span>
        <strong style={{ fontSize: 14, color: riskColor, textTransform: "capitalize" }}>{data.overallRisk} Risk</strong>
        <span style={{ fontSize: 13, color: "#666" }}>— {data.conflicts.length} conflict(s) detected</span>
      </div>

      {data.conflicts.map((c) => {
        const sevColor = c.severity === "high" ? "#ef4444" : c.severity === "medium" ? "#f59e0b" : "#10b981";
        return (
          <div key={c.id} style={{ padding: 14, marginBottom: 12, borderRadius: 8, background: "#fafafa", borderLeft: `4px solid ${sevColor}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <strong style={{ fontSize: 14, textTransform: "capitalize", color: sevColor }}>{c.type.replace(/_/g, " ")}</strong>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: sevColor + "20", color: sevColor, fontWeight: 600 }}>{c.severity}</span>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#333" }}>{c.description}</p>
            {c.affectedStaff.length > 0 && (
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                Affected: {c.affectedStaff.join(", ")}
              </div>
            )}
            <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
              <strong>Trade-off:</strong> {c.tradeOffAnalysis}
            </div>
            <div>
              <strong style={{ fontSize: 12, color: "#333" }}>Suggestions:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20, fontSize: 12, color: "#555" }}>
                {c.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── AI Query View ─────────────────────────────────────────────────────────────

function QueryView({ messages, onSend, loading, input, onInputChange, error, chatEndRef }: {
  messages: ChatMessage[];
  onSend: () => void;
  loading: boolean;
  input: string;
  onInputChange: (v: string) => void;
  error: string | null;
  chatEndRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: 500 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>💬 Ask About the Schedule</h3>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#666" }}>
        Try: "Who&apos;s working nights?", "How many shifts did Ada get?", "Are there any conflicts?"
      </p>

      {/* Chat messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12, background: "#f8fafc", borderRadius: 8, marginBottom: 12 }}>
        {messages.length === 0 && (
          <p style={{ textAlign: "center", color: "#999", fontSize: 14, padding: 32 }}>
            No questions yet. Ask something about the schedule!
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "80%",
              padding: "10px 14px",
              borderRadius: 12,
              background: m.role === "user" ? "#3b82f6" : "#fff",
              color: m.role === "user" ? "#fff" : "#333",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ fontSize: 13, color: "#666", padding: "4px 0" }}>Thinking...</div>
        )}
        <div ref={chatEndRef} />
      </div>

      {error && <div style={{ padding: 8, background: "#fef2f2", borderRadius: 6, color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</div>}

      {/* Input */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && onSend()}
          placeholder="Ask a question about the schedule..."
          disabled={loading}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}
        />
        <button
          onClick={onSend}
          disabled={loading || !input.trim()}
          style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: loading || !input.trim() ? "#94a3b8" : "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 600, cursor: loading || !input.trim() ? "not-allowed" : "pointer" }}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

// ─── AI Predict View ───────────────────────────────────────────────────────────

function PredictView({ predictions, loading, onPredict, error }: {
  predictions: { recommendations: StaffingRecommendation[]; overallHealth: string; burnoutRiskStaff: { name: string; reason: string; risk: string }[] } | null;
  loading: boolean;
  onPredict: () => void;
  error: string | null;
}) {
  if (!predictions && !loading) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔮</div>
        <h3 style={{ margin: "0 0 8px", color: "#1a1a2e" }}>Predictive Staffing</h3>
        <p style={{ color: "#666", fontSize: 14, marginBottom: 16 }}>
          AI analyzes burnout risk, understaffing, and optimization opportunities.
        </p>
        <button
          onClick={onPredict}
          style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#10b981", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Generate Predictions
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
        <p style={{ color: "#666" }}>AI is generating predictions...</p>
      </div>
    );
  }

  if (error) {
    return <div style={{ padding: 12, background: "#fef2f2", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>{error}</div>;
  }

  const data = predictions!;
  const healthColor = data.overallHealth === "critical" ? "#ef4444" : data.overallHealth === "warning" ? "#f59e0b" : "#10b981";

  return (
    <div>
      {/* Health badge */}
      <div style={{ padding: 12, background: healthColor + "18", borderRadius: 8, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{data.overallHealth === "critical" ? "🔴" : data.overallHealth === "warning" ? "🟡" : "🟢"}</span>
        <strong style={{ fontSize: 14, color: healthColor, textTransform: "capitalize" }}>Overall Health: {data.overallHealth}</strong>
      </div>

      {/* Burnout risk */}
      {data.burnoutRiskStaff.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15, color: "#ef4444" }}>⚠️ Burnout Risk Staff</h3>
          {data.burnoutRiskStaff.map((b, i) => (
            <div key={i} style={{ padding: 10, marginBottom: 6, borderRadius: 6, background: "#fef2f2", borderLeft: "4px solid #ef4444" }}>
              <strong style={{ fontSize: 13 }}>{b.name}</strong>
              <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 6px", borderRadius: 8, background: b.risk === "high" ? "#ef4444" : b.risk === "medium" ? "#f59e0b" : "#10b981", color: "#fff" }}>{b.risk}</span>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666" }}>{b.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Recommendations</h3>
      {data.recommendations.length === 0 ? (
        <div style={{ padding: 20, background: "#f9fafb", borderRadius: 8, border: "1px dashed #d1d5db", textAlign: "center", minHeight: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
            No specific recommendations at this time. The schedule looks balanced.
          </p>
        </div>
      ) : (
        <div style={{ minHeight: 120, maxHeight: 500, overflowY: "auto" }}>
          {data.recommendations.map((r) => {
            const priColor = r.priority === "high" ? "#ef4444" : r.priority === "medium" ? "#f59e0b" : "#10b981";
            return (
              <div key={r.id} style={{ padding: 14, marginBottom: 10, borderRadius: 8, background: "#fafafa", borderLeft: `4px solid ${priColor}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <strong style={{ fontSize: 14, textTransform: "capitalize" }}>{r.title}</strong>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: priColor + "20", color: priColor, fontWeight: 600 }}>{r.priority}</span>
                </div>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#555" }}>{r.description}</p>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "#999" }}>Impact: {r.impact}</p>
                <div>
                  <strong style={{ fontSize: 12 }}>Action items:</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 20, fontSize: 12, color: "#555" }}>
                    {r.actionItems.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
