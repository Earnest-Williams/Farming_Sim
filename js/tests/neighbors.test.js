import assert from 'node:assert/strict';

import { createInitialWorld } from '../world.js';
import { stepOneMinute } from '../simulation.js';

export async function testNeighborFarmPresence() {
  const world = createInitialWorld();
  assert.ok(Array.isArray(world.neighbors), 'world should include neighbors list');
  assert.ok(world.neighbors.length > 0, 'neighbor farms should be defined');
  const neighbor = world.neighbors[0];
  assert.ok(neighbor?.farmhouse, 'neighbor farmhouse should be defined');
  assert.ok(Array.isArray(neighbor?.plots) && neighbor.plots.length > 0, 'neighbor plots should be populated');
}

export async function testNeighborChoresAdvance() {
  const world = createInitialWorld();
  const neighbor = world.neighbors?.[0];
  assert.ok(neighbor, 'neighbor should exist for chore validation');
  const initialTask = neighbor.farmer?.task;
  for (let i = 0; i < 400; i += 1) {
    stepOneMinute(world);
  }
  assert.notStrictEqual(neighbor.farmer?.task, initialTask, 'neighbor task should change after time advances');
  const startX = neighbor.farmer.x;
  const startY = neighbor.farmer.y;
  for (let i = 0; i < 60; i += 1) {
    stepOneMinute(world);
  }
  const moved = neighbor.farmer.x !== startX || neighbor.farmer.y !== startY;
  assert.ok(moved, 'neighbor farmer should move while working through chores');
}
