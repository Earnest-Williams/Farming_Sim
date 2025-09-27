import { CALENDAR, resetTime, getSimTime } from './time.js';

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
  }
  return Object.freeze(value);
}

export const FIELDS = freezeDeep([
  { key: 'turnips', acres: 8, crop: 'fallow', phase: 'stubble_manured' },
  { key: 'barley_clover', acres: 8, crop: 'bare', phase: 'needs_plough' },
  { key: 'clover_hay', acres: 8, crop: 'clover', phase: 'growing' },
  { key: 'wheat', acres: 8, crop: 'winter_wheat', phase: 'tillering' },
  { key: 'beans_peas', acres: 8, crop: 'bare', phase: 'needs_plough' },
  { key: 'flex', acres: 8, crop: 'bare', phase: 'decision_pending' },
]);

export const CLOSES = freezeDeep([
  { key: 'A_oats', acres: 3, crop: 'bare', phase: 'ready_to_sow' },
  { key: 'B_legume', acres: 3, crop: 'bare', phase: 'idle' },
  { key: 'C_roots', acres: 3, crop: 'bare', phase: 'plant_in_SpringII' },
]);

export const LIVESTOCK = freezeDeep({
  horses: 2,
  oxen: 2,
  cows: 2,
  bull: 1,
  sheep: 36,
  geese: 16,
  poultry: 24,
  where: {
    sheep: 'clover_hay',
    horses: 'byre',
    oxen: 'byre',
    cows: 'byre',
    geese: 'orchard',
    poultry: 'yard',
  },
});

export const STORES = freezeDeep({
  wheat_bu: 180,
  barley_bu: 250,
  beans_bu: 120,
  oats_bu: 60,
  hay_t: 12,
  roots_t: 2.5,
  wood_cords: 4,
});

const WORLD_TEMPLATE = freezeDeep({
  calendar: { month: CALENDAR.MONTHS[0], monthIndex: 0, day: 1, minute: 0, year: 1 },
  fields: FIELDS,
  closes: CLOSES,
  livestock: LIVESTOCK,
  stores: STORES,
});

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

export function createInitialWorld() {
  resetTime();
  const world = clone(WORLD_TEMPLATE);
  world.fields = world.fields.map((f) => ({ ...f }));
  world.closes = world.closes.map((c) => ({ ...c }));
  world.livestock = clone(WORLD_TEMPLATE.livestock);
  world.stores = { ...WORLD_TEMPLATE.stores };
  world.calendar = { ...WORLD_TEMPLATE.calendar, ...getSimTime() };
  world.labour = { used: 0, budget: null };
  world.completedJobs = [];
  return world;
}

export function cloneWorld(world) {
  const copy = clone(world);
  copy.fields = world.fields.map((f) => ({ ...f }));
  copy.closes = world.closes.map((c) => ({ ...c }));
  copy.livestock = clone(world.livestock);
  copy.stores = { ...world.stores };
  copy.calendar = { ...world.calendar };
  copy.labour = { ...world.labour };
  copy.completedJobs = Array.isArray(world.completedJobs) ? [...world.completedJobs] : [];
  return copy;
}

export function findField(world, key) {
  return world.fields.find((f) => f.key === key) || world.closes.find((c) => c.key === key) || null;
}

export function updateFieldPhase(world, key, phase) {
  const parcel = findField(world, key);
  if (!parcel) return null;
  parcel.phase = phase;
  return parcel;
}

export function updateFieldCrop(world, key, crop) {
  const parcel = findField(world, key);
  if (!parcel) return null;
  parcel.crop = crop;
  return parcel;
}

export function moveLivestock(world, kind, destination) {
  if (!world.livestock?.where) {
    world.livestock = { ...world.livestock, where: { ...WORLD_TEMPLATE.livestock.where } };
  }
  world.livestock.where = { ...world.livestock.where, [kind]: destination };
  return world.livestock.where[kind];
}

export function recordJobCompletion(world, job) {
  if (!Array.isArray(world.completedJobs)) {
    world.completedJobs = [];
  }
  world.completedJobs.push({ id: job.id, kind: job.kind, field: job.field ?? null });
  return world.completedJobs;
}
