import { strict as assert } from 'node:assert';
import {
  PLANTS,
  ARABLE_PLANTS,
  GARDEN_PLANTS,
  ROTATION,
  STAGE_SIDS_BY_KEY,
  CROP_GLYPHS_BY_KEY,
  STRAW_PER_BUSHEL_BY_ID,
  SEED_CONFIGS,
  getPlantForSheafKey,
} from '../config/plants.js';

export function testPlantSchema() {
  assert.ok(Array.isArray(PLANTS) && PLANTS.length > 0, 'plants collection must be non-empty');
  for (const plant of PLANTS) {
    assert.ok(plant.id && typeof plant.id === 'string', 'plant id must be string');
    assert.ok(plant.name && typeof plant.name === 'string', 'plant name must be string');
    assert.ok(Number.isFinite(plant.baseDays), `plant ${plant.id} missing baseDays`);
    assert.ok(Number.isFinite(plant.baseYield), `plant ${plant.id} missing baseYield`);
    assert.ok(Number.isFinite(plant.nitrogenUse), `plant ${plant.id} missing nitrogenUse`);
    assert.ok(Array.isArray(plant.glyphs) && plant.glyphs.length > 0, `plant ${plant.id} missing glyphs`);
    assert.ok(plant.primaryYield && typeof plant.primaryYield === 'object', `plant ${plant.id} missing primary yield`);
    if (plant.sheaf?.key) {
      assert.strictEqual(getPlantForSheafKey(plant.sheaf.key)?.id, plant.id, `sheaf key must resolve for ${plant.id}`);
    }
  }
}

export function testRotationPlants() {
  assert.ok(Array.isArray(ROTATION) && ROTATION.length > 0, 'rotation must include plants');
  for (const plant of ROTATION) {
    assert.ok(plant && typeof plant.id === 'string', 'rotation entries must be valid plants');
  }
}

export function testArableRenderAssets() {
  for (const plant of ARABLE_PLANTS) {
    if (plant.key) {
      const sprites = STAGE_SIDS_BY_KEY[plant.key];
      const glyphs = CROP_GLYPHS_BY_KEY[plant.key];
      assert.ok(Array.isArray(sprites) && sprites.length > 0, `sprites missing for ${plant.key}`);
      assert.ok(Array.isArray(glyphs) && glyphs.length > 0, `glyphs missing for ${plant.key}`);
    }
  }
}

export function testSeedAndStrawMaps() {
  for (const config of SEED_CONFIGS) {
    if (config.inventoryKey) {
      assert.ok(typeof config.resourceKey === 'string' && config.resourceKey.length > 0, 'seed resource key required');
    }
    if (config.marketItem) {
      assert.ok(config.marketItem.startsWith('seed_'), 'seed market item should use seed_ prefix');
    }
  }
  for (const plant of ARABLE_PLANTS) {
    if (plant.sheaf?.key) {
      assert.ok(Number.isFinite(STRAW_PER_BUSHEL_BY_ID[plant.id]), `straw data missing for ${plant.id}`);
    }
  }
}

export function testGardenPlantsPresent() {
  assert.ok(Array.isArray(GARDEN_PLANTS));
  const ids = new Set();
  for (const plant of GARDEN_PLANTS) {
    assert.ok(plant.id && typeof plant.id === 'string', 'garden plant must have id');
    assert.ok(!ids.has(plant.id), 'garden plant ids must be unique');
    ids.add(plant.id);
  }
}
