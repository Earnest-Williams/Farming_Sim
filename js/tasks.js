import { log } from './utils.js';
import { TASK_KINDS, WORK_MINUTES, ACRES, ROWS, CREW_SLOTS, SOIL } from './constants.js';
import { applyTaskEffects } from './state.js';

export function makeTask(world, spec) {
  return {
    id: world.nextTaskId++,
    kind: spec.kind,
    parcelId: spec.parcelId ?? null,
    payload: spec.payload || null,
    latestDay: spec.latestDay ?? 20,
    estMin: spec.estMin,
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
    case TASK_KINDS.CartToMarket: return WORK_MINUTES.CartToMarket;
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

  if (MUD_SENSITIVE_TASKS.has(task.kind) && mudTooHigh(p)) return false;

  switch (task.kind) {
    case TASK_KINDS.PloughPlot:
      return true;
    case TASK_KINDS.HarrowPlot:
      return p.status.lastPloughedOn != null || (p.status.tilth || 0) >= 0.2;
    case TASK_KINDS.Sow:
      if (!p.rows?.length) return false;
      return p.rows.every(r => !r.crop) && (p.status.tilth || 0) >= 0.2;
    case TASK_KINDS.DrillPlot:
      return (p.rows?.length || 0) > 0;
    case TASK_KINDS.CutCloverHay:
      return world.weather.rain_mm <= 0.2;
    case TASK_KINDS.CartHay: {
      const h = p.hayCuring;
      return !!h && h.dryness >= 1 && world.weather.rain_mm <= 0.2;
    }
    case TASK_KINDS.HoeRow:
      return !!p.rows?.some(r => r.crop);
    case TASK_KINDS.HarvestParcel:
      if (!p.rows?.length) return false;
      return p.rows.every(r => r.crop && r.growth >= 1.0);
    case TASK_KINDS.CartSheaves:
      return (p.fieldStore?.sheaves || 0) > 0;
    case TASK_KINDS.StackRicks:
      return Object.values(world.storeSheaves || {}).some(v => v > 0);
    case TASK_KINDS.Thresh:
      return !!world.stackReady && Object.values(world.storeSheaves || {}).some(v => v > 0);
    default:
      return true;
  }
}

function scoreTask(world, t) {
  const day = world.calendar.day;
  const slack = Math.max(0, t.latestDay - day);
  return (t.priority * 1000) + (100 - Math.min(99, slack));
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
  let needsTopUp = false;
  for (let s = 0; s < CREW_SLOTS; s++) {
    const id = world.farmer.activeWork[s];
    if (id == null) continue;
    const t = findTaskById(world, id);
    if (!t) {
      world.farmer.activeWork[s] = null;
      needsTopUp = true;
      continue;
    }
    t.doneMin += 1;
    world.labour.usedMin += 1;
    if (maybeToolBreak(world, t)) {
      // tool break handled
    }
    if (t.doneMin >= t.estMin) {
      completeTask(world, t, s);
      needsTopUp = true;
    }
  }

  if (!needsTopUp) return;

  for (let s = 0; s < CREW_SLOTS; s++) {
    if (world.farmer.activeWork[s] != null) continue;
    let task;
    let foundAndAssigned = false;
    const pools = [world.tasks.month.overdue, world.tasks.month.queued];
    for (const pool of pools) {
      pool.sort((a, b) => scoreTask(world, b) - scoreTask(world, a));
      let guard = pool.length;
      while (guard-- > 0) {
        task = pool.shift();
        if (canStartTask(world, task)) {
          task.status = 'active';
          world.tasks.month.active.push(task);
          world.farmer.activeWork[s] = task.id;
          foundAndAssigned = true;
          break;
        } else {
          pool.push(task);
        }
      }
      if (foundAndAssigned) break;
    }
  }
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
