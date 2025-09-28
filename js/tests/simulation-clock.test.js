import { strict as assert } from 'node:assert';
import { createInitialWorld } from '../world.js';
import { createEngineState, tick as runEngineTick } from '../engine.js';
import { JOBS } from '../jobs.js';
import { resetTime, advanceSimMinutes, getSimTime, SIM, MINUTES_PER_DAY, DAYS_PER_MONTH } from '../time.js';

function setupEngine() {
  resetTime();
  const world = createInitialWorld();
  const engine = createEngineState(world);
  engine.world = world;
  engine.stepCost = SIM.STEP_MIN;
  if (engine.progress?.done instanceof Set) {
    for (const job of JOBS) {
      if (job?.id) engine.progress.done.add(job.id);
    }
  }
  return { world, engine };
}

export function testMovementEtaDeterminism() {
  const { world, engine } = setupEngine();
  const start = { x: engine.farmer.pos.x, y: engine.farmer.pos.y };
  const target = { x: start.x + 4, y: start.y + 3 };
  const distance = Math.abs(target.x - start.x) + Math.abs(target.y - start.y);

  engine.currentTask = {
    definition: { id: 'test_move', kind: 'TestMove' },
    runtime: { target, hours: 0, kind: 'TestMove' },
    totalSimMin: 0,
    remainingSimMin: SIM.STEP_MIN,
    target,
    startedAt: { year: world.calendar.year, month: world.calendar.month, day: world.calendar.day },
  };

  const path = [];
  for (let i = 0; i < distance; i += 1) {
    runEngineTick(engine, SIM.STEP_MIN);
    path.push({ x: engine.farmer.pos.x, y: engine.farmer.pos.y });
  }

  assert.strictEqual(engine.farmer.pos.x, target.x);
  assert.strictEqual(engine.farmer.pos.y, target.y);
  assert.strictEqual(engine.labour.travelSimMin, distance * SIM.STEP_MIN);
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1];
    const curr = path[i];
    const stepDist = Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
    assert.strictEqual(stepDist, 1);
  }
  const travelled = engine.labour.travelSimMin;
  runEngineTick(engine, SIM.STEP_MIN);
  assert.strictEqual(engine.farmer.pos.x, target.x);
  assert.strictEqual(engine.farmer.pos.y, target.y);
  assert.strictEqual(engine.labour.travelSimMin, travelled);
}

export function testTaskProgressGatedByArrival() {
  const { world, engine } = setupEngine();
  const start = { x: engine.farmer.pos.x, y: engine.farmer.pos.y };
  const target = { x: start.x + 1, y: start.y + 1 };
  const initialRemaining = SIM.STEP_MIN * 4;

  engine.currentTask = {
    definition: { id: 'test_work', kind: 'TestWork' },
    runtime: { target, hours: initialRemaining / 60, kind: 'TestWork' },
    totalSimMin: initialRemaining,
    remainingSimMin: initialRemaining,
    target,
    startedAt: { year: world.calendar.year, month: world.calendar.month, day: world.calendar.day },
  };

  runEngineTick(engine, SIM.STEP_MIN);
  assert.strictEqual(engine.currentTask.remainingSimMin, initialRemaining);
  assert.strictEqual(engine.labour.workSimMin, 0);

  runEngineTick(engine, SIM.STEP_MIN);
  assert.strictEqual(engine.farmer.pos.x, target.x);
  assert.strictEqual(engine.farmer.pos.y, target.y);
  assert.strictEqual(engine.currentTask.remainingSimMin, initialRemaining);
  assert.strictEqual(engine.labour.workSimMin, 0);

  runEngineTick(engine, SIM.STEP_MIN);
  assert.strictEqual(engine.currentTask.remainingSimMin, initialRemaining - SIM.STEP_MIN);
  assert.strictEqual(engine.labour.workSimMin, SIM.STEP_MIN);
}

export function testMonthRolloverBoundaries() {
  resetTime();
  advanceSimMinutes(MINUTES_PER_DAY * DAYS_PER_MONTH - SIM.STEP_MIN);
  let calendar = getSimTime();
  assert.strictEqual(calendar.monthIndex, 0);
  assert.strictEqual(calendar.day, DAYS_PER_MONTH);
  assert.ok(Math.abs(calendar.minute - (MINUTES_PER_DAY - SIM.STEP_MIN)) < 1e-6);

  advanceSimMinutes(SIM.STEP_MIN);
  calendar = getSimTime();
  assert.strictEqual(calendar.monthIndex, 1);
  assert.strictEqual(calendar.day, 1);
  assert.strictEqual(calendar.minute, 0);
  assert.strictEqual(calendar.year, 1);
}
