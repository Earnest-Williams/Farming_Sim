import { strict as assert } from 'node:assert';

export async function testWrappedJobStatusQueuedAndOverdue() {
  const previousDocument = global.document;
  global.document = {
    addEventListener: () => {},
  };

  try {
    const { computeJobStatus } = await import('../main.js');

    const job = {
      id: 'wrap_status_job',
      window: ['VIII', 'II'],
    };

    const testState = {
      world: {
        calendar: {
          month: 'VIII',
          day: 1,
          minute: 0,
        },
      },
      engine: {
        world: {
          calendar: {
            month: 'VIII',
            day: 1,
            minute: 0,
          },
        },
        progress: {
          done: new Set(),
        },
      },
    };

    const eligibleMonths = ['VIII', 'IX', 'X', 'XI', 'XII', 'I', 'II'];
    for (const month of eligibleMonths) {
      testState.world.calendar.month = month;
      testState.engine.world.calendar.month = month;
      const status = computeJobStatus(job, { state: testState });
      assert.equal(status, 'queued', `Status should be queued in ${month}`);
    }

    const overdueMonths = ['III', 'IV', 'V'];
    for (const month of overdueMonths) {
      testState.world.calendar.month = month;
      testState.engine.world.calendar.month = month;
      const status = computeJobStatus(job, { state: testState });
      assert.equal(status, 'overdue', `Status should be overdue in ${month}`);
    }
  } finally {
    if (previousDocument === undefined) {
      delete global.document;
    } else {
      global.document = previousDocument;
    }
  }
}

export async function testSkippedJobStatusReported() {
  const previousDocument = global.document;
  global.document = { addEventListener: () => {} };

  try {
    const { computeJobStatus } = await import('../main.js');

    const job = {
      id: 'skip_status_job',
      window: ['I', 'I'],
    };

    const testState = {
      world: {
        calendar: {
          month: 'I',
          day: 1,
          minute: 0,
        },
      },
      engine: {
        world: {
          calendar: {
            month: 'I',
            day: 1,
            minute: 0,
          },
        },
        progress: {
          done: new Set(),
        },
        taskSkips: new Map([[job.id, { reason: 'waiting for target' }]]),
      },
    };

    const status = computeJobStatus(job, { state: testState });
    assert.equal(status, 'skipped', 'Skipped jobs should report skipped status');
  } finally {
    if (previousDocument === undefined) {
      delete global.document;
    } else {
      global.document = previousDocument;
    }
  }
}
