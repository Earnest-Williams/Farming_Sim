import assert from 'node:assert/strict';

import { createInitialWorld } from '../world.js';
import { dailyWeatherEvents } from '../weather.js';

export async function testWeatherUsesWorldRng() {
  const world = createInitialWorld();

  world.calendar.month = 'III';
  world.weather.wind_ms = 12;
  world.weather.dryStreakDays = 2;

  const parcelIndex = world.parcelByKey?.field_2 ?? world.parcelByKey?.field_1;
  assert.ok(Number.isInteger(parcelIndex), 'an arable parcel should exist for lodging checks');
  world.parcelByKey.barley_clover = parcelIndex;
  const parcel = world.parcels[parcelIndex];
  parcel.rows = [{ crop: { id: 'BARLEY' }, growth: 0.75 }];
  parcel.status.mud = 0.4;
  parcel.status.lodgingPenalty = 0;

  let rngCalls = 0;
  world.rng = () => {
    rngCalls += 1;
    return 0.25;
  };

  const originalRandom = Math.random;
  let mathRandomCalls = 0;
  Math.random = () => {
    mathRandomCalls += 1;
    return 0.9;
  };

  try {
    dailyWeatherEvents(world);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(mathRandomCalls, 0, 'weather events should not fall back to Math.random when world RNG exists');
  assert.ok(rngCalls > 0, 'world RNG should be used for lodging rolls');
  const expectedPenalty = 0.08 + 0.04 * 0.25;
  assert.equal(parcel.status.lodgingPenalty, expectedPenalty, 'lodging penalty should reflect deterministic roll');
}

