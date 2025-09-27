# ASCII Farming Simulation

A minute-accurate, season-aware farm simulation with Norfolk-style rotations, realistic task gating, and a visible farmer avatar whose movement reflects in-game time.

## Project Goals

1. **Minute-based core loop.** Deterministic, whole-minute ticks for work; avatar movement reflects time passage.
2. **Seasonal daylight gating.** Work allowed from 30 minutes before sunrise to 30 minutes after sunset; KPIs derive from workable minutes.
3. **Single-agent labour model.** One farmer stands for a four-adult household; slot-based concurrency simulates parallel labour.
4. **Environment preconditions.** Mud, rain, hay dryness, crop readiness, and calendar windows gate task starts (`canStartTask`).
5. **Physicality first.** Tasks accrue minutes; nothing completes instantly. Travel and handling time are costed (e.g., market runs).
6. **Visible embodiment.** The avatar walks to the job site; presence is required for many tasks.
7. **Configuration and testability.** Clear task schemas, a rule-like `canStartTask`, and headless tests to catch regressions.

## Core Loop

- **Render loop:** runs every animation frame for smooth visuals.
- **Movement cadence:** **1 step per 0.5 sim minute** (2 steps/min), driven by a movement accumulator.
- **Work cadence:** whole-minute ticks only; each occupied slot adds `+1 doneMin` to its task if within the daylight window and presence rules pass.
- **Day rollover:** recompute daylight, re-plan, and churn overdue tasks.

## Defaults

- **Simulation speed:** **1.0 min/s** → **60 sim minutes per 60 real seconds**.
- **Work window:** sunrise − 30 min to sunset + 30 min (seasonal).
- **Slots:** 4 concurrent labour slots (represents a four-adult household).

## Controls

- Speed slider and presets (Pause, Very slow, Slow, Normal, Fast, Ultra).
- Space toggles Pause. Number keys can map to preset speeds.
- Debug HUD shows `minute`, `workStart/workEnd`, `speed`, and active slots.

## Roadmap

- Fatigue/skill affecting minute productivity.
- Family members and hired labour.
- Travel-time logistics (teams, wagons, winter roads).
- Weather forecast and risk-aware planning.
- Market days and variable prices.
- Declarative rule engine for task preconditions.
- Regression tests (no work outside daylight, no instant completions, wet hay never carted).

## Building and Running

Open `index.html` in a modern browser or serve with any static server. The default start uses the slow visual cadence with speed `1.0 min/s`, which is adequate for observing behaviour in real time.
