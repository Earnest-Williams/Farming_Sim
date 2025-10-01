import { strict as assert } from 'node:assert';
import { seasonOfMonth } from '../constants.js';

export function testSeasonOfMonthAcceptsRomanNumerals() {
  assert.strictEqual(seasonOfMonth('I'), 'Spring');
  assert.strictEqual(seasonOfMonth('iv'), 'Summer');
  assert.strictEqual(seasonOfMonth('VII'), 'Winter');
  assert.strictEqual(seasonOfMonth(0), 'Spring');
  assert.strictEqual(seasonOfMonth(3), 'Summer');
}
