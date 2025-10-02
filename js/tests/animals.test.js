import { strict as assert } from 'node:assert';
import {
  ANIMALS,
  ANIMAL_IDS,
  INITIAL_LIVESTOCK_COUNTS,
  DEFAULT_LIVESTOCK_LOCATIONS,
  INITIAL_HERD_LOCATIONS,
  computeDailyNeedsForAnimal,
} from '../config/animals.js';
import { makeWorld } from '../world.js';
import { consumeLivestock } from '../simulation.js';

export function testAnimalSchema() {
  assert.ok(ANIMALS.length > 0, 'animal data should not be empty');
  const seen = new Set();
  for (const animal of ANIMALS) {
    assert.strictEqual(typeof animal.id, 'string');
    assert.ok(animal.id.length > 0, 'animal id required');
    assert.ok(!seen.has(animal.id), `duplicate animal id: ${animal.id}`);
    seen.add(animal.id);
    assert.strictEqual(typeof animal.displayName, 'string');
    assert.ok(animal.displayName.length > 0, `display name missing for ${animal.id}`);
    assert.strictEqual(typeof animal.startingCount, 'number');
    assert.ok(animal.startingCount >= 0, `starting count negative for ${animal.id}`);
    assert.ok(animal.feed && typeof animal.feed === 'object', `feed spec missing for ${animal.id}`);
    assert.strictEqual(typeof animal.feed.oats_bu, 'number');
    assert.strictEqual(typeof animal.feed.hay_t, 'number');
    assert.strictEqual(typeof animal.manurePerDay, 'number');
    assert.strictEqual(typeof animal.eggsDozensPerDay, 'number');
    if (animal.pastureIntake_t > 0) {
      assert.ok(typeof animal.pastureParcel === 'string' && animal.pastureParcel.length > 0,
        `pasture parcel required for ${animal.id}`);
    }
    assert.ok(Object.hasOwn(INITIAL_LIVESTOCK_COUNTS, animal.id),
      `initial count missing for ${animal.id}`);
  }
  assert.deepStrictEqual(Array.from(seen).sort(), Array.from(ANIMAL_IDS).sort());
}

function pastureBiomass(world, key) {
  const idx = world.parcelByKey?.[key];
  if (idx == null) return 0;
  const parcel = world.parcels[idx];
  if (!parcel) return 0;
  const pasture = parcel.pasture;
  return pasture?.biomass_t ?? 0;
}

export function testAnimalIntegration() {
  const world = makeWorld(4242);
  const herdKeys = new Set(Object.keys(INITIAL_HERD_LOCATIONS));

  for (const animal of ANIMALS) {
    const count = world.livestock[animal.id] ?? 0;
    assert.strictEqual(count, animal.startingCount, `starting count mismatch for ${animal.id}`);
    if (animal.defaultLocation) {
      assert.strictEqual(world.livestock.where[animal.id], animal.defaultLocation,
        `default location mismatch for ${animal.id}`);
    }
    if (herdKeys.has(animal.id)) {
      assert.strictEqual(world.herdLoc[animal.id], INITIAL_HERD_LOCATIONS[animal.id],
        `herd location mismatch for ${animal.id}`);
    }
  }

  const storeStart = {
    oats: world.store.oats,
    hay: world.store.hay,
    manure: world.store.manure_units || 0,
    eggs: world.store.eggs_dozen,
  };

  const pastureTracked = new Set();
  let oatsNeed = 0;
  let hayNeed = 0;
  let manureUnits = 0;
  let eggsDozens = 0;
  for (const animal of ANIMALS) {
    const count = world.livestock[animal.id] ?? 0;
    if (count <= 0) continue;
    const herdLocation = world.herdLoc?.[animal.id] ?? world.livestock.where?.[animal.id];
    const needs = computeDailyNeedsForAnimal(animal, count, herdLocation);
    oatsNeed += needs.oats_bu;
    hayNeed += needs.hay_t;
    manureUnits += needs.manureUnits;
    eggsDozens += needs.eggsDozens;
    if (needs.pastureIntake_t > 0) {
      const key = animal.pastureParcel || animal.defaultLocation;
      if (key) pastureTracked.add(key);
    }
  }

  const initialPasture = new Map();
  for (const key of pastureTracked) {
    initialPasture.set(key, pastureBiomass(world, key));
  }

  consumeLivestock(world);

  let actualPastureDraw = 0;
  for (const key of pastureTracked) {
    const before = initialPasture.get(key) ?? 0;
    const after = pastureBiomass(world, key);
    if (after < before) actualPastureDraw += (before - after);
  }

  const expectedOats = storeStart.oats - Math.min(storeStart.oats, oatsNeed);
  const expectedHay = storeStart.hay - Math.min(storeStart.hay, Math.max(0, hayNeed - actualPastureDraw));
  const expectedEggs = storeStart.eggs + Math.max(0, Math.round(eggsDozens));
  const expectedManure = storeStart.manure + manureUnits;

  assert.strictEqual(Number(world.store.oats.toFixed(6)), Number(expectedOats.toFixed(6)), 'oats consumption should follow spec');
  assert.strictEqual(Number(world.store.hay.toFixed(6)), Number(expectedHay.toFixed(6)), 'hay consumption should follow spec');
  assert.strictEqual(world.store.eggs_dozen, expectedEggs, 'egg yield should follow spec');
  assert.strictEqual(world.store.manure_units, expectedManure, 'manure output should follow spec');
}
