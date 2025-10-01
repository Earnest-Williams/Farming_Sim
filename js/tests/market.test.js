import test from 'node:test';
import assert from 'node:assert/strict';

import { needsMarketTrip } from '../market.js';
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
