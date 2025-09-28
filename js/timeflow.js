import { CONFIG_PACK_V1 } from './config/pack_v1.js';

export const SPEEDS = Object.freeze({ ...CONFIG_PACK_V1.time?.speedMultipliers });

let current = 1.0;

const SIM_MIN_PER_REAL_MS = (CONFIG_PACK_V1.time?.simMinPerRealMin ?? 0) / (CONFIG_PACK_V1.time?.realMsPerMinute ?? 1);

export function setSpeed(value) {
  current = Math.max(0, Number.isFinite(value) ? value : 0);
}

export function getSpeed() {
  return current;
}

export function minutesToAdvance(dtMs) {
  return dtMs * SIM_MIN_PER_REAL_MS * current;
}
