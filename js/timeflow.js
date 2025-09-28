import { CONFIG_PACK_V1 } from './config/pack_v1.js';

export const SPEEDS = Object.freeze({ ...CONFIG_PACK_V1.time?.speedMultipliers });

const DEFAULT_SIM_MIN_PER_REAL_MIN = CONFIG_PACK_V1.time?.simMinPerRealMin ?? 60;
const DEFAULT_SPEED = DEFAULT_SIM_MIN_PER_REAL_MIN / 60;

let current = DEFAULT_SPEED;
let boundClock = null;

export function bindClock(clock) {
  boundClock = clock || null;
  if (boundClock) {
    boundClock.setSpeed(current * 60);
  }
}

export function setSpeed(value) {
  const next = Math.max(0, Number.isFinite(value) ? value : 0);
  current = next;
  if (boundClock) {
    boundClock.setSpeed(current * 60);
  }
}

export function getSpeed() {
  return current;
}
