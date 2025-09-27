export const CALENDAR = Object.freeze({
  MONTHS: Object.freeze(["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]),
  DAYS_PER_MONTH: 20,
});

export const MINUTES_PER_DAY = 24 * 60;

export const SIM = Object.freeze({
  MIN_PER_REAL_MIN: 60,
  STEP_MIN: 0.5,
});

const state = {
  monthIndex: 0,
  day: 1,
  minute: 0,
  year: 1,
};

function clampMonthIndex(idx) {
  const { MONTHS } = CALENDAR;
  return ((idx % MONTHS.length) + MONTHS.length) % MONTHS.length;
}

export function resetTime() {
  state.monthIndex = 0;
  state.day = 1;
  state.minute = 0;
  state.year = 1;
  return getSimTime();
}

export function setSimTime({ monthIndex = 0, day = 1, minute = 0, year = 1 } = {}) {
  state.monthIndex = clampMonthIndex(monthIndex);
  state.day = Math.max(1, Math.min(CALENDAR.DAYS_PER_MONTH, Math.floor(day)));
  state.minute = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.floor(minute)));
  state.year = Math.max(1, Math.floor(year));
  return getSimTime();
}

export function getSimTime() {
  return {
    monthIndex: state.monthIndex,
    month: CALENDAR.MONTHS[state.monthIndex],
    day: state.day,
    minute: state.minute,
    year: state.year,
  };
}

function advanceDay(by = 1) {
  let remaining = by;
  while (remaining > 0) {
    state.day += 1;
    if (state.day > CALENDAR.DAYS_PER_MONTH) {
      state.day = 1;
      state.monthIndex = clampMonthIndex(state.monthIndex + 1);
      if (state.monthIndex === 0) {
        state.year += 1;
      }
    }
    remaining -= 1;
  }
}

export function advanceSimMinutes(minutes) {
  let remaining = minutes;
  while (remaining > 0) {
    const delta = Math.min(remaining, MINUTES_PER_DAY - state.minute);
    state.minute += delta;
    remaining -= delta;
    if (state.minute >= MINUTES_PER_DAY) {
      state.minute -= MINUTES_PER_DAY;
      advanceDay(1);
    }
  }
  return getSimTime();
}

export function tickSim(dtRealMs) {
  if (!Number.isFinite(dtRealMs) || dtRealMs <= 0) {
    return getSimTime();
  }
  const realMinutes = dtRealMs / 60000;
  const simMinutes = realMinutes * SIM.MIN_PER_REAL_MIN;
  return advanceSimMinutes(simMinutes);
}

export function formatSimTime() {
  const { month, day, minute } = getSimTime();
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const mins = String(Math.floor(minute % 60)).padStart(2, '0');
  return { label: `Month ${month}, Day ${day}`, time: `${hours}:${mins}` };
}
