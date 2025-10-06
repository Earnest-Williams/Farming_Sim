import { strict as assert } from 'node:assert';

import { createEngineState, tick } from '../engine.js';
import { JOBS } from '../jobs.js';
import { ARABLE_PLANTS, SEED_CONFIGS } from '../config/plants.js';

const GRAIN_STORE_KEYS = Array.from(new Set(
  ARABLE_PLANTS
    .filter((plant) => plant.primaryYield?.unit === 'bu' && plant.primaryYield?.storeKey)
    .map((plant) => plant.primaryYield.storeKey),
));

const SEED_INVENTORY_KEYS = SEED_CONFIGS
  .map((config) => config.inventoryKey)
  .filter((key) => typeof key === 'string' && key.length > 0);

function makeGrainStore(values = {}) {
  return Object.fromEntries(GRAIN_STORE_KEYS.map((key) => [key, values[key] ?? 0]));
}

function makeSeedStore(values = {}) {
  return Object.fromEntries(SEED_INVENTORY_KEYS.map((key) => [key, values[key] ?? 0]));
}

function makeHaySurplusWorld() {
  const hayReserve = 20;
  const cashReserve = 120;
  const world = {
    calendar: { year: 1, month: 'I', day: 1, minute: 9 * 60 },
    locations: { yard: { x: 0, y: 0 }, market: { x: 6, y: 0 } },
    store: {
      hay: hayReserve,
      ...makeGrainStore({ wheat: 180, barley: 160, oats: 140, pulses: 120 }),
      seed: makeSeedStore({ wheat: 20, barley: 20, oats: 18, pulses: 15 }),
    },
    finance: { loanDueWithinHours: () => false, cash: cashReserve },
    market: { lastTripAt: -Infinity, cooldownMin: 0 },
    thresholds: { grain_keep: Infinity, grain_surplus: Infinity },
    cash: cashReserve,
    logs: [],
  };

  let drained = false;
  let planCount = 0;
  const initialHay = world.store.hay;
  const initialCash = world.cash;

  Object.defineProperty(world.market, 'nextManifestOps', {
    configurable: true,
    enumerable: true,
    get() {
      return this._nextManifestOps ?? null;
    },
    set(value) {
      this._nextManifestOps = value;
      planCount += 1;
      if (!drained && planCount >= 2 && Array.isArray(value) && value.length) {
        drained = true;
        for (const key of Object.keys(world.store)) {
          if (key === 'seed' && world.store.seed && typeof world.store.seed === 'object') {
            for (const seedKey of Object.keys(world.store.seed)) {
              world.store.seed[seedKey] = 0;
            }
          } else if (typeof world.store[key] === 'number') {
            world.store[key] = 0;
          }
        }
        world.cash = 0;
        world.finance.cash = 0;
      }
    },
  });

  return { world, initialHay, initialCash };
}

export async function testMarketTripRetryAfterCanApplyFailure() {
  const originalJobs = JOBS.slice();
  const marketJob = originalJobs.find((job) => job.id === 'market_trip');
  assert.ok(marketJob, 'Expected baseline market trip job to exist');

  const { world, initialHay, initialCash } = makeHaySurplusWorld();
  const state = createEngineState(world);

  JOBS.splice(0, JOBS.length, marketJob);

  try {
    const firstConsumed = tick(state, 1);
    assert.equal(firstConsumed, 0, 'Blocked attempt should not consume labour');
    assert.equal(state.currentTask, null, 'Blocked market trip should not become active');

    const skip = state.taskSkips.get(marketJob.id);
    assert.ok(skip, 'Skip metadata should be recorded when market trip cannot apply');
    assert.ok(typeof skip.reason === 'string' && skip.reason.length > 0, 'Skip reason should be recorded');
    assert.ok(state.world.logs.some((line) => line.includes('Cart goods to market') && line.includes('waiting')));
    assert.ok(state.world.logs.some((line) => /insufficient/i.test(line)), 'World log should capture manifest failure detail');
    assert.ok(!state.progress.done.has(marketJob.id), 'Blocked job must remain outstanding');

    // Inventory improves: replenish hay and cash so the manifest becomes viable again.
    world.store.hay = initialHay;
    world.cash = initialCash;
    world.finance.cash = initialCash;

    state.world.calendar.minute = Math.floor(skip.blockedUntil) + 1;

    tick(state, 1);
    assert.ok(state.currentTask, 'Market trip should be scheduled once prerequisites are met');
    assert.equal(state.currentTask.definition, marketJob, 'Scheduled task should be the market trip job');
    assert.ok(!state.taskSkips.has(marketJob.id), 'Skip metadata should clear after successful scheduling');
  } finally {
    JOBS.splice(0, JOBS.length, ...originalJobs);
  }
}

