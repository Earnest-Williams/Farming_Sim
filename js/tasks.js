import { log } from './utils.js';
import {
  TASK_KINDS,
  WORK_MINUTES,
  ACRES,
  ROWS,
  CREW_SLOTS as CONST_CREW_SLOTS,
  SOIL,
  LABOUR_DAY_MIN as CONST_LABOUR_DAY_MIN,
  MINUTES_PER_DAY,
} from './constants.js';
import { applyTaskEffects } from './state.js';

const SPEEDS = { walk_m_per_min: 70, cart_m_per_min: 120 };
const OVERHEAD = { load_per_crate_min: 1.2, market_transaction_min: 8 };

export const CREW_SLOTS = CONST_CREW_SLOTS;
export const LABOUR_DAY_MIN = CONST_LABOUR_DAY_MIN;

function distanceMeters(world, a = { x: 0, y: 0 }, b = { x: 0, y: 0 }) {
  const scale = world?.grid?.metersPerCell ?? 1;
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0)) * scale;
}

function estimateMinutes(world, spec) {
  if (!spec) return 30;
  if (spec.kind === TASK_KINDS.CartToMarket) {
    const farmhouse = world.farmhouse ?? { x: 0, y: 0 };
    const yard = world.locations?.yard ?? farmhouse;
    const marketDefault = { x: yard.x + 200, y: yard.y + 50 };
    const market = world.locations?.market ?? marketDefault;
    const dGo = distanceMeters(world, yard, market);
    const dBack = distanceMeters(world, market, yard);
    const hasCart = Boolean(world.assets?.oxCart);
    const v = hasCart ? SPEEDS.cart_m_per_min : SPEEDS.walk_m_per_min;
    const travel = (dGo + dBack) / (v || SPEEDS.walk_m_per_min);

    const payload = spec.payload;
    const crates = Array.isArray(payload)
      ? payload.reduce((acc, item) => acc + (item.qty ?? 1), 0)
      : (payload?.crates ?? 1);
    const handling = crates * OVERHEAD.load_per_crate_min + OVERHEAD.market_transaction_min;

    return travel + handling;
  }
  if (spec.parcelId != null) {
    const parcel = world.parcels?.[spec.parcelId];
    if (parcel) return minutesFor(spec.kind, parcel, spec.payload);
  }
  return 30;
}

export function makeTask(world, spec) {
  const rawEstimate = spec.kind === TASK_KINDS.CartToMarket
    ? estimateMinutes(world, spec)
    : (spec.estMin ?? estimateMinutes(world, spec));
  const estMin = Math.max(1, Math.round(rawEstimate || 1));
  return {
    id: world.nextTaskId++,
    kind: spec.kind,
    parcelId: spec.parcelId ?? null,
    payload: spec.payload || null,
    latestDay: spec.latestDay ?? 20,
    estMin,
    doneMin: 0,
    priority: spec.priority ?? 0,
    status: 'queued',
  };
}

export function minutesFor(op, parcel, payload) {
  switch (op) {
    case TASK_KINDS.PloughPlot: return WORK_MINUTES.PloughPlot_perAcre * ACRES(parcel);
    case TASK_KINDS.HarrowPlot: return WORK_MINUTES.HarrowPlot_perAcre * ACRES(parcel);
    case TASK_KINDS.DrillPlot: return WORK_MINUTES.DrillPlot_perAcre * ACRES(parcel);
    case TASK_KINDS.Sow: return WORK_MINUTES.Sow_perRow * ROWS(parcel);
    case TASK_KINDS.HoeRow: return WORK_MINUTES.HoeRow_perRow * ROWS(parcel);
    case TASK_KINDS.CartSheaves: return WORK_MINUTES.CartSheaves_perAcre * ACRES(parcel);
    case TASK_KINDS.StackRicks: return WORK_MINUTES.StackRicks_perAcre * ACRES(parcel);
    case TASK_KINDS.HarvestParcel: return WORK_MINUTES.HarvestParcel_perAcre * ACRES(parcel);
    case TASK_KINDS.SpreadManure: return WORK_MINUTES.SpreadManure_perAcre * ACRES(parcel);
    case TASK_KINDS.FoldSheep: return WORK_MINUTES.FoldSheep_setup;
    case TASK_KINDS.CutCloverHay: return WORK_MINUTES.CutCloverHay_perAcre * ACRES(parcel);
    case TASK_KINDS.OrchardHarvest: return WORK_MINUTES.OrchardHarvest_perAcre * ACRES(parcel);
    case TASK_KINDS.CartHay: return WORK_MINUTES.CartHay_perAcre * (parcel?.acres || 0);
    default: return 0;
  }
}

export function moistureToMud(m) {
  return Math.max(0, (m - SOIL.FIELD_CAP) / (SOIL.SAT - SOIL.FIELD_CAP));
}

export function mudTooHigh(p, threshold = 0.35) {
  return (p.status.mud || 0) >= threshold;
}

const PARCEL_REQUIRED_TASKS = new Set([
  TASK_KINDS.PloughPlot,
  TASK_KINDS.HarrowPlot,
  TASK_KINDS.Sow,
  TASK_KINDS.DrillPlot,
  TASK_KINDS.HoeRow,
  TASK_KINDS.CartSheaves,
  TASK_KINDS.CutCloverHay,
  TASK_KINDS.CartHay,
  TASK_KINDS.HarvestParcel,
]);

const MUD_SENSITIVE_TASKS = new Set([
  TASK_KINDS.PloughPlot,
  TASK_KINDS.HarrowPlot,
  TASK_KINDS.Sow,
  TASK_KINDS.DrillPlot,
  TASK_KINDS.CartSheaves,
]);

export function canStartTask(world, task) {
  const p = task.parcelId != null ? world.parcels[task.parcelId] : null;
  if (PARCEL_REQUIRED_TASKS.has(task.kind) && !p) return false;

  switch (task.kind) {
    case TASK_KINDS.PloughPlot:
      return !!p && !mudTooHigh(p);
    case TASK_KINDS.HarrowPlot:
      if (!p || mudTooHigh(p)) return false;
      return p.status.lastPloughedOn != null || (p.status.tilth || 0) >= 0.2;
    case TASK_KINDS.Sow:
      if (!p || mudTooHigh(p)) return false;
      if (!p.rows?.length) return false;
      return p.rows.every(r => !r.crop) && (p.status.tilth || 0) >= 0.2;
    case TASK_KINDS.DrillPlot:
      return !!p && !mudTooHigh(p) && (p.rows?.length || 0) > 0;
    case TASK_KINDS.CutCloverHay:
      return !!p && world.weather.rain_mm <= 0.2;
    case TASK_KINDS.CartHay: {
      if (!p) return false;
      const h = p.hayCuring;
      return !!h && h.dryness >= 1 && world.weather.rain_mm <= 0.2;
    }
    case TASK_KINDS.HoeRow:
      return !!p && !mudTooHigh(p) && p.rows?.some(r => r.crop);
    case TASK_KINDS.HarvestParcel:
      if (!p || !p.rows?.length) return false;
      return p.rows.every(r => r.crop && r.growth >= 1.0);
    case TASK_KINDS.CartSheaves:
      if (!p || mudTooHigh(p)) return false;
      return (p.fieldStore?.sheaves || 0) > 0;
    case TASK_KINDS.StackRicks:
      return Object.values(world.storeSheaves || {}).some(v => v > 0);
    case TASK_KINDS.Thresh:
      return !!world.stackReady && Object.values(world.storeSheaves || {}).some(v => v > 0);
    case TASK_KINDS.CartToMarket: {
      const store = world.store || {};
      const haveGoods = Array.isArray(task.payload)
        ? task.payload.some(item => (item?.qty ?? 0) > 0)
        : Object.values(store).some(value => typeof value === 'number' && value > 0);
      if (!haveGoods) return false;
      const minute = world.calendar.minute ?? 0;
      const daylight = world.daylight || { workStart: 0, workEnd: MINUTES_PER_DAY };
      if (minute < daylight.workStart || minute > daylight.workEnd) return false;
      if (world.weather?.rain_mm > 2 && !world.assets?.coveredCart) return false;
      return true;
    }
    default:
      if (MUD_SENSITIVE_TASKS.has(task.kind) && p && mudTooHigh(p)) return false;
      return true;
  }
}

function scoreTask(world, t) {
  const day = world.calendar.day;
  const slack = Math.max(0, t.latestDay - day);
  let score = (t.priority * 1000) + (100 - Math.min(99, slack));
  if (t.parcelId != null) {
    const parcel = world.parcels?.[t.parcelId];
    if (parcel?.proximity === 'close') score += 2;
  }
  return score;
}

function findTaskById(world, id) {
  return world.tasks.month.active.find(t => t.id === id);
}

function maybeToolBreak(world, task) {
  const heavy = [TASK_KINDS.PloughPlot, TASK_KINDS.HarrowPlot, TASK_KINDS.CartSheaves, TASK_KINDS.CartHay];
  if (!heavy.includes(task.kind)) return false;
  const perHour = 0.008;
  const perMin = 1 - Math.pow(1 - perHour, 1 / 60);
  if (world.rng() < perMin) {
    world.tasks.month.queued.push(makeTask(world, {
      kind: TASK_KINDS.Repair,
      parcelId: null,
      payload: { scope: 'tool_break' },
      latestDay: world.calendar.day + 2,
      estMin: WORK_MINUTES.Repair_perJob,
      priority: 15,
    }));
    (world.alerts = world.alerts || []).push('Tool breakdown → repair queued');
    return true;
  }
  return false;
}

export function planDayMonthly(world) {
  world.tasks.month.queued.sort((a, b) => scoreTask(world, b) - scoreTask(world, a));
  for (let i = 0; i < CREW_SLOTS; i++) {
    if (world.farmer.activeWork[i] != null) continue;
    let task;
    let guard = world.tasks.month.queued.length;
    let foundTask = false;
    while (guard-- > 0) {
      task = world.tasks.month.queued.shift();
      if (canStartTask(world, task)) {
        task.status = 'active';
        world.tasks.month.active.push(task);
        world.farmer.activeWork[i] = task.id;
        foundTask = true;
        break;
      } else {
        world.tasks.month.queued.push(task);
      }
    }
    if (!foundTask) break;
  }
}

export function completeTask(world, task, slotIndex) {
  task.status = 'done';
  applyTaskEffects(world, task);
  world.tasks.month.active = world.tasks.month.active.filter(t => t.id !== task.id);
  world.tasks.month.done.push(task);
  world.farmer.activeWork[slotIndex] = null;
  log(world, `Completed task: ${task.kind}`);
}

export function tickWorkMinute(world) {
  const minute = world.calendar.minute ?? 0;
  const daylight = world.daylight || { workStart: 0, workEnd: MINUTES_PER_DAY };
  if (minute < daylight.workStart || minute > daylight.workEnd) {
    if (world.kpi) world.kpi._workOutsideWindow = true;
    return;
  }

  let needsTopUp = false;
  let needsSync = false;
  for (let s = 0; s < CREW_SLOTS; s++) {
    const id = world.farmer.activeWork[s];
    if (id == null) continue;
    const t = findTaskById(world, id);
    if (!t) {
      world.farmer.activeWork[s] = null;
      needsTopUp = true;
      needsSync = true;
      continue;
    }
    t.doneMin += 1;
    world.labour.usedMin += 1;
    if (maybeToolBreak(world, t)) {
      // optional stochastic repair handled inside maybeToolBreak
    }
    if (t.doneMin >= t.estMin) {
      completeTask(world, t, s);
      needsTopUp = true;
      needsSync = true;
    }
  }

  if (needsTopUp) {
    if (topUpActiveSlots(world)) needsSync = true;
  }
  if (needsSync) syncFarmerToActive(world);
}

function topUpActiveSlots(world) {
  let assigned = false;
  for (let s = 0; s < CREW_SLOTS; s++) {
    if (world.farmer.activeWork[s]) continue;

    let task;
    let found = false;
    const pools = [world.tasks.month.overdue, world.tasks.month.queued];

    for (const pool of pools) {
      pool.sort((a, b) => scoreTask(world, b) - scoreTask(world, a));
      let guard = pool.length;
      while (guard-- > 0) {
        task = pool.shift();
        if (!task) continue;
        if (canStartTask(world, task)) {
          task.status = 'active';
          world.tasks.month.active.push(task);
          world.farmer.activeWork[s] = task.id;
          found = true;
          assigned = true;
          break;
        }
        pool.push(task);
      }
      if (found) break;
    }
  }
  return assigned;
}

export function endOfDayMonth(world) {
  const day = world.calendar.day;
  for (const t of world.tasks.month.queued) {
    if (t.latestDay < day && t.status === 'queued') {
      t.status = 'overdue';
      world.tasks.month.overdue.push(t);
    }
  }
  for (const t of world.tasks.month.overdue) t.priority = Math.max(t.priority, 20);
  world.tasks.month.queued = world.tasks.month.queued.filter(t => t.status === 'queued');
}

export function monthHudInfo(world) {
  const u = world.labour.usedMin;
  const b = world.labour.monthBudgetMin;
  const q = world.tasks.month.queued.length;
  const a = world.tasks.month.active.length;
  const o = world.tasks.month.overdue.length;
  const next = world.tasks.month.queued[0];
  const nextTxt = next ? `${next.kind} d${next.latestDay}` : '—';
  return { u, b, q, a, o, nextTxt };
}

export function hasActiveWork(world) {
  return world?.farmer?.activeWork?.some(Boolean) ?? false;
}

export function syncFarmerToActive(world) {
  const farmer = world.farmer;
  if (!farmer) return;

  const firstActiveId = farmer.activeWork.find(Boolean);
  if (!firstActiveId) {
    farmer.task = world.tasks.month.queued.length ? 'Waiting for conditions' : 'Idle';
    farmer.queue = [];
    farmer.moveTarget = null;
    farmer.path = [];
    return;
  }

  const activeTask = world.tasks.month.active.find(t => t.id === firstActiveId);
  if (!activeTask) {
    farmer.task = 'Overseeing non-field task';
    farmer.queue = [];
    farmer.moveTarget = null;
    farmer.path = [];
    return;
  }

  if (activeTask.kind === TASK_KINDS.CartToMarket) {
    const farmhouse = world.farmhouse ?? { x: farmer.x, y: farmer.y };
    const yard = world.locations?.yard ?? farmhouse;
    const marketDefault = { x: yard.x + 200, y: yard.y + 50 };
    const market = world.locations?.market ?? marketDefault;
    farmer.queue = [
      { type: 'move', x: yard.x, y: yard.y },
      { type: 'move', x: market.x, y: market.y },
      { type: 'move', x: yard.x, y: yard.y },
    ];
    farmer.moveTarget = null;
    farmer.path = [];
    farmer.task = 'Cart to Market';
    return;
  }

  if (activeTask.parcelId == null) {
    const farmhouse = world.farmhouse ?? { x: farmer.x, y: farmer.y };
    const yard = world.locations?.yard ?? farmhouse;
    farmer.queue = [{ type: 'move', x: yard.x, y: yard.y }];
    farmer.moveTarget = null;
    farmer.path = [];
    farmer.task = `Working: ${activeTask.kind}`;
    return;
  }

  const parcel = world.parcels[activeTask.parcelId];
  if (!parcel) {
    farmer.queue = [];
    farmer.moveTarget = null;
    farmer.path = [];
    farmer.task = `Missing parcel ${activeTask.parcelId}`;
    return;
  }

  farmer.queue = [{ type: 'move', x: parcel.x + 2, y: parcel.y + 2 }];
  farmer.moveTarget = null;
  farmer.path = [];
  const parcelName = parcel.name ?? parcel.key;
  farmer.task = `Overseeing: ${activeTask.kind} @ ${parcelName}`;
}

export function processFarmerMinute(world) {
  const farmer = world.farmer;
  if (!farmer || !Array.isArray(farmer.queue) || farmer.queue.length === 0) return;

  const tgt = farmer.queue[0];
  const dx = Math.sign(tgt.x - farmer.x);
  const dy = Math.sign(tgt.y - farmer.y);
  farmer.x += dx;
  farmer.y += dy;

  if (farmer.x === tgt.x && farmer.y === tgt.y) {
    farmer.queue.shift();
  }
}
