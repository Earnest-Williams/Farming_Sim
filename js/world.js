import { clamp, clamp01, lerp, getSeedFromURL, makeRng } from './utils.js';
import {
  CONFIG,
  PARCEL_KIND,
  ROWS_FOR_ACRES,
  CROPS,
  ROTATION,
  LIVESTOCK_START,
  CREW_SLOTS,
  LABOUR_BUDGET_MIN,
  PASTURE,
  WX_BASE,
  RATION,
  MANURE,
  DAYS_PER_YEAR,
  TASK_KINDS,
  WORK_MINUTES,
  ACRES,
  ROWS
} from './constants.js';

const SCREEN_W = CONFIG.SCREEN.W;
const SCREEN_H = CONFIG.SCREEN.H;
const HOUSE = CONFIG.HOUSE;
const WELL = CONFIG.WELL;
const DOOR_XL = HOUSE.x + Math.floor(HOUSE.w / 2) - 1;
const DOOR_XR = DOOR_XL + 1;

const PARCELS_LAYOUT = [
  { key:'turnips',       name:'Turnips Field',       kind:PARCEL_KIND.ARABLE,  acres:8,  x:45, y:5,  w:60, h:25 },
  { key:'barley_clover', name:'Barley+Clover Field', kind:PARCEL_KIND.ARABLE,  acres:8,  x:110,y:5,  w:60, h:25 },
  { key:'clover_hay',    name:'Clover/Hay Field',    kind:PARCEL_KIND.ARABLE,  acres:8,  x:45, y:35, w:60, h:25 },
  { key:'wheat',         name:'Winter Wheat Field',  kind:PARCEL_KIND.ARABLE,  acres:8,  x:110,y:35, w:60, h:25 },
  { key:'pulses',        name:'Beans/Peas Field',    kind:PARCEL_KIND.ARABLE,  acres:8,  x:45, y:65, w:60, h:25 },
  { key:'flex',          name:'Flex Field',          kind:PARCEL_KIND.ARABLE,  acres:8,  x:110,y:65, w:60, h:25 },
  { key:'close_a',       name:'Close A (Oats)',      kind:PARCEL_KIND.CLOSE,   acres:3,  x:175,y:5,  w:30, h:25 },
  { key:'close_b',       name:'Close B (Legumes)',   kind:PARCEL_KIND.CLOSE,   acres:3,  x:175,y:35, w:30, h:25 },
  { key:'close_c',       name:'Close C (Roots/Fod.)',kind:PARCEL_KIND.CLOSE,   acres:3,  x:175,y:65, w:30, h:25 },
  { key:'homestead',     name:'Homestead',           kind:PARCEL_KIND.HOMESTEAD, acres:1, x:10, y:5,  w:30, h:20 },
  { key:'orchard',       name:'Orchard',             kind:PARCEL_KIND.ORCHARD,   acres:1, x:10, y:28, w:30, h:15 },
  { key:'coppice',       name:'Coppice',             kind:PARCEL_KIND.COPPICE,   acres:2, x:10, y:46, w:30, h:20 },
];

export function rowBand(parcel, rowIdx) {
  const y0 = parcel.y + 1;
  const y1 = parcel.y + parcel.h - 2;
  const iH = y1 - y0 + 1;
  const bH = Math.floor(iH / parcel.rows.length);
  const remainder = iH % parcel.rows.length;
  const getBandHeight = (idx) => bH + (idx < remainder ? 1 : 0);
  let cumulative = y0;
  for (let i = 0; i < rowIdx; i++) cumulative += getBandHeight(i);
  const sy = cumulative;
  const ey = sy + getBandHeight(rowIdx) - 1;
  return { sy, ey };
}

export function rowCenter(parcel, rowIdx) {
  const { sy, ey } = rowBand(parcel, rowIdx);
  return { x: Math.floor(parcel.x + Math.floor(parcel.w / 2)), y: Math.floor((sy + ey) / 2) };
}

export const FARMER_START = { x: HOUSE.x + Math.floor(HOUSE.w / 2), y: HOUSE.y + HOUSE.h };

function isBlocked(x, y) {
  if (x < 0 || x >= CONFIG.WORLD.W || y < 0 || y >= CONFIG.WORLD.H) return true;
  if (x >= HOUSE.x && x < HOUSE.x + HOUSE.w && y >= HOUSE.y && y < HOUSE.y + HOUSE.h) {
    const onBorder = (x === HOUSE.x || x === HOUSE.x + HOUSE.w - 1 || y === HOUSE.y || y === HOUSE.y + HOUSE.h - 1);
    const isDoor = (y === HOUSE.y + HOUSE.h - 1) && (x === DOOR_XL || x === DOOR_XR);
    if (onBorder && !isDoor) return true;
  }
  return false;
}

export function createPathfindingGrid() {
  const grid = Array.from({ length: CONFIG.WORLD.H }, () => Array(CONFIG.WORLD.W).fill(0));
  for (let y = 0; y < CONFIG.WORLD.H; y++) {
    for (let x = 0; x < CONFIG.WORLD.W; x++) {
      if (isBlocked(x, y)) grid[y][x] = 1;
    }
  }
  return grid;
}

export function findPath(grid, start, end) {
  const q = [[start]];
  const visited = new Set([`${start.x},${start.y}`]);
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  while (q.length > 0) {
    const path = q.shift();
    const pos = path[path.length - 1];
    if (pos.x === end.x && pos.y === end.y) return path.slice(1);
    for (const [dx, dy] of dirs) {
      const nx = pos.x + dx;
      const ny = pos.y + dy;
      const key = `${nx},${ny}`;
      if (nx >= 0 && nx < CONFIG.WORLD.W && ny >= 0 && ny < CONFIG.WORLD.H && !grid[ny][nx] && !visited.has(key)) {
        visited.add(key);
        const newPath = [...path, { x: nx, y: ny }];
        q.push(newPath);
      }
    }
  }
  return null;
}

export function stamp(world) {
  return { m: world.calendar.month, d: world.calendar.day };
}

function makeParcel(entry, rng) {
  const soil = { moisture: 0.55 + rng() * 0.2, nitrogen: 0.45 + rng() * 0.2 };
  const parcel = {
    id: null,
    key: entry.key,
    name: entry.name,
    kind: entry.kind,
    acres: entry.acres,
    x: entry.x,
    y: entry.y,
    w: entry.w,
    h: entry.h,
    soil,
    rows: [],
    rotationIndex: null,
    status: {
      stubble: false,
      tilth: 0,
      lastPlantedOn: null,
      cropNote: '',
      lastPloughedOn: null,
      lastHarrowedOn: null,
      lateSow: 0,
      harvestPenalty: 0,
      lodgingPenalty: 0,
      mud: 0,
    },
    fieldStore: { sheaves: 0, cropKey: null },
  };
  const rowCount = (entry.kind === PARCEL_KIND.ARABLE || entry.kind === PARCEL_KIND.CLOSE) ? ROWS_FOR_ACRES(entry.acres) : 0;
  for (let i = 0; i < rowCount; i++) {
    parcel.rows.push({ crop: null, companion: null, growth: 0, moisture: soil.moisture, weed: 0, plantedOn: null, _tilledOn: null, _irrigatedOn: null, harvested: false });
  }
  return parcel;
}

function buildParcels(rng) {
  const parcels = PARCELS_LAYOUT.map((e, i) => {
    const p = makeParcel(e, rng);
    p.id = i;
    return p;
  });
  const byKey = {};
  for (const p of parcels) byKey[p.key] = p.id;
  return { parcels, byKey };
}

function initStores() {
  return {
    wheat: 0, barley: 0, oats: 0, pulses: 0, straw: 0, hay: 0, turnips: 0,
    roots_misc: 0, onions: 0, cabbages: 0, carrots: 0, parsnips: 0, beets: 0,
    fruit_dried: 0, cider_l: 0, firewood_cords: 0, poles: 0, meat_salted: 0,
    bacon_sides: 0, eggs_dozen: 0, manure_units: 0,
    seed: { wheat: 0, barley: 0, oats: 0, pulses: 0 },
    water: 0,
  };
}

function initStock() {
  return JSON.parse(JSON.stringify(LIVESTOCK_START));
}

function initHerdLocations(world) {
  world.herdLoc = {
    horses: 'homestead',
    oxen: 'homestead',
    cows: 'homestead',
    sheep: 'clover_hay',
    geese: 'orchard',
    poultry: 'homestead',
  };
}

function initWeather(world) {
  world.weather = {
    tempC: WX_BASE[world.calendar.month].tMean,
    rain_mm: 0,
    wind_ms: 2,
    frostTonight: false,
    dryStreakDays: 0,
    forecast: [],
  };
}

function initCash(world) {
  world.cash = 0;
}

export function kpiInit(world) {
  world.kpi = {
    oats_days_cover: 0,
    hay_days_cover: 0,
    wheat_days_cover: 0,
    seed_gaps: [],
    deadline_risk: 0,
    labour_pressure: 0,
    month_workable_min_left: 0,
    month_required_min_left: 0,
    warnings: [],
    suggestions: [],
  };
}

export function ensureAdvisor(world) {
  world.advisor = world.advisor || { enabled: true, mode: 'auto' };
}

export function attachPastureIfNeeded(parcel) {
  if (!parcel.pasture) parcel.pasture = { biomass_t: 0, grazedToday_t: 0 };
}

function initPastureDay1(world) {
  const clover = world.parcels[world.parcelByKey.clover_hay];
  attachPastureIfNeeded(clover);
  clover.pasture.biomass_t = Math.min(clover.acres * PASTURE.MAX_BIOMASS_T_PER_ACRE * 0.25, clover.acres * 0.2);
}

function markBareToBeSown(p, note) {
  p.status = { ...p.status, tilth: 0, stubble: false, cropNote: `Bare → ${note}` };
}

function markBare(p) {
  p.status = { ...p.status, tilth: 0, stubble: false, cropNote: 'Bare' };
}

function markStubbledTurnips(p) {
  p.status = { ...p.status, tilth: 0.2, stubble: true, cropNote: 'Folded in winter; drill in Month II' };
}

function markEstablishedClover(p) {
  for (const r of p.rows) {
    r.crop = CROPS.CLOVER;
    r.growth = 0.6;
  }
  p.status.cropNote = 'Clover standing (hay Month III)';
}

function markYoungWheat(p) {
  for (const r of p.rows) {
    r.crop = CROPS.WHEAT;
    r.growth = 0.2;
  }
  p.status.cropNote = 'Young wheat overwintered';
}

function initEstate(world) {
  const { parcels, byKey } = buildParcels(world.rng);
  world.parcels = parcels;
  world.parcelByKey = byKey;
  world.store = initStores();
  world.livestock = initStock();
  initHerdLocations(world);
  initPastureDay1(world);

  world.parcels[byKey.turnips].rotationIndex = 0;
  world.parcels[byKey.barley_clover].rotationIndex = 1;
  world.parcels[byKey.clover_hay].rotationIndex = 2;
  world.parcels[byKey.wheat].rotationIndex = 3;

  world.parcels[byKey.barley_clover].status.targetHarvestM = 4;
  world.parcels[byKey.close_a].status.targetHarvestM = 4;
  world.parcels[byKey.pulses].status.targetHarvestM = 4;
  world.parcels[byKey.wheat].status.targetHarvestM = 5;

  markYoungWheat(world.parcels[byKey.wheat]);
  markEstablishedClover(world.parcels[byKey.clover_hay]);
  markStubbledTurnips(world.parcels[byKey.turnips]);
  markBareToBeSown(world.parcels[byKey.barley_clover], 'barley+clover');
  markBareToBeSown(world.parcels[byKey.pulses], 'beans/peas/vetch');
  markBare(world.parcels[byKey.flex]);
  markBareToBeSown(world.parcels[byKey.close_a], 'oats');
  markBare(world.parcels[byKey.close_b]);
  markBare(world.parcels[byKey.close_c]);

  world.parcels[byKey.homestead].status.cropNote = 'Byres + garden prepped';
  world.parcels[byKey.orchard].status.cropNote = 'Buds just breaking';
  world.parcels[byKey.coppice].status.cropNote = 'Poles seasoning; stools sprouting';
}

export function computeDaylightByIndex(dayIndex) {
  const stepIdx = Math.floor(dayIndex / CONFIG.DAYLIGHT.snapDays);
  const stepped = stepIdx * CONFIG.DAYLIGHT.snapDays + Math.floor(CONFIG.DAYLIGHT.snapDays / 2);
  const angle = 2 * Math.PI * ((stepped - 60) / DAYS_PER_YEAR);
  const dayLen = clamp(CONFIG.DAYLIGHT.baseHours + CONFIG.DAYLIGHT.amplitude * Math.cos(angle), 8, 16);
  const sunrise = Math.round((12 - dayLen / 2) * 60);
  const sunset = Math.round((12 + dayLen / 2) * 60);
  return {
    sunrise,
    sunset,
    workStart: Math.max(0, sunrise - CONFIG.DAYLIGHT.bufferMin),
    workEnd: Math.min(24 * 60, sunset + CONFIG.DAYLIGHT.bufferMin),
    dayLenHours: dayLen,
  };
}

export function makeWorld(seed) {
  const effectiveSeed = seed ?? getSeedFromURL();
  const rng = makeRng(effectiveSeed);
  const world = {
    rng,
    seed: effectiveSeed,
    paused: false,
    speedIdx: 2,
    speeds: CONFIG.SPEED_LEVELS,
    calendar: { minute: 0, day: 1, month: 1, year: 1 },
    weather: {},
    daylight: computeDaylightByIndex(0),
    farmer: { x: FARMER_START.x, y: FARMER_START.y, task: 'Idle', queue: [], moveTarget: null, path: [], activeWork: new Array(CREW_SLOTS).fill(null) },
    parcels: [],
    store: {},
    storeSheaves: { WHEAT: 0, BARLEY: 0, OATS: 0, PULSES: 0 },
    stackReady: false,
    logs: [],
    alerts: [],
    camera: { x: 0, y: 0, follow: true },
    livestock: {},
    labour: { monthBudgetMin: LABOUR_BUDGET_MIN, usedMin: 0, crewSlots: CREW_SLOTS },
    tasks: { month: { queued: [], active: [], done: [], overdue: [] } },
    nextTaskId: 0,
    flexChoice: null,
    cash: 0,
  };

  initEstate(world);
  initWeather(world);
  initCash(world);
  kpiInit(world);
  ensureAdvisor(world);
  world.pathGrid = createPathfindingGrid();
  Object.defineProperty(world, 'plots', { get() { return world.parcels; } });
  return world;
}

export { SCREEN_W, SCREEN_H, HOUSE, WELL, CROPS, ROTATION, RATION, MANURE, WORK_MINUTES, TASK_KINDS, ACRES, ROWS };
