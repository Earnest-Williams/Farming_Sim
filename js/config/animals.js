import animalsJson from '../../data/animals.json' with { type: 'json' };

/**
 * @typedef {Object} AnimalFeedSpec
 * @property {number} oats_bu
 * @property {number} hay_t
 */

/**
 * @typedef {Object} AnimalSpec
 * @property {string} id
 * @property {string} displayName
 * @property {number} startingCount
 * @property {string|null} [defaultLocation]
 * @property {AnimalFeedSpec} feed
 * @property {number} pastureIntake_t
 * @property {string|null} [pastureParcel]
 * @property {boolean} pastureReplacesHay
 * @property {number} manurePerDay
 * @property {number} eggsDozensPerDay
 * @property {Record<string, number>} slaughter
 */

/**
 * @typedef {Object} AnimalDailyNeeds
 * @property {number} oats_bu
 * @property {number} hay_t
 * @property {number} manureUnits
 * @property {number} eggsDozens
 * @property {number} pastureIntake_t
 */

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
  }
  return Object.freeze(value);
}

function coerceNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeSlaughter(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const entries = Object.entries(raw)
    .map(([key, value]) => [key, coerceNumber(value, 0)])
    .filter(([, value]) => value !== 0);
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeAnimalSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Invalid animal specification: expected object');
  }
  const id = String(spec.id || '').trim();
  if (!id) throw new Error('Animal specification missing id');
  const displayName = String(spec.displayName || id).trim();
  const startingCount = coerceNumber(spec.startingCount, 0);
  const defaultLocation = spec.defaultLocation == null ? null : String(spec.defaultLocation || '').trim() || null;
  const feedSpec = spec.feed && typeof spec.feed === 'object' ? spec.feed : {};
  const feed = Object.freeze({
    oats_bu: coerceNumber(feedSpec.oats_bu, 0),
    hay_t: coerceNumber(feedSpec.hay_t, 0),
  });
  const pastureIntake_t = coerceNumber(spec.pastureIntake_t, 0);
  const pastureParcel = spec.pastureParcel == null ? null : String(spec.pastureParcel || '').trim() || null;
  const pastureReplacesHay = Boolean(spec.pastureReplacesHay);
  const manurePerDay = coerceNumber(spec.manurePerDay, 0);
  const eggsDozensPerDay = coerceNumber(spec.eggsDozensPerDay, 0);
  const slaughter = normalizeSlaughter(spec.slaughter);

  /** @type {AnimalSpec} */
  const normalized = {
    id,
    displayName,
    startingCount,
    defaultLocation,
    feed,
    pastureIntake_t,
    pastureParcel,
    pastureReplacesHay,
    manurePerDay,
    eggsDozensPerDay,
    slaughter,
  };

  return deepFreeze(normalized);
}

const rawAnimals = Array.isArray(animalsJson?.animals) ? animalsJson.animals : [];
const normalizedAnimals = rawAnimals.map(normalizeAnimalSpec);
const animalsById = new Map();
for (const animal of normalizedAnimals) {
  if (animalsById.has(animal.id)) {
    throw new Error(`Duplicate animal id detected: ${animal.id}`);
  }
  animalsById.set(animal.id, animal);
}

export const ANIMALS = Object.freeze([...normalizedAnimals]);
export const ANIMAL_IDS = Object.freeze(ANIMALS.map(a => a.id));
export const ANIMALS_BY_ID = animalsById;

export const INITIAL_LIVESTOCK_COUNTS = Object.freeze(Object.fromEntries(
  ANIMALS.map(a => [a.id, a.startingCount])
));

export const DEFAULT_LIVESTOCK_LOCATIONS = Object.freeze(Object.fromEntries(
  ANIMALS.filter(a => a.defaultLocation).map(a => [a.id, a.defaultLocation])
));

export const INITIAL_HERD_LOCATIONS = Object.freeze(Object.fromEntries(
  ANIMALS.filter(a => a.pastureParcel).map(a => [a.id, a.pastureParcel])
));

export const FEED_BY_ID = Object.freeze(Object.fromEntries(
  ANIMALS.map(a => [a.id, a.feed])
));

export const MANURE_PER_DAY_BY_ID = Object.freeze(Object.fromEntries(
  ANIMALS.map(a => [a.id, a.manurePerDay])
));

export const EGGS_DOZENS_PER_DAY_BY_ID = Object.freeze(Object.fromEntries(
  ANIMALS.map(a => [a.id, a.eggsDozensPerDay])
));

export const PASTURE_INFO_BY_ID = Object.freeze(Object.fromEntries(
  ANIMALS.map(a => [a.id, Object.freeze({
    intake_t: a.pastureIntake_t,
    parcel: a.pastureParcel,
    replacesHay: a.pastureReplacesHay,
  })])
));

export const SLAUGHTER_OUTPUTS_BY_ID = Object.freeze(Object.fromEntries(
  ANIMALS.map(a => [a.id, a.slaughter])
));

/**
 * @param {string} id
 * @returns {AnimalSpec | null}
 */
export function getAnimalById(id) {
  return animalsById.get(id) || null;
}

/**
 * @param {AnimalSpec} animal
 * @param {number} count
 * @param {string} [herdLocation]
 * @returns {AnimalDailyNeeds}
 */
export function computeDailyNeedsForAnimal(animal, count, herdLocation = undefined) {
  if (!animal) {
    return { oats_bu: 0, hay_t: 0, manureUnits: 0, eggsDozens: 0, pastureIntake_t: 0 };
  }
  const heads = Math.max(0, coerceNumber(count, 0));
  if (heads === 0) {
    return { oats_bu: 0, hay_t: 0, manureUnits: 0, eggsDozens: 0, pastureIntake_t: 0 };
  }
  const oats_bu = animal.feed.oats_bu * heads;
  let hay_t = animal.feed.hay_t * heads;
  let pastureIntake_t = 0;
  const targetParcel = animal.pastureParcel || animal.defaultLocation || null;
  if (animal.pastureIntake_t > 0 && herdLocation && targetParcel && herdLocation === targetParcel) {
    pastureIntake_t = animal.pastureIntake_t * heads;
    if (animal.pastureReplacesHay) {
      hay_t = 0;
    }
  }
  const manureUnits = animal.manurePerDay * heads;
  const eggsDozens = animal.eggsDozensPerDay * heads;
  return { oats_bu, hay_t, manureUnits, eggsDozens, pastureIntake_t };
}
