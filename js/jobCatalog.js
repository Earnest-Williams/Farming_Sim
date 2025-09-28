import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { findField, recordJobCompletion } from './world.js';
import {
  RATES,
  plough,
  harrow,
  sow,
  gardenPlant,
  moveSheep,
  cartToMarket,
} from './tasks.js';

const MINUTES_PER_HOUR = CONFIG_PACK_V1.time.minutesPerHour ?? 60;

function hoursFor(acres, perHour) {
  if (!Number.isFinite(acres) || acres <= 0) return 0;
  if (!Number.isFinite(perHour) || perHour <= 0) return 0;
  return acres / perHour;
}

function parcelCenter(parcel) {
  if (!parcel) return { x: 0, y: 0 };
  const x = Math.round((parcel.x ?? 0) + (parcel.w ?? 0) / 2);
  const y = Math.round((parcel.y ?? 0) + (parcel.h ?? 0) / 2);
  return { x, y };
}

function gardenCenter(world) {
  const parcel = findField(world, 'homestead');
  if (parcel) return parcelCenter(parcel);
  return world?.locations?.yard ?? { x: 0, y: 0 };
}

function marketCenter(world) {
  return world?.locations?.market ?? { x: 0, y: 0 };
}

function livestockDestination(world, key) {
  const parcel = findField(world, key);
  if (parcel) return parcelCenter(parcel);
  return world?.locations?.yard ?? { x: 0, y: 0 };
}

export function estimateJobHours(job) {
  switch (job.kind) {
    case 'plough':
      return hoursFor(job.acres ?? 0, RATES.plough_ac_per_hour);
    case 'harrow':
      return hoursFor(job.acres ?? 0, RATES.harrow_ac_per_hour);
    case 'sow':
      return hoursFor(job.acres ?? 0, RATES.drill_ac_per_hour);
    case 'garden_plant':
      return RATES.garden_hours ?? 0;
    case 'move_livestock':
      return 1;
    case 'market':
      return RATES.cart_market_hours ?? 0;
    default:
      return 0;
  }
}

function ensureJobHours(jobDef, job) {
  if (Number.isFinite(job?.hours) && job.hours > 0) return job.hours;
  const estimated = estimateJobHours(jobDef);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  return 0;
}

export function instantiateJob(world, jobDef) {
  if (!world || !jobDef) return null;
  switch (jobDef.kind) {
    case 'plough': {
      const field = findField(world, jobDef.field);
      if (!field) return null;
      const job = plough(field);
      const hours = ensureJobHours(jobDef, job);
      return {
        ...job,
        id: jobDef.id,
        label: jobDef.label ?? job.operation ?? job.kind,
        hours,
        target: parcelCenter(field),
      };
    }
    case 'harrow': {
      const field = findField(world, jobDef.field);
      if (!field) return null;
      const job = harrow(field);
      const hours = ensureJobHours(jobDef, job);
      return {
        ...job,
        id: jobDef.id,
        label: jobDef.label ?? job.operation ?? job.kind,
        hours,
        target: parcelCenter(field),
      };
    }
    case 'sow': {
      const field = findField(world, jobDef.field);
      if (!field) return null;
      const job = sow(field, jobDef.crop);
      const hours = ensureJobHours(jobDef, job);
      return {
        ...job,
        id: jobDef.id,
        label: jobDef.label ?? job.operation ?? job.kind,
        hours,
        target: parcelCenter(field),
      };
    }
    case 'garden_plant': {
      const crops = Array.isArray(jobDef.crops) ? jobDef.crops : [];
      const job = gardenPlant(jobDef.field ?? 'homestead', crops);
      const hours = ensureJobHours(jobDef, job);
      return {
        ...job,
        id: jobDef.id,
        label: jobDef.label ?? job.operation ?? job.kind,
        hours,
        target: gardenCenter(world),
      };
    }
    case 'move_livestock': {
      const job = moveSheep(jobDef.from ?? 'turnips', jobDef.to ?? 'clover_hay');
      const hours = ensureJobHours(jobDef, job);
      return {
        ...job,
        id: jobDef.id,
        label: jobDef.label ?? job.operation ?? job.kind,
        hours,
        target: livestockDestination(world, jobDef.to ?? jobDef.field ?? 'turnips'),
      };
    }
    case 'market': {
      const job = cartToMarket();
      const hours = ensureJobHours(jobDef, job);
      return {
        ...job,
        id: jobDef.id,
        label: jobDef.label ?? job.operation ?? job.kind,
        hours,
        target: marketCenter(world),
      };
    }
    default:
      return null;
  }
}

export function applyJobCompletion(world, jobRuntime) {
  if (!jobRuntime) return;
  if (typeof jobRuntime.apply === 'function') {
    jobRuntime.apply(world);
  }
  recordJobCompletion(world, jobRuntime);
}

export function simMinutesForHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return hours * MINUTES_PER_HOUR;
}
