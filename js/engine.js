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

function startNextTask(state) {
  const next = pickNextTask(state);
  if (!next) {
    state.currentTask = null;
    return null;
  }
  const runtime = instantiateJob(state.world, next);
  if (!runtime) {
    state.progress.done.add(next.id);
    state.progress.history.set(next.id, { year: state.world?.calendar?.year, month: state.world?.calendar?.month });
    state.currentTask = null;
    return startNextTask(state);
  }
  if (typeof runtime.canApply === 'function' && !runtime.canApply(state.world)) {
    state.progress.done.add(next.id);
    state.progress.history.set(next.id, { year: state.world?.calendar?.year, month: state.world?.calendar?.month });
    state.currentTask = null;
    return startNextTask(state);
  }
  const totalSimMin = simMinutesForHours(runtime.hours);
  if (!Number.isFinite(totalSimMin) || totalSimMin <= 0) {
    applyJobCompletion(state.world, runtime);
    state.progress.done.add(next.id);
    state.progress.history.set(next.id, { year: state.world?.calendar?.year, month: state.world?.calendar?.month });
    state.currentTask = null;
    return startNextTask(state);
  }
  const target = runtime.target || state.world?.locations?.yard || { x: 0, y: 0 };
  state.currentTask = {
    definition: next,
    runtime,
    totalSimMin,
    remainingSimMin: totalSimMin,
    target: { x: target.x ?? 0, y: target.y ?? 0 },
  };
  return state.currentTask;
}

function ensureAtWorksite(state, task, stepCost, budgetSimMin) {
  if (!task) return { consumedSimMin: 0 };
  const pos = ensurePosition(state);
  const target = task.target || pos;
  const cost = Number.isFinite(stepCost) && stepCost > 0 ? stepCost : STEP_COST_DEFAULT;
  if (cost <= 0) {
    pos.x = target.x ?? pos.x;
    pos.y = target.y ?? pos.y;
    return { consumedSimMin: 0 };
  }
  let dx = Math.round((target.x ?? pos.x) - (pos.x ?? 0));
  let dy = Math.round((target.y ?? pos.y) - (pos.y ?? 0));
  if (dx === 0 && dy === 0) return { consumedSimMin: 0 };
  const stepsNeeded = Math.abs(dx) + Math.abs(dy);
  const maxSteps = Math.min(stepsNeeded, Math.floor(budgetSimMin / cost));
  if (maxSteps <= 0) return { consumedSimMin: 0 };
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
  const consumedSimMin = maxSteps * cost;
  return { consumedSimMin };
}

function workSlice(task, budgetSimMin) {
  if (!task) return { consumedSimMin: 0, done: false };
  const consumeSimMin = Math.min(task.remainingSimMin, budgetSimMin);
  task.remainingSimMin = Math.max(0, task.remainingSimMin - consumeSimMin);
  const done = task.remainingSimMin <= 1e-6;
  return { consumedSimMin: consumeSimMin, done };
}

function completeTask(state, task) {
  applyJobCompletion(state.world, task.runtime);
  state.progress.done.add(task.definition.id);
  state.progress.history.set(task.definition.id, {
    year: state.world?.calendar?.year,
    month: state.world?.calendar?.month,
  });
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
      const task = startNextTask(state);
      if (!task) break;
    }
    const task = state.currentTask;
    if (!task) break;
    const travel = ensureAtWorksite(state, task, state.stepCost, remaining);
    if (travel.consumedSimMin > 0) {
      consumeLabour(state, travel.consumedSimMin, 'travel');
      consumed += travel.consumedSimMin;
      remaining -= travel.consumedSimMin;
      if (remaining <= 0) break;
    }
    const work = workSlice(task, remaining);
    if (work.consumedSimMin > 0) {
      consumeLabour(state, work.consumedSimMin, 'work');
      consumed += work.consumedSimMin;
      remaining -= work.consumedSimMin;
    }
    if (work.done) {
      completeTask(state, task);
      continue;
    }
    if (work.consumedSimMin <= 0 && travel.consumedSimMin <= 0) {
      break;
    }
  }
  return consumed;
}
