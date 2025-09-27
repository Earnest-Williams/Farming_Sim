import { labourBudgetForMonth } from './labour.js';
import { generateMonthJobs } from './plan.js';
import { cloneWorld } from './world.js';

export function scheduleMonth(world, monthRoman, jobsOverride = null) {
  const budget = labourBudgetForMonth();
  const jobs = Array.isArray(jobsOverride) ? jobsOverride : generateMonthJobs(world, monthRoman);
  const testWorld = cloneWorld(world);
  const selected = [];
  let used = 0;

  for (const job of jobs) {
    const cost = job.hours;
    if (!Number.isFinite(cost) || cost <= 0) continue;
    if (used + cost > budget) continue;
    if (!job.canApply(testWorld)) continue;
    job.apply(testWorld);
    selected.push(job);
    used += cost;
  }

  return { selected, used, budget };
}
