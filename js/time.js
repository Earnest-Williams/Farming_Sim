import { CONFIG_PACK_V1 } from './config/pack_v1.js';

const PACK_TIME = CONFIG_PACK_V1.time;
const PACK_CALENDAR = CONFIG_PACK_V1.calendar;

export const CALENDAR = Object.freeze({
  MONTHS: Object.freeze([...PACK_CALENDAR.months]),
  DAYS_PER_MONTH: PACK_CALENDAR.daysPerMonth,
});

export const DAYS_PER_MONTH = CALENDAR.DAYS_PER_MONTH;
export const MONTHS_PER_YEAR = CALENDAR.MONTHS.length;

export const MINUTES_PER_DAY = PACK_TIME.daySimMin;

const DEFAULT_WORK_START_MIN = PACK_TIME.workStartMin;
const DEFAULT_WORK_END_MIN = PACK_TIME.workEndMin;

const DAYLIGHT_ANCHORS = Object.freeze(
  (PACK_TIME.daylightAnchors || []).map((anchor) => Object.freeze({ ...anchor }))
);

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildDaylightSchedule() {
  const schedule = [];
  for (let monthIndex = 0; monthIndex < MONTHS_PER_YEAR; monthIndex += 1) {
    const current = DAYLIGHT_ANCHORS[monthIndex];
    const next = DAYLIGHT_ANCHORS[(monthIndex + 1) % MONTHS_PER_YEAR];
    for (let dayIdx = 0; dayIdx < DAYS_PER_MONTH; dayIdx += 1) {
      const blend = dayIdx / DAYS_PER_MONTH;
      const workStart = Math.round(lerp(current.workStart, next.workStart, blend));
      const workEnd = Math.round(lerp(current.workEnd, next.workEnd, blend));
      const dayLenMinutes = Math.max(0, workEnd - workStart);
      schedule.push(Object.freeze({
        monthIndex,
        month: CALENDAR.MONTHS[monthIndex],
        day: dayIdx + 1,
        workStart,
        workEnd,
        dayLenMinutes,
        dayLenHours: dayLenMinutes / PACK_TIME.minutesPerHour,
      }));
    }
  }
  return Object.freeze(schedule);
}

const DAYLIGHT_SCHEDULE = buildDaylightSchedule();

const DAYLIGHT_DEFAULT = Object.freeze({
  workStart: DEFAULT_WORK_START_MIN,
  workEnd: DEFAULT_WORK_END_MIN,
  dayLenMinutes: DEFAULT_WORK_END_MIN - DEFAULT_WORK_START_MIN,
  dayLenHours: (DEFAULT_WORK_END_MIN - DEFAULT_WORK_START_MIN) / PACK_TIME.minutesPerHour,
});

const DAYLIGHT_BOUNDS = Object.freeze({
  minWorkStart: DAYLIGHT_SCHEDULE.reduce((acc, entry) => Math.min(acc, entry.workStart), DEFAULT_WORK_START_MIN),
  maxWorkEnd: DAYLIGHT_SCHEDULE.reduce((acc, entry) => Math.max(acc, entry.workEnd), DEFAULT_WORK_END_MIN),
  minDayLenHours: DAYLIGHT_SCHEDULE.reduce((acc, entry) => Math.min(acc, entry.dayLenHours), DAYLIGHT_DEFAULT.dayLenHours),
  maxDayLenHours: DAYLIGHT_SCHEDULE.reduce((acc, entry) => Math.max(acc, entry.dayLenHours), DAYLIGHT_DEFAULT.dayLenHours),
});

export const DAYLIGHT = Object.freeze({
  anchors: DAYLIGHT_ANCHORS,
  schedule: DAYLIGHT_SCHEDULE,
  default: DAYLIGHT_DEFAULT,
  bounds: DAYLIGHT_BOUNDS,
});

function clampDayIndex(idx) {
  const maxIndex = DAYLIGHT_SCHEDULE.length - 1;
  if (!Number.isFinite(idx) || maxIndex < 0) {
    return null;
  }
  return Math.max(0, Math.min(maxIndex, Math.floor(idx)));
}

export function computeDaylightByIndex(index) {
  const clamped = clampDayIndex(index);
  if (clamped == null) {
    return {
      ...DAYLIGHT_DEFAULT,
      monthIndex: 0,
      month: CALENDAR.MONTHS[0],
      day: 1,
    };
  }
  return DAYLIGHT_SCHEDULE[clamped] ?? {
    ...DAYLIGHT_DEFAULT,
    monthIndex: 0,
    month: CALENDAR.MONTHS[0],
    day: 1,
  };
}

export function dayIndex(day = 1, month = 1) {
  const safeDay = Math.max(1, Math.min(DAYS_PER_MONTH, Math.floor(day)));
  const numericMonth = Number.isFinite(month) ? Math.floor(month) : 1;
  const zeroBasedMonth =
    numericMonth >= 0 && numericMonth < MONTHS_PER_YEAR
      ? clampMonthIndex(numericMonth)
      : clampMonthIndex(numericMonth - 1);
  return zeroBasedMonth * DAYS_PER_MONTH + (safeDay - 1);
}

export const SIM = Object.freeze({
  MIN_PER_REAL_MIN: PACK_TIME.simMinPerRealMin,
  STEP_MIN: PACK_TIME.tickSimMin,
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
  const realMinutes = dtRealMs / PACK_TIME.realMsPerMinute;
  const simMinutes = realMinutes * SIM.MIN_PER_REAL_MIN;
  return advanceSimMinutes(simMinutes);
}

export function formatSimTime() {
  const { month, day, minute } = getSimTime();
  const hours = String(Math.floor(minute / PACK_TIME.minutesPerHour)).padStart(2, '0');
  const mins = String(Math.floor(minute % PACK_TIME.minutesPerHour)).padStart(2, '0');
  return { label: `Month ${month}, Day ${day}`, time: `${hours}:${mins}` };
}
