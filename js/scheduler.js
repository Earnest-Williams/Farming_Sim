import { JOBS } from './jobs.js';
import { estimateJobHours } from './jobCatalog.js';
import { CALENDAR, DAYS_PER_MONTH } from './time.js';

export function monthIndexFromLabel(label) {
  if (Number.isFinite(label)) {
    const idx = Math.floor(label) - 1;
    if (idx >= 0 && idx < CALENDAR.MONTHS.length) return idx;
  }
  if (typeof label !== 'string') return 0;
  const idx = CALENDAR.MONTHS.indexOf(label);
  return idx >= 0 ? idx : 0;
}

function compareMonths(a, b) {
  return monthIndexFromLabel(a) - monthIndexFromLabel(b);
}

export function inWindow(state, window) {
  if (!state?.world?.calendar) return false;
  if (!Array.isArray(window) || window.length < 2) return true;
  const month = state.world.calendar.month;
  const idx = monthIndexFromLabel(month);
  const start = monthIndexFromLabel(window[0]);
  const end = monthIndexFromLabel(window[1]);
  return idx >= start && idx <= end;
}

export function prerequisitesMet(state, job) {
  if (!job?.prereq?.length) return true;
  const done = state?.progress?.done;
  if (!(done instanceof Set)) return false;
  return job.prereq.every((id) => done.has(id));
}

export function guardAllows(state, job) {
  if (!job?.guard) return true;
  const fn = state?.guards?.[job.guard];
  if (typeof fn !== 'function') return false;
  return !!fn(state);
}

export function isEligible(state, job) {
  if (!job) return false;
  if (state?.progress?.done?.has(job.id)) return false;
  return inWindow(state, job.window) && prerequisitesMet(state, job) && guardAllows(state, job);
}

function urgency(state, job) {
  if (!state?.world?.calendar) return 0;
  const { month, day } = state.world.calendar;
  const monthIdx = monthIndexFromLabel(month);
  const endIdx = monthIndexFromLabel(job.window?.[1] ?? month);
  const safeDay = Number.isFinite(day) ? day : 1;
  const monthsRemaining = Math.max(0, endIdx - monthIdx);
  const daysRemaining = monthsRemaining * DAYS_PER_MONTH + Math.max(0, DAYS_PER_MONTH - safeDay);
  return 1000 - daysRemaining;
}

function efficiency(job, hours) {
  const value = Number.isFinite(job?.value) ? job.value : (job.acres ?? 1);
  if (!Number.isFinite(hours) || hours <= 0) return value;
  return value / hours;
}

export function pickNextTask(state) {
  const eligible = JOBS
    .filter((job) => isEligible(state, job))
    .map((job) => {
      const hours = estimateJobHours(job);
      return {
        job,
        urgency: urgency(state, job),
        efficiency: efficiency(job, hours),
      };
    });

  eligible.sort((a, b) => {
    const u = b.urgency - a.urgency;
    if (u !== 0) return u;
    const e = b.efficiency - a.efficiency;
    if (e !== 0) return e;
    return compareMonths(a.job.window?.[0], b.job.window?.[0]);
  });

  return eligible[0]?.job ?? null;
}

export function jobsInWindow(monthLabel) {
  return JOBS.filter((job) => {
    const start = monthIndexFromLabel(job.window?.[0] ?? monthLabel);
    const end = monthIndexFromLabel(job.window?.[1] ?? monthLabel);
    const idx = monthIndexFromLabel(monthLabel);
    return idx >= start && idx <= end;
  });
}

export function nextJobsByPriority(state) {
  const eligible = JOBS.filter((job) => isEligible(state, job));
  eligible.sort((a, b) => {
    const u = urgency(state, b) - urgency(state, a);
    if (u !== 0) return u;
    const ea = efficiency(a, estimateJobHours(a));
    const eb = efficiency(b, estimateJobHours(b));
    if (eb !== ea) return eb - ea;
    return a.id.localeCompare(b.id);
  });
  return eligible;
}
