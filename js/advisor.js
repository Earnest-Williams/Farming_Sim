import { clamp } from './utils.js';
import {
  CROPS,
  DEMAND,
  TASK_KINDS,
  WORK_MINUTES,
  LABOUR_DAY_MIN,
  ROTATION,
} from './constants.js';
import { seedNeededForParcel } from './constants.js';
import { estimateParcelYieldBushelsWithTiming, priceFor } from './state.js';
import { makeTask } from './tasks.js';
import { estimateRoundTripMinutes } from './market.js';
import { ANIMALS, computeDailyNeedsForAnimal } from './config/animals.js';
import {
  SEED_CONFIG_BY_PLANT_ID,
  SEED_CONFIG_BY_MARKET_ITEM,
  PRIMARY_YIELD_MARKET_KEY_BY_ID,
  PRIMARY_YIELD_STORE_KEY_BY_ID,
} from './config/plants.js';

function dailyFeedNeeds(world) {
  const L = world.livestock || {};
  const H = world.herdLoc || {};
  let oats_bu = 0;
  let hay_t = 0;
  for (const animal of ANIMALS) {
    const count = Number(L[animal.id]) || 0;
    if (count <= 0) continue;
    const herdLocation = H?.[animal.id] ?? L?.where?.[animal.id];
    const needs = computeDailyNeedsForAnimal(animal, count, herdLocation);
    oats_bu += needs.oats_bu;
    hay_t += needs.hay_t;
  }
  return { oats_bu, hay_t };
}

const BARLEY_STORE_KEY = PRIMARY_YIELD_STORE_KEY_BY_ID.BARLEY ?? 'barley';
const BARLEY_MARKET_ITEM = PRIMARY_YIELD_MARKET_KEY_BY_ID.BARLEY ?? 'barley_bu';
export function updateKPIs(world) {
  const S = world.store;
  const m = world.calendar.month;
  const d = world.calendar.day;
  const { oats_bu: oatsDaily, hay_t: hayDaily } = dailyFeedNeeds(world);
  const wheatDaily = DEMAND.household_wheat_bu_per_day;
  world.kpi.oats_days_cover = oatsDaily > 0 ? (S.oats / oatsDaily) : Infinity;
  world.kpi.hay_days_cover = hayDaily > 0 ? (S.hay / hayDaily) : Infinity;
  world.kpi.wheat_days_cover = wheatDaily > 0 ? (S.wheat / wheatDaily) : Infinity;

  const seed_gaps = [];
  for (const p of world.parcels) {
    if (!p.rows?.length) continue;
    const sowQueued = world.tasks?.month?.queued?.some(t => t.kind === TASK_KINDS.Sow && t.parcelId === p.id);
    if (!sowQueued) continue;
    const payloadCrop = world.tasks.month.queued.find(t => t.kind === TASK_KINDS.Sow && t.parcelId === p.id)?.payload?.crop;
    const rotationPlant = Number.isInteger(p.rotationIndex) ? ROTATION[p.rotationIndex] : null;
    const key = payloadCrop || rotationPlant?.id || null;
    if (!key) continue;
    const need = seedNeededForParcel(p, key);
    if (need <= 0) continue;
    const config = SEED_CONFIG_BY_PLANT_ID[key];
    const inventoryKey = config?.inventoryKey ?? key.toLowerCase();
    const have = inventoryKey ? (world.store.seed?.[inventoryKey] ?? 0) : 0;
    if (have < need) seed_gaps.push({ parcelId: p.id, key, need, have, short: need - have, inventoryKey });
  }
  world.kpi.seed_gaps = seed_gaps;

  const daysLeft = Math.max(0, 20 - d + 1);
  const avgMudFactor = world.parcels.reduce((s, p) => s + (p.status?.mud || 0), 0) / Math.max(1, world.parcels.length);
  const workability = Math.max(0.4, 1 - 0.6 * avgMudFactor);
  const slots = world.labour.crewSlots || 4;
  const workMinutesToday = Math.max(0, (world.daylight?.workEnd ?? 0) - (world.daylight?.workStart ?? 0));
  const workableMinPerDay = workMinutesToday * slots * workability;
  const month_workable_min_left = workableMinPerDay * daysLeft;
  const reqLeft = (world.tasks?.month?.queued || []).filter(t => t.latestDay >= d).reduce((s, t) => s + Math.max(0, (t.estMin - t.doneMin)), 0);
  world.kpi.month_workable_min_left = Math.round(month_workable_min_left);
  world.kpi.month_required_min_left = Math.round(reqLeft);
  world.kpi.labour_pressure = reqLeft > 0 ? (reqLeft / Math.max(1, month_workable_min_left)) : 0;

  let risky = 0, total = 0;
  for (const t of world.tasks.month.queued) {
    total++;
    const slackMin = Math.max(0, (t.latestDay - d)) * LABOUR_DAY_MIN * slots * 0.5;
    if (t.estMin > slackMin) risky++;
  }
  world.kpi.deadline_risk = total ? risky / total : 0;

  const W = [];
  if (world.kpi.oats_days_cover < 30) W.push('Oats < 30 days');
  if (world.kpi.hay_days_cover < 30) W.push('Hay < 30 days');
  if (world.kpi.wheat_days_cover < 60) W.push('Wheat < 60 days');
  if (world.kpi.labour_pressure > 1.1) W.push('Labour overcommitted');
  if (seed_gaps.length) W.push('Seed shortfalls');
  world.kpi.warnings = W;
}

function expectedBushelPrice(world, key) {
  const marketKey = PRIMARY_YIELD_MARKET_KEY_BY_ID[key];
  return marketKey ? priceFor(marketKey, world.calendar.month) : 0.5;
}

function latenessPenaltyPerDay(t) {
  if (t.kind === TASK_KINDS.Sow || t.kind === TASK_KINDS.HarvestParcel) return 0.01;
  return 0.002;
}

export function taskMarginalValue(world, t) {
  const p = t.parcelId != null ? world.parcels[t.parcelId] : null;
  const d = world.calendar.day;
  const daysLate = Math.max(0, d - t.latestDay);
  if (t.kind === TASK_KINDS.Sow && p) {
    const key = t.payload?.crop;
    const crop = CROPS[key];
    if (!crop) return 0;
    const buPotential = (p.acres || 0) * (crop.baseYield || 0) * 0.6;
    const value = buPotential * expectedBushelPrice(world, key) * (latenessPenaltyPerDay(t) * (daysLate || 1));
    return Math.max(1, value);
  }
  if (t.kind === TASK_KINDS.HarvestParcel && p) {
    const row0 = p.rows?.[0];
    if (!row0 || !row0.crop) return 0;
    const key = row0.crop.key;
    const crop = row0.crop;
    const buEst = estimateParcelYieldBushelsWithTiming(world, p, crop);
    const risk = 0.05 + (p.status.lodgingPenalty || 0);
    return Math.max(1, buEst * expectedBushelPrice(world, key) * risk);
  }
  if (t.kind === TASK_KINDS.CartSheaves) {
    return 25;
  }
  if (t.kind === TASK_KINDS.CutCloverHay || t.kind === TASK_KINDS.CartHay) {
    const need = world.kpi.hay_days_cover < 45 ? 1.0 : 0.3;
    return 200 * need;
  }
  if (t.kind === TASK_KINDS.DrillPlot) {
    return 150;
  }
  if (t.kind === TASK_KINDS.SpreadManure) {
    return 60;
  }
  if (t.kind === TASK_KINDS.HoeRow) {
    return 20;
  }
  if (t.kind === TASK_KINDS.Thresh || t.kind === TASK_KINDS.Winnow) {
    const liquidity = world.cash < 5 ? 2.0 : 1.0;
    return 30 * liquidity;
  }
  if (t.kind === TASK_KINDS.GardenSow) {
    return 10;
  }
  if (t.kind === TASK_KINDS.Repair) {
    return 40;
  }
  return 10;
}

export function reprioritiseByVPM(world) {
  if (!world.tasks?.month?.queued?.length) return;
  for (const t of world.tasks.month.queued) {
    const v = taskMarginalValue(world, t);
    const minutes = Math.max(1, t.estMin - t.doneMin);
    const vpm = v / minutes;
    t.priority = clamp(Math.max(t.priority || 0, Math.round(vpm * 200)), 0, 30);
    if (world.calendar.day > t.latestDay) t.priority = Math.max(t.priority, 20);
  }
  world.tasks.month.queued.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

export function advisorSuggestions(world) {
  const K = world.kpi;
  const S = world.store;
  const sug = [];
  if (K.oats_days_cover < 25) {
    const daysToTarget = 45 - K.oats_days_cover;
    const { oats_bu: dailyOats } = dailyFeedNeeds(world);
    const buyQty = Math.ceil(Math.max(0, daysToTarget) * dailyOats);
    if (buyQty > 0) sug.push({ type: 'buy', item: 'oats_bu', qty: buyQty, reason: 'Oats cover < 45 days' });
  }
  if (K.seed_gaps.length) {
    for (const g of K.seed_gaps) {
      const config = SEED_CONFIG_BY_PLANT_ID[g.key];
      const item = config?.marketItem ?? (g.key ? `seed_${g.key.toLowerCase()}_bu` : null);
      if (item) {
        sug.push({ type: 'buy', item, qty: Math.ceil(g.short), reason: `Seed gap for ${g.key}` });
      }
    }
  }
  if (world.cash < 2 && (S[BARLEY_STORE_KEY] || 0) > 40) {
    sug.push({ type: 'sell', items: [{ item: BARLEY_MARKET_ITEM, qty: Math.floor((S[BARLEY_STORE_KEY] || 0) * 0.1) }], reason: 'Raise cash' });
  }
  world.kpi.suggestions = sug;
  return sug;
}

function buy(world, item, qty) {
  const cost = qty * priceFor(item, world.calendar.month);
  if (world.cash < cost) return false;
  world.cash -= cost;
  if (item === 'oats_bu') {
    world.store.oats += qty;
    return true;
  }
  const seedConfig = SEED_CONFIG_BY_MARKET_ITEM[item];
  if (seedConfig?.inventoryKey) {
    if (!world.store.seed) world.store.seed = {};
    world.store.seed[seedConfig.inventoryKey] = (world.store.seed[seedConfig.inventoryKey] || 0) + qty;
    return true;
  }
  return false;
}

export function advisorExecute(world, mode = 'auto') {
  const sug = advisorSuggestions(world);
  for (const s of sug) {
    if (s.type === 'buy') {
      const ok = buy(world, s.item, s.qty);
        if (!ok) {
          const request = {
            buy: [{ item: s.item, qty: s.qty, reason: s.reason }],
            sell: [{ item: BARLEY_MARKET_ITEM, qty: Math.min(world.store[BARLEY_STORE_KEY] || 0, 40), reason: 'raise_cash' }],
          };
        world.tasks.month.queued.push(makeTask(world, {
          kind: TASK_KINDS.CartToMarket,
          parcelId: null,
          payload: { request },
          latestDay: Math.min(20, world.calendar.day + 3),
          estMin: Math.round(estimateRoundTripMinutes(world)),
          priority: 18,
        }));
      }
    } else if (s.type === 'sell') {
      const request = { sell: s.items, reason: s.reason };
      world.tasks.month.queued.push(makeTask(world, {
        kind: TASK_KINDS.CartToMarket,
        parcelId: null,
        payload: { request },
        latestDay: Math.min(20, world.calendar.day + 2),
        estMin: Math.round(estimateRoundTripMinutes(world)),
        priority: 16,
      }));
    }
  }
}

export function advisorHud(world) {
  const K = world.kpi;
  return [
    `Cover—Oats:${K.oats_days_cover | 0}d Hay:${K.hay_days_cover | 0}d Wheat:${K.wheat_days_cover | 0}d`,
    `Month—Req:${K.month_required_min_left.toLocaleString()}m · Workable:${K.month_workable_min_left.toLocaleString()}m · Pressure:${(K.labour_pressure * 100 | 0)}%`,
    `Risk:${(K.deadline_risk * 100 | 0)}% · Warn:${K.warnings.join(';') || '—'}`,
  ].join(' | ');
}
