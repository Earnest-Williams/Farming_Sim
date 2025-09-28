import { DAYS_PER_MONTH as TIME_DAYS_PER_MONTH, MONTHS_PER_YEAR as TIME_MONTHS_PER_YEAR, MINUTES_PER_DAY as TIME_MINUTES_PER_DAY, DAYLIGHT } from './time.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';

const PACK = CONFIG_PACK_V1;

export const DAYS_PER_MONTH = TIME_DAYS_PER_MONTH;
export const MONTHS_PER_YEAR = TIME_MONTHS_PER_YEAR;
export const MINUTES_PER_DAY = TIME_MINUTES_PER_DAY;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

export const SEASONS = ["Spring","Spring","Summer","Summer","Autumn","Autumn","Winter","Winter"];
export const MONTH_NAMES = Object.freeze([...PACK.calendar.months]);

export function seasonOfMonth(m) {
  return SEASONS[(m - 1) % 8];
}

export function isGrowingMonth(m) {
  return (m >= 1 && m <= 4);
}

export function isWinterMonth(m) {
  return (m === 7 || m === 8);
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

export const STRAW_PER_BUSHEL = { WHEAT:1.2, BARLEY:1.0, OATS:1.1, PULSES:0.6 };
export const OPT_MOIST = 0.60;

export const RATION = {
  HORSE: { oats_bu: 0.375, hay_t: 0.006 },
  OX: { oats_bu: 0.10,  hay_t: 0.008 },
  COW: { oats_bu: 0.00, hay_t: 0.010 },
  SHEEP: { oats_bu: 0.00, hay_t: 0.0015 },
  GOOSE: { oats_bu: 0.005, hay_t: 0.000 },
  HEN:   { oats_bu: 0.001, hay_t: 0.000 }
};

export const MANURE = { HORSE: 1.0, OX: 1.2, COW: 1.1, SHEEP: 0.2, GOOSE: 0.05, HEN: 0.03 };

export const PASTURE = {
  SHEEP_CONS_T_PER_DAY: 0.0006,
  GOOSE_CONS_T_PER_DAY: 0.0002,
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
  seed_oats_bu: 0.5
};

export const DEMAND = {
  household_wheat_bu_per_day: 0.25,
  seed_bu_per_acre: {
    WHEAT:2.0, BARLEY:2.0, OATS:2.0, PULSES:1.5, FLAX:0.0, TURNIPS:0.2
  }
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
  WORLD:  { W: 210, H: 100 },
  HOUSE: { x: 15, y: 10, w: 16, h: 8 },
  WELL: { x: 35, y: 12 },
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
  SOIL_UNTILLED: 10, SOIL_TILLED: 11, SOIL_MOIST: 12,
  T_S1: 20, T_S2: 21, T_S3: 22, T_S4: 23, T_S5: 24, T_BULB: 25,
  B_S1: 30, B_S2: 31, B_S3: 32, B_S4: 33, B_S5: 34,
  C_S1: 40, C_S2: 41, C_S3: 42, C_S4: 43, C_S5: 44,
  W_S1: 50, W_S2: 51, W_S3: 52, W_S4: 53, W_S5: 54,
  O_S1: 60, O_S2: 61, O_S3: 62, O_S4: 63, O_S5: 64,
  P_S1: 70, P_S2: 71, P_S3: 72, P_S4: 73, P_S5: 74,
  F_S1: 80, F_S2: 81, F_S3: 82, F_S4: 83, F_S5: 84,
  FARMER: 90, HOUSE_WALL: 91, DOOR: 92, WELL_WATER: 93, BORDER: 94, WELL_TEXT: 95, WOOD_FLOOR: 96,
  HUD_TEXT: 100, W_RAIN: 101, W_STORM: 102, W_HOT: 103, W_SNOW: 104,
  BAR_LOW: 110, BAR_MID: 111, BAR_HIGH: 112, N_LOW: 113, N_MID: 114, N_HIGH: 115,
  MIXED_LABEL: 200,
};

export const SID_BY_CROP = {
  T: [SID.SOIL_TILLED, SID.T_S1, SID.T_S2, SID.T_S3, SID.T_S4, SID.T_S5],
  B: [SID.SOIL_TILLED, SID.B_S1, SID.B_S2, SID.B_S3, SID.B_S4, SID.B_S5],
  C: [SID.SOIL_TILLED, SID.C_S1, SID.C_S2, SID.C_S3, SID.C_S4, SID.C_S5],
  W: [SID.SOIL_TILLED, SID.W_S1, SID.W_S2, SID.W_S3, SID.W_S4, SID.W_S5],
  O: [SID.SOIL_TILLED, SID.O_S1, SID.O_S2, SID.O_S3, SID.O_S4, SID.O_S5],
  P: [SID.SOIL_TILLED, SID.P_S1, SID.P_S2, SID.P_S3, SID.P_S4, SID.P_S5],
  F: [SID.SOIL_TILLED, SID.F_S1, SID.F_S2, SID.F_S3, SID.F_S4, SID.F_S5],
};

export const CROP_GLYPHS = {
  T: ['.', '`', ',', 'v', 'w', 'W'],
  B: ['.', ',', ';', 't', 'Y', 'H'],
  C: ['.', ',', '"', '*', 'c', 'C'],
  W: ['.', ',', ';', 'i', 'I', 'W'],
  O: ['.', ',', ';', 't', 'T', 'Y'],
  P: ['.', 'o', 'd', 'b', '8', '&'],
  F: ['.', '|', 'i', 't', 'T', '#'],
};

export const GRASS_GLYPHS = {
  [SID.GRASS_DRY]: '.',
  [SID.GRASS_NORMAL]: '`',
  [SID.GRASS_LUSH]: ',',
  [SID.GRASS_VERY_LUSH]: '"',
};

export const CROPS = {
  TURNIPS: { key:'T', name:'Turnips', type:'root', baseDays: 80, baseYield: 60, nUse: -0.10 },
  BARLEY:  { key:'B', name:'Barley',  type:'grain', baseDays: 85, baseYield: 70, nUse: -0.12 },
  CLOVER:  { key:'C', name:'Clover',  type:'legume', baseDays: 70, baseYield: 25, nUse: +0.18 },
  WHEAT:   { key:'W', name:'Wheat',   type:'grain', baseDays: 95, baseYield: 80, nUse: -0.14 },
  OATS:    { key:'O', name:'Oats',    type:'grain', baseDays: 85, baseYield: 65, nUse: -0.12 },
  PULSES:  { key:'P', name:'Beans/Peas/Vetch', type:'pulse', baseDays:90, baseYield:45, nUse:+0.06 },
  FLAX:    { key:'F', name:'Flax/Hemp', type:'fiber', baseDays:100, baseYield:30, nUse:-0.10 },
};

export const ROTATION = [CROPS.TURNIPS, CROPS.BARLEY, CROPS.CLOVER, CROPS.WHEAT];

export const LIVESTOCK_START = { horses:2, oxen:3, cows:2, bull:1, sheep:36, geese:16, poultry:24 };
