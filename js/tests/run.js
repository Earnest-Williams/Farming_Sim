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
import { testAnimalSchema, testAnimalIntegration } from './animals.test.js';
import {
  testPlantSchema,
  testRotationPlants,
  testArableRenderAssets,
  testSeedAndStrawMaps,
  testGardenPlantsPresent,
} from './plants.test.js';
import { testMenuToggleHandlesMissingDrawer } from './ui-menu.test.js';
import {
  testJobsInWindowHandlesWraparound,
  testJobsInWindowSingleMonthInvariant,
} from './scheduler.test.js';

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
  ['animal data schema validated', testAnimalSchema],
  ['animal data drives simulation', testAnimalIntegration],
  ['plant data schema validated', testPlantSchema],
  ['rotation plants resolvable', testRotationPlants],
  ['arable plants provide render assets', testArableRenderAssets],
  ['seed and straw helpers consistent', testSeedAndStrawMaps],
  ['garden plants enumerated', testGardenPlantsPresent],
  ['menu toggle tolerates missing drawer', testMenuToggleHandlesMissingDrawer],
  ['jobs window handles wraparound', testJobsInWindowHandlesWraparound],
  ['jobs window single month invariant', testJobsInWindowSingleMonthInvariant],
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
