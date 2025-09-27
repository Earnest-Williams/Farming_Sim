import {
  TASK_KINDS,
  WORK_MINUTES,
} from './constants.js';
import { updateFieldCrop, updateFieldPhase, moveLivestock, findField } from './world.js';

export const RATES = Object.freeze({
  plough_ac_per_hour: 0.8,
  harrow_ac_per_hour: 1.2,
  drill_ac_per_hour: 1.0,
  hoe_ac_per_hour: 2.0,
  hay_cut_ac_per_hour: 1.0,
  cart_market_hours: 4,
  garden_hours: 6,
});

export const OATS_LOW_THRESHOLD = 20;

let jobCounter = 0;

function nextId(prefix) {
  jobCounter += 1;
  return `${prefix}-${jobCounter}`;
}

function hoursFor(acres, rate) {
  if (!rate || rate <= 0) return 0;
  return acres / rate;
}

function createFieldJob(kind, field, options = {}) {
  const { crop = null, rate, nextPhase, prerequisites = [], description } = options;
  const hours = options.hours ?? hoursFor(field.acres, rate);
  const opLabel = description ?? kind.replace(/_/g, ' ');
  return {
    id: nextId(kind),
    kind,
    field: field.key,
    operation: opLabel,
    acres: field.acres,
    crop,
    hours,
    prerequisites,
    canApply(world) {
      const parcel = findField(world, field.key);
      if (!parcel) {
        if (kind === 'garden_plant' || kind === 'cart_market' || kind === 'move_livestock') {
          return true;
        }
        return false;
      }
      if (kind === 'plough') return parcel.phase === 'needs_plough';
      if (kind === 'harrow') return parcel.phase === 'ploughed';
      if (kind === 'sow') return ['ploughed', 'harrowed', 'ready_to_sow'].includes(parcel.phase);
      if (kind === 'hoe_first') return parcel.phase === 'sown' || parcel.phase === 'growing';
      if (kind === 'hay_cut') return parcel.phase === 'growing';
      if (kind === 'cart_market') return true;
      if (kind === 'garden_plant') return true;
      if (kind === 'move_livestock') return true;
      return true;
    },
    apply(world) {
      if (kind === 'plough') {
        updateFieldPhase(world, field.key, nextPhase ?? 'ploughed');
      } else if (kind === 'harrow') {
        updateFieldPhase(world, field.key, nextPhase ?? 'harrowed');
      } else if (kind === 'sow') {
        updateFieldPhase(world, field.key, nextPhase ?? 'sown');
        if (crop) updateFieldCrop(world, field.key, crop);
      } else if (kind === 'hoe_first') {
        updateFieldPhase(world, field.key, nextPhase ?? 'weeded_once');
      } else if (kind === 'hay_cut') {
        updateFieldPhase(world, field.key, nextPhase ?? 'cut_for_hay');
      } else if (kind === 'garden_plant') {
        updateFieldPhase(world, field.key, nextPhase ?? 'planted');
      } else if (kind === 'move_livestock') {
        moveLivestock(world, options.animal, options.to);
      }
      return world;
    },
  };
}

export function plough(field) {
  return createFieldJob('plough', field, {
    rate: RATES.plough_ac_per_hour,
    nextPhase: 'ploughed',
    prerequisites: ['Team: horses or oxen', 'Plough ready'],
    description: 'Plough',
  });
}

export function harrow(field) {
  return createFieldJob('harrow', field, {
    rate: RATES.harrow_ac_per_hour,
    nextPhase: 'harrowed',
    prerequisites: ['Horses or oxen', 'Harrow tool'],
    description: 'Harrow',
  });
}

export function sow(field, crop) {
  return createFieldJob('sow', field, {
    rate: RATES.drill_ac_per_hour,
    nextPhase: 'sown',
    crop,
    prerequisites: [`Seed: ${crop}`],
    description: `Sow ${crop}`,
  });
}

export function hoe(field) {
  return createFieldJob('hoe_first', field, {
    rate: RATES.hoe_ac_per_hour,
    nextPhase: 'weeded_once',
    prerequisites: ['Hand tools'],
    description: 'First hoeing',
  });
}

export function hayCut(field) {
  return createFieldJob('hay_cut', field, {
    rate: RATES.hay_cut_ac_per_hour,
    nextPhase: 'cut_for_hay',
    prerequisites: ['Scythes ready'],
    description: 'Cut hay',
  });
}

export function gardenPlant(parcelKey, crops) {
  const pseudoField = { key: parcelKey, acres: 0.25 };
  return createFieldJob('garden_plant', pseudoField, {
    hours: RATES.garden_hours,
    nextPhase: 'planted',
    prerequisites: crops.map((c) => `Seedlings: ${c}`),
    description: `Plant garden (${crops.join(', ')})`,
  });
}

export function moveSheep(from, to) {
  const pseudoField = { key: from, acres: 0 };
  return createFieldJob('move_livestock', pseudoField, {
    hours: 1,
    nextPhase: null,
    prerequisites: [`Sheep at ${from}`],
    description: `Move sheep to ${to}`,
    animal: 'sheep',
    to,
  });
}

export function cartToMarket() {
  const pseudoField = { key: 'market', acres: 0 };
  return createFieldJob('cart_market', pseudoField, {
    hours: RATES.cart_market_hours,
    prerequisites: ['Cart team ready', 'Goods loaded'],
    description: 'Cart to market',
  });
}

export function shouldGoToMarket(world) {
  const lowOats = (world?.stores?.oats_bu ?? 0) < OATS_LOW_THRESHOLD;
  const surplus = (world?.stores?.barley_bu ?? 0) > 280 || (world?.stores?.beans_bu ?? 0) > 140;
  const parcels = [...(world?.fields ?? []), ...(world?.closes ?? [])];
  const pendingSeed = parcels.some((f) => f.phase === 'needs_seed');
  return Boolean(lowOats || surplus || pendingSeed);
}

function nextTaskId(world) {
  world.nextTaskId = (world.nextTaskId ?? 0) + 1;
  return world.nextTaskId;
}

const MINUTE = 1;

function acres(parcel) {
  return parcel?.acres ?? 0;
}

function rows(parcel) {
  return parcel?.rows?.length ?? 0;
}

function clampMinutes(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function sortTasksByPriority(list) {
  if (!Array.isArray(list) || list.length <= 1) return;
  list.sort((a, b) => {
    const pr = (b.priority ?? 0) - (a.priority ?? 0);
    if (pr !== 0) return pr;
    const due = (a.latestDay ?? 99) - (b.latestDay ?? 99);
    if (due !== 0) return due;
    return (a.id ?? 0) - (b.id ?? 0);
  });
}

function defaultTaskFields(world, spec) {
  return {
    id: nextTaskId(world),
    kind: spec.kind,
    parcelId: spec.parcelId ?? null,
    payload: spec.payload ?? null,
    latestDay: spec.latestDay ?? 20,
    estMin: clampMinutes(spec.estMin ?? 0),
    doneMin: clampMinutes(spec.doneMin ?? 0),
    priority: spec.priority ?? 0,
    status: spec.status ?? 'queued',
  };
}

export function makeTask(world, spec) {
  if (!world || !spec || !spec.kind) {
    throw new Error('makeTask requires a world and task specification');
  }
  const task = defaultTaskFields(world, spec);
  return task;
}

export function minutesFor(kind, parcel, payload = {}) {
  switch (kind) {
    case TASK_KINDS.PloughPlot:
      return clampMinutes(acres(parcel) * WORK_MINUTES.PloughPlot_perAcre);
    case TASK_KINDS.HarrowPlot:
      return clampMinutes(acres(parcel) * WORK_MINUTES.HarrowPlot_perAcre);
    case TASK_KINDS.DrillPlot:
      return clampMinutes(acres(parcel) * WORK_MINUTES.DrillPlot_perAcre);
    case TASK_KINDS.Sow: {
      const rowCount = rows(parcel) || Math.max(1, Math.round(acres(parcel) * 2));
      return clampMinutes(rowCount * WORK_MINUTES.Sow_perRow);
    }
    case TASK_KINDS.HoeRow: {
      const rowCount = rows(parcel) || Math.max(1, Math.round(acres(parcel) * 2));
      return clampMinutes(rowCount * WORK_MINUTES.HoeRow_perRow);
    }
    case TASK_KINDS.CartSheaves:
      return clampMinutes(Math.max(acres(parcel), 1) * WORK_MINUTES.CartSheaves_perAcre);
    case TASK_KINDS.StackRicks:
      return clampMinutes(Math.max(acres(parcel), 1) * WORK_MINUTES.StackRicks_perAcre);
    case TASK_KINDS.Thresh: {
      const qty = payload.bushels ?? payload.qty ?? 1;
      return clampMinutes(Math.max(1, qty) * WORK_MINUTES.Thresh_perBushel);
    }
    case TASK_KINDS.Winnow: {
      const qty = payload.bushels ?? payload.qty ?? 1;
      return clampMinutes(Math.max(1, qty) * WORK_MINUTES.Winnow_perBushel);
    }
    case TASK_KINDS.SpreadManure:
      return clampMinutes(Math.max(acres(parcel), 1) * WORK_MINUTES.SpreadManure_perAcre);
    case TASK_KINDS.FoldSheep:
      return clampMinutes(WORK_MINUTES.FoldSheep_setup + Math.max(0, (payload.days ?? 0) - 1) * 10);
    case TASK_KINDS.MoveHerd:
      return clampMinutes(WORK_MINUTES.MoveHerd_flat);
    case TASK_KINDS.Prune: {
      const treeCount = payload.trees ?? Math.max(1, Math.round(acres(parcel) * 18));
      return clampMinutes(treeCount * WORK_MINUTES.Prune_perTree);
    }
    case TASK_KINDS.Repair:
      return clampMinutes(WORK_MINUTES.Repair_perJob);
    case TASK_KINDS.Slaughter:
      return clampMinutes(Math.max(1, payload.count ?? 1) * WORK_MINUTES.Slaughter_perHead);
    case TASK_KINDS.ClampRoots:
      return clampMinutes(Math.max(1, payload.tons ?? payload.qty ?? 1) * WORK_MINUTES.ClampRoots_perTon);
    case TASK_KINDS.GardenSow: {
      const beds = payload.items?.length ?? 1;
      return clampMinutes(Math.max(1, beds) * WORK_MINUTES.GardenSow_perBed);
    }
    case TASK_KINDS.HarvestParcel:
      return clampMinutes(Math.max(acres(parcel), 1) * WORK_MINUTES.HarvestParcel_perAcre);
    case TASK_KINDS.CutCloverHay:
      return clampMinutes(Math.max(acres(parcel), 1) * WORK_MINUTES.CutCloverHay_perAcre);
    case TASK_KINDS.OrchardHarvest:
      return clampMinutes(Math.max(acres(parcel), 1) * WORK_MINUTES.OrchardHarvest_perAcre);
    case TASK_KINDS.CartHay:
      return clampMinutes(Math.max(acres(parcel), 1) * WORK_MINUTES.CartHay_perAcre);
    case TASK_KINDS.CartToMarket:
      return clampMinutes(WORK_MINUTES.CartToMarket);
    default:
      return clampMinutes(WORK_MINUTES.Repair_perJob);
  }
}

function ensureTaskContainers(world) {
  if (!world.tasks) world.tasks = { month: { queued: [], active: [], done: [], overdue: [] } };
  if (!world.tasks.month) world.tasks.month = { queued: [], active: [], done: [], overdue: [] };
  const month = world.tasks.month;
  month.queued = Array.isArray(month.queued) ? month.queued : [];
  month.active = Array.isArray(month.active) ? month.active : [];
  month.done = Array.isArray(month.done) ? month.done : [];
  month.overdue = Array.isArray(month.overdue) ? month.overdue : [];
  return month;
}

function completeTask(world, task) {
  const month = world.tasks.month;
  const idx = month.active.findIndex((t) => t.id === task.id);
  if (idx !== -1) month.active.splice(idx, 1);
  task.doneMin = Math.max(task.estMin ?? 0, task.doneMin ?? 0);
  task.status = 'done';
  task._completedAtMinute = world.calendar?.minute ?? 0;
  month.done.push(task);
  if (Array.isArray(world.farmer?.activeWork)) {
    for (let i = 0; i < world.farmer.activeWork.length; i += 1) {
      if (world.farmer.activeWork[i] === task.id) {
        world.farmer.activeWork[i] = null;
      }
    }
  }
}

export function planDayMonthly(world) {
  if (!world) return;
  const month = ensureTaskContainers(world);
  const slots = Math.max(1, world.labour?.crewSlots ?? world.farmer?.activeWork?.length ?? 1);

  for (let i = month.active.length - 1; i >= 0; i -= 1) {
    const task = month.active[i];
    if ((task.doneMin ?? 0) >= (task.estMin ?? 0)) {
      completeTask(world, task);
    }
  }

  sortTasksByPriority(month.queued);

  while (month.active.length > slots) {
    const task = month.active.pop();
    if (!task) break;
    task.status = 'queued';
    month.queued.push(task);
  }

  sortTasksByPriority(month.queued);

  while (month.active.length < slots && month.queued.length > 0) {
    const task = month.queued.shift();
    task.status = 'active';
    task.startedAt = {
      day: world.calendar?.day ?? 1,
      month: world.calendar?.month ?? 1,
    };
    month.active.push(task);
  }

  world.farmer.task = month.active.length ? month.active[0].kind : null;
}

export function syncFarmerToActive(world) {
  if (!world?.farmer) return;
  ensureTaskContainers(world);
  const slots = Math.max(1, world.labour?.crewSlots ?? world.farmer?.activeWork?.length ?? 1);
  const active = world.tasks.month.active;
  if (!Array.isArray(world.farmer.activeWork) || world.farmer.activeWork.length !== slots) {
    world.farmer.activeWork = Array.from({ length: slots }, () => null);
  }
  for (let i = 0; i < world.farmer.activeWork.length; i += 1) {
    world.farmer.activeWork[i] = active[i]?.id ?? null;
  }
  world.farmer.queue = Array.isArray(world.farmer.queue) ? world.farmer.queue : [];
  world.farmer.task = active.length ? active[0].kind : null;
}

export function hasActiveWork(world) {
  return Boolean(world?.tasks?.month?.active?.length);
}

export function tickWorkMinute(world) {
  if (!world?.farmer) return;
  ensureTaskContainers(world);
  const active = world.tasks.month.active;
  if (!active.length) return;
  const slotIds = Array.isArray(world.farmer.activeWork) ? world.farmer.activeWork : [];
  const map = new Map(active.map((t) => [t.id, t]));
  const completed = new Set();
  for (let i = 0; i < slotIds.length; i += 1) {
    const id = slotIds[i];
    if (id == null) continue;
    const task = map.get(id);
    if (!task) {
      slotIds[i] = null;
      continue;
    }
    task.doneMin = (task.doneMin ?? 0) + MINUTE;
    world.labour.usedMin = (world.labour.usedMin ?? 0) + MINUTE;
    if ((task.doneMin ?? 0) >= (task.estMin ?? 0)) {
      completed.add(task.id);
    }
  }
  if (completed.size > 0) {
    active
      .filter((task) => completed.has(task.id))
      .forEach((task) => completeTask(world, task));
    planDayMonthly(world);
    syncFarmerToActive(world);
  }
}

export function sendFarmerHome(world) {
  if (!world?.farmer) return;
  world.farmer.queue = [];
  world.farmer.task = null;
}

export function endOfDayMonth(world) {
  if (!world) return;
  const month = ensureTaskContainers(world);
  const day = world.calendar?.day ?? 1;
  for (let i = month.queued.length - 1; i >= 0; i -= 1) {
    const task = month.queued[i];
    const due = task.latestDay ?? 20;
    if (due < day) {
      month.queued.splice(i, 1);
      task.status = 'overdue';
      month.overdue.push(task);
    }
  }
  for (let i = month.active.length - 1; i >= 0; i -= 1) {
    const task = month.active[i];
    const due = task.latestDay ?? 20;
    if (due < day && task.status !== 'done') {
      task.status = 'overdue';
      month.overdue.push(task);
      month.active.splice(i, 1);
    }
  }
}

export function moistureToMud(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0.4) return 0;
  if (value >= 0.9) return 1;
  return (value - 0.4) / 0.5;
}

export function processFarmerHalfStep(world) {
  if (!world?.farmer?.queue?.length) return null;
  const step = world.farmer.queue.shift();
  if (!step) return null;
  if (typeof step.x === 'number') world.farmer.x = step.x;
  if (typeof step.y === 'number') world.farmer.y = step.y;
  return step;
}
