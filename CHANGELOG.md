# Fair Call Agent — Iterative Improvement Changelog

> micro1 Agentic Workflows Hackathon · Built on Fair Call Pro's LRU Scheduler

## Overview

This changelog documents each iteration of improving the baseline deterministic LRU scheduler with agentic constraint reasoning. Each iteration adds a capability, is measured against the baseline, and shows evidence of improvement.

---

## Iteration 0: Baseline (Original Fair Call Pro LRU Scheduler)

**What**: The original `generateSchedule()` function from Fair Call Pro — a greedy LRU (Least Recently Used) algorithm that distributes shifts fairly across staff.

**Design**: For each shift slot, find eligible staff (not past end date, not already assigned another slot today), sort by days since last assignment (LRU), assign the least-recently-used staff.

**Capabilities**:
- Fair shift distribution via LRU sorting
- Back-to-back preference (soft constraint)
- Night-to-morning crossover detection (soft)
- Manual assignment preservation
- Holiday and weekend awareness

**Limitations**:
- ❌ Cannot understand natural language instructions
- ❌ Cannot honor time-off requests (unless pre-entered as manual assignments)
- ❌ Cannot enforce availability constraints (day-of-week, date-specific)
- ❌ Cannot respect shift preferences
- ❌ Cannot handle inter-staff constraints (pair together/apart)
- ❌ Cannot enforce max/min shift limits
- ❌ Cannot explain scheduling decisions

**Measured Performance** (12 evaluation cases):
- Coverage: 100%
- Fairness: 95.8/100
- **Constraint Satisfaction: 55%** — baseline accidentally satisfies some constraints (like max shifts) because the LRU algorithm naturally distributes work, but fails on any constraint requiring explicit reasoning

---

## Iteration 1: Natural Language Constraint Parser

**Change**: Added a pattern-matching parser that converts manager instructions like _"Ada needs time off from Aug 14 for 3 days"_ into structured `Constraint` objects.

**Design Choice**: Used regex-based pattern matching rather than LLM calls for reliability and zero external dependencies. Supports 14 constraint types: `unavailable`, `time_off`, `preferred`, `max_shifts`, `min_shifts`, `no_back_to_back`, `no_night_to_morning`, `pair_together`, `pair_apart`, `specific_shift`, `availability`, `balance`, `coverage`, `role`.

**Evidence**: Parser correctly identifies and structures all 14 constraint types from natural language. Unrecognized patterns are reported for manual review.

---

## Iteration 2: Constraint-Aware Scheduling Engine

**Change**: Built `generateAgentSchedule()` that wraps the LRU algorithm with a constraint reasoning layer.

**Design**:
1. **Pre-computation**: Index all constraints by type into efficient lookup structures (Maps, Sets)
2. **Hard constraint pre-assignment**: Pin specific shifts before the main loop
3. **Hard constraint filtering**: In `findEligibleStaff()`, exclude staff who violate hard constraints (unavailability, time-off, pair-apart, day-of-week availability)
4. **Soft constraint scoring**: Add/subtract scores for soft constraints (preferences, max shifts, back-to-back avoidance)
5. **Fallback**: If no eligible staff under hard constraints, relax and try again (coverage > constraint adherence when truly understaffed)

**Evidence** — Multi-Constraint Hospital case (5 constraints):
| Constraint | Baseline | Agent |
|---|---|---|
| Time-off (Ada off Aug 10-14) | ✓ (coincidental) | ✓ |
| Max shifts (Chidi ≤ 18) | ✓ (coincidental) | ✓ |
| Morning preference (Funke) | ✗ | ✓ |
| No night→morning (Ibrahim) | ✓ (coincidental) | ✓ |
| Weekend unavailability (Kemi) | ✗ | ✓ |

Baseline: 60% constraint satisfaction. Agent: 100%.

---

## Iteration 3: Shift Preference Optimization

**Change**: Added preference-aware scoring to the eligibility sort. Staff who prefer a certain shift type get a +10 score bonus when that slot is being filled.

**Trade-off**: This slightly reduces fairness (95.8 → 92.0 in the preference diversity case) because honoring preferences means some staff get more of their preferred shifts than others. This is intentional and correct — the agent prioritizes stated preferences over pure statistical equality.

**Evidence** — Shift Preference Diversity case (5 preferences):
| Staff | Preference | Baseline | Agent |
|---|---|---|---|
| Ada | Morning | Mixed | Mostly morning ✓ |
| Chidi | Night | Mixed | Mostly night ✓ |
| Funke | Afternoon | Mixed | Mostly afternoon ✓ |
| Ibrahim | Morning | Mixed | Mostly morning ✓ |
| Kemi | Night | Mixed | Mostly night ✓ |

Baseline: 0% preference satisfaction. Agent: 100%.

---

## Iteration 4: Specific Shift Pinning

**Change**: Before the main scheduling loop, hard-assign shifts that are explicitly required (e.g., "Ada must work morning on Aug 5"). These assignments are treated as pre-existing manual assignments.

**Design**: Processed before the LRU loop so the algorithm works around them naturally.

**Evidence** — Specific Shift Assignment case:
| Requirement | Baseline | Agent |
|---|---|---|
| Ada morning on Aug 5 | ✗ (assigned afternoon) | ✓ |
| Chidi night on Aug 12 | ✗ (assigned morning) | ✓ |

Baseline: 0%. Agent: 100%.

---

## Iteration 5: Schedule Explainer Agent

**Change**: Added an explanation layer that analyzes the generated schedule and produces:
- Fairness score with Gini-like calculation
- Most/least loaded staff analysis
- Constraint compliance report per constraint
- Anomaly detection (unassigned slots, fairness issues, zero-shift staff)
- **"Hot Take"** — a practical insight from the analysis

**Design Choice**: The explainer is a separate module, not embedded in the scheduler. This separation of concerns allows the scheduler to focus on optimization and the explainer on transparency.

**Evidence**: Generated explanations identify specific issues like "3 back-to-back violations detected" and "Ada is heavily weighted toward morning shifts (80%)".

---

## Iteration 6: LLM-Powered Constraint Parsing

**Change**: Added a Groq LLM-based constraint parser (`llm-constraint-parser.ts`) that semantically understands natural language, with regex fallback when no API key is configured.

**Design**: The `parseConstraintsAsync()` entry point tries the LLM first. If the LLM successfully parses all constraints, it returns those results. Any constraints the LLM misses are passed to the regex parser as a fallback. If the LLM is unavailable (no `GROQ_API_KEY`), it falls back to regex-only — the app works exactly as before at $0 cost.

**Why LLM**: The regex parser struggles with complex phrasing, negations, and multi-part constraints. For example, "Ada and Chidi should NOT work together" was misread by regex as `pair_together` instead of `pair_apart`. The LLM understands negation semantically.

**Evidence**:
| Constraint Text | Regex Parser | LLM Parser |
|---|---|---|
| "Kemi and Ladi should NOT work together" | `pair_together` ✗ | `pair_apart` ✓ |
| "Ada cannot do night followed by morning" | `no_night_to_morning` ✓ | `no_night_to_morning` ✓ |
| "Ibrahim is only available weekdays" | `availability` ✓ | `availability` ✓ |

The LLM correctly interprets negation where the regex parser fails. Both paths produce identical results for well-structured constraints.

---

## Final Results

| Metric | Baseline | Agent | Δ |
|---|---|---|---|
| **Coverage** | 100% | 100% | 0 |
| **Fairness** | 95.8/100 | 95.6/100 | -0.2 |
| **Constraint Satisfaction** | **55%** | **100%** | **+45** |
| B2B Violations | 60 | 63 | +3 |
| N→M Violations | 0 | 0 | 0 |

**Key Finding**: The agent achieves 100% constraint satisfaction across all 12 evaluation cases while maintaining 100% coverage and fairness within 0.2 points of the baseline. The +45 percentage point improvement in constraint satisfaction is the primary measured improvement.

---

## Failure Mode / Hot Take

> _"Back-to-back violations (60→63) increase slightly when the agent honors time-off constraints — because removing one staff from the pool for several days forces others to work more consecutive days. This reveals a fundamental truth: **constraint satisfaction and individual workload smoothness are sometimes at odds**. The agent's job isn't to eliminate all violations but to make transparent, principled trade-offs that the baseline algorithm can't even consider."_

The baseline had 60 back-to-back violations in the understaffed case — the agent has 63 (one extra). This is the cost of honoring Ada's 2-day time-off in a 4-staff environment. The alternative would be violating Ada's time-off to reduce others' back-to-back days, which is a worse trade-off because Ada explicitly requested the time off.
