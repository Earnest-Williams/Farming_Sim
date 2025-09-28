import { jobsInWindow } from './scheduler.js';
import { estimateJobHours } from './jobCatalog.js';

export function generateMonthJobs(world, monthRoman) {
  return jobsInWindow(monthRoman).map((job) => ({
    ...job,
    hours: estimateJobHours(job),
    prerequisites: Array.isArray(job.prereq) ? [...job.prereq] : [],
  }));
}
