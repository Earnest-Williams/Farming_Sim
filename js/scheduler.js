import { JOBS } from './jobs.js';
import { estimateJobHours } from './jobCatalog.js';
import { CALENDAR, DAYS_PER_MONTH } from './time.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { canFulfillResources, readResource } from './resources.js';
import { travelTimeBetween } from './world.js';

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

export function monthInWindow(monthIdx, startIdx, endIdx) {
  if (!Number.isFinite(monthIdx) || !Number.isFinite(startIdx) || !Number.isFinite(endIdx)) {
    return false;
  }
  const totalMonths = CALENDAR.MONTHS.length;
  const wraps = startIdx > endIdx;
  const normalizedStart = startIdx;
  const normalizedEnd = wraps ? endIdx + totalMonths : endIdx;
  let normalizedMonth = monthIdx;
  if (wraps && normalizedMonth < startIdx) {
    normalizedMonth += totalMonths;
  }
  return normalizedMonth >= normalizedStart && normalizedMonth <= normalizedEnd;
}

export function inWindow(state, window) {
  if (!state?.world?.calendar) return false;
  if (!Array.isArray(window) || window.length < 2) return true;
  const month = state.world.calendar.month;
  const idx = monthIndexFromLabel(month);
  const start = monthIndexFromLabel(window[0]);
  const end = monthIndexFromLabel(window[1]);
  return monthInWindow(idx, start, end);
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
  const result = fn(state);
  if (result && typeof result === 'object') {
    return !!result.ok;
  }
  return !!result;
}

export function isEligible(state, job) {
  if (!job) return false;
  if (state?.progress?.done?.has(job.id)) return false;
  if (!inWindow(state, job.window)) return false;
  if (!prerequisitesMet(state, job)) return false;
  if (!guardAllows(state, job)) return false;
  if (Array.isArray(job.allowedMonths) && job.allowedMonths.length) {
    const month = state?.world?.calendar?.month;
    const idx = monthIndexFromLabel(month) + 1;
    if (!job.allowedMonths.includes(idx)) return false;
  }
  if (Array.isArray(job.allowedHours) && job.allowedHours.length === 2) {
    const minute = state?.world?.calendar?.minute ?? 0;
    const [start, end] = job.allowedHours;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      if (minute < start || minute > end) return false;
    }
  }
  if (!canFulfillResources(state?.world, job.requiresResources)) return false;
  if (Number.isFinite(job.sellThreshold) && job.sellThreshold > 0) {
    const resourceKey = job.sellResourceKey ?? 'turnips';
    const stock = readResource(state?.world, resourceKey);
    if (stock < job.sellThreshold) return false;
  }
  if (state?.taskCooldowns instanceof Map) {
    const now = currentSimMinute(state);
    const readyAt = state.taskCooldowns.get(job.id);
    if (Number.isFinite(readyAt) && now < readyAt) return false;
  }
  return true;
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

function workMinutes(job) {
  if (Number.isFinite(job?.fixedWorkMin) && job.fixedWorkMin > 0) {
    return job.fixedWorkMin;
  }
  if (Number.isFinite(job?.baseWorkPerAcreMin) && Number.isFinite(job?.acres)) {
    return job.baseWorkPerAcreMin * job.acres;
  }
  const hours = estimateJobHours(job);
  const minutesPerHour = CONFIG_PACK_V1.time.minutesPerHour ?? 60;
  return hours * minutesPerHour;
}

function currentSimMinute(state) {
  const calendar = state?.world?.calendar;
  if (!calendar) return 0;
  const monthIdx = monthIndexFromLabel(calendar.month);
  const day = Number.isFinite(calendar.day) ? calendar.day : 1;
  const minute = Number.isFinite(calendar.minute) ? calendar.minute : 0;
  return monthIdx * DAYS_PER_MONTH * (CONFIG_PACK_V1.time.daySimMin ?? 24 * 60) + (day - 1) * (CONFIG_PACK_V1.time.daySimMin ?? 24 * 60) + minute;
}

const TRAVEL_LAMBDA = 1 / (CONFIG_PACK_V1.rules.travelPenaltyCap ?? 5);

function efficiency(job, hours) {
  const value = Number.isFinite(job?.value) ? job.value : (job.acres ?? 1);
  if (!Number.isFinite(hours) || hours <= 0) return value;
  return value / hours;
}

export function pickNextTask(state) {
  const pos = state?.farmer?.pos;
  const world = state?.world;
  const eligible = JOBS
    .filter((job) => isEligible(state, job))
    .map((job) => {
      const minutes = workMinutes(job);
      const travel = travelTimeBetween(world, pos, job.requiresPresenceAt ?? job.field ?? 'farmhouse');
      const urgencyScore = urgency(state, job);
      const priority = Number.isFinite(job.priority) ? job.priority : (job.value ?? 0);
      const travelPenalty = travel * TRAVEL_LAMBDA;
      const score = priority + urgencyScore - travelPenalty;
      return {
        job,
        urgency: urgencyScore,
        priority,
        travel,
        score,
        minutes,
      };
    });

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.travel !== b.travel) return a.travel - b.travel;
    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    return compareMonths(a.job.window?.[0], b.job.window?.[0]);
  });

  if (!eligible.length) return null;

  const top = eligible[0];
  if (top.job.kind === 'market') {
    const seasonal = eligible.find((entry) => entry.job.kind !== 'market');
    if (seasonal) return seasonal.job;
  }

  return top.job;
}

export function jobsInWindow(monthLabel) {
  return JOBS.filter((job) => {
    const start = monthIndexFromLabel(job.window?.[0] ?? monthLabel);
    const end = monthIndexFromLabel(job.window?.[1] ?? monthLabel);
    const idx = monthIndexFromLabel(monthLabel);
    return monthInWindow(idx, start, end);
  });
}

export function nextJobsByPriority(state) {
  const pos = state?.farmer?.pos;
  const world = state?.world;
  return JOBS
    .filter((job) => isEligible(state, job))
    .map((job) => {
      const minutes = workMinutes(job);
      const travel = travelTimeBetween(world, pos, job.requiresPresenceAt ?? job.field ?? 'farmhouse');
      const urgencyScore = urgency(state, job);
      const priority = Number.isFinite(job.priority) ? job.priority : (job.value ?? 0);
      const travelPenalty = travel * TRAVEL_LAMBDA;
      const score = priority + urgencyScore - travelPenalty;
      const eff = efficiency(job, minutes / (CONFIG_PACK_V1.time.minutesPerHour ?? 60));
      return { job, score, urgency: urgencyScore, priority, travel, eff };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.travel !== b.travel) return a.travel - b.travel;
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      if (b.eff !== a.eff) return b.eff - a.eff;
      return a.job.id.localeCompare(b.job.id);
    })
    .map((entry) => entry.job);
}
