import { jobsInWindow } from './scheduler.js';
import { estimateJobHours } from './jobCatalog.js';
import { expandJob } from './jobs/expander.js';

export function generateMonthJobs(world, monthRoman) {
  const templates = jobsInWindow(monthRoman);
  const expanded = templates.flatMap((job) => expandJob(job, world));
  return expanded.map((job) => ({
    ...job,
    hours: estimateJobHours(job),
    prerequisites: Array.isArray(job.prereq) ? [...job.prereq] : [],
  }));
}
