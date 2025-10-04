import { strict as assert } from 'node:assert';
import { jobsInWindow } from '../scheduler.js';
import { JOBS } from '../jobs.js';

export function testJobsInWindowHandlesWraparound() {
  const wrapJob = {
    id: 'wrap_test_job',
    window: ['VIII', 'II'],
  };

  JOBS.push(wrapJob);
  try {
    const includedMonths = ['VIII', 'I', 'II'];
    for (const month of includedMonths) {
      const jobs = jobsInWindow(month);
      assert.ok(jobs.some((job) => job.id === wrapJob.id), `${wrapJob.id} should be in window for ${month}`);
    }

    const excludedMonths = ['III', 'IV'];
    for (const month of excludedMonths) {
      const jobs = jobsInWindow(month);
      assert.ok(!jobs.some((job) => job.id === wrapJob.id), `${wrapJob.id} should not be in window for ${month}`);
    }
  } finally {
    JOBS.pop();
  }
}

export function testJobsInWindowSingleMonthInvariant() {
  const targetJobId = 'plough_barley';

  const januaryJobs = jobsInWindow('I');
  assert.ok(januaryJobs.some((job) => job.id === targetJobId), `${targetJobId} should be scheduled in I`);

  const februaryJobs = jobsInWindow('II');
  assert.ok(!februaryJobs.some((job) => job.id === targetJobId), `${targetJobId} should only be scheduled in I`);
}
