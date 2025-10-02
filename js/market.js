import { PRICES, DAYS_PER_MONTH } from './constants.js';
import { MINUTES_PER_DAY, CALENDAR } from './time.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { simulateManifest, applyManifest, operationsToSummary } from './sim/market_exec.js';

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

const MONTHS_PER_YEAR = Array.isArray(CALENDAR?.MONTHS) && CALENDAR.MONTHS.length > 0
  ? CALENDAR.MONTHS.length
  : 1;
const MINUTES_PER_YEAR = MINUTES_PER_DAY * DAYS_PER_MONTH * MONTHS_PER_YEAR;

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
  if (!('nextManifestOps' in world.market)) world.market.nextManifestOps = null;
  if (!('nextManifestSummary' in world.market)) world.market.nextManifestSummary = null;
  if (!('nextManifestReason' in world.market)) world.market.nextManifestReason = null;
  if (!('nextManifestRequest' in world.market)) world.market.nextManifestRequest = null;
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

function evaluateMarketNeeds(world, thresholds, request = {}) {
  const store = world.store || {};
  const seeds = store.seed || {};
  const buySeeds = SEED_KEYS.some((key) => (seeds[key] ?? 0) < (thresholds.seeds?.[key] ?? 0));
  const buyFeed = (store.hay ?? 0) < (thresholds.hay_min ?? 0);
  const grainTotal = (store.wheat ?? 0) + (store.barley ?? 0) + (store.oats ?? 0) + (store.pulses ?? 0);
  const sellGrain = grainTotal > (thresholds.grain_surplus ?? Infinity);
  const hayTarget = thresholds.hay_target ?? Infinity;
  const sellHay = hayTarget < Infinity && (store.hay ?? 0) > hayTarget;
  const debtDue = !!(world.finance?.loanDueWithinHours?.(DEBT_HORIZON_HOURS))
    && (world.finance?.cash ?? world.cash ?? 0) < (thresholds.cash_min ?? 0);
  const requestBuy = Array.isArray(request.buy) ? request.buy : [];
  const requestSell = Array.isArray(request.sell) ? request.sell : [];
  const requestLines = requestBuy.length + requestSell.length > 0;
  return { buySeeds, buyFeed, sellGrain, sellHay, debtDue, requestLines };
}

function requestReason(request) {
  if (!request) return null;
  if (typeof request.reason === 'string' && request.reason.trim()) return request.reason.trim();
  const lines = [];
  if (Array.isArray(request.buy)) lines.push(...request.buy);
  if (Array.isArray(request.sell)) lines.push(...request.sell);
  for (const line of lines) {
    if (line && typeof line.reason === 'string' && line.reason.trim()) {
      return line.reason.trim();
    }
  }
  return null;
}

function manifestLinesToOperations(world, manifest) {
  if (!manifest) return [];
  const month = world.calendar?.month;
  const ops = [];
  for (const line of manifest.sell || []) {
    const qty = Number(line?.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    ops.push({
      kind: 'sell',
      item: line.item,
      qty,
      unitPrice: priceFor(line.item, month),
    });
  }
  for (const line of manifest.buy || []) {
    const qty = Number(line?.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    ops.push({
      kind: 'buy',
      item: line.item,
      qty,
      unitPrice: priceFor(line.item, month),
    });
  }
  return ops;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return `${value}`;
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-9) return `${rounded}`;
  return value.toFixed(2);
}

function formatManifestOps(ops) {
  if (!Array.isArray(ops) || !ops.length) return '';
  return ops
    .map((op) => {
      const qty = formatNumber(op.qty);
      const price = formatNumber(op.unitPrice ?? 0);
      return `${op.kind} ${qty} ${op.item}@${price}`;
    })
    .join(', ');
}

function deriveManifestReason(request, flags, ops) {
  const explicit = requestReason(request);
  if (explicit) return explicit;
  if (flags.buyFeed) return 'hay shortage';
  if (flags.buySeeds) return 'seed shortage';
  if (flags.debtDue) return 'raise cash for debt';
  if (flags.sellGrain) return 'reduce grain surplus';
  if (flags.sellHay) return 'reduce hay surplus';
  if (ops.some((op) => op.kind === 'buy')) return 'market purchases';
  if (ops.some((op) => op.kind === 'sell')) return 'market sales';
  return null;
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
  let grainSurplus = grains.reduce((acc, { key }) => acc + (S[key] ?? 0), 0) - grainKeep;
  if (grainSurplus > 0) {
    for (const { key, item } of grains) {
      if (grainSurplus <= 0) break;
      const have = S[key] ?? 0;
      if (have <= 0) continue;
      const qty = Math.min(have, grainSurplus);
      if (qty > 0) {
        sell.push({ item, qty });
        grainSurplus -= qty;
      }
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

export function computeMarketManifest(world, request = {}) {
  ensureMarketState(world);
  const thresholds = world.thresholds;
  const requestLines = normaliseRequest(request);
  const needs = evaluateMarketNeeds(world, thresholds, requestLines);
  const manifest = buildMarketManifest(world, requestLines);
  const ops = manifestLinesToOperations(world, manifest);
  const reason = deriveManifestReason(request, needs, ops);
  const simulation = simulateManifest(world.store, world.cash, ops);
  return {
    manifest: ops,
    sell: manifest.sell,
    buy: manifest.buy,
    value: manifest.value,
    revenue: manifest.revenue,
    cost: manifest.cost,
    reason,
    needs,
    simulation,
  };
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
  const rawYear = Number(world.calendar?.year);
  const yearIndex = Number.isFinite(rawYear)
    ? Math.max(0, Math.floor(rawYear) - 1)
    : 0;
  const dayIndex = (day - 1) + monthIndex * DAYS_PER_MONTH;
  const rawMinute = Number(world.calendar?.minute);
  const minute = Number.isFinite(rawMinute) ? rawMinute : 0;
  return (yearIndex * MINUTES_PER_YEAR) + (dayIndex * MINUTES_PER_DAY) + minute;
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
  const plan = computeMarketManifest(world, request);
  const thresholds = world.thresholds;
  const {
    buySeeds,
    buyFeed,
    sellGrain,
    sellHay,
    debtDue,
    requestLines,
  } = plan.needs;
  const manifestValue = plan.value;
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
  const hasManifest = (plan.sell.length + plan.buy.length) > 0;
  const manifestViable = !!plan.simulation?.ok;
  const hasTrigger = buySeeds || buyFeed || sellGrain || sellHay || debtDue || requestLines;
  const ok = hasManifest && manifestViable && hasTrigger && goodTrade && cooldownOk;
  return {
    ok,
    buySeeds,
    buyFeed,
    sellGrain,
    sellHay,
    debtDue,
    requestLines,
    manifest: { sell: plan.sell, buy: plan.buy },
    manifestOps: plan.manifest,
    manifestValue,
    travelCost,
    goodTrade,
    cooldownOk,
    reason: plan.reason,
    simulation: plan.simulation,
  };
}

export function transactAtMarket(world, manifest, summary = null) {
  ensureMarketState(world);
  const ops = Array.isArray(manifest) ? manifest : manifestLinesToOperations(world, manifest);
  const beforeCash = world.cash ?? 0;
  const result = applyManifest(world, ops);
  if (!result.ok) return result;
  world.finance.cash = world.cash;
  world.market.lastTripAt = absoluteMinutes(world);
  world.market.tripInProgress = false;
  const summaryManifest = summary ?? operationsToSummary(ops);
  world.market.lastPlannedManifest = summaryManifest;
  if (Array.isArray(world.logs)) {
    const opsSummary = formatManifestOps(ops);
    if (opsSummary) world.logs.push(`Market ops: ${opsSummary}`);
    world.logs.push(`Cash: ${formatNumber(beforeCash)} → ${formatNumber(world.cash ?? 0)}`);
  }
  return { ok: true, manifest: summaryManifest };
}

export { MOVE_MIN_PER_STEP, LOAD_UNLOAD_MIN };
