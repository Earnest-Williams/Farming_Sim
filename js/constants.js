import { DAYS_PER_MONTH as TIME_DAYS_PER_MONTH, MONTHS_PER_YEAR as TIME_MONTHS_PER_YEAR, MINUTES_PER_DAY as TIME_MINUTES_PER_DAY, DAYLIGHT } from './time.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { INITIAL_LIVESTOCK_COUNTS, PASTURE_INFO_BY_ID } from './config/animals.js';
import {
  CROPS as CROPS_FROM_DATA,
  ROTATION as ROTATION_FROM_DATA,
  STAGE_SIDS_BY_KEY,
  CROP_GLYPHS_BY_KEY,
  STRAW_PER_BUSHEL_BY_ID,
  SEED_RATE_BU_PER_ACRE_BY_ID,
} from './config/plants.js';

const PACK = CONFIG_PACK_V1;

export const DAYS_PER_MONTH = TIME_DAYS_PER_MONTH;
export const MONTHS_PER_YEAR = TIME_MONTHS_PER_YEAR;
export const MINUTES_PER_DAY = TIME_MINUTES_PER_DAY;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

export const SEASONS = ["Spring","Spring","Summer","Summer","Autumn","Autumn","Winter","Winter"];
export const MONTH_NAMES = Object.freeze([...PACK.calendar.months]);

export function normalizeMonth(month) {
  if (Number.isFinite(month)) {
    const int = Math.floor(month);
    if (int >= 1 && int <= MONTHS_PER_YEAR) return int;
    if (int >= 0 && int < MONTHS_PER_YEAR) return int + 1;
  }
  if (typeof month === 'string') {
    const trimmed = month.trim();
    if (trimmed.length > 0) {
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isFinite(parsed)) {
        return normalizeMonth(parsed);
      }
      const directIdx = MONTH_NAMES.indexOf(trimmed);
      if (directIdx >= 0) return directIdx + 1;
      const upperIdx = MONTH_NAMES.indexOf(trimmed.toUpperCase());
      if (upperIdx >= 0) return upperIdx + 1;
    }
  }
  return 1;
}

export function seasonOfMonth(m) {
  const month = normalizeMonth(m);
  const idx = ((month - 1) % SEASONS.length + SEASONS.length) % SEASONS.length;
  return SEASONS[idx];
}

export function isGrowingMonth(m) {
  const month = normalizeMonth(m);
  return (month >= 1 && month <= 4);
}

export function isWinterMonth(m) {
  const month = normalizeMonth(m);
  return (month === 7 || month === 8);
}

export const N_MAX = 1.15;

export const PARCEL_KIND = {
  ARABLE: 'arable',
  CLOSE: 'close',
  ORCHARD: 'orchard',
  GARDEN: 'garden',
  COPPICE: 'coppice',
  HOMESTEAD: 'homestead'
};

export const ACRES_PER_ROW = 0.5;
export const ROWS_FOR_ACRES = (ac) => Math.max(1, Math.round(ac / ACRES_PER_ROW));

export const CREW_SLOTS = PACK.labour.crewSlots ?? 4;
export const LABOUR_DAY_MIN = PACK.labour.hoursPerDay * 60;
export const LABOUR_BUDGET_MIN = (PACK.labour.monthlyHours ?? CREW_SLOTS * PACK.calendar.daysPerMonth * PACK.labour.hoursPerDay) * 60;

export const TILTH_MAX = 1.0;
export const WEED_MAX = 1.0;
export const HOE_WEED_DELTA = -0.40;
export const PLOUGH_TILTH_DELTA = +0.35;
export const HARROW_TILTH_DELTA = +0.20;
export const THRESH_LOSS = 0.02;

export const STRAW_PER_BUSHEL = STRAW_PER_BUSHEL_BY_ID;
export const OPT_MOIST = 0.60;

export const PASTURE = {
  CONSUMPTION_T_PER_DAY: Object.freeze(Object.fromEntries(
    Object.entries(PASTURE_INFO_BY_ID).map(([id, info]) => [id, info.intake_t])
  )),
  REGROW_T_PER_ACRE_PER_DAY: 0.0025,
  MIN_BIOMASS_T: 0.0,
  MAX_BIOMASS_T_PER_ACRE: 0.6
};

export const WX_BASE = {
  1:{ tMean:9, rainMean:2.0, etp:1.6 },
  2:{ tMean:12, rainMean:2.2, etp:2.2 },
  3:{ tMean:17, rainMean:2.0, etp:3.2 },
  4:{ tMean:20, rainMean:2.4, etp:4.0 },
  5:{ tMean:15, rainMean:3.2, etp:2.6 },
  6:{ tMean:10, rainMean:3.6, etp:1.6 },
  7:{ tMean:5, rainMean:2.4, etp:0.8 },
  8:{ tMean:6, rainMean:2.2, etp:0.8 }
};

export const SOIL = {
  WILTING: 0.20,
  FIELD_CAP: 0.60,
  SAT: 1.00,
  INFIL_PER_MM: 0.003,
  DRAIN_RATE: 0.05
};

export const PRICES = {
  wheat_bu: 0.75,
  barley_bu: 0.55,
  oats_bu: 0.40,
  pulses_bu: 0.70,
  hay_t: 18,
  straw_t: 6,
  poles_bundle: 1.5,
  firewood_cord: 10,
  meat_lb: 0.02,
  bacon_side: 1.2,
  cider_l: 0.002,
  seed_wheat_bu: 0.9,
  seed_barley_bu: 0.7,
  seed_oats_bu: 0.5,
  seed_pulses_bu: 0.8,
};

export const DEMAND = {
  household_wheat_bu_per_day: 0.25,
  seed_bu_per_acre: Object.freeze({
    ...SEED_RATE_BU_PER_ACRE_BY_ID,
  }),
};

export function seedNeededForParcel(p, cropKey) {
  const ac = p.acres || 0;
  const sb = DEMAND.seed_bu_per_acre[cropKey] || 0;
  return ac * sb;
}

export const TASK_KINDS = {
  MOVE: 'move', WORK: 'work', HarvestRow: 'HarvestRow', PlantRow: 'PlantRow', IrrigateRow: 'IrrigateRow', TendRow: 'TendRow', DrawWater: 'DrawWater',
  PloughPlot: 'PloughPlot', HarrowPlot: 'HarrowPlot', DrillPlot: 'DrillPlot', Sow: 'Sow', HoeRow: 'HoeRow', CartSheaves: 'CartSheaves',
  StackRicks: 'StackRicks', Thresh: 'Thresh', Winnow: 'Winnow', SpreadManure: 'SpreadManure', FoldSheep: 'FoldSheep', MoveHerd: 'MoveHerd',
  Prune: 'Prune', Repair: 'Repair', Slaughter: 'Slaughter', ClampRoots: 'ClampRoots', GardenSow: 'GardenSow',
  HarvestParcel:'HarvestParcel', CutCloverHay: 'CutCloverHay', OrchardHarvest: 'OrchardHarvest', CartHay: 'CartHay', CartToMarket: 'CartToMarket',
};

export const CONFIG = {
  SCREEN: { W: 100, H: 30 },
  WORLD:  { W: 480, H: 540 },
  HOUSE: { x: 230, y: 200, w: 20, h: 12 },
  BYRE: { x: 260, y: 200, w: 12, h: 8 },
  WELL: { x: 242, y: 195 },
  FARMER_SPEED: 2,
  SPEED_LEVELS: [1000, 600, 300, 150, 75],
  IRRIGATION_THRESHOLD: 0.35,
  TEND_ROWS_PER_DAY: 4,
  WORK_JITTER: 0.10,
  DAYLIGHT,
  IRRIGATION_AMOUNT: 0.18,
  FODDER_PER_LIVESTOCK: 1,
  MANURE_NITROGEN_CREDIT: 0.005,
  DAILY_ROOT_CONSUMPTION: 2,
  LIVESTOCK_BUY_COST: 150,
  LIVESTOCK_SELL_VALUE: 100,
};

export const HOUSE = Object.freeze({ ...CONFIG.HOUSE });
export const BYRE = Object.freeze({ ...CONFIG.BYRE });

export const MAX_SCHEDULED_TASK_ATTEMPTS = 100;
export const MID_MONTH_LABOUR_THRESHOLD = 0.35;

export const WORK_MINUTES = {
  PlantRow: 25, HarvestRow: 45, TendRow: 10, IrrigateRow: 12, DrawWater: 15,
  PloughPlot_perAcre: 160,   HarrowPlot_perAcre: 60,   DrillPlot_perAcre: 45,
  Sow_perRow: 6,             HoeRow_perRow: 12,
  CartSheaves_perAcre: 40,   StackRicks_perAcre: 25,
  Thresh_perBushel: 6,       Winnow_perBushel: 2,
  SpreadManure_perAcre: 90,  FoldSheep_setup: 60,      MoveHerd_flat: 30,
  Prune_perTree: 5,          Repair_perJob: 120,       Slaughter_perHead: 240,
  ClampRoots_perTon: 120,    GardenSow_perBed: 20,
  HarvestParcel_perAcre:120,
  CutCloverHay_perAcre: 180, OrchardHarvest_perAcre: 120, CartHay_perAcre: 60,
  CartToMarket: 240,
};

export const ACRES = (p) => p.acres || 0;
export const ROWS = (p) => (p.rows?.length || 0);

export const SID = {
  GRASS_DRY: 0, GRASS_NORMAL: 1, GRASS_LUSH: 2, GRASS_VERY_LUSH: 3,
  SOIL_UNTILLED: 10, SOIL_TILLED: 11, SOIL_MOIST: 12, SOIL_FERTILE: 13, SOIL_PARCHED: 14,
  T_S1: 20, T_S2: 21, T_S3: 22, T_S4: 23, T_S5: 24, T_BULB: 25,
  B_S1: 30, B_S2: 31, B_S3: 32, B_S4: 33, B_S5: 34,
  C_S1: 40, C_S2: 41, C_S3: 42, C_S4: 43, C_S5: 44,
  W_S1: 50, W_S2: 51, W_S3: 52, W_S4: 53, W_S5: 54,
  O_S1: 60, O_S2: 61, O_S3: 62, O_S4: 63, O_S5: 64,
  P_S1: 70, P_S2: 71, P_S3: 72, P_S4: 73, P_S5: 74,
  F_S1: 80, F_S2: 81, F_S3: 82, F_S4: 83, F_S5: 84,
  FARMER: 90, HOUSE_WALL: 91, DOOR: 92, WELL_WATER: 93, BORDER: 94, WELL_TEXT: 95, WOOD_FLOOR: 96,
  BYRE_FLOOR: 97, BYRE_LABEL: 98, COPPICE_TREE: 99, NEIGHBOR_FARMER: 207,
  HUD_TEXT: 100, W_RAIN: 101, W_STORM: 102, W_HOT: 103, W_SNOW: 104,
  BAR_LOW: 110, BAR_MID: 111, BAR_HIGH: 112, N_LOW: 113, N_MID: 114, N_HIGH: 115,
  MIXED_LABEL: 200,
  RIVER: 201,
  ROAD: 202,
  BED: 203,
  TABLE: 204,
  HEARTH: 205,
  STORAGE: 206,
};

export const SID_BY_CROP = STAGE_SIDS_BY_KEY;

export const CROP_GLYPHS = CROP_GLYPHS_BY_KEY;

export const GRASS_GLYPHS = {
  [SID.GRASS_DRY]: '.',
  [SID.GRASS_NORMAL]: '`',
  [SID.GRASS_LUSH]: ',',
  [SID.GRASS_VERY_LUSH]: '"',
};

export const CROPS = CROPS_FROM_DATA;

export const ROTATION = ROTATION_FROM_DATA;

export const LIVESTOCK_START = Object.freeze({ ...INITIAL_LIVESTOCK_COUNTS });
