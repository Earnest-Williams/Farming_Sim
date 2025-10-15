import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { canScheduleMarketTrip } from './jobs/market_trip.js';
import { pickNextTask, monthIndexFromLabel } from './scheduler.js';
import { instantiateJob, applyJobCompletion, simMinutesForHours } from './jobCatalog.js';
import { consume } from './labour.js';
import { TASK_META } from './task_meta.js';
import { applyResourceDeltas } from './resources.js';
import { DAYS_PER_MONTH, MAX_SCHEDULED_TASK_ATTEMPTS } from './constants.js';
import { findPath } from './pathfinding.js';
import { FARMHOUSE_BED } from './world.js';
import { log } from './utils.js';

const STEP_COST_DEFAULT = CONFIG_PACK_V1.labour.travelStepSimMin ?? 0.5;
const MINUTES_PER_HOUR = CONFIG_PACK_V1.time.minutesPerHour ?? 60;
const DAY_SIM_MIN = CONFIG_PACK_V1.time.daySimMin ?? 24 * 60;
const DEFAULT_SKIP_RETRY_MIN = Math.max(
  5,
  Number.isFinite(CONFIG_PACK_V1.rules?.taskRetryCooldownSimMin)
    ? CONFIG_PACK_V1.rules.taskRetryCooldownSimMin
    : MINUTES_PER_HOUR || 60,
);

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
    if (state.taskSkips instanceof Map) {
      state.taskSkips.clear();
    }
  }
}

function bedLocation(world) {
  const loc = world?.locations?.bed;
  if (loc && Number.isFinite(loc.x) && Number.isFinite(loc.y)) {
    return { x: Math.round(loc.x), y: Math.round(loc.y) };
  }
  return { x: FARMHOUSE_BED.x, y: FARMHOUSE_BED.y };
}

function ensureFarmer(state) {
  const home = bedLocation(state.world);
  if (!state.farmer) {
    state.farmer = {
      pos: { ...home },
      path: [],
      pathTarget: null,
    };
  } else {
    if (!state.farmer.pos) {
      state.farmer.pos = { ...home };
    } else {
      state.farmer.pos.x = Math.round(Number.isFinite(state.farmer.pos.x) ? state.farmer.pos.x : home.x);
      state.farmer.pos.y = Math.round(Number.isFinite(state.farmer.pos.y) ? state.farmer.pos.y : home.y);
    }
    if (!Array.isArray(state.farmer.path)) {
      state.farmer.path = [];
    }
    const target = state.farmer.pathTarget;
    if (target && typeof target === 'object' && Number.isFinite(target.x) && Number.isFinite(target.y)) {
      state.farmer.pathTarget = { x: Math.round(target.x), y: Math.round(target.y) };
    } else {
      state.farmer.pathTarget = null;
    }
  }
  return state.farmer;
}

function settleFarmerIfSleeping(state) {
  const world = state.world;
  if (!world) return;
  if (state.currentTask) return;
  const path = state.farmer?.path;
  if (Array.isArray(path) && path.length > 0) return;
  const daylight = world.daylight;
  const minute = world.calendar?.minute ?? 0;
  const start = Number.isFinite(daylight?.workStart) ? daylight.workStart : 0;
  const fallbackEnd = CONFIG_PACK_V1.time?.daySimMin ?? 24 * 60;
  const end = Number.isFinite(daylight?.workEnd) ? daylight.workEnd : fallbackEnd;
  const outsideWindow = minute < start || minute >= end;
  if (!outsideWindow) return;
  const farmer = ensureFarmer(state);
  const bed = bedLocation(world);
  farmer.pos.x = bed.x;
  farmer.pos.y = bed.y;
  farmer.path = [];
  farmer.pathTarget = null;
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
  state.guards.hasTradeNeed = (engineState) => canScheduleMarketTrip(engineState.world);
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

function ensureTaskSkips(state) {
  if (!(state.taskSkips instanceof Map)) {
    state.taskSkips = new Map();
  }
  return state.taskSkips;
}

function describeJobForLog(job, runtime) {
  return (
    runtime?.label
    ?? job?.label
    ?? job?.operation
    ?? job?.kind
    ?? job?.id
    ?? 'task'
  );
}

function noteTaskBlocked(state, job, runtime, details = {}) {
  if (!job?.id) return;
  const skips = ensureTaskSkips(state);
  const now = currentSimMinute(state.world);
  const retryIn = Number.isFinite(details.retryIn)
    ? details.retryIn
    : Number.isFinite(details.retryAt)
      ? Math.max(0, details.retryAt - now)
      : Number.isFinite(runtime?.retryCooldownMin)
        ? runtime.retryCooldownMin
        : Number.isFinite(job?.retryCooldownMin)
          ? job.retryCooldownMin
          : DEFAULT_SKIP_RETRY_MIN;
  const blockedUntil = now + Math.max(1, retryIn);
  const reason = String(
    details.reason
    ?? runtime?.manifestReason
    ?? runtime?.blockReason
    ?? job?.blockReason
    ?? 'requirements not met',
  );
  const existing = skips.get(job.id);
  const entry = {
    blockedUntil,
    reason,
    lastChecked: now,
    logNotified: existing?.logNotified ?? false,
  };
  if (Array.isArray(state.world?.logs) && (!existing || existing.reason !== reason || !existing.logNotified)) {
    const label = describeJobForLog(job, runtime);
    log(state.world, `⏸️ ${label} waiting: ${reason}`);
    entry.logNotified = true;
  } else if (existing) {
    entry.logNotified = existing.logNotified;
  }
  skips.set(job.id, entry);
}

function beginScheduledTask(state) {
  for (let attempts = 0; attempts < MAX_SCHEDULED_TASK_ATTEMPTS; attempts += 1) {
    const next = pickNextTask(state);
    if (!next) {
      state.currentTask = null;
      return null;
    }
    let instantiationDetails = null;
    const runtime = instantiateJob(state.world, next, {
      onBlocked: (details = {}) => {
        instantiationDetails = { ...details };
      },
    });
    if (!runtime) {
      const reason = instantiationDetails?.reason;
      noteTaskBlocked(state, next, null, {
        ...instantiationDetails,
        reason: typeof reason === 'string' && reason.length ? reason : undefined,
      });
      continue;
    }
    if (typeof runtime.canApply === 'function') {
      const result = runtime.canApply(state.world);
      const ok = typeof result === 'object' ? !!result.ok : !!result;
      if (!ok) {
        const details = typeof result === 'object' ? result : {};
        noteTaskBlocked(state, next, runtime, details);
        continue;
      }
    }
    const totalSimMin = simMinutesForHours(runtime.hours);
    if (!Number.isFinite(totalSimMin) || totalSimMin <= 0) {
      applyJobCompletion(state.world, runtime);
      recordTaskHistory(state, next);
      continue;
    }
    if (state.taskSkips instanceof Map) {
      state.taskSkips.delete(next.id);
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
  if (atSite) {
    farmer.path = [];
    farmer.pathTarget = null;
    return { arrived: true, consumedSimMin: 0 };
  }

  const stepCost = Number.isFinite(state.stepCost) && state.stepCost > 0 ? state.stepCost : STEP_COST_DEFAULT;
  if (!(stepCost > 0)) {
    const target = workTiles[0];
    if (target) {
      farmer.pos.x = target.x;
      farmer.pos.y = target.y;
    }
    farmer.path = [];
    farmer.pathTarget = null;
    return { arrived: true, consumedSimMin: 0 };
  }

  const targetTile = nearestTile(farmer.pos, workTiles);
  if (!targetTile) {
    farmer.path = [];
    farmer.pathTarget = null;
    return { arrived: false, consumedSimMin: 0 };
  }

  const directTravel = () => {
    farmer.path = [];
    farmer.pathTarget = null;
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
  };

  const grid = state.world?.pathGrid;
  if (!grid) {
    return directTravel();
  }

  const targetChanged = !farmer.pathTarget || farmer.pathTarget.x !== targetTile.x || farmer.pathTarget.y !== targetTile.y;
  if (targetChanged) {
    farmer.path = [];
    farmer.pathTarget = { x: targetTile.x, y: targetTile.y };
  }

  if (!Array.isArray(farmer.path) || farmer.path.length === 0) {
    const rawPath = findPath(grid, farmer.pos, targetTile);
    if (!Array.isArray(rawPath) || rawPath.length === 0) {
      return directTravel();
    }
    const steps = rawPath.slice(1).map(([x, y]) => ({ x, y }));
    if (steps.length === 0) {
      return directTravel();
    }
    farmer.path = steps;
  }

  let consumed = 0;
  while (budgetSimMin - consumed >= stepCost && farmer.path.length > 0) {
    const nextStep = farmer.path.shift();
    if (!nextStep) continue;
    const nextX = Number.isFinite(nextStep.x) ? nextStep.x : Math.round(nextStep[0] ?? farmer.pos.x);
    const nextY = Number.isFinite(nextStep.y) ? nextStep.y : Math.round(nextStep[1] ?? farmer.pos.y);
    if (farmer.pos.x === nextX && farmer.pos.y === nextY) {
      continue;
    }
    farmer.pos.x = nextX;
    farmer.pos.y = nextY;
    consumed += stepCost;
  }

  const arrivedNow = workTiles.some((tile) => tile.x === farmer.pos.x && tile.y === farmer.pos.y);
  if (arrivedNow) {
    farmer.path = [];
    farmer.pathTarget = null;
  } else if (farmer.path.length === 0) {
    farmer.pathTarget = null;
  }

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
  if (state.taskSkips instanceof Map && def.id) {
    state.taskSkips.delete(def.id);
  }
  const farmer = ensureFarmer(state);
  if (task.target) {
    farmer.pos.x = Math.round(task.target.x ?? farmer.pos.x);
    farmer.pos.y = Math.round(task.target.y ?? farmer.pos.y);
  }
  farmer.path = [];
  farmer.pathTarget = null;
  state.currentTask = null;
}

export function createEngineState(world) {
  const home = bedLocation(world);
  return {
    world,
    currentTask: null,
    farmer: {
      pos: { ...home },
      path: [],
      pathTarget: null,
    },
    progress: {
      done: new Set(),
      history: new Map(),
      year: world?.calendar?.year ?? 1,
    },
    guards: {
      hasTradeNeed: (engineState) => canScheduleMarketTrip(engineState.world),
    },
    stepCost: STEP_COST_DEFAULT,
    labour: { totalSimMin: 0, travelSimMin: 0, workSimMin: 0 },
    taskCooldowns: new Map(),
    taskSkips: new Map(),
  };
}

export function tick(state, simMin) {
  if (!state || !Number.isFinite(simMin) || simMin <= 0) return 0;
  ensureProgressStructures(state);
  ensureGuards(state);
  ensureFarmer(state);
  ensureTaskSkips(state);
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
  settleFarmerIfSleeping(state);
  syncWorldFarmer(state);
  return consumed;
}
