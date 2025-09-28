import { resetTime, getSimTime } from './time.js';
import {
  CONFIG,
  LIVESTOCK_START,
  CROPS,
  ROTATION,
  PARCEL_KIND,
  ROWS_FOR_ACRES,
  CREW_SLOTS,
  LABOUR_BUDGET_MIN,
} from './constants.js';
import { makeRng } from './utils.js';

export const SCREEN_W = CONFIG.SCREEN.W;
export const SCREEN_H = CONFIG.SCREEN.H;
export const HOUSE = Object.freeze({ ...CONFIG.HOUSE });
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

const STORE_TEMPLATE = freezeDeep({
  wheat: 180,
  barley: 250,
  oats: 60,
  pulses: 120,
  hay: 12,
  straw: 6,
  turnips: 50,
  cider_l: 0,
  fruit_dried: 0,
  meat_salted: 0,
  bacon_sides: 0,
  eggs_dozen: 6,
  manure_units: 0,
  seed: { wheat: 14, barley: 12, oats: 10, pulses: 8 },
});

const STORE_SHEAVES_TEMPLATE = freezeDeep({ W: 0, B: 0, O: 0, P: 0 });

const DEFAULT_SOIL = Object.freeze({ moisture: 0.55, nitrogen: 0.6 });

const PARCEL_LAYOUT = [
  Object.freeze({
    key: 'turnips',
    name: 'North Turnip Field',
    acres: 8,
    kind: PARCEL_KIND.ARABLE,
    rotationIndex: 0,
    status: { cropNote: 'Turnip aftermath', stubble: false, tilth: 0.4 },
    x: 40,
    y: 60,
    w: 30,
    h: 12,
  }),
  Object.freeze({
    key: 'barley_clover',
    name: 'Barley & Clover',
    acres: 8,
    kind: PARCEL_KIND.ARABLE,
    rotationIndex: 1,
    status: { cropNote: 'Ready for barley & clover', stubble: true, tilth: 0.3 },
    x: 76,
    y: 60,
    w: 30,
    h: 12,
  }),
  Object.freeze({
    key: 'clover_hay',
    name: 'Clover Hay',
    acres: 8,
    kind: PARCEL_KIND.ARABLE,
    rotationIndex: 2,
    status: { cropNote: 'Clover aftermath', stubble: false, tilth: 0.35 },
    x: 112,
    y: 60,
    w: 30,
    h: 12,
    pasture: true,
  }),
  Object.freeze({
    key: 'wheat',
    name: 'Lower Wheat',
    acres: 8,
    kind: PARCEL_KIND.ARABLE,
    rotationIndex: 3,
    status: { cropNote: 'Winter wheat emerging', stubble: false, tilth: 0.5 },
    x: 40,
    y: 78,
    w: 30,
    h: 12,
    initialCrop: CROPS.WHEAT,
    initialGrowth: 0.35,
  }),
  Object.freeze({
    key: 'pulses',
    name: 'Pulse Close',
    acres: 4,
    kind: PARCEL_KIND.CLOSE,
    status: { cropNote: 'Beans & peas fallow', stubble: false, tilth: 0.25 },
    x: 76,
    y: 26,
    w: 26,
    h: 12,
  }),
  Object.freeze({
    key: 'flex',
    name: 'Flex Field',
    acres: 6,
    kind: PARCEL_KIND.ARABLE,
    rotationIndex: 0,
    status: { cropNote: 'Awaiting decision', stubble: true, tilth: 0.25 },
    x: 76,
    y: 78,
    w: 28,
    h: 12,
  }),
  Object.freeze({
    key: 'close_a',
    name: 'Close A',
    acres: 3,
    kind: PARCEL_KIND.CLOSE,
    status: { cropNote: 'Oat aftermath', stubble: true, tilth: 0.3 },
    x: 20,
    y: 26,
    w: 24,
    h: 11,
  }),
  Object.freeze({
    key: 'close_c',
    name: 'Close C',
    acres: 3,
    kind: PARCEL_KIND.CLOSE,
    status: { cropNote: 'Roots lifted', stubble: false, tilth: 0.2 },
    x: 48,
    y: 26,
    w: 24,
    h: 11,
  }),
  Object.freeze({
    key: 'orchard',
    name: 'Orchard',
    acres: 2,
    kind: PARCEL_KIND.ORCHARD,
    status: { cropNote: 'Fruit trees budding', stubble: false, tilth: 0 },
    x: 108,
    y: 26,
    w: 24,
    h: 11,
    rows: 0,
    pasture: true,
  }),
  Object.freeze({
    key: 'homestead',
    name: 'Homestead Garden',
    acres: 1,
    kind: PARCEL_KIND.GARDEN,
    status: { cropNote: 'Kitchen beds', stubble: false, tilth: 0.4 },
    x: 136,
    y: 26,
    w: 22,
    h: 11,
    rows: 0,
  }),
];

const LEGACY_TO_ACTUAL_KEY = Object.freeze({
  beans_peas: 'pulses',
  A_oats: 'close_a',
  C_roots: 'close_c',
  homestead_garden: 'homestead',
});

const INITIAL_SUMMARY_BY_KEY = (() => {
  const summaries = new Map();
  const add = (entry) => {
    const actualKey = LEGACY_TO_ACTUAL_KEY[entry.key] || entry.key;
    summaries.set(actualKey, { ...entry });
  };
  FIELDS.forEach(add);
  CLOSES.forEach(add);
  return summaries;
})();

const LEGACY_CROP_TO_CROP = Object.freeze({
  fallow: null,
  bare: null,
  idle: null,
  clover: CROPS.CLOVER,
  clover_hay: CROPS.CLOVER,
  'barley+clover': CROPS.BARLEY,
  barley: CROPS.BARLEY,
  beans_peas: CROPS.PULSES,
  'beans/peas/vetch': CROPS.PULSES,
  oats: CROPS.OATS,
  turnips: CROPS.TURNIPS,
  winter_wheat: CROPS.WHEAT,
  pulses: CROPS.PULSES,
  flax: CROPS.FLAX,
});

function resolveParcelKey(key) {
  if (key == null) return key;
  return LEGACY_TO_ACTUAL_KEY[key] || key;
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
  const resolved = resolveParcelKey(key);
  if (Number.isInteger(world?.parcelByKey?.[resolved])) {
    const idx = world.parcelByKey[resolved];
    return world.parcels?.[idx] ?? null;
  }
  if (Array.isArray(world?.parcels)) {
    const parcel = world.parcels.find((p) => p.key === resolved);
    if (parcel) return parcel;
  }
  if (Array.isArray(world?.fields)) {
    const legacy = world.fields.find((f) => f.key === resolved || resolveParcelKey(f.key) === resolved);
    if (legacy) return legacy;
  }
  if (Array.isArray(world?.closes)) {
    const legacy = world.closes.find((c) => c.key === resolved || resolveParcelKey(c.key) === resolved);
    if (legacy) return legacy;
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
  world.completedJobs.push({ id: job.id, kind: job.kind, field: job.field ?? null });
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
  const month = Number.isFinite(cal.month) ? cal.month : 1;
  const day = Number.isFinite(cal.day) ? cal.day : 1;
  return { y: year, m: month, d: day };
}

export function createPathfindingGrid(width = CONFIG.WORLD.W, height = CONFIG.WORLD.H, parcels = []) {
  const grid = Array.from({ length: height }, () => new Array(width).fill(1));
  for (let x = 0; x < width; x++) {
    grid[0][x] = 0;
    grid[height - 1][x] = 0;
  }
  for (let y = 0; y < height; y++) {
    grid[y][0] = 0;
    grid[y][width - 1] = 0;
  }
  for (const parcel of parcels) {
    if (!parcel) continue;
    const startY = Math.max(0, parcel.y);
    const endY = Math.min(height, parcel.y + parcel.h);
    const startX = Math.max(0, parcel.x);
    const endX = Math.min(width, parcel.x + parcel.w);
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        grid[y][x] = 1;
      }
    }
  }
  return grid;
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
  for (let i = 0; i < rowCount; i++) {
    const crop = template.initialCrop || null;
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
  const rotationIndex = Number.isInteger(template.rotationIndex) ? template.rotationIndex : null;
  const rotationKey = template.rotationKey
    || (rotationIndex != null && ROTATION[rotationIndex] ? ROTATION[rotationIndex].key : null);
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
    rotationIndex,
    rotationKey,
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
  const where = {
    horses: 'byre',
    oxen: 'byre',
    cows: 'byre',
    bull: 'byre',
    sheep: 'clover_hay',
    geese: 'orchard',
    poultry: 'yard',
  };
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
    store: clone(STORE_TEMPLATE),
    storeSheaves: clone(STORE_SHEAVES_TEMPLATE),
    stackReady: false,
    livestock: makeLivestockState(),
    herdLoc: { sheep: 'clover_hay', geese: 'orchard' },
    tasks: { month: { queued: [], active: [], done: [], overdue: [] } },
    nextTaskId: 0,
    labour: { usedMin: 0, monthBudgetMin: LABOUR_BUDGET_MIN, crewSlots: CREW_SLOTS },
    logs: [],
    alerts: [],
    weather: { tempC: 10, rain_mm: 0, wind_ms: 2, frostTonight: false, dryStreakDays: 0, label: 'Fair' },
    daylight: { ...CONFIG.DAYLIGHT.default },
    storeSheavesHistory: [],
    cash: 18,
    advisor: { enabled: true, mode: 'auto' },
  };

  world.parcels = PARCEL_LAYOUT.map((template, idx) => {
    const parcel = createParcelFromTemplate(template, idx);
    world.parcelByKey[parcel.key] = idx;
    return parcel;
  });

  world.pathGrid = createPathfindingGrid(CONFIG.WORLD.W, CONFIG.WORLD.H, world.parcels);
  kpiInit(world);
  return world;
}
