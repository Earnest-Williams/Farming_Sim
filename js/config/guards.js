import { CONFIG_PACK_V1 } from './pack_v1.js';

const REQUIRED_NUMERIC_KEYS = [
  'time.simMinPerRealMin',
  'time.tickSimMin',
  'time.daySimMin',
  'time.realMsPerMinute',
  'time.minutesPerHour',
  'calendar.daysPerMonth',
  'labour.monthlyHours',
  'labour.hoursPerDay',
  'labour.crewSlots',
  'labour.travelStepSimMin',
  'rates.ploughHarrow',
  'rates.sow',
  'rates.hoe',
  'rates.harvest',
  'rates.hayCut',
  'rates.loadUnloadMarket',
  'rules.marketCooldownSimMin',
  'rules.cartCapacity',
  'rules.manifestValueMin',
  'rules.labourValuePerMin',
  'rules.closeFieldMaxSteps',
  'rules.priceDrift.factor',
  'rules.marketHours.open',
  'rules.marketHours.close',
  'rules.travelPenaltyCap',
  'rules.debtHorizonHours',
  'rules.buyUtilityMultiplier',
];

const REQUIRED_OBJECT_KEYS = [
  'calendar.months',
  'estate.farmhouse',
  'estate.parcels',
  'time.daylightAnchors',
  'rules.priceDrift.months',
  'rules.manifestDiscounts',
  'rules.seedKeys',
];

function getPath(source, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), source);
}

export function assertConfigCompleteness(pack = CONFIG_PACK_V1) {
  if (!pack || typeof pack !== 'object') {
    throw new Error('Configuration pack missing or invalid');
  }

  for (const path of REQUIRED_NUMERIC_KEYS) {
    const value = getPath(pack, path);
    if (!Number.isFinite(value)) {
      throw new Error(`Config pack missing numeric value for "${path}"`);
    }
  }

  for (const path of REQUIRED_OBJECT_KEYS) {
    const value = getPath(pack, path);
    if (value == null) {
      throw new Error(`Config pack missing required object for "${path}"`);
    }
  }

  return true;
}

export function requireNumeric(path, pack = CONFIG_PACK_V1) {
  const value = getPath(pack, path);
  if (!Number.isFinite(value)) {
    throw new Error(`Expected numeric config value at "${path}"`);
  }
  return value;
}
