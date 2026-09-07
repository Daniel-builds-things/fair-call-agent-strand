# Fair Call Agent — Agentic Shift Scheduling

> **micro1 Agentic Workflows Hackathon** — Built on [Fair Call Pro](https://github.com/Danielbuildsorigin/fair-call-pro)

An agentic constraint-reasoning layer on top of a deterministic LRU scheduler. Managers give natural language instructions; the agent parses, reasons about trade-offs, and produces schedules that honor constraints.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run the full demo (parse → schedule → explain → evaluate)
npm run demo

# 3. Run just the evaluation suite (12 cases, baseline vs agent)
npm run eval
```

No API keys, no external services — pure TypeScript.

## Architecture

```
🗣️ Natural Language    →    🧠 Constraint Parser    →    ⚙️ Constraint-Aware    →    📊 Schedule
   "Ada needs time          Pattern matching              Scheduler                   Output
    off Aug 14-16"          → 14 constraint               LRU + constraint            + 💡 Explainer
                             types                        filtering + scoring
```

### Components

| Component | File | Purpose |
|---|---|---|
| Baseline Scheduler | `src/lib/baseline-scheduler.ts` | Original LRU algorithm from Fair Call Pro |
| Constraint Parser | `src/agents/constraint-parser.ts` | Natural language → structured constraints (regex) |
| LLM Constraint Parser | `src/agents/llm-constraint-parser.ts` | Groq LLM-powered semantic parsing |
| Enhanced Scheduler | `src/agents/enhanced-scheduler.ts` | Constraint-aware scheduling engine |
| Schedule Explainer | `src/agents/schedule-explainer.ts` | Fairness analysis + insights + hot take |
| Evaluation Suite | `src/eval/evaluate.ts` | 12-case benchmark: baseline vs agent |
| Test Cases | `src/eval/cases.ts` | Realistic scenarios with constraints |
| **Web UI** | `app/page.tsx` | Interactive live scheduler demo |
| **API Route** | `app/api/schedule/route.ts` | REST endpoint for schedule generation |

### Supported Constraint Types

| Type | Example | Priority |
|---|---|---|
| `time_off` | "Ada needs time off from Aug 14 for 3 days" | Hard |
| `unavailable` | "Chidi cannot work on Aug 5" | Hard |
| `availability` | "Kemi is only available on weekdays" | Hard |
| `specific_shift` | "Musa must work morning on Aug 5" | Hard |
| `no_night_to_morning` | "Funke cannot do night followed by morning" | Hard |
| `pair_apart` | "Kemi and Ladi should not work together" | Hard |
| `max_shifts` | "Ibrahim can work at most 15 shifts" | Soft |
| `min_shifts` | "Nneka needs at least 10 shifts" | Soft |
| `no_back_to_back` | "No consecutive days for all staff" | Soft |
| `pair_together` | "Ada and Chidi should work together" | Soft |
| `preferred` | "Funke prefers morning shifts" | Preference |
| `balance` | "Balance shifts for Ada" | Preference |
| `coverage` | "Minimum 2 staff per night shift" | Soft |
| `role` | "Ada is a senior" | Preference |

## Evaluation Results

| Metric | Baseline (LRU) | Agent (Constraint-Aware) | Δ |
|---|---|---|---|
| Coverage | 100% | 100% | 0 |
| Fairness | 95.8/100 | 95.6/100 | -0.2 |
| **Constraint Satisfaction** | **55%** | **100%** | **+45** |

See the full HTML report in the `eval-report/` directory (run `npm run eval:html` to regenerate).

## 12 Evaluation Cases

1. **Basic 8-Staff Clinic** — Standard scheduling, no constraints
2. **Wedding Conflict** — Time-off handling
3. **Weekend Availability** — Day-of-week constraints
4. **Night-to-Morning** — Crossover prohibition
5. **Max Shift Cap** — Individual workload limits
6. **Pair Apart** — Inter-staff conflict resolution
7. **Multi-Constraint Hospital** — 5 overlapping constraints
8. **Understaffed Emergency** — Trade-offs with only 4 staff
9. **Shift Preference Diversity** — 5 different preferences
10. **No Back-to-Back Policy** — Organization-wide policy
11. **Holiday Month** — Holiday-aware scheduling
12. **Specific Shift Assignment** — Hard shift pinning

## Project Structure

```
fair-call-agent/
├── src/
│   ├── lib/
│   │   └── baseline-scheduler.ts   # Original LRU (our baseline)
│   ├── agents/
│   │   ├── constraint-parser.ts     # NL → constraints (regex)
│   │   ├── llm-constraint-parser.ts # NL → constraints (Groq LLM)
│   │   ├── enhanced-scheduler.ts    # Constraint-aware engine
│   │   └── schedule-explainer.ts    # Analysis + insights
│   ├── eval/
│   │   ├── cases.ts                 # 12 test cases
│   │   └── evaluate.ts              # Benchmark runner
│   ├── types.ts                     # Shared type definitions
│   └── index.ts                     # Demo entry point
├── app/                             # Next.js web UI
│   ├── page.tsx                     # Interactive scheduler UI
│   ├── layout.tsx                   # Root layout
│   └── api/schedule/route.ts        # REST API for scheduling
├── scheduler-lib/                   # Web-app copies (ESM-compatible)
│   ├── baseline-scheduler.ts
│   ├── constraint-parser.ts
│   ├── llm-constraint-parser.ts
│   ├── enhanced-scheduler.ts
│   └── types.ts
├── scripts/
│   └── generate_eval_html.ts        # HTML report generator
├── eval-report/
│   └── index.html                   # Visual evaluation report
├── CHANGELOG.md                     # Iterative improvement log
├── package.json
├── next.config.mjs                  # Next.js configuration
└── tsconfig.json
```

## How It Works

### 1. Parse Natural Language

```typescript
const constraints = parseConstraints([
  "Ada needs time off from Aug 14 for 3 days",
  "Chidi prefers morning shifts",
  "Kemi cannot work weekends",
], staff, month);
// → 3 structured Constraint objects
```

### 2. Generate Schedule

```typescript
// Baseline (ignores constraints)
const baseline = generateBaselineSchedule(staff, month);

// Agent (respects constraints)
const agent = generateAgentSchedule(staff, month, constraints);
```

### 3. Evaluate & Explain

```typescript
const explanation = explainSchedule(agent, constraints);
console.log(explanation.fairnessAnalysis.overallScore); // 96/100
console.log(explanation.hotTake); // "Key insight..."
```

## Built On

- [Fair Call Pro](https://github.com/Danielbuildsorigin/fair-call-pro) — React/Vite/TypeScript shift scheduling app with LRU algorithm
- [Groq](https://groq.com) — LLM-powered constraint parsing (`groq-sdk`)
- [Next.js](https://nextjs.org) — Web UI framework (app router)
- date-fns — Date manipulation
- TypeScript — Type safety throughout

## License

MIT
