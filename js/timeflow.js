export const SPEEDS = {
  PAUSE: 0,
  VERY_SLOW: 0.03,
  SLOW: 0.06,
  NORMAL: 0.12,
  FAST: 0.5,
  ULTRA: 2.0,
};

let current = SPEEDS.VERY_SLOW;

export function setSpeed(value) {
  current = Math.max(0, Number.isFinite(value) ? value : 0);
}

export function getSpeed() {
  return current;
}

export function minutesToAdvance(dtMs) {
  return (dtMs / 1000) * current;
}
