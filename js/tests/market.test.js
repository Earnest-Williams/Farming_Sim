import test from 'node:test';
import assert from 'node:assert/strict';

import { needsMarketTrip } from '../market.js';
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
