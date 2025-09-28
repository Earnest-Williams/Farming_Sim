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

const MINUTES_PER_HOUR = PACK_TIME.minutesPerHour ?? 60;
const MINUTES_PER_MONTH = MINUTES_PER_DAY * DAYS_PER_MONTH;
const MINUTES_PER_YEAR = MINUTES_PER_MONTH * MONTHS_PER_YEAR;

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
  const monthIdx = monthIndexFromValue(month);
  return monthIdx * DAYS_PER_MONTH + (safeDay - 1);
}

export const SIM = Object.freeze({
  MIN_PER_REAL_MIN: PACK_TIME.simMinPerRealMin,
  STEP_MIN: PACK_TIME.tickSimMin,
});

const state = {
  totalSimMin: 0,
  calendar: {
    monthIndex: 0,
    month: CALENDAR.MONTHS[0],
    day: 1,
    minute: 0,
    year: 1,
  },
};

function clampMonthIndex(idx) {
  const { MONTHS } = CALENDAR;
  return ((idx % MONTHS.length) + MONTHS.length) % MONTHS.length;
}

export function resetTime() {
  return syncSimTime(0);
}

function monthIndexFromValue(value) {
  if (Number.isFinite(value)) {
    const idx = Math.floor(value);
    if (idx >= 0 && idx < MONTHS_PER_YEAR) return idx;
    if (idx >= 1 && idx <= MONTHS_PER_YEAR) return clampMonthIndex(idx - 1);
  }
  if (typeof value === 'string') {
    const idx = CALENDAR.MONTHS.indexOf(value);
    if (idx >= 0) return idx;
  }
  return 0;
}

function calendarFromTotal(totalSimMin) {
  const safeTotal = Math.max(0, Number.isFinite(totalSimMin) ? totalSimMin : 0);
  const yearsElapsed = Math.floor(safeTotal / MINUTES_PER_YEAR);
  const year = yearsElapsed + 1;
  let remainder = safeTotal - yearsElapsed * MINUTES_PER_YEAR;

  let monthIndex = Math.floor(remainder / MINUTES_PER_MONTH);
  if (monthIndex >= MONTHS_PER_YEAR) monthIndex = MONTHS_PER_YEAR - 1;
  remainder -= monthIndex * MINUTES_PER_MONTH;

  let day = Math.floor(remainder / MINUTES_PER_DAY);
  if (day >= DAYS_PER_MONTH) day = DAYS_PER_MONTH - 1;
  remainder -= day * MINUTES_PER_DAY;

  const minute = remainder;

  return {
    monthIndex,
    month: CALENDAR.MONTHS[monthIndex] ?? CALENDAR.MONTHS[0],
    day: day + 1,
    minute,
    year,
  };
}

function totalFromCalendar({ monthIndex = 0, day = 1, minute = 0, year = 1 } = {}) {
  const safeYear = Math.max(1, Math.floor(Number.isFinite(year) ? year : 1));
  const idx = monthIndexFromValue(monthIndex);
  const safeDay = Math.max(1, Math.min(DAYS_PER_MONTH, Math.floor(Number.isFinite(day) ? day : 1)));
  const safeMinute = Math.max(0, Math.min(MINUTES_PER_DAY, Number.isFinite(minute) ? minute : 0));
  const yearOffset = (safeYear - 1) * MINUTES_PER_YEAR;
  const monthOffset = idx * MINUTES_PER_MONTH;
  const dayOffset = (safeDay - 1) * MINUTES_PER_DAY;
  return yearOffset + monthOffset + dayOffset + safeMinute;
}

function syncFromTotal(totalSimMin) {
  state.totalSimMin = Math.max(0, Number.isFinite(totalSimMin) ? totalSimMin : 0);
  state.calendar = calendarFromTotal(state.totalSimMin);
  return getSimTime();
}

export function syncSimTime(simMinutes) {
  return syncFromTotal(simMinutes);
}

export function nowSimMin() {
  return state.totalSimMin;
}

export function setSimTime({ monthIndex = 0, day = 1, minute = 0, year = 1 } = {}) {
  const total = totalFromCalendar({ monthIndex, day, minute, year });
  return syncFromTotal(total);
}

export function advanceSimMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes === 0) {
    return getSimTime();
  }
  const total = state.totalSimMin + minutes;
  return syncFromTotal(total);
}

export function getSimTime() {
  return { ...state.calendar };
}

export function formatSimTime() {
  const { month, day, minute } = getSimTime();
  const hours = String(Math.floor(minute / MINUTES_PER_HOUR)).padStart(2, '0');
  const mins = String(Math.floor(minute % MINUTES_PER_HOUR)).padStart(2, '0');
  return { label: `Month ${month}, Day ${day}`, time: `${hours}:${mins}` };
}
