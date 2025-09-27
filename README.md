# ASCII Farming Simulation

A Norfolk-style farm planner tuned for an eight-month, twenty-day calendar. The simulation tracks labour explicitly, derives task durations from acres, and keeps the world grounded in a canonical “Spring I, Day 1” state.

## Purpose

- **Calendar:** Eight named months (`I`–`VIII`), twenty days each, deterministic rollover.
- **Labour:** A single farmer abstractly represents four adults working eight hours a day across twenty days → **640 labour-hours per month**.
- **Fields:** Acre-scaled Norfolk rotation with closes, livestock placements, and store inventories.
- **Planning:** Monthly priorities expand into concrete jobs with prerequisites and hour costs.
- **Scheduling:** A monthly labour budget selects which jobs proceed; travel time is explicit.

## Time Scale

- **Simulation speed:** 60 simulation minutes per real minute.
- **Movement cadence:** One grid step per 0.5 simulation minute.
- **Day length:** 24 hours (1,440 simulation minutes) with deterministic month/day advancement.

## Labour Model

- **Household abstraction:** One farmer embodies the combined effort of four adults working 8 h/day across 20 days.
- **Budget:** 640 labour-hours per month, consumed per task including travel.
- **Tracking:** HUD displays budget vs. usage; planner lists prerequisite-gated jobs.

## Getting Started

Open `index.html` in any modern browser. The HUD shows current month/day, simulation time, and labour usage. Use the **Advance Day** button to consume scheduled work and roll time forward; the planner panel updates as tasks complete and field phases change.

## Roadmap

1. Month planner → Task durations → Inventory audit (completed in this pass).
2. Next steps: livestock management refinements, garden/orchard expansion, winter work, yield modelling.
3. Future ideas: weather impacts, trade pricing, save/load, multi-season progression.
