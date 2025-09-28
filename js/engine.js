import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { shouldGoToMarket } from './tasks.js';
import { pickNextTask, monthIndexFromLabel } from './scheduler.js';
import { instantiateJob, applyJobCompletion, simMinutesForHours } from './jobCatalog.js';
import { consume } from './labour.js';
import { TASK_META } from './task_meta.js';
import { applyResourceDeltas } from './resources.js';
import { DAYS_PER_MONTH, MAX_SCHEDULED_TASK_ATTEMPTS } from './constants.js';

const STEP_COST_DEFAULT = CONFIG_PACK_V1.labour.travelStepSimMin ?? 0.5;
const MINUTES_PER_HOUR = CONFIG_PACK_V1.time.minutesPerHour ?? 60;
const DAY_SIM_MIN = CONFIG_PACK_V1.time.daySimMin ?? 24 * 60;

function currentSimMinute(world) {
  if (!world?.calendar) return 0;
  const { month, day, minute } = world.calendar;
  const monthIdx = monthIndexFromLabel(month);
  const safeDay = Number.isFinite(day) ? day - 1 : 0;
  const minuteOfDay = Number.isFinite(minute) ? minute : 0;
  return monthIdx * DAYS_PER_MONTH * DAY_SIM_MIN + safeDay * DAY_SIM_MIN + minuteOfDay;
}

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

function ensureFarmer(state) {
  if (!state.farmer) {
    const yard = state.world?.locations?.yard ?? { x: 0, y: 0 };
    state.farmer = {
      pos: { x: yard.x ?? 0, y: yard.y ?? 0 },
      path: [],
    };
  } else {
    if (!state.farmer.pos) {
      const yard = state.world?.locations?.yard ?? { x: 0, y: 0 };
      state.farmer.pos = { x: yard.x ?? 0, y: yard.y ?? 0 };
    } else {
      state.farmer.pos.x = Math.round(state.farmer.pos.x ?? 0);
      state.farmer.pos.y = Math.round(state.farmer.pos.y ?? 0);
    }
    if (!Array.isArray(state.farmer.path)) {
      state.farmer.path = [];
    }
  }
  return state.farmer;
}

function ensureWorldFarmer(state) {
  if (!state?.world) return null;
  const world = state.world;
  if (!world.farmer) {
    world.farmer = { x: 0, y: 0, queue: [], activeWork: [], task: null };
  }
  if (!Array.isArray(world.farmer.queue)) {
    world.farmer.queue = [];
  }
  if (!Array.isArray(world.farmer.activeWork)) {
    world.farmer.activeWork = [];
  }
  return world.farmer;
}

function syncWorldFarmer(state) {
  const engineFarmer = ensureFarmer(state);
  const worldFarmer = ensureWorldFarmer(state);
  if (!engineFarmer || !worldFarmer) return;

  const pos = engineFarmer.pos || {};
  const px = Number.isFinite(pos.x) ? pos.x : 0;
  const py = Number.isFinite(pos.y) ? pos.y : 0;
  worldFarmer.x = Math.round(px);
  worldFarmer.y = Math.round(py);

  const desiredSlots = state.world?.labour?.crewSlots ?? (worldFarmer.activeWork.length || 1);
  const slots = Math.max(1, desiredSlots);
  if (worldFarmer.activeWork.length !== slots) {
    worldFarmer.activeWork = Array.from({ length: slots }, () => null);
  } else {
    worldFarmer.activeWork.fill(null);
  }

  const current = state.currentTask;
  if (worldFarmer.activeWork.length > 0) {
    worldFarmer.activeWork[0] = current?.definition?.id ?? null;
  }
  worldFarmer.task = current?.definition?.kind ?? null;
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
  for (let attempts = 0; attempts < MAX_SCHEDULED_TASK_ATTEMPTS; attempts += 1) {
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
    if (state.farmer) state.farmer.path = [];
    return state.currentTask;
  }
  state.currentTask = null;
  return null;
}

function normalizeTile(tile) {
  if (!tile) return null;
  const x = Math.round(tile.x ?? 0);
  const y = Math.round(tile.y ?? 0);
  return { x, y };
}

function tilesForTask(state, task) {
  const tiles = [];
  const id = task?.definition?.id;
  const kind = task?.definition?.kind ?? task?.runtime?.kind;
  const meta = (id && TASK_META[id]) || (kind && TASK_META[kind]) || null;
  if (meta && typeof meta.site === 'function') {
    const result = meta.site(state, task);
    if (Array.isArray(result)) {
      for (const tile of result) {
        const normalized = normalizeTile(tile);
        if (normalized) tiles.push(normalized);
      }
    }
  }
  if (!tiles.length) {
    const fallback = normalizeTile(task?.runtime?.target || task?.target);
    if (fallback) tiles.push(fallback);
  }
  return tiles;
}

function nearestTile(from, tiles) {
  if (!from || !tiles?.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const tile of tiles) {
    const dist = Math.abs(tile.x - from.x) + Math.abs(tile.y - from.y);
    if (dist < bestDist) {
      best = tile;
      bestDist = dist;
    }
  }
  return best;
}

function ensureAtSite(state, task, budgetSimMin) {
  if (!task) return { arrived: true, consumedSimMin: 0 };
  const farmer = ensureFarmer(state);
  const workTiles = tilesForTask(state, task);
  if (!workTiles.length) return { arrived: true, consumedSimMin: 0 };
  const atSite = workTiles.some((tile) => tile.x === farmer.pos.x && tile.y === farmer.pos.y);
  if (atSite) return { arrived: true, consumedSimMin: 0 };
  const stepCost = Number.isFinite(state.stepCost) && state.stepCost > 0 ? state.stepCost : STEP_COST_DEFAULT;
  if (!(stepCost > 0)) {
    const target = workTiles[0];
    farmer.pos.x = target.x;
    farmer.pos.y = target.y;
    return { arrived: true, consumedSimMin: 0 };
  }
  const targetTile = nearestTile(farmer.pos, workTiles);
  if (!targetTile) return { arrived: false, consumedSimMin: 0 };
  let consumed = 0;
  while (budgetSimMin - consumed >= stepCost) {
    if (farmer.pos.x === targetTile.x && farmer.pos.y === targetTile.y) break;
    if (farmer.pos.x !== targetTile.x) {
      farmer.pos.x += farmer.pos.x < targetTile.x ? 1 : -1;
    } else if (farmer.pos.y !== targetTile.y) {
      farmer.pos.y += farmer.pos.y < targetTile.y ? 1 : -1;
    }
    consumed += stepCost;
  }
  const arrivedNow = workTiles.some((tile) => tile.x === farmer.pos.x && tile.y === farmer.pos.y);
  return { arrived: arrivedNow, consumedSimMin: consumed };
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
  const def = task.definition || {};
  if (def.consumesOnComplete) {
    applyResourceDeltas(state.world, def.consumesOnComplete);
  }
  if (def.produces) {
    applyResourceDeltas(state.world, def.produces);
  }
  if (def.cooldownMin > 0 && state.taskCooldowns instanceof Map && def.id) {
    const readyAt = currentSimMinute(state.world) + def.cooldownMin;
    state.taskCooldowns.set(def.id, readyAt);
  }
  const farmer = ensureFarmer(state);
  if (task.target) {
    farmer.pos.x = Math.round(task.target.x ?? farmer.pos.x);
    farmer.pos.y = Math.round(task.target.y ?? farmer.pos.y);
  }
  farmer.path = [];
  state.currentTask = null;
}

export function createEngineState(world) {
  const yard = world?.locations?.yard ?? { x: 0, y: 0 };
  return {
    world,
    currentTask: null,
    farmer: {
      pos: { x: yard.x ?? 0, y: yard.y ?? 0 },
      path: [],
    },
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
    taskCooldowns: new Map(),
  };
}

export function tick(state, simMin) {
  if (!state || !Number.isFinite(simMin) || simMin <= 0) return 0;
  ensureProgressStructures(state);
  ensureGuards(state);
  ensureFarmer(state);
  let remaining = simMin;
  let consumed = 0;
  while (remaining > 0) {
    if (!state.currentTask) {
      const task = beginScheduledTask(state);
      if (!task) break;
    }
    const task = state.currentTask;
    if (!task) break;
    const travel = ensureAtSite(state, task, remaining);
    if (travel.consumedSimMin > 0) {
      consumeLabour(state, travel.consumedSimMin, 'travel');
      consumed += travel.consumedSimMin;
      remaining -= travel.consumedSimMin;
    }
    if (!travel.arrived) break;
    if (remaining <= 0) break;
    const def = task.definition || {};
    if (Array.isArray(def.allowedHours) && def.allowedHours.length === 2) {
      const minuteOfDay = state.world?.calendar?.minute ?? 0;
      const [start, end] = def.allowedHours;
      if (Number.isFinite(start) && Number.isFinite(end)) {
        if (minuteOfDay < start || minuteOfDay > end) break;
      }
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
    if (travel.consumedSimMin <= 0 && work.consumedSimMin <= 0) {
      break;
    }
  }
  syncWorldFarmer(state);
  return consumed;
}
