import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { shouldGoToMarket } from './tasks.js';
import { pickNextTask } from './scheduler.js';
import { instantiateJob, applyJobCompletion, simMinutesForHours } from './jobCatalog.js';
import { consume } from './labour.js';

const STEP_COST_DEFAULT = CONFIG_PACK_V1.labour.travelStepSimMin ?? 0.5;
const MINUTES_PER_HOUR = CONFIG_PACK_V1.time.minutesPerHour ?? 60;

function ensureProgressStructures(state) {
  if (!state.progress) state.progress = {};
  if (!(state.progress.done instanceof Set)) state.progress.done = new Set();
  if (!(state.progress.history instanceof Map)) state.progress.history = new Map();
  const year = state.world?.calendar?.year ?? 1;
  if (state.progress.year !== year) {
    state.progress.done.clear();
    state.progress.history.clear();
    state.progress.year = year;
  }
}

function ensurePosition(state) {
  if (!state.position) {
    const yard = state.world?.locations?.yard ?? { x: 0, y: 0 };
    state.position = { x: yard.x ?? 0, y: yard.y ?? 0 };
  }
  return state.position;
}

function ensureGuards(state) {
  if (!state.guards) {
    state.guards = {};
  }
  state.guards.hasTradeNeed = (engineState) => shouldGoToMarket(engineState.world);
}

function consumeLabour(state, simMin, reason) {
  if (!Number.isFinite(simMin) || simMin <= 0) return 0;
  const hours = simMin / MINUTES_PER_HOUR;
  consume(hours);
  if (!state.labour) {
    state.labour = { totalSimMin: 0, travelSimMin: 0, workSimMin: 0 };
  }
  state.labour.totalSimMin += simMin;
  if (reason === 'travel') state.labour.travelSimMin += simMin;
  else state.labour.workSimMin += simMin;
  return hours;
}

function recordTaskHistory(state, job) {
  if (!job?.id) return;
  const progress = state.progress;
  const year = state.world?.calendar?.year;
  const month = state.world?.calendar?.month;
  progress.done.add(job.id);
  progress.history.set(job.id, { year, month });
}

function beginScheduledTask(state) {
  while (true) {
    const next = pickNextTask(state);
    if (!next) {
      state.currentTask = null;
      return null;
    }
    const runtime = instantiateJob(state.world, next);
    if (!runtime) {
      recordTaskHistory(state, next);
      continue;
    }
    if (typeof runtime.canApply === 'function' && !runtime.canApply(state.world)) {
      recordTaskHistory(state, next);
      continue;
    }
    const totalSimMin = simMinutesForHours(runtime.hours);
    if (!Number.isFinite(totalSimMin) || totalSimMin <= 0) {
      applyJobCompletion(state.world, runtime);
      recordTaskHistory(state, next);
      continue;
    }
    const target = runtime.target || state.world?.locations?.yard || { x: 0, y: 0 };
    state.currentTask = {
      definition: next,
      runtime,
      totalSimMin,
      remainingSimMin: totalSimMin,
      target: { x: target.x ?? 0, y: target.y ?? 0 },
      startedAt: {
        year: state.world?.calendar?.year ?? null,
        month: state.world?.calendar?.month ?? null,
        day: state.world?.calendar?.day ?? null,
      },
    };
    return state.currentTask;
  }
}

function moveTowardWorksite(state, task, budgetSimMin) {
  if (!task) return 0;
  const pos = ensurePosition(state);
  const target = task.target || pos;
  const stepCost = Number.isFinite(state.stepCost) && state.stepCost > 0 ? state.stepCost : STEP_COST_DEFAULT;
  if (stepCost <= 0) {
    pos.x = target.x ?? pos.x;
    pos.y = target.y ?? pos.y;
    return 0;
  }
  let dx = Math.round((target.x ?? pos.x) - (pos.x ?? 0));
  let dy = Math.round((target.y ?? pos.y) - (pos.y ?? 0));
  if (dx === 0 && dy === 0) return 0;
  const stepsNeeded = Math.abs(dx) + Math.abs(dy);
  const maxSteps = Math.min(stepsNeeded, Math.floor(budgetSimMin / stepCost));
  if (maxSteps <= 0) return 0;
  let steps = maxSteps;
  while (steps > 0 && (dx !== 0 || dy !== 0)) {
    if (dx !== 0) {
      pos.x += dx > 0 ? 1 : -1;
      dx = Math.round((target.x ?? pos.x) - pos.x);
    } else if (dy !== 0) {
      pos.y += dy > 0 ? 1 : -1;
      dy = Math.round((target.y ?? pos.y) - pos.y);
    }
    steps -= 1;
  }
  return maxSteps * stepCost;
}

function performWorkSlice(task, budgetSimMin) {
  if (!task) return { consumedSimMin: 0, done: false };
  const consumeSimMin = Math.min(task.remainingSimMin, budgetSimMin);
  task.remainingSimMin = Math.max(0, task.remainingSimMin - consumeSimMin);
  const done = task.remainingSimMin <= 1e-6;
  return { consumedSimMin: consumeSimMin, done };
}

function completeTask(state, task) {
  applyJobCompletion(state.world, task.runtime);
  recordTaskHistory(state, task.definition);
  const pos = ensurePosition(state);
  pos.x = task.target?.x ?? pos.x;
  pos.y = task.target?.y ?? pos.y;
  state.currentTask = null;
}

export function createEngineState(world) {
  const yard = world?.locations?.yard ?? { x: 0, y: 0 };
  return {
    world,
    currentTask: null,
    position: { x: yard.x ?? 0, y: yard.y ?? 0 },
    progress: {
      done: new Set(),
      history: new Map(),
      year: world?.calendar?.year ?? 1,
    },
    guards: {
      hasTradeNeed: (engineState) => shouldGoToMarket(engineState.world),
    },
    stepCost: STEP_COST_DEFAULT,
    labour: { totalSimMin: 0, travelSimMin: 0, workSimMin: 0 },
  };
}

export function tick(state, simMin) {
  if (!state || !Number.isFinite(simMin) || simMin <= 0) return 0;
  ensureProgressStructures(state);
  ensureGuards(state);
  ensurePosition(state);
  let remaining = simMin;
  let consumed = 0;
  while (remaining > 0) {
    if (!state.currentTask) {
      const task = beginScheduledTask(state);
      if (!task) break;
    }
    const task = state.currentTask;
    if (!task) break;
    const travelSimMin = moveTowardWorksite(state, task, remaining);
    if (travelSimMin > 0) {
      consumeLabour(state, travelSimMin, 'travel');
      consumed += travelSimMin;
      remaining -= travelSimMin;
      if (remaining <= 0) break;
    }
    const work = performWorkSlice(task, remaining);
    if (work.consumedSimMin > 0) {
      consumeLabour(state, work.consumedSimMin, 'work');
      consumed += work.consumedSimMin;
      remaining -= work.consumedSimMin;
    }
    if (work.done) {
      completeTask(state, task);
      continue;
    }
    if (travelSimMin <= 0 && work.consumedSimMin <= 0) {
      break;
    }
  }
  return consumed;
}
