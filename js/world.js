import { resetTime, getSimTime } from './time.js';
import {
  CONFIG,
  LIVESTOCK_START,
  CROPS,
  PARCEL_KIND,
  ROWS_FOR_ACRES,
  CREW_SLOTS,
  LABOUR_BUDGET_MIN,
} from './constants.js';
import { DEFAULT_PACK_V1 } from './config/default-pack.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { DEFAULT_LIVESTOCK_LOCATIONS, INITIAL_HERD_LOCATIONS } from './config/animals.js';
import { stageNow } from './rotation.js';
import {
  SEED_CONFIGS,
  ARABLE_PLANTS,
  ALIAS_TO_PLANT_ID,
  getPlantById,
} from './config/plants.js';
import { findParcelMeta } from './estate.js';
import { makeRng } from './utils.js';
import { createGrid } from './pathfinding.js';

export const SCREEN_W = CONFIG.SCREEN.W;
export const SCREEN_H = CONFIG.SCREEN.H;
export const HOUSE = Object.freeze({ ...CONFIG.HOUSE });
export const BYRE = Object.freeze({ ...CONFIG_PACK_V1.estate.byre });
export const WELL = Object.freeze({ ...CONFIG.WELL });

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
  }
  return Object.freeze(value);
}

export const FIELDS = freezeDeep([
  { key: 'field_1', acres: 8, crop: 'fallow', phase: 'stubble_manured' },
  { key: 'field_2', acres: 8, crop: 'bare', phase: 'needs_plough' },
  { key: 'field_3', acres: 8, crop: 'clover', phase: 'growing' },
  { key: 'field_4', acres: 8, crop: 'winter_wheat', phase: 'tillering' },
  { key: 'field_5', acres: 8, crop: 'bare', phase: 'needs_plough' },
  { key: 'field_6', acres: 8, crop: 'bare', phase: 'decision_pending' },
]);

export const CLOSES = freezeDeep([
  { key: 'close_1', acres: 3, crop: 'bare', phase: 'ready_to_sow' },
  { key: 'close_2', acres: 3, crop: 'bare', phase: 'idle' },
  { key: 'close_3', acres: 3, crop: 'bare', phase: 'plant_in_SpringII' },
]);

const LIVESTOCK_DEFAULT_WHERE = Object.fromEntries(Object.entries(DEFAULT_LIVESTOCK_LOCATIONS));

export const LIVESTOCK = freezeDeep({
  ...LIVESTOCK_START,
  where: LIVESTOCK_DEFAULT_WHERE,
});

const BASE_STORE_DEFAULTS = {
  straw: 6,
  cider_l: 0,
  fruit_dried: 0,
  meat_salted: 0,
  bacon_sides: 0,
  eggs_dozen: 6,
  manure_units: 0,
};

const PLANT_STORE_DEFAULTS = Object.fromEntries(
  ARABLE_PLANTS
    .map((plant) => [plant.primaryYield?.storeKey, plant.primaryYield?.startingQuantity ?? 0])
    .filter(([key]) => typeof key === 'string' && key.length > 0)
);

const SEED_STORE_DEFAULTS = Object.fromEntries(
  SEED_CONFIGS
    .map((config) => [config.inventoryKey, config.startingQuantity ?? 0])
    .filter(([key]) => typeof key === 'string' && key.length > 0)
);

const STORE_TEMPLATE = freezeDeep({
  ...BASE_STORE_DEFAULTS,
  ...PLANT_STORE_DEFAULTS,
  seed: SEED_STORE_DEFAULTS,
});

const STORE_SHEAVES_TEMPLATE = freezeDeep(Object.fromEntries(
  ARABLE_PLANTS
    .filter((plant) => plant.sheaf?.key)
    .map((plant) => [plant.sheaf.key, 0])
));

const DEFAULT_SOIL = Object.freeze({ moisture: 0.55, nitrogen: 0.6 });

const ROMAN_MONTH_TO_NUMBER = Object.freeze({
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
});

const PACK_FARMHOUSE = DEFAULT_PACK_V1?.estate?.farmhouse;
const DEFAULT_FARMHOUSE_CENTER = {
  x: HOUSE.x + Math.floor(HOUSE.w / 2),
  y: HOUSE.y + Math.floor(HOUSE.h / 2),
};

export const FARMHOUSE = Object.freeze({
  ...(PACK_FARMHOUSE ?? DEFAULT_FARMHOUSE_CENTER),
});

const PACK_PARCELS = Array.isArray(DEFAULT_PACK_V1?.estate?.parcels)
  ? DEFAULT_PACK_V1.estate.parcels.map((parcel) => clone(parcel))
  : [];
const PACK_CLOSES = Array.isArray(DEFAULT_PACK_V1?.estate?.closes)
  ? DEFAULT_PACK_V1.estate.closes.map((close) => clone(close))
  : [];

const PARCEL_LAYOUT = freezeDeep([...PACK_PARCELS, ...PACK_CLOSES]);

const LEGACY_TO_ACTUAL_KEY = Object.freeze({
  homestead_garden: 'homestead',
  close_a: 'close_1',
  close_b: 'close_2',
  close_c: 'close_3',
  a_oats: 'close_1',
  b_legume: 'close_2',
  c_roots: 'close_3',
});

const NUMERIC_ALIAS_RE = /^(field|close)[\s_-]?0*(\d+)$/;

const INITIAL_SUMMARY_BY_KEY = (() => {
  const summaries = new Map();
  const add = (entry) => {
    const key = typeof entry.key === 'string' ? entry.key.toLowerCase() : entry.key;
    const actualKey = LEGACY_TO_ACTUAL_KEY[key] || entry.key;
    summaries.set(actualKey, { ...entry });
  };
  FIELDS.forEach(add);
  CLOSES.forEach(add);
  return summaries;
})();

const LEGACY_CROP_TO_CROP = (() => {
  const map = new Map([
    ['fallow', null],
    ['bare', null],
    ['idle', null],
  ]);
  for (const [alias, plantId] of Object.entries(ALIAS_TO_PLANT_ID)) {
    const plant = CROPS[plantId] || getPlantById(plantId);
    if (plant) map.set(alias, plant);
  }
  return Object.freeze(Object.fromEntries(map));
})();

function resolveParcelKey(key) {
  if (key == null) return key;
  const raw = String(key).trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase();
  if (lower.startsWith('field_') || lower.startsWith('close_')) return lower;
  const numeric = NUMERIC_ALIAS_RE.exec(lower);
  if (numeric) {
    const [, prefix, num] = numeric;
    const parsed = Number.parseInt(num, 10);
    const suffix = Number.isNaN(parsed) ? num : String(parsed);
    return `${prefix}_${suffix}`;
  }
  return LEGACY_TO_ACTUAL_KEY[lower] || lower;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

export function parcelCenter(parcel) {
  if (!parcel) return { x: 0, y: 0 };
  const x = Math.round((parcel.x ?? 0) + (parcel.w ?? 0) / 2);
  const y = Math.round((parcel.y ?? 0) + (parcel.h ?? 0) / 2);
  return { x, y };
}

export function locationPoint(world, key) {
  if (!world) return { x: 0, y: 0 };
  if (key === 'farmhouse') {
    const yard = world.locations?.yard ?? FARMHOUSE;
    return { x: yard.x ?? 0, y: yard.y ?? 0 };
  }
  if (key === 'market') {
    const market = world.locations?.market;
    if (market) return { x: Math.round(market.x ?? 0), y: Math.round(market.y ?? 0) };
  }
  const parcelKey = resolveParcelKey(key);
  if (parcelKey && world.parcelByKey && parcelKey in world.parcelByKey) {
    const parcel = world.parcels?.[world.parcelByKey[parcelKey]];
    if (parcel) return parcelCenter(parcel);
  }
  const meta = findParcelMeta(parcelKey || key);
  if (meta) return { x: meta.x ?? 0, y: meta.y ?? 0 };
  return { x: 0, y: 0 };
}

export function travelStepsBetween(world, from, toKey) {
  if (!world) return 0;
  const target = locationPoint(world, toKey);
  const origin = from || locationPoint(world, 'farmhouse');
  const dx = Math.abs((origin.x ?? 0) - (target.x ?? 0));
  const dy = Math.abs((origin.y ?? 0) - (target.y ?? 0));
  return dx + dy;
}

export function travelTimeBetween(world, from, toKey, stepSimMin = CONFIG_PACK_V1.labour.travelStepSimMin ?? 0.5) {
  const steps = travelStepsBetween(world, from, toKey);
  return steps * (stepSimMin > 0 ? stepSimMin : 0.5);
}

const LEGACY_STAGE_ALIASES = Object.freeze({
  barley: 'barley_clover',
  barley_clover: 'barley_clover',
  clover: 'clover_hay',
  clover_hay: 'clover_hay',
  wheat: 'wheat',
  pulses: 'pulses',
  beans: 'pulses',
  peas: 'pulses',
  beans_peas: 'pulses',
  flex: 'flex',
  turnip: 'turnips',
  turnips: 'turnips',
  oats: 'oats_close',
  oats_close: 'oats_close',
  grass_close: 'grass_close',
  hay_close: 'hay_close',
  close_a: 'oats_close',
  close_b: 'grass_close',
  close_c: 'hay_close',
  a_oats: 'oats_close',
  b_legume: 'grass_close',
  c_roots: 'hay_close',
});

function monthIndexFromCalendarSource(source) {
  const calendar = source?.calendar ?? {};
  if (Number.isFinite(calendar.monthIndex)) return calendar.monthIndex;
  if (typeof calendar.month === 'string') {
    const months = CONFIG_PACK_V1.calendar?.months ?? [];
    const idx = months.indexOf(calendar.month);
    if (idx >= 0) return idx;
  }
  if (Number.isFinite(calendar.month)) {
    const idx = Math.floor(calendar.month) - 1;
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

function collectParcelsForIndex(state) {
  const parcels = [];
  const seen = new Set();
  const addCollection = (collection) => {
    if (!Array.isArray(collection)) return;
    for (const parcel of collection) {
      if (!parcel || typeof parcel !== 'object') continue;
      const key = parcel.key ?? parcel.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      parcels.push(parcel);
    }
  };

  addCollection(state?.estate?.parcels);
  addCollection(state?.estate?.closes);
  addCollection(state?.parcels);
  addCollection(state?.closes);
  if (state?.lookup) {
    addCollection(Object.values(state.lookup.parcels ?? {}));
    addCollection(Object.values(state.lookup.closes ?? {}));
  }
  return parcels;
}

export function buildStageIndex(state) {
  if (!state) return Object.create(null);
  const base = state?.estate ? state : state?.world ?? state;
  const monthIndex = monthIndexFromCalendarSource(base ?? state);
  const map = Object.create(null);
  const addStage = (parcel) => {
    if (!parcel?.key || !parcel.rotationId) return;
    const stage = stageNow(parcel, monthIndex);
    if (!stage) return;
    const bucket = map[stage] || (map[stage] = []);
    if (!bucket.includes(parcel.key)) bucket.push(parcel.key);
  };

  const parcels = collectParcelsForIndex(base);
  parcels.forEach(addStage);
  return map;
}

export function resolveTargetKeys(targetName, state) {
  if (!targetName) return [];
  const raw = String(targetName).trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();

  if (lower.startsWith('field_') || lower.startsWith('close_')) return [lower];
  const numeric = NUMERIC_ALIAS_RE.exec(lower);
  if (numeric) {
    const [, prefix, num] = numeric;
    const parsed = Number.parseInt(num, 10);
    const suffix = Number.isNaN(parsed) ? num : String(parsed);
    return [`${prefix}_${suffix}`];
  }

  const direct = LEGACY_TO_ACTUAL_KEY[lower];
  if (direct && (direct.startsWith('field_') || direct.startsWith('close_'))) {
    return [direct];
  }

  const canonical = LEGACY_STAGE_ALIASES[lower] || lower;
  const stageIndex = buildStageIndex(state);
  const matches = stageIndex[canonical];
  if (!Array.isArray(matches)) return [];
  return matches.slice();
}

export function createInitialWorld() {
  const world = makeWorld();
  world.calendar = { ...world.calendar, ...getSimTime() };
  world.completedJobs = [];
  world.labour = { ...world.labour, used: 0, budget: null };
  return world;
}

export function cloneWorld(world) {
  const copy = clone(world);
  if (Array.isArray(world.parcels)) {
    copy.parcels = world.parcels.map((parcel) => ({
      ...parcel,
      soil: clone(parcel.soil),
      status: clone(parcel.status),
      rows: Array.isArray(parcel.rows) ? parcel.rows.map((row) => ({ ...row })) : [],
      pasture: parcel.pasture ? { ...parcel.pasture } : null,
      hayCuring: parcel.hayCuring ? { ...parcel.hayCuring } : null,
    }));
  } else {
    copy.parcels = [];
  }
  copy.parcelByKey = { ...(world.parcelByKey ?? {}) };
  if (world.camera) copy.camera = { ...world.camera };
  if (world.farmer) {
    copy.farmer = {
      ...world.farmer,
      queue: Array.isArray(world.farmer.queue) ? [...world.farmer.queue] : [],
      activeWork: Array.isArray(world.farmer.activeWork) ? [...world.farmer.activeWork] : [],
    };
  }
  if (world.tasks?.month) {
    copy.tasks = {
      month: {
        queued: (world.tasks.month.queued ?? []).map((task) => ({ ...task })),
        active: (world.tasks.month.active ?? []).map((task) => ({ ...task })),
        done: (world.tasks.month.done ?? []).map((task) => ({ ...task })),
        overdue: (world.tasks.month.overdue ?? []).map((task) => ({ ...task })),
      },
    };
  }
  if (world.livestock) copy.livestock = clone(world.livestock);
  if (world.store) copy.store = clone(world.store);
  if (world.storeSheaves) copy.storeSheaves = clone(world.storeSheaves);
  if (world.labour) copy.labour = { ...world.labour };
  if (Array.isArray(world.completedJobs)) copy.completedJobs = [...world.completedJobs];
  return copy;
}

export function findField(world, key) {
  if (!world) return null;
  const targets = resolveTargetKeys(key, world);
  const fallback = resolveParcelKey(key);
  const searchKeys = [];
  if (Array.isArray(targets) && targets.length) searchKeys.push(...targets);
  if (fallback && (!searchKeys.length || !searchKeys.includes(fallback))) searchKeys.push(fallback);
  if (!searchKeys.length) return null;

  const seen = new Set();
  for (const candidate of searchKeys) {
    if (candidate == null) continue;
    const normalized = typeof candidate === 'string' ? candidate.toLowerCase() : candidate;
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    const direct = world.lookup?.parcels?.[normalized] || world.lookup?.closes?.[normalized];
    if (direct) return direct;
    if (Number.isInteger(world?.parcelByKey?.[normalized])) {
      const idx = world.parcelByKey[normalized];
      if (Array.isArray(world.parcels)) {
        const parcel = world.parcels[idx];
        if (parcel) return parcel;
      }
    }
    if (Array.isArray(world?.parcels)) {
      const parcel = world.parcels.find((p) => {
        const keyLower = typeof p?.key === 'string' ? p.key.toLowerCase() : null;
        return keyLower === normalized;
      });
      if (parcel) return parcel;
    }
    if (Array.isArray(world?.fields)) {
      const legacy = world.fields.find((f) => {
        const keyLower = typeof f?.key === 'string' ? f.key.toLowerCase() : null;
        return keyLower === normalized || resolveParcelKey(f.key) === normalized;
      });
      if (legacy) return legacy;
    }
    if (Array.isArray(world?.closes)) {
      const legacy = world.closes.find((c) => {
        const keyLower = typeof c?.key === 'string' ? c.key.toLowerCase() : null;
        return keyLower === normalized || resolveParcelKey(c.key) === normalized;
      });
      if (legacy) return legacy;
    }
    if (Array.isArray(world?.estate?.parcels)) {
      const parcel = world.estate.parcels.find((p) => {
        const keyLower = typeof p?.key === 'string' ? p.key.toLowerCase() : null;
        return keyLower === normalized;
      });
      if (parcel) return parcel;
    }
    if (Array.isArray(world?.estate?.closes)) {
      const parcel = world.estate.closes.find((p) => {
        const keyLower = typeof p?.key === 'string' ? p.key.toLowerCase() : null;
        return keyLower === normalized;
      });
      if (parcel) return parcel;
    }
  }
  return null;
}

export function updateFieldPhase(world, key, phase) {
  const parcel = findField(world, key);
  if (!parcel) return null;
  parcel.phase = phase;
  if (Array.isArray(parcel.rows) && parcel.rows.length > 0) {
    const stamp = { d: world.calendar?.day ?? 1, m: world.calendar?.month ?? 1 };
    parcel.rows = parcel.rows.map((row) => ({
      ...row,
      _tilledOn: phase === 'ploughed' || phase === 'harrowed' ? stamp : row._tilledOn,
    }));
  }
  return parcel;
}

export function updateFieldCrop(world, key, crop) {
  const parcel = findField(world, key);
  if (!parcel) return null;
  parcel.crop = crop;
  const mapKey = typeof crop === 'string' ? crop : String(crop ?? '').toLowerCase();
  const cropObj = LEGACY_CROP_TO_CROP[crop] ?? LEGACY_CROP_TO_CROP[mapKey] ?? null;
  if (Array.isArray(parcel.rows)) {
    parcel.rows = parcel.rows.map((row) => ({
      ...row,
      crop: cropObj ?? row.crop ?? null,
      growth: cropObj ? 0 : row.growth ?? 0,
    }));
  }
  return parcel;
}

export function moveLivestock(world, kind, destination) {
  if (!world.livestock?.where) {
    world.livestock = { ...world.livestock, where: { ...LIVESTOCK.where } };
  }
  world.livestock.where = { ...world.livestock.where, [kind]: destination };
  return world.livestock.where[kind];
}

export function recordJobCompletion(world, job) {
  if (!Array.isArray(world.completedJobs)) {
    world.completedJobs = [];
  }
  const targetKey = job?.target?.key ?? job.field ?? null;
  const stage = job?.target?.stage ?? null;
  world.completedJobs.push({ id: job.id, kind: job.kind, field: targetKey, stage });
  return world.completedJobs;
}

export function rowBand(parcel, rowIndex) {
  if (!parcel) return { sy: 0, ey: 0 };
  const inner = Math.max(0, (parcel.h ?? 0) - 2);
  if (inner <= 0 || !Array.isArray(parcel.rows) || parcel.rows.length === 0) {
    const sy = parcel.y + 1;
    const ey = parcel.y + Math.max(0, (parcel.h ?? 0) - 2);
    return { sy, ey };
  }
  const rows = parcel.rows.length;
  const idx = Math.max(0, Math.min(rows - 1, rowIndex | 0));
  const baseStart = Math.floor((inner * idx) / rows);
  const baseEnd = Math.floor((inner * (idx + 1)) / rows) - 1;
  const sy = parcel.y + 1 + Math.max(0, baseStart);
  const innerMax = parcel.y + Math.max(1, (parcel.h ?? 0) - 2);
  const rawEy = parcel.y + 1 + Math.max(baseStart, baseEnd);
  const ey = Math.max(parcel.y + 1, Math.min(innerMax, rawEy));
  return { sy, ey };
}

export function attachPastureIfNeeded(parcel) {
  if (!parcel) return parcel;
  if (!parcel.pasture) {
    const acres = Math.max(0, parcel.acres || 0);
    parcel.pasture = {
      biomass_t: acres * 0.2,
      grazedToday_t: 0,
    };
  }
  return parcel;
}

export function stamp(world) {
  const cal = world?.calendar || {};
  const year = Number.isFinite(cal.year) ? cal.year : 1;
  let month;
  if (Number.isFinite(cal.monthIndex)) {
    month = cal.monthIndex + 1;
  } else if (Number.isFinite(cal.month)) {
    month = cal.month;
  } else if (typeof cal.month === 'string') {
    const normalized = cal.month.trim().toUpperCase();
    month = ROMAN_MONTH_TO_NUMBER[normalized];
    if (!Number.isFinite(month)) {
      const parsed = Number.parseInt(normalized, 10);
      if (Number.isFinite(parsed)) month = parsed;
    }
  }
  if (!Number.isFinite(month)) month = 1;
  const day = Number.isFinite(cal.day) ? cal.day : 1;
  return { y: year, m: month, d: day };
}

export function kpiInit(world) {
  world.kpi = {
    oats_days_cover: Infinity,
    hay_days_cover: Infinity,
    wheat_days_cover: Infinity,
    seed_gaps: [],
    month_workable_min_left: 0,
    month_required_min_left: 0,
    labour_pressure: 0,
    deadline_risk: 0,
    warnings: [],
    suggestions: [],
    _workOutsideWindow: false,
  };
  return world.kpi;
}

function createParcelFromTemplate(template, index) {
  const acres = template.acres ?? 0;
  const soilTemplate = template.soil || DEFAULT_SOIL;
  const soil = {
    moisture: soilTemplate.moisture ?? DEFAULT_SOIL.moisture,
    nitrogen: soilTemplate.nitrogen ?? DEFAULT_SOIL.nitrogen,
  };
  const statusTemplate = template.status || {};
  const status = {
    cropNote: statusTemplate.cropNote || '',
    stubble: !!statusTemplate.stubble,
    tilth: statusTemplate.tilth ?? 0,
    mud: 0,
  };
  const rowsRequested = template.rows != null ? template.rows : ROWS_FOR_ACRES(acres);
  const rowCount = Math.max(0, Math.floor(rowsRequested));
  const rows = [];
  const initialCropValue = template.initialCrop || template.initialCropKey || null;
  const cropTemplate =
    typeof initialCropValue === 'string' ? (CROPS[initialCropValue] ?? null) : initialCropValue;
  for (let i = 0; i < rowCount; i++) {
    const crop = cropTemplate || null;
    rows.push({
      crop,
      companion: template.initialCompanion || null,
      growth: crop ? (template.initialGrowth ?? 0) : 0,
      moisture: soil.moisture,
      weed: template.initialWeed ?? 0,
      plantedOn: null,
      _tilledOn: null,
      _irrigatedOn: null,
    });
  }
  const rotationIndex = Number.isInteger(template.rotationIndex) ? template.rotationIndex : 0;
  const parcel = {
    id: index,
    key: template.key,
    name: template.name || template.key,
    kind: template.kind || PARCEL_KIND.ARABLE,
    acres,
    x: template.x ?? 0,
    y: template.y ?? 0,
    w: template.w ?? 12,
    h: template.h ?? 8,
    soil,
    status,
    rows,
    rotationId: template.rotationId ?? null,
    rotationIndex,
    fieldNo: Number.isFinite(template.fieldNo) ? template.fieldNo : null,
    closeNo: Number.isFinite(template.closeNo) ? template.closeNo : null,
    fieldStore: { sheaves: 0, cropKey: null },
    pasture: null,
    hayCuring: null,
  };
  const summary = INITIAL_SUMMARY_BY_KEY.get(parcel.key);
  parcel.phase = summary?.phase ?? 'idle';
  parcel.crop = summary?.crop ?? 'bare';
  if (template.pasture) attachPastureIfNeeded(parcel);
  return parcel;
}

function makeLivestockState() {
  const where = Object.fromEntries(Object.entries(DEFAULT_LIVESTOCK_LOCATIONS));
  return { ...LIVESTOCK_START, where };
}

export function makeWorld(seed = 12345) {
  const baseSeed = Number.isFinite(seed) ? seed | 0 : 12345;
  resetTime();
  const calendar = { ...getSimTime() };
  const world = {
    seed: baseSeed,
    rng: makeRng(baseSeed),
    calendar,
    camera: {
      x: Math.max(0, (HOUSE.x + Math.floor(HOUSE.w / 2)) - Math.floor(SCREEN_W / 2)),
      y: Math.max(0, (HOUSE.y + Math.floor(HOUSE.h / 2)) - Math.floor(SCREEN_H / 2)),
      follow: true,
    },
    snapCamera: true,
    farmer: {
      x: HOUSE.x + Math.floor(HOUSE.w / 2),
      y: HOUSE.y + HOUSE.h - 2,
      queue: [],
      task: null,
      activeWork: Array.from({ length: CREW_SLOTS }, () => null),
    },
    parcels: [],
    parcelByKey: {},
    farmhouse: { ...FARMHOUSE },
    fences: [],
    store: clone(STORE_TEMPLATE),
    storeSheaves: clone(STORE_SHEAVES_TEMPLATE),
    stackReady: false,
    livestock: makeLivestockState(),
    herdLoc: Object.fromEntries(Object.entries(INITIAL_HERD_LOCATIONS)),
    tasks: { month: { queued: [], active: [], done: [], overdue: [] } },
    nextTaskId: 0,
    labour: { usedMin: 0, monthBudgetMin: LABOUR_BUDGET_MIN, crewSlots: CREW_SLOTS },
    logs: [],
    alerts: [],
    weather: {
      tempC: 10,
      rain_mm: 0,
      wind_ms: 2,
      frostTonight: false,
      dryStreakDays: 0,
      label: 'Fair',
      humidity: 0.55,
      cloudCover: 0.25,
      lightLevel: 0.78,
      sunGlow: 0.4,
      skyHue: 210,
    },
    daylight: { ...CONFIG.DAYLIGHT.default },
    storeSheavesHistory: [],
    cash: 18,
    advisor: { enabled: true, mode: 'auto' },
  };

  const yardLocation = { ...FARMHOUSE };
  const marketLocation = DEFAULT_PACK_V1?.estate?.market
    ? { ...DEFAULT_PACK_V1.estate.market }
    : { x: yardLocation.x + 200, y: yardLocation.y + 50 };

  world.locations = {
    yard: yardLocation,
    market: marketLocation,
  };

  world.fences = [
    { x: 14, y: 9, w: 1, h: 10 },
    { x: 30, y: 23, w: 20, h: 1 },
  ];

  world.parcels = PARCEL_LAYOUT.map((template, idx) => {
    const parcel = createParcelFromTemplate(template, idx);
    world.parcelByKey[parcel.key] = idx;
    return parcel;
  });

  const parcelLookup = {};
  const closeLookup = {};
  for (const parcel of world.parcels) {
    if (!parcel?.key) continue;
    if (parcel.fieldNo != null || parcel.kind === PARCEL_KIND.ARABLE) {
      parcelLookup[parcel.key] = parcel;
    }
    if (parcel.closeNo != null || parcel.kind === 'close') {
      closeLookup[parcel.key] = parcel;
    }
  }
  world.lookup = { parcels: parcelLookup, closes: closeLookup };
  world.fields = Object.values(parcelLookup);
  world.closes = Object.values(closeLookup);

  world.pathGrid = createGrid(world);
  kpiInit(world);
  return world;
}
