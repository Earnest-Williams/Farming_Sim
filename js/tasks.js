import { updateFieldCrop, updateFieldPhase, moveLivestock, findField } from './world.js';

export const RATES = Object.freeze({
  plough_ac_per_hour: 0.8,
  harrow_ac_per_hour: 1.2,
  drill_ac_per_hour: 1.0,
  hoe_ac_per_hour: 2.0,
  hay_cut_ac_per_hour: 1.0,
  cart_market_hours: 4,
  garden_hours: 6,
});

export const OATS_LOW_THRESHOLD = 20;

let jobCounter = 0;

function nextId(prefix) {
  jobCounter += 1;
  return `${prefix}-${jobCounter}`;
}

function hoursFor(acres, rate) {
  if (!rate || rate <= 0) return 0;
  return acres / rate;
}

function createFieldJob(kind, field, options = {}) {
  const { crop = null, rate, nextPhase, prerequisites = [], description } = options;
  const hours = options.hours ?? hoursFor(field.acres, rate);
  const opLabel = description ?? kind.replace(/_/g, ' ');
  return {
    id: nextId(kind),
    kind,
    field: field.key,
    operation: opLabel,
    acres: field.acres,
    crop,
    hours,
    prerequisites,
    canApply(world) {
      const parcel = findField(world, field.key);
      if (!parcel) {
        if (kind === 'garden_plant' || kind === 'cart_market' || kind === 'move_livestock') {
          return true;
        }
        return false;
      }
      if (kind === 'plough') return parcel.phase === 'needs_plough';
      if (kind === 'harrow') return parcel.phase === 'ploughed';
      if (kind === 'sow') return ['ploughed', 'harrowed', 'ready_to_sow'].includes(parcel.phase);
      if (kind === 'hoe_first') return parcel.phase === 'sown' || parcel.phase === 'growing';
      if (kind === 'hay_cut') return parcel.phase === 'growing';
      if (kind === 'cart_market') return true;
      if (kind === 'garden_plant') return true;
      if (kind === 'move_livestock') return true;
      return true;
    },
    apply(world) {
      if (kind === 'plough') {
        updateFieldPhase(world, field.key, nextPhase ?? 'ploughed');
      } else if (kind === 'harrow') {
        updateFieldPhase(world, field.key, nextPhase ?? 'harrowed');
      } else if (kind === 'sow') {
        updateFieldPhase(world, field.key, nextPhase ?? 'sown');
        if (crop) updateFieldCrop(world, field.key, crop);
      } else if (kind === 'hoe_first') {
        updateFieldPhase(world, field.key, nextPhase ?? 'weeded_once');
      } else if (kind === 'hay_cut') {
        updateFieldPhase(world, field.key, nextPhase ?? 'cut_for_hay');
      } else if (kind === 'garden_plant') {
        updateFieldPhase(world, field.key, nextPhase ?? 'planted');
      } else if (kind === 'move_livestock') {
        moveLivestock(world, options.animal, options.to);
      }
      return world;
    },
  };
}

export function plough(field) {
  return createFieldJob('plough', field, {
    rate: RATES.plough_ac_per_hour,
    nextPhase: 'ploughed',
    prerequisites: ['Team: horses or oxen', 'Plough ready'],
    description: 'Plough',
  });
}

export function harrow(field) {
  return createFieldJob('harrow', field, {
    rate: RATES.harrow_ac_per_hour,
    nextPhase: 'harrowed',
    prerequisites: ['Horses or oxen', 'Harrow tool'],
    description: 'Harrow',
  });
}

export function sow(field, crop) {
  return createFieldJob('sow', field, {
    rate: RATES.drill_ac_per_hour,
    nextPhase: 'sown',
    crop,
    prerequisites: [`Seed: ${crop}`],
    description: `Sow ${crop}`,
  });
}

export function hoe(field) {
  return createFieldJob('hoe_first', field, {
    rate: RATES.hoe_ac_per_hour,
    nextPhase: 'weeded_once',
    prerequisites: ['Hand tools'],
    description: 'First hoeing',
  });
}

export function hayCut(field) {
  return createFieldJob('hay_cut', field, {
    rate: RATES.hay_cut_ac_per_hour,
    nextPhase: 'cut_for_hay',
    prerequisites: ['Scythes ready'],
    description: 'Cut hay',
  });
}

export function gardenPlant(parcelKey, crops) {
  const pseudoField = { key: parcelKey, acres: 0.25 };
  return createFieldJob('garden_plant', pseudoField, {
    hours: RATES.garden_hours,
    nextPhase: 'planted',
    prerequisites: crops.map((c) => `Seedlings: ${c}`),
    description: `Plant garden (${crops.join(', ')})`,
  });
}

export function moveSheep(from, to) {
  const pseudoField = { key: from, acres: 0 };
  return createFieldJob('move_livestock', pseudoField, {
    hours: 1,
    nextPhase: null,
    prerequisites: [`Sheep at ${from}`],
    description: `Move sheep to ${to}`,
    animal: 'sheep',
    to,
  });
}

export function cartToMarket() {
  const pseudoField = { key: 'market', acres: 0 };
  return createFieldJob('cart_market', pseudoField, {
    hours: RATES.cart_market_hours,
    prerequisites: ['Cart team ready', 'Goods loaded'],
    description: 'Cart to market',
  });
}

export function shouldGoToMarket(world) {
  const lowOats = (world?.stores?.oats_bu ?? 0) < OATS_LOW_THRESHOLD;
  const surplus = (world?.stores?.barley_bu ?? 0) > 280 || (world?.stores?.beans_bu ?? 0) > 140;
  const parcels = [...(world?.fields ?? []), ...(world?.closes ?? [])];
  const pendingSeed = parcels.some((f) => f.phase === 'needs_seed');
  return Boolean(lowOats || surplus || pendingSeed);
}
