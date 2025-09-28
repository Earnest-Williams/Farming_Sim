import { PRICES, DAYS_PER_MONTH } from './constants.js';
import { MINUTES_PER_DAY, CALENDAR } from './time.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';

const PACK = CONFIG_PACK_V1;
const RULES = PACK.rules || {};
const MOVE_MIN_PER_STEP = PACK.labour?.travelStepSimMin ?? 0;
const LOAD_UNLOAD_MIN = PACK.rates?.loadUnloadMarket ?? 0;
const DEFAULT_LABOUR_VALUE_PER_MIN = RULES.labourValuePerMin ?? 0;
const DEFAULT_CART_CAPACITY = RULES.cartCapacity ?? 0;
const DEFAULT_COOLDOWN_MIN = RULES.marketCooldownSimMin ?? 0;
const DEFAULT_MANIFEST_VALUE_MIN = RULES.manifestValueMin ?? 0;
const PRICE_DRIFT_MONTHS = new Set(RULES.priceDrift?.months || []);
const PRICE_DRIFT_FACTOR = RULES.priceDrift?.factor ?? 0;
const MARKET_HOURS = RULES.marketHours || {};
const TRAVEL_PENALTY_CAP = RULES.travelPenaltyCap ?? Infinity;
const DEBT_HORIZON_HOURS = RULES.debtHorizonHours ?? 0;
const MANIFEST_DISCOUNTS = RULES.manifestDiscounts || {};
const BUY_UTILITY_MULTIPLIER = RULES.buyUtilityMultiplier ?? 1;
const SEED_KEYS = Array.isArray(RULES.seedKeys) ? RULES.seedKeys : ['barley', 'pulses', 'oats', 'wheat'];

const DEFAULT_THRESHOLDS = {
  seeds: { ...(RULES.seedMinimums || {}) },
  hay_min: RULES.hayMin ?? 0,
  hay_target: RULES.hayTarget ?? 0,
  grain_keep: RULES.grainKeep ?? 0,
  grain_surplus: RULES.grainSurplus ?? 0,
  cash_min: RULES.cashMin ?? 0,
  manifest_value_min: DEFAULT_MANIFEST_VALUE_MIN,
};

function ensureFinance(world) {
  if (!world.finance) {
    world.finance = {
      loanDueWithinHours: () => false,
    };
  }
  if (!('cash' in world.finance)) {
    Object.defineProperty(world.finance, 'cash', {
      get() { return world.cash ?? 0; },
      set(v) { world.cash = v; },
      configurable: true,
    });
  }
}

function ensureCart(world) {
  world.cart = world.cart || { capacity: DEFAULT_CART_CAPACITY };
  if (!('capacity' in world.cart)) world.cart.capacity = DEFAULT_CART_CAPACITY;
}

function ensureThresholds(world) {
  if (!world.thresholds) world.thresholds = {};
  const seeds = world.thresholds.seeds || {};
  world.thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...world.thresholds,
    seeds: {
      ...DEFAULT_THRESHOLDS.seeds,
      ...seeds,
    },
  };
  if (!('labourValuePerMin' in world.thresholds)) {
    world.thresholds.labourValuePerMin = DEFAULT_LABOUR_VALUE_PER_MIN;
  }
}

export function ensureMarketState(world) {
  world.market = world.market || {};
  ensureFinance(world);
  ensureCart(world);
  ensureThresholds(world);
  if (!('tripInProgress' in world.market)) world.market.tripInProgress = false;
  if (!('lastTripAt' in world.market)) world.market.lastTripAt = -Infinity;
  if (!('lastPlannedManifest' in world.market)) world.market.lastPlannedManifest = null;
  if (!('cooldownMin' in world.market)) world.market.cooldownMin = DEFAULT_COOLDOWN_MIN;
}

export function priceFor(item, month) {
  const numericMonth = typeof month === 'number' ? month : CALENDAR?.MONTHS?.indexOf(month) + 1;
  const drift = PRICE_DRIFT_MONTHS.has(numericMonth) ? PRICE_DRIFT_FACTOR : 0;
  return (PRICES[item] || 0) * (1 + drift);
}

function seedStock(world, key) {
  return world.store?.seed?.[key] ?? 0;
}

function clampLineQty(line, maxQty) {
  if (maxQty <= 0) return null;
  const qty = Math.min(line.qty ?? 0, maxQty);
  if (qty <= 0) return null;
  return { ...line, qty };
}

function normaliseRequest(request) {
  if (!request) return { buy: [], sell: [] };
  const buy = Array.isArray(request.buy) ? request.buy.filter(Boolean) : [];
  const sell = Array.isArray(request.sell) ? request.sell.filter(Boolean) : [];
  if (Array.isArray(request.items)) {
    sell.push(...request.items.filter(Boolean));
  }
  if (request.item && request.qty) {
    buy.push({ item: request.item, qty: request.qty });
  }
  return { buy, sell };
}

function lineRevenue(world, line) {
  return (line?.qty ?? 0) * priceFor(line.item, world.calendar.month);
}

function addSellLines(world, sell, thresholds) {
  const S = world.store || {};
  const grainKeep = thresholds.grain_keep ?? 0;
  const grains = [
    { key: 'wheat', item: 'wheat_bu' },
    { key: 'barley', item: 'barley_bu' },
    { key: 'oats', item: 'oats_bu' },
    { key: 'pulses', item: 'pulses_bu' },
  ];
  for (const { key, item } of grains) {
    const have = S[key] ?? 0;
    if (have > grainKeep) {
      sell.push({ item, qty: Math.max(0, have - grainKeep) });
    }
  }
  if ((S.hay ?? 0) > thresholds.hay_target) {
    sell.push({ item: 'hay_t', qty: Math.max(0, (S.hay ?? 0) - thresholds.hay_target) });
  }
  return sell;
}

function addBuyLines(world, buy, thresholds) {
  for (const key of SEED_KEYS) {
    const have = seedStock(world, key);
    const target = thresholds.seeds?.[key] ?? 0;
    if (have < target) {
      buy.push({ item: `seed_${key}_bu`, qty: Math.max(0, target - have) });
    }
  }
  if ((world.store?.hay ?? 0) < thresholds.hay_min) {
    buy.push({ item: 'hay_t', qty: Math.max(0, thresholds.hay_target - (world.store?.hay ?? 0)) });
  }
  return buy;
}

function clampToBudget(world, sellLines, buyLines) {
  const month = world.calendar.month;
  const revenue = sellLines.reduce((acc, line) => acc + lineRevenue(world, line), 0);
  let available = (world.cash ?? 0) + revenue;
  const result = [];
  for (const line of buyLines) {
    const price = priceFor(line.item, month);
    if (price <= 0) continue;
    const affordableQty = Math.min(line.qty ?? 0, available / price);
    if (affordableQty <= 0) continue;
    result.push({ ...line, qty: affordableQty });
    available -= affordableQty * price;
  }
  return { lines: result, availableAfter: available };
}

function clampToCapacity(lines, capacity) {
  if (capacity <= 0) return [];
  const result = [];
  let used = 0;
  for (const line of lines) {
    const left = capacity - used;
    if (left <= 0) break;
    const capped = clampLineQty(line, left);
    if (capped) {
      result.push(capped);
      used += capped.qty;
    }
  }
  return result;
}

export function clampToCapacityAndBudget(world, sell, buy) {
  ensureMarketState(world);
  const thresholds = world.thresholds;
  const autoSell = addSellLines(world, [...sell], thresholds);
  const autoBuy = addBuyLines(world, [...buy], thresholds);
  const sellClamped = clampToCapacity(autoSell, world.cart.capacity ?? DEFAULT_CART_CAPACITY);
  const budgetInfo = clampToBudget(world, sellClamped, autoBuy);
  const buyClamped = clampToCapacity(budgetInfo.lines, world.cart.capacity ?? DEFAULT_CART_CAPACITY);
  const month = world.calendar.month;
  const sellRevenue = sellClamped.reduce((acc, line) => acc + priceFor(line.item, month) * (line.qty ?? 0), 0);
  const buyCost = buyClamped.reduce((acc, line) => acc + priceFor(line.item, month) * (line.qty ?? 0), 0);
  const buyUtility = buyClamped.reduce((acc, line) => acc + priceFor(line.item, month) * (line.qty ?? 0) * BUY_UTILITY_MULTIPLIER, 0);
  const value = sellRevenue + buyUtility;
  return { sellFinal: sellClamped, buyFinal: buyClamped, value, revenue: sellRevenue, cost: buyCost };
}

export function buildMarketManifest(world, request = {}) {
  ensureMarketState(world);
  const thresholds = world.thresholds;
  const { buy: requestBuy, sell: requestSell } = normaliseRequest(request);
  const { sellFinal, buyFinal, value, revenue, cost } = clampToCapacityAndBudget(world, requestSell, requestBuy);
  return { sell: sellFinal, buy: buyFinal, value, revenue, cost };
}

export function estimateManifestValue(world, request = {}) {
  return buildMarketManifest(world, request).value;
}

function absoluteMinutes(world) {
  const monthIndex = Number.isFinite(world.calendar?.monthIndex)
    ? world.calendar.monthIndex
    : (() => {
      const month = world.calendar?.month;
      if (typeof month === 'number' && Number.isFinite(month)) {
        return Math.max(0, Math.floor(month - 1));
      }
      if (typeof month === 'string') {
        const idx = CALENDAR?.MONTHS?.indexOf(month);
        if (idx >= 0) return idx;
      }
      return 0;
    })();
  const day = Math.max(1, (world.calendar?.day ?? 1));
  const dayIndex = (day - 1) + monthIndex * DAYS_PER_MONTH;
  return dayIndex * MINUTES_PER_DAY + (world.calendar?.minute ?? 0);
}

export function estimateRoundTripMinutes(world) {
  ensureMarketState(world);
  const yard = world.locations?.yard
    ?? world.farmhouse
    ?? PACK.estate?.farmhouse
    ?? { x: 0, y: 0 };
  const market = world.locations?.market
    ?? PACK.estate?.market
    ?? yard;
  const dx = Math.abs((yard.x ?? 0) - (market.x ?? 0));
  const dy = Math.abs((yard.y ?? 0) - (market.y ?? 0));
  const stepsOneWay = dx + dy;
  const travel = 2 * stepsOneWay * MOVE_MIN_PER_STEP;
  return travel + 2 * LOAD_UNLOAD_MIN;
}

function estimateTripCost(world) {
  const labourValue = world.thresholds?.labourValuePerMin ?? DEFAULT_LABOUR_VALUE_PER_MIN;
  return estimateRoundTripMinutes(world) * labourValue;
}

export function marketOpenNow(world) {
  const minute = world.calendar.minute ?? 0;
  const open = MARKET_HOURS.open ?? 0;
  const close = MARKET_HOURS.close ?? MINUTES_PER_DAY;
  return minute >= open && minute <= close;
}

export function travelPenalty(world) {
  return Math.min(TRAVEL_PENALTY_CAP, estimateRoundTripMinutes(world) / 60);
}

export function needsMarketTrip(world, request = {}) {
  ensureMarketState(world);
  const thresholds = world.thresholds;
  const store = world.store || {};
  const seeds = store.seed || {};
  const buySeeds = SEED_KEYS.some((key) => (seeds[key] ?? 0) < (thresholds.seeds?.[key] ?? 0));
  const buyFeed = (store.hay ?? 0) < (thresholds.hay_min ?? 0);
  const grainTotal = (store.wheat ?? 0) + (store.barley ?? 0) + (store.oats ?? 0) + (store.pulses ?? 0);
  const sellGrain = grainTotal > (thresholds.grain_surplus ?? Infinity);
  const debtDue = !!(world.finance?.loanDueWithinHours?.(DEBT_HORIZON_HOURS))
    && (world.finance?.cash ?? world.cash ?? 0) < (thresholds.cash_min ?? 0);
  const manifest = buildMarketManifest(world, request);
  const manifestValue = manifest.value;
  const travelCost = estimateTripCost(world);
  const minValueBase = thresholds.manifest_value_min ?? DEFAULT_MANIFEST_VALUE_MIN;
  const essentialWeight = MANIFEST_DISCOUNTS.essential ?? 1;
  const seedWeight = MANIFEST_DISCOUNTS.seeds ?? 1;
  const defaultWeight = MANIFEST_DISCOUNTS.default ?? 1;
  const minValue = (buySeeds || buyFeed) ? minValueBase * (buyFeed ? essentialWeight : seedWeight) : minValueBase;
  const urgencyFactor = buyFeed || debtDue ? essentialWeight : (buySeeds ? seedWeight : defaultWeight);
  const tradeThreshold = travelCost * urgencyFactor;
  const goodTrade = manifestValue >= Math.max(minValue, tradeThreshold);
  const lastTrip = world.market.lastTripAt ?? -Infinity;
  const cooldownOk = (absoluteMinutes(world) - lastTrip) >= (world.market.cooldownMin ?? DEFAULT_COOLDOWN_MIN);
  const hasManifest = (manifest.sell.length + manifest.buy.length) > 0;
  const ok = hasManifest && (buySeeds || buyFeed || sellGrain || debtDue) && goodTrade && cooldownOk;
  return { ok, buySeeds, buyFeed, sellGrain, debtDue, manifest, manifestValue, travelCost, goodTrade, cooldownOk };
}

export function transactAtMarket(world, manifest) {
  ensureMarketState(world);
  const month = world.calendar.month;
  let cashDelta = 0;
  for (const line of manifest.sell || []) {
    const qty = Math.max(0, line.qty ?? 0);
    if (qty <= 0) continue;
    switch (line.item) {
      case 'wheat_bu': world.store.wheat = Math.max(0, (world.store.wheat ?? 0) - qty); break;
      case 'barley_bu': world.store.barley = Math.max(0, (world.store.barley ?? 0) - qty); break;
      case 'oats_bu': world.store.oats = Math.max(0, (world.store.oats ?? 0) - qty); break;
      case 'pulses_bu': world.store.pulses = Math.max(0, (world.store.pulses ?? 0) - qty); break;
      case 'hay_t': world.store.hay = Math.max(0, (world.store.hay ?? 0) - qty); break;
      case 'straw_t': world.store.straw = Math.max(0, (world.store.straw ?? 0) - qty); break;
      case 'cider_l': world.store.cider_l = Math.max(0, (world.store.cider_l ?? 0) - qty); break;
      case 'meat_lb': world.store.meat_salted = Math.max(0, (world.store.meat_salted ?? 0) - qty); break;
      case 'bacon_side': world.store.bacon_sides = Math.max(0, (world.store.bacon_sides ?? 0) - qty); break;
      default: break;
    }
    cashDelta += qty * priceFor(line.item, month);
  }
  for (const line of manifest.buy || []) {
    const qty = Math.max(0, line.qty ?? 0);
    if (qty <= 0) continue;
    switch (line.item) {
      case 'seed_wheat_bu': world.store.seed.wheat = (world.store.seed.wheat ?? 0) + qty; break;
      case 'seed_barley_bu': world.store.seed.barley = (world.store.seed.barley ?? 0) + qty; break;
      case 'seed_oats_bu': world.store.seed.oats = (world.store.seed.oats ?? 0) + qty; break;
      case 'seed_pulses_bu': world.store.seed.pulses = (world.store.seed.pulses ?? 0) + qty; break;
      case 'oats_bu': world.store.oats = (world.store.oats ?? 0) + qty; break;
      case 'hay_t': world.store.hay = (world.store.hay ?? 0) + qty; break;
      default: break;
    }
    cashDelta -= qty * priceFor(line.item, month);
  }
  world.cash = (world.cash ?? 0) + cashDelta;
  world.finance.cash = world.cash;
  world.market.lastTripAt = absoluteMinutes(world);
  world.market.tripInProgress = false;
  world.market.lastPlannedManifest = manifest;
  return cashDelta;
}

export { MOVE_MIN_PER_STEP, LOAD_UNLOAD_MIN };
