# Reproduction Guide — Fair Call Agent

> AI Agent Orchestration Showcase — Built on [Fair Call Pro](https://github.com/Danielbuildsorigin/fair-call-pro)

This guide walks you through running the entire evaluation suite and interactive AI features from a clean environment.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | v20+ (v22 tested) | `node --version` |
| **npm** | v10+ | `npm --version` |
| **OS** | macOS / Linux / WSL | Any Unix-like environment |
| **API Keys** | Optional | `GROQ_API_KEY` or `OPENAI_API_KEY` for LLM-powered features |

The entire project runs locally. Without API keys, all features fall back to deterministic analysis — no external services required.

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/Daniel-builds-things/fair-call-agent-strand.git
cd fair-call-agent-strand
```

---

## Step 2: Install Dependencies

```bash
npm install
```

This installs:
- `@strands-agents/sdk` (v1.16.0) — AWS Strands Agents SDK
- `groq-sdk` (v0.33.0) — Groq LLM provider
- `openai` (v6.49.0) — OpenAI LLM provider
- `date-fns` (v3.6.0) — date manipulation
- `next` (v14.2.x) — web UI framework
- `react` / `react-dom` (v18.3.x) — UI library
- `zod` (v4.5.x) — runtime type validation
- `tsx` (v4.19.0) — TypeScript execution
- `typescript` (v5.4.0) — type checking

Expected output: ~50+ packages, ~30 seconds.

---

## Step 3: Run the Quick Demo

```bash
npm run demo
```

This runs a single end-to-end execution:
1. Defines 8 staff members and the month of August 2025
2. Parses 3 natural language constraints
3. Runs both baseline and agent schedulers
4. Prints a side-by-side comparison
5. Generates an explanation of the agent's output

Expected duration: ~3 seconds.

---

## Step 4: Run the Full Evaluation (12 Cases)

```bash
npm run eval
```

This is the **primary evaluation command**. It:
1. Loads all 12 evaluation cases (realistic scheduling scenarios)
2. For each case, runs **both** the baseline LRU scheduler and the agentic constraint-aware scheduler
3. Measures coverage, fairness, and constraint satisfaction for each
4. Prints a summary table with aggregate results

**Expected results:**

```
========================================
  Fair Call Agent — Evaluation Summary
========================================

Cases:    12
Coverage: 100% (baseline) → 100% (agent)
Fairness: 95.8/100 (baseline) → 95.6/100 (agent)
Constraint Satisfaction: 55% (baseline) → 100% (agent) [+45 points]
```

Expected duration: ~5 seconds.

---

## Step 5: Generate HTML Evaluation Report

```bash
npm run eval:html
```

This produces a visual HTML report at `eval-report/index.html` with:
- Side-by-side baseline vs agent charts
- Per-case constraint breakdowns
- Fairness distribution graphs
- Hot take / failure analysis

Open `eval-report/index.html` in any browser.

---

## Step 6: Run the Web UI (with 4 AI Features)

```bash
# Set an API key for full AI experience (optional)
export GROQ_API_KEY="your-key-here"

# Start the dev server
npm run dev
```

Open `http://localhost:3000` in your browser. The UI provides:

1. **Staff & Constraint Input** — Add staff names and type natural language constraints
2. **Generate Schedule** — Run the constraint-aware scheduler
3. **🧠 Explain Tab** — Per-staff "why" justifications for shift assignments
4. **⚠️ Conflicts Tab** — Automatic conflict detection with resolution suggestions
5. **💬 Query Tab** — Chat with your schedule ("Who's working nights this week?")
6. **🔮 Predict Tab** — Burnout risk, understaffing alerts, hiring recommendations

All four AI features work without an API key (deterministic fallback mode).

---

## Step 7: Strands Agent Demo

```bash
# Full Strands agent demo (conversational scheduling)
npm run strands:demo

# Tool-only demo (without LLM conversation)
npm run strands:demo:tool
```

---

## Step 8: (Optional) Enable LLM-Powered Parsing

For the full agentic experience with semantic constraint understanding:

```bash
# Get a free API key from https://console.groq.com
# or use OpenAI: https://platform.openai.com
export GROQ_API_KEY="your-key-here"
# or: export OPENAI_API_KEY="your-key-here"
```

Then run the LLM demo to see side-by-side comparison:

```bash
npm run demo:llm
```

Without API keys, the app falls back to regex-only parsing and deterministic AI analysis — still works perfectly.

---

## Step 9: Run Constraint Tests

```bash
npm run test
```

Runs unit-level tests on the constraint parser to verify all 14 constraint types are correctly identified from natural language.

---

## Project Structure

```
fair-call-agent-strand/
├── src/
│   ├── lib/
│   │   └── baseline-scheduler.ts        # Original LRU algorithm (baseline)
│   ├── agents/
│   │   ├── constraint-parser.ts          # NL → structured constraints (regex)
│   │   ├── llm-constraint-parser.ts      # NL → constraints (Groq/OpenAI LLM)
│   │   ├── enhanced-scheduler.ts         # Constraint-aware scheduler
│   │   ├── schedule-explainer.ts         # Analysis + insights
│   │   ├── scheduling-agent.ts           # Strands Agents SDK integration
│   │   └── ai-features/
│   │       ├── index.ts                  # AI features barrel export
│   │       ├── ai-schedule-explainer.ts  # 🧠 LLM "why" explanations
│   │       ├── ai-conflict-resolver.ts   # ⚠️ Conflict detection + resolution
│   │       ├── ai-schedule-query.ts      # 💬 NL chat over schedules
│   │       └── ai-predictive-staffing.ts # 🔮 Burnout & health analysis
│   ├── strands/
│   │   ├── index.ts                      # Strands agent demo
│   │   └── demo-tool-only.ts             # Tool-only demo
│   ├── eval/
│   │   ├── cases.ts                      # 12 evaluation cases
│   │   └── evaluate.ts                   # Benchmark runner
│   ├── types.ts                          # Shared types
│   └── index.ts                          # Demo entry point
├── app/                                  # Next.js web UI
│   ├── page.tsx                          # Interactive scheduler + 4 AI tabs
│   ├── layout.tsx                        # Root layout
│   └── api/
│       ├── schedule/route.ts             # REST API for scheduling
│       └── ai/route.ts                   # Unified AI features endpoint
├── scheduler-lib/                        # ESM-compatible copies
├── CHANGELOG.md                          # 11 improvement iterations
├── REPRODUCE.md                          # This file
├── package.json
├── next.config.mjs
└── tsconfig.json
```

---

## Cost & Runtime

| Metric | Regex/Deterministic | LLM-Enabled |
|---|---|---|
| API calls | 0 | ~1-5 per AI feature invocation |
| External services | 0 | Groq (free tier) or OpenAI |
| LLM cost | $0.00 | ~$0.001-$0.01 per analysis |
| Total runtime (full eval) | ~5 seconds | ~8 seconds |
| Memory usage | <50 MB | <100 MB |
| Node.js version | v22 (v20+ compatible) | v22 (v20+ compatible) |

---

## Environment Variables

| Variable | Provider | Required | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | Groq | No | LLM constraint parsing + AI features |
| `OPENAI_API_KEY` | OpenAI | No | Alternative LLM provider |
| `ANTHROPIC_API_KEY` | Anthropic | No | Strands agent (optional) |

Set **at least one** LLM key for the full AI experience. Without any keys, all features use deterministic fallbacks.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `node: command not found` | Install Node.js from https://nodejs.org |
| `tsx: not found` | Run `npm install` first |
| TypeScript errors | Run `npm run build` to check compilation |
| Evaluation fails | Ensure you're in the project root directory |
| Next.js build fails | Check Node.js version is v20+ |

---

## What to Show Judges

For the hackathon evaluation, these are the most important demos:

```bash
# Primary: demonstrates the measured improvement
npm run eval

# Live UI: open the dev server and show the 4 AI tabs
npm run dev

# Conversational: show the Strands agent in action
npm run strands:demo
```

The `npm run eval` command demonstrates the **measured improvement** — the core scoring criterion. It runs both baseline and agent across 12 cases and prints the +45 point constraint satisfaction improvement.

The **live UI** (`npm run dev`) is where the 4 AI features shine — judges can interact with Explain, Conflicts, Query, and Predict tabs in real time.
