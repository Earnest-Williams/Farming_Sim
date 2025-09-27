export const SPEEDS = {
  PAUSE: 0,
  VERY_SLOW: 0.03,
  SLOW: 0.06,
  NORMAL: 0.12,
  FAST: 0.50,
  ULTRA: 2.00,
};

let current = 1.0;

export function setSpeed(value) {
  current = Math.max(0, Number.isFinite(value) ? value : 0);
}

export function getSpeed() {
  return current;
}

export function minutesToAdvance(dtMs) {
  return (dtMs / 1000) * current;
}
