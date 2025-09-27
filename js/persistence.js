import { makeWorld, kpiInit, createPathfindingGrid } from './world.js';
import { CROPS } from './constants.js';

const SAVE_VERSION = 1;

function serializeTask(world, t) {
  return {
    id: t.id,
    kind: t.kind,
    parcelKey: t.parcelId != null ? world.parcels[t.parcelId].key : null,
    payload: t.payload ?? null,
    latestDay: t.latestDay,
    estMin: t.estMin,
    doneMin: t.doneMin,
    priority: t.priority,
    status: t.status,
  };
}

export function toSnapshot(world) {
  return {
    version: SAVE_VERSION,
    seed: world.seed,
    rngState: world.rng.state(),
    calendar: { month: world.calendar.month, day: world.calendar.day, year: world.calendar.year ?? 1, minute: world.calendar.minute },
    labour: { usedMin: world.labour.usedMin, monthBudgetMin: world.labour.monthBudgetMin, crewSlots: world.labour.crewSlots },
    parcels: world.parcels.map(p => ({
      key: p.key,
      soil: p.soil,
      status: p.status,
      rows: (p.rows || []).map(r => ({
        crop: r.crop?.key ?? null,
        companion: r.companion?.key ?? null,
        growth: r.growth,
        moisture: r.moisture,
        weed: r.weed,
        plantedOn: r.plantedOn,
      })),
      fieldStore: p.fieldStore,
      pasture: p.pasture ?? null,
      hayCuring: p.hayCuring ?? null,
    })),
    store: world.store,
    storeSheaves: world.storeSheaves,
    stackReady: world.stackReady ?? false,
    livestock: world.livestock,
    herdLoc: world.herdLoc,
    weather: world.weather,
    tasks: {
      queued: world.tasks.month.queued.map(t => serializeTask(world, t)),
      active: world.tasks.month.active.map(t => serializeTask(world, t)),
      done: world.tasks.month.done.map(t => serializeTask(world, t)),
      overdue: world.tasks.month.overdue.map(t => serializeTask(world, t)),
      activeWork: Array.isArray(world.farmer?.activeWork) ? [...world.farmer.activeWork] : [],
    },
    nextTaskId: world.nextTaskId ?? 1,
    flexChoice: world.flexChoice ?? null,
    cash: world.cash ?? 0,
    advisor: world.advisor ?? { enabled: true, mode: 'auto' },
  };
}

export function fromSnapshot(snap) {
  if (snap.version !== SAVE_VERSION) {
    console.warn('Save version mismatch.');
    return makeWorld();
  }
  const world = makeWorld(snap.seed);
  world.pathGrid = createPathfindingGrid();
  world.rng.set(snap.rngState);
  world.calendar = { ...snap.calendar };
  world.labour = { ...snap.labour };
  const parcelMap = {};
  world.parcels.forEach(p => parcelMap[p.key] = p);
  snap.parcels.forEach(sp => {
    const p = parcelMap[sp.key];
    if (p) {
      Object.assign(p.soil, sp.soil);
      Object.assign(p.status, sp.status);
      p.rows = (sp.rows || []).map(r => ({
        crop: r.crop ? CROPS[r.crop] : null,
        companion: r.companion ? CROPS[r.companion] : null,
        growth: r.growth,
        moisture: r.moisture,
        weed: r.weed,
        plantedOn: r.plantedOn,
      }));
      p.fieldStore = { ...(sp.fieldStore || { sheaves: 0, cropKey: null }) };
      p.pasture = sp.pasture ? { ...sp.pasture } : null;
      p.hayCuring = sp.hayCuring ? { ...sp.hayCuring } : null;
    }
  });
  world.store = { ...snap.store };
  world.storeSheaves = { ...snap.storeSheaves };
  world.stackReady = !!snap.stackReady;
  world.livestock = { ...snap.livestock };
  world.herdLoc = { ...snap.herdLoc };
  world.weather = { ...snap.weather };
  world.nextTaskId = snap.nextTaskId ?? 1;
  const inflate = (st) => st.map(t => ({
    id: t.id,
    kind: t.kind,
    parcelId: t.parcelKey != null ? world.parcelByKey[t.parcelKey] : null,
    payload: t.payload,
    latestDay: t.latestDay,
    estMin: t.estMin,
    doneMin: t.doneMin,
    priority: t.priority,
    status: t.status,
  }));
  world.tasks = { month: {
    queued: inflate(snap.tasks.queued),
    active: inflate(snap.tasks.active),
    done: inflate(snap.tasks.done),
    overdue: inflate(snap.tasks.overdue),
  } };
  const savedActiveWork = Array.isArray(snap.tasks?.activeWork) ? snap.tasks.activeWork : [];
  const slotCount = world.labour?.crewSlots ?? (world.farmer?.activeWork?.length ?? 0);
  world.farmer.activeWork = Array.from({ length: slotCount }, () => null);
  const activeIds = new Set(world.tasks.month.active.map(t => t.id));
  const queuedIds = new Set(world.tasks.month.queued.map(t => t.id));
  for (let i = 0; i < Math.min(slotCount, savedActiveWork.length); i++) {
    const id = savedActiveWork[i];
    if (id == null) continue;
    if (activeIds.has(id)) {
      world.farmer.activeWork[i] = id;
    }
  }
  const assignedIds = new Set(world.farmer.activeWork.filter(id => id != null));
  const stillActive = [];
  for (const task of world.tasks.month.active) {
    if (assignedIds.has(task.id)) {
      stillActive.push(task);
    } else {
      task.status = 'queued';
      world.tasks.month.queued.push(task);
      queuedIds.add(task.id);
    }
  }
  world.tasks.month.active = stillActive;
  const ensureQueued = (id) => {
    if (id == null || assignedIds.has(id) || queuedIds.has(id)) return;
    const idx = world.tasks.month.overdue.findIndex(t => t.id === id);
    if (idx !== -1) {
      const [task] = world.tasks.month.overdue.splice(idx, 1);
      task.status = 'queued';
      world.tasks.month.queued.push(task);
      queuedIds.add(task.id);
    }
  };
  for (let i = 0; i < savedActiveWork.length; i++) {
    ensureQueued(savedActiveWork[i]);
  }
  world.flexChoice = snap.flexChoice ?? null;
  world.cash = snap.cash ?? 0;
  world.advisor = snap.advisor ?? { enabled: true, mode: 'auto' };
  kpiInit(world);
  return world;
}

export function saveToLocalStorage(world, key = 'farmSave') {
  const json = JSON.stringify(toSnapshot(world));
  localStorage.setItem(key, json);
  return true;
}

export function loadFromLocalStorage(key = 'farmSave') {
  const json = localStorage.getItem(key);
  if (!json) return null;
  try {
    const snap = JSON.parse(json);
    return fromSnapshot(snap);
  } catch (e) {
    console.error('Failed to load save:', e);
    return null;
  }
}

export function downloadSave(world, filename = 'farm_save.json') {
  const blob = new Blob([JSON.stringify(toSnapshot(world), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function makeAutosave(world) {
  world.autosave = world.autosave || { ring: [], max: 10 };
}

export function autosave(world) {
  makeAutosave(world);
  const snap = toSnapshot(world);
  world.autosave.ring.push(snap);
  if (world.autosave.ring.length > world.autosave.max) world.autosave.ring.shift();
}

export function rollback(world, steps = 1) {
  makeAutosave(world);
  const idx = Math.max(0, world.autosave.ring.length - 1 - steps);
  const snap = world.autosave.ring[idx];
  return snap ? fromSnapshot(snap) : world;
}
