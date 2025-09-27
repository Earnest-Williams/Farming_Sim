import { CALENDAR } from './time.js';

export const LABOUR = Object.freeze({
  ADULTS: 4,
  DAYS_PER_MONTH: 20,
  HOURS_PER_DAY: 8,
});

const state = {
  month: CALENDAR.MONTHS[0],
  used: 0,
};

export function labourBudgetForMonth() {
  return LABOUR.ADULTS * LABOUR.DAYS_PER_MONTH * LABOUR.HOURS_PER_DAY;
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
