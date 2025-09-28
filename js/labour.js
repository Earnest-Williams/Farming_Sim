import { CALENDAR } from './time.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';

const PACK_LABOUR = CONFIG_PACK_V1.labour;
const PACK_CALENDAR = CONFIG_PACK_V1.calendar;

const HOURS_PER_DAY = PACK_LABOUR.hoursPerDay;
const DAYS_PER_MONTH = PACK_LABOUR.daysPerMonth ?? PACK_CALENDAR.daysPerMonth;
const CREW_SLOTS = PACK_LABOUR.crewSlots;
const MONTHLY_HOURS = PACK_LABOUR.monthlyHours ?? CREW_SLOTS * DAYS_PER_MONTH * HOURS_PER_DAY;

export const LABOUR = Object.freeze({
  ADULTS: CREW_SLOTS,
  DAYS_PER_MONTH,
  HOURS_PER_DAY,
  MONTHLY_HOURS,
});

const state = {
  month: CALENDAR.MONTHS[0],
  used: 0,
};

export function labourBudgetForMonth() {
  return LABOUR.MONTHLY_HOURS;
}

export function resetLabour(month = CALENDAR.MONTHS[0]) {
  state.month = month;
  state.used = 0;
  return getLabourUsage();
}

export function consume(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return getLabourUsage();
  state.used += hours;
  return getLabourUsage();
}

export function getLabourUsage() {
  return {
    month: state.month,
    used: state.used,
    budget: labourBudgetForMonth(),
  };
}
