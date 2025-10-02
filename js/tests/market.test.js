import test from 'node:test';
import assert from 'node:assert/strict';

import { needsMarketTrip, computeMarketManifest, transactAtMarket } from '../market.js';
import { canScheduleMarketTrip } from '../jobs/market_trip.js';
import { MINUTES_PER_DAY } from '../time.js';
import { DAYS_PER_MONTH } from '../constants.js';

function makeWorldForCooldownCheck() {
  return {
    calendar: { month: 'II', monthIndex: 1, day: 1, minute: 0 },
    store: {
      hay: 0,
      wheat: 0,
      barley: 0,
      oats: 0,
      pulses: 0,
      seed: { wheat: 0, barley: 0, oats: 0, pulses: 0 },
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
      wheat: 120,
      barley: 120,
      oats: 120,
      pulses: 120,
      seed: { wheat: 12, barley: 12, oats: 12, pulses: 12 },
    },
    finance: { loanDueWithinHours: () => false, cash: 100 },
    market: {
      lastTripAt: -Infinity,
      cooldownMin: 0,
    },
    thresholds: { manifest_value_min: 50 },
    cash: 100,
  };
}

function makeWorldForHaySurplus() {
  return {
    calendar: { month: 'I', monthIndex: 0, day: 1, minute: 9 * 60 },
    store: {
      hay: 20,
      wheat: 120,
      barley: 120,
      oats: 120,
      pulses: 120,
      seed: { wheat: 12, barley: 12, oats: 12, pulses: 12 },
    },
    finance: { loanDueWithinHours: () => false, cash: 100 },
    market: {
      lastTripAt: -Infinity,
      cooldownMin: 0,
    },
    cash: 100,
  };
}

function makeWorldForManualRequest() {
  return {
    calendar: { month: 'I', monthIndex: 0, day: 1, minute: 9 * 60 },
    store: {
      hay: 6,
      wheat: 120,
      barley: 120,
      oats: 120,
      pulses: 120,
      seed: { wheat: 12, barley: 12, oats: 12, pulses: 12 },
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
      wheat: 120,
      barley: 120,
      oats: 120,
      pulses: 120,
      seed: { wheat: 12, barley: 12, oats: 12, pulses: 0 },
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
