import test from 'node:test';
import assert from 'node:assert/strict';

import { needsMarketTrip, computeMarketManifest, transactAtMarket } from '../market.js';
import { canScheduleMarketTrip } from '../jobs/market_trip.js';
import { MINUTES_PER_DAY } from '../time.js';
import { DAYS_PER_MONTH } from '../constants.js';
import { ARABLE_PLANTS, SEED_CONFIGS } from '../config/plants.js';

const GRAIN_STORE_KEYS = Array.from(new Set(
  ARABLE_PLANTS
    .filter((plant) => plant.primaryYield?.unit === 'bu' && plant.primaryYield?.storeKey)
    .map((plant) => plant.primaryYield.storeKey)
));

const GRAIN_MARKET_ITEMS = ARABLE_PLANTS
  .filter((plant) => plant.primaryYield?.unit === 'bu' && plant.primaryYield?.storeKey && plant.primaryYield?.marketKey)
  .map((plant) => ({ storeKey: plant.primaryYield.storeKey, marketItem: plant.primaryYield.marketKey }));

const SEED_INVENTORY_KEYS = SEED_CONFIGS
  .map((config) => config.inventoryKey)
  .filter((key) => typeof key === 'string' && key.length > 0);

function makeGrainStore(values = {}) {
  return Object.fromEntries(GRAIN_STORE_KEYS.map((key) => [key, values[key] ?? 0]));
}

function makeSeedStore(values = {}) {
  return Object.fromEntries(SEED_INVENTORY_KEYS.map((key) => [key, values[key] ?? 0]));
}

function makeWorldForCooldownCheck() {
  return {
    calendar: { month: 'II', monthIndex: 1, day: 1, minute: 0 },
    store: {
      hay: 0,
      ...makeGrainStore(),
      seed: makeSeedStore(),
    },
    finance: { loanDueWithinHours: () => false, cash: 100 },
    market: {
      lastTripAt: DAYS_PER_MONTH * MINUTES_PER_DAY - 60,
      cooldownMin: 60,
    },
    cash: 100,
  };
}

test('needsMarketTrip respects cooldown across roman numeral months', () => {
  const world = makeWorldForCooldownCheck();
  const result = needsMarketTrip(world);
  assert.equal(result.cooldownOk, true);
  assert.ok(
    (result.manifest.buy.length + result.manifest.sell.length) > 0,
    'Expected manifest to include at least one line',
  );
  assert.ok(Array.isArray(result.manifestOps) && result.manifestOps.length > 0, 'Expected manifestOps to contain operations');
  assert.equal(result.simulation?.ok, true);
});

test('market cooldown remains monotonic across year boundaries', () => {
  const world = makeWorldForCooldownCheck();
  world.calendar.year = 1;
  world.calendar.month = 'VIII';
  world.calendar.monthIndex = 7;
  world.calendar.day = DAYS_PER_MONTH;
  world.calendar.minute = MINUTES_PER_DAY - 30;
  world.market.cooldownMin = 60;

  const recorded = transactAtMarket(world, []);
  assert.equal(recorded.ok, true, 'Expected trip recording to succeed');

  world.calendar = {
    year: 2,
    month: 'I',
    monthIndex: 0,
    day: 1,
    minute: 90,
  };

  const nextTrip = needsMarketTrip(world);
  assert.equal(nextTrip.cooldownOk, true, 'Cooldown should allow trip after year rollover');
});

function makeWorldForLowValueManifest() {
  return {
    calendar: { month: 'I', monthIndex: 0, day: 1, minute: 9 * 60 },
    store: {
      hay: 6,
      ...makeGrainStore({ wheat: 120, barley: 120, oats: 120, pulses: 120 }),
      seed: makeSeedStore({ wheat: 12, barley: 12, oats: 12, pulses: 12 }),
    },
    finance: { loanDueWithinHours: () => false, cash: 100 },
    market: {
      lastTripAt: -Infinity,
      cooldownMin: 0,
    },
    thresholds: { manifest_value_min: 50, grain_keep: Infinity, grain_surplus: Infinity },
    cash: 100,
  };
}

function makeWorldForHaySurplus() {
  return {
    calendar: { month: 'I', monthIndex: 0, day: 1, minute: 9 * 60 },
    store: {
      hay: 20,
      ...makeGrainStore({ wheat: 120, barley: 120, oats: 120, pulses: 120 }),
      seed: makeSeedStore({ wheat: 12, barley: 12, oats: 12, pulses: 12 }),
    },
    finance: { loanDueWithinHours: () => false, cash: 100 },
    market: {
      lastTripAt: -Infinity,
      cooldownMin: 0,
    },
    thresholds: { grain_keep: Infinity, grain_surplus: Infinity },
    cash: 100,
  };
}

function makeWorldForGrainDistribution() {
  return {
    calendar: { month: 'I', monthIndex: 0, day: 1, minute: 9 * 60 },
    store: {
      hay: 6,
      ...makeGrainStore({ wheat: 60, barley: 60, oats: 60, pulses: 60 }),
      seed: makeSeedStore({ wheat: 12, barley: 12, oats: 12, pulses: 12 }),
    },
    finance: { loanDueWithinHours: () => false, cash: 100 },
    market: {
      lastTripAt: -Infinity,
      cooldownMin: 0,
    },
    cart: { capacity: 500 },
    thresholds: {
      grain_keep: 120,
      grain_surplus: 140,
    },
    cash: 100,
  };
}

function makeWorldForManualRequest() {
  return {
    calendar: { month: 'I', monthIndex: 0, day: 1, minute: 9 * 60 },
    store: {
      hay: 6,
      ...makeGrainStore({ wheat: 120, barley: 120, oats: 120, pulses: 120 }),
      seed: makeSeedStore({ wheat: 12, barley: 12, oats: 12, pulses: 12 }),
    },
    finance: { loanDueWithinHours: () => false, cash: 100 },
    market: {
      lastTripAt: -Infinity,
      cooldownMin: 0,
    },
    cash: 100,
  };
}

test('canScheduleMarketTrip mirrors needsMarketTrip rejection for low-value manifests', () => {
  const request = { buy: [{ item: 'hay_t', qty: 1, reason: 'top up hay' }] };
  const needsWorld = makeWorldForLowValueManifest();
  const scheduleWorld = makeWorldForLowValueManifest();
  const needs = needsMarketTrip(needsWorld, request);
  assert.equal(needs.ok, false, 'needsMarketTrip should reject the low-value manifest');
  const gate = canScheduleMarketTrip(scheduleWorld, request);
  assert.equal(gate.ok, false, 'scheduler should refuse the same manifest');
  assert.ok(gate.reason.includes('value'), 'expected scheduler to explain low manifest value');
  assert.deepEqual(
    gate.summary.buy.map((line) => ({ item: line.item, qty: line.qty })),
    needs.manifest.buy.map((line) => ({ item: line.item, qty: line.qty })),
    'scheduler summary should mirror the rejected manifest lines',
  );
});

test('computeMarketManifest buys pulse seed when inventory is low', () => {
  const world = {
    calendar: { month: 'I', monthIndex: 0, day: 1, minute: 9 * 60 },
    store: {
      hay: 6,
      ...makeGrainStore({ wheat: 120, barley: 120, oats: 120, pulses: 120 }),
      seed: makeSeedStore({ wheat: 12, barley: 12, oats: 12, pulses: 0 }),
    },
    finance: { loanDueWithinHours: () => false, cash: 100 },
    market: {
      lastTripAt: -Infinity,
      cooldownMin: 0,
    },
    cash: 100,
  };

  const manifest = computeMarketManifest(world);
  const pulseSeedLine = manifest.buy.find((line) => line.item === 'seed_pulses_bu');

  assert.ok(pulseSeedLine, 'Expected manifest to include a pulse seed purchase line');
  assert.ok(pulseSeedLine.qty > 0, 'Expected positive quantity for pulse seed purchase');
});

test('hay surplus manifests trigger market trips', () => {
  const needsWorld = makeWorldForHaySurplus();
  const scheduleWorld = makeWorldForHaySurplus();

  const needs = needsMarketTrip(needsWorld);
  assert.equal(needs.sellHay, true, 'Expected hay surplus to be detected');
  assert.equal(needs.ok, true, 'Hay surplus manifest should be approved');
  assert.ok(
    needs.manifest.sell.some((line) => line.item === 'hay_t' && line.qty > 0),
    'Manifest should include hay sale line',
  );

  const gate = canScheduleMarketTrip(scheduleWorld);
  assert.equal(gate.ok, true, 'Scheduler should approve hay surplus manifest');
  assert.ok(
    gate.manifest.some((op) => op.kind === 'sell' && op.item === 'hay_t'),
    'Scheduler should schedule hay sale operation',
  );
});

test('grain surplus manifests sell down to the keep level across cereals', () => {
  const world = makeWorldForGrainDistribution();
  const needs = needsMarketTrip(world);

  assert.equal(needs.sellGrain, true, 'Expected grain surplus trigger to be active');

  const grainItemSet = new Set(GRAIN_MARKET_ITEMS.map(({ marketItem }) => marketItem));
  const totalGrain = GRAIN_STORE_KEYS.reduce((acc, key) => acc + (world.store[key] ?? 0), 0);
  const grainKeep = world.thresholds.grain_keep;

  const grainSellLines = needs.manifest.sell.filter((line) => grainItemSet.has(line.item));
  assert.ok(grainSellLines.length > 0, 'Expected manifest to include grain sale lines');
  for (const line of grainSellLines) {
    assert.ok(line.qty > 0, `Expected positive grain sale quantity for ${line.item}`);
  }

  const soldQty = grainSellLines.reduce((acc, line) => acc + line.qty, 0);
  assert.equal(soldQty, totalGrain - grainKeep, 'Manifest should sell down to the keep level');
  assert.equal(needs.ok, true, 'Manifest should be approved when grain surplus can be sold');

  const record = transactAtMarket(world, needs.manifestOps, needs.manifest);
  assert.equal(record.ok, true, 'Market transaction should succeed');

  const followup = needsMarketTrip(world);
  assert.equal(followup.sellGrain, false, 'Grain surplus trigger should clear after sales are applied');

  const followupSoldQty = followup.manifest.sell
    .filter((line) => grainItems.includes(line.item))
    .reduce((acc, line) => acc + line.qty, 0);
  assert.equal(followupSoldQty, 0, 'No further grain sales should be scheduled once at keep level');

  const remainingGrain = grainKeys.reduce((acc, key) => acc + (world.store[key] ?? 0), 0);
  assert.equal(remainingGrain, grainKeep, 'Grain inventory should match the keep level after sale');
});

test('explicit market requests trigger market trips', () => {
  const request = { buy: [{ item: 'straw_t', qty: 5, reason: 'restock straw' }] };
  const needsWorld = makeWorldForManualRequest();
  const scheduleWorld = makeWorldForManualRequest();

  const needs = needsMarketTrip(needsWorld, request);
  assert.equal(needs.requestLines, true, 'Expected request lines to be detected');
  assert.equal(needs.ok, true, 'Manual request manifest should be approved');
  assert.ok(
    needs.manifest.buy.some((line) => line.item === 'straw_t' && line.qty > 0),
    'Manifest should include requested straw purchase',
  );

  const gate = canScheduleMarketTrip(scheduleWorld, request);
  assert.equal(gate.ok, true, 'Scheduler should approve manual request');
  assert.ok(
    gate.manifest.some((op) => op.kind === 'buy' && op.item === 'straw_t'),
    'Scheduler should schedule straw purchase operation',
  );
});
