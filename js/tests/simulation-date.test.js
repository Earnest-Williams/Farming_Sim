import assert from 'node:assert/strict';

import { createInitialWorld } from '../world.js';
import { dailyTurn } from '../simulation.js';
import { DAYS_PER_MONTH, MONTH_NAMES } from '../constants.js';

export function testDailyTurnMonthRollover() {
  const world = createInitialWorld();

  world.calendar.month = MONTH_NAMES[MONTH_NAMES.length - 1];
  world.calendar.monthIndex = MONTH_NAMES.length - 1;
  world.calendar.day = DAYS_PER_MONTH;
  world.calendar.year = 3;
  world.flexChoice = 'OATS';

  dailyTurn(world);

  assert.equal(world.calendar.day, 1, 'day should reset at month boundary');
  assert.equal(world.calendar.monthIndex, 0, 'monthIndex should wrap to zero');
  assert.equal(world.calendar.month, MONTH_NAMES[0], 'month label should match wrapped index');
  assert.equal(world.calendar.year, 4, 'year should increment when month wraps');
  assert.equal(world.daylight.month, MONTH_NAMES[0], 'daylight schedule should align with month label');
}
