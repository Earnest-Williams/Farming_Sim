import { strict as assert } from 'node:assert';
import { createInitialWorld } from '../world.js';
import { createEngineState, tick as runEngineTick } from '../engine.js';
import { JOBS } from '../jobs.js';
import {
  resetTime,
  advanceSimMinutes,
  getSimTime,
  setSimTime,
  SIM,
  MINUTES_PER_DAY,
  DAYS_PER_MONTH,
  CALENDAR,
} from '../time.js';

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
  const daylight = world.daylight || { workStart: 0, workEnd: MINUTES_PER_DAY };
  const minute = world.calendar?.minute ?? 0;
  const asleep = minute < daylight.workStart || minute >= daylight.workEnd;
  if (asleep) {
    const bed = world.locations?.bed ?? { x: start.x, y: start.y };
    assert.strictEqual(engine.farmer.pos.x, Math.round(bed.x ?? start.x));
    assert.strictEqual(engine.farmer.pos.y, Math.round(bed.y ?? start.y));
  } else {
    assert.strictEqual(engine.farmer.pos.x, target.x);
    assert.strictEqual(engine.farmer.pos.y, target.y);
  }
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

export function testWorldFarmerStateSync() {
  const { world, engine } = setupEngine();
  const start = { x: engine.farmer.pos.x, y: engine.farmer.pos.y };
  const target = { x: start.x + 2, y: start.y + 1 };

  engine.currentTask = {
    definition: { id: 'sync_task', kind: 'SyncWork' },
    runtime: { target, hours: 0.5, kind: 'SyncWork' },
    totalSimMin: SIM.STEP_MIN * 4,
    remainingSimMin: SIM.STEP_MIN * 4,
    target,
    startedAt: { year: world.calendar.year, month: world.calendar.month, day: world.calendar.day },
  };

  runEngineTick(engine, SIM.STEP_MIN);
  assert.strictEqual(world.farmer.x, engine.farmer.pos.x);
  assert.strictEqual(world.farmer.y, engine.farmer.pos.y);
  assert.strictEqual(world.farmer.task, 'SyncWork');
  assert.ok(Array.isArray(world.farmer.activeWork));
  assert.strictEqual(world.farmer.activeWork[0], 'sync_task');

  engine.currentTask = null;
  runEngineTick(engine, SIM.STEP_MIN);
  assert.strictEqual(world.farmer.task, null);
  assert.ok(world.farmer.activeWork.every((slot) => slot == null));
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

export function testOneBasedMonthIndex() {
  resetTime();
  setSimTime({ monthIndex: 1 });
  const calendar = getSimTime();
  assert.strictEqual(calendar.monthIndex, 0);
  assert.strictEqual(calendar.month, CALENDAR.MONTHS[0]);
}
