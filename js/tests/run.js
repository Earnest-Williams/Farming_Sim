import { assertCloseFieldWithinSteps, assertStepMatchesTick } from './config-pack.test.js';
import {
  testMovementEtaDeterminism,
  testTaskProgressGatedByArrival,
  testWorldFarmerStateSync,
  testMonthRolloverBoundaries,
  testOneBasedMonthIndex,
} from './simulation-clock.test.js';

const tests = [
  ['config close field within steps', assertCloseFieldWithinSteps],
  ['config travel step matches tick', assertStepMatchesTick],
  ['movement eta determinism', testMovementEtaDeterminism],
  ['task gating by location', testTaskProgressGatedByArrival],
  ['world farmer mirrors engine state', testWorldFarmerStateSync],
  ['month rollover boundaries', testMonthRolloverBoundaries],
  ['one-based month index preserves first month', testOneBasedMonthIndex],
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
