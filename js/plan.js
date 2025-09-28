import { findField } from './world.js';
import {
  plough,
  harrow,
  sow,
  gardenPlant,
  moveSheep,
  cartToMarket,
  shouldGoToMarket,
} from './tasks.js';

export const MONTHLY_PLAN = {
  I: [
    { op: 'plough+harrow', fields: ['barley_clover', 'pulses', 'oats_close'] },
    {
      op: 'sow',
      pairs: [
        ['barley_clover', 'barley+clover'],
        ['pulses', 'beans/peas/vetch'],
        ['oats_close', 'oats'],
      ],
    },
    { op: 'garden_plant', what: ['onions', 'cabbages', 'carrots'], parcel: 'homestead' },
    { op: 'move_sheep', from: 'turnips', to: 'clover_hay' },
  ],
};

function flattenJobs(world, planItem) {
  const jobs = [];
  if (planItem.op === 'plough+harrow') {
    for (const key of planItem.fields) {
      const field = findField(world, key);
      if (!field) continue;
      if (field.phase === 'needs_plough') {
        jobs.push(plough(field));
        jobs.push(harrow(field));
      } else if (field.phase === 'ploughed') {
        jobs.push(harrow(field));
      }
    }
  } else if (planItem.op === 'sow') {
    for (const [key, crop] of planItem.pairs) {
      const field = findField(world, key);
      if (!field) continue;
      jobs.push(sow(field, crop));
    }
  } else if (planItem.op === 'garden_plant') {
    jobs.push(gardenPlant(planItem.parcel ?? 'homestead', planItem.what));
  } else if (planItem.op === 'move_sheep') {
    jobs.push(moveSheep(planItem.from, planItem.to));
  }
  return jobs;
}

export function generateMonthJobs(world, monthRoman) {
  const plan = MONTHLY_PLAN[monthRoman] || [];
  const jobs = plan.flatMap((item) => flattenJobs(world, item));
  if (shouldGoToMarket(world)) {
    jobs.push(cartToMarket());
  }
  return jobs;
}
