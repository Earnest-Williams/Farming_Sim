import { assertCloseFieldWithinSteps, assertStepMatchesTick } from './config-pack.test.js';
import {
  testMovementEtaDeterminism,
  testTaskProgressGatedByArrival,
  testWorldFarmerStateSync,
  testMonthRolloverBoundaries,
  testOneBasedMonthIndex,
} from './simulation-clock.test.js';
import { testSeasonOfMonthAcceptsRomanNumerals } from './constants.test.js';
import { testDailyTurnMonthRollover } from './simulation-date.test.js';

const tests = [
  ['config close field within steps', assertCloseFieldWithinSteps],
  ['config travel step matches tick', assertStepMatchesTick],
  ['movement eta determinism', testMovementEtaDeterminism],
  ['task gating by location', testTaskProgressGatedByArrival],
  ['world farmer mirrors engine state', testWorldFarmerStateSync],
  ['month rollover boundaries', testMonthRolloverBoundaries],
  ['daily turn month rollover preserves labels', testDailyTurnMonthRollover],
  ['one-based month index preserves first month', testOneBasedMonthIndex],
  ['season helper accepts roman numerals', testSeasonOfMonthAcceptsRomanNumerals],
];

let failed = false;

for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('All tests passed');
}
