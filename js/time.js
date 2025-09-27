export const DAYS_PER_MONTH = 20;
export const MONTHS_PER_YEAR = 8;
export const MINUTES_PER_DAY = 24 * 60;

export const DAYLIGHT = { baseHours: 12, amplitude: 3, snapDays: 5, bufferMin: 30 };

export function dayIndex(day, month) {
  return (day - 1) + (month - 1) * DAYS_PER_MONTH;
}

export function computeDaylightByIndex(idx) {
  const stepIdx = Math.floor(idx / DAYLIGHT.snapDays);
  const stepped = stepIdx * DAYLIGHT.snapDays + Math.floor(DAYLIGHT.snapDays / 2);
  const angle = 2 * Math.PI * ((stepped - 60) / (DAYS_PER_MONTH * MONTHS_PER_YEAR));
  const dayLen = clamp(DAYLIGHT.baseHours + DAYLIGHT.amplitude * Math.cos(angle), 8, 16);
  const sunrise = Math.round((12 - dayLen / 2) * 60);
  const sunset  = Math.round((12 + dayLen / 2) * 60);
  return {
    sunrise,
    sunset,
    workStart: Math.max(0, sunrise - DAYLIGHT.bufferMin),
    workEnd: Math.min(MINUTES_PER_DAY, sunset + DAYLIGHT.bufferMin),
    dayLenHours: dayLen
  };
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
