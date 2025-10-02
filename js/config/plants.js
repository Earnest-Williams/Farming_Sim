import plantsJson from '../../data/plants.json' with { type: 'json' };

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
  }
  return Object.freeze(value);
}

function asString(value, fallback = '') {
  if (value == null) return fallback;
  const str = String(value).trim();
  return str || fallback;
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeGlyphs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((g) => asString(g));
}

function normalizeStageSpriteIds(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => asNumber(n, 0));
}

function normalizeSeed(raw) {
  const seed = raw && typeof raw === 'object' ? raw : {};
  const rateObj = seed.rate && typeof seed.rate === 'object' ? seed.rate : {};
  const unit = asString(rateObj.unit, 'bu_per_acre');
  const value = asNumber(rateObj.value, 0);
  const inventoryKey = seed.inventoryKey == null ? null : asString(seed.inventoryKey, '') || null;
  const resourceKey = seed.resourceKey == null ? (inventoryKey ? `seed_${inventoryKey}` : null) : asString(seed.resourceKey, '') || null;
  const marketItem = seed.marketItem == null ? null : asString(seed.marketItem, '') || null;
  const startingQuantity = asNumber(seed.startingQuantity, 0);
  return deepFreeze({
    rate: deepFreeze({ unit, value }),
    inventoryKey,
    resourceKey,
    marketItem,
    startingQuantity,
  });
}

function normalizePrimaryYield(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const storeKey = payload.storeKey == null ? null : asString(payload.storeKey, '') || null;
  const marketKey = payload.marketKey == null ? null : asString(payload.marketKey, '') || null;
  const unit = payload.unit == null ? null : asString(payload.unit, '') || null;
  const startingQuantity = asNumber(payload.startingQuantity, 0);
  return deepFreeze({ storeKey, marketKey, unit, startingQuantity });
}

function normalizeSheaf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = asString(raw.key, '');
  if (!key) return null;
  const strawPerBushel = asNumber(raw.strawPerBushel, 0);
  return deepFreeze({ key, strawPerBushel });
}

function normalizeSalvage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const storeKey = asString(raw.storeKey, '');
  if (!storeKey) return null;
  const multiplier = asNumber(raw.multiplier, 1);
  return deepFreeze({ storeKey, multiplier });
}

function normalizeProcessing(raw) {
  if (!raw || typeof raw !== 'object') return deepFreeze({ winnow: false });
  return deepFreeze({ winnow: !!raw.winnow });
}

function normalizeAliases(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((alias) => asString(alias)).filter((alias) => alias.length > 0);
}

function ensureRequiredFields(plant) {
  if (!plant.id) throw new Error('Plant specification missing id');
  if (!plant.name) throw new Error(`Plant ${plant.id} missing name`);
  if (!Number.isFinite(plant.baseDays)) throw new Error(`Plant ${plant.id} missing baseDays`);
  if (!Number.isFinite(plant.baseYield)) throw new Error(`Plant ${plant.id} missing baseYield`);
  if (!Number.isFinite(plant.nitrogenUse)) throw new Error(`Plant ${plant.id} missing nitrogenUse`);
  if (!plant.glyphs.length) throw new Error(`Plant ${plant.id} missing glyphs`);
}

function normalizePlant(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Invalid plant specification: expected object');
  }
  const id = asString(spec.id);
  const key = spec.key == null ? null : asString(spec.key, '') || null;
  const name = asString(spec.name, id);
  const category = asString(spec.category, 'arable');
  const type = asString(spec.type, 'misc');
  const baseDays = asNumber(spec.baseDays, 0);
  const baseYield = asNumber(spec.baseYield, 0);
  const nitrogenUse = asNumber(spec.nitrogenUse, 0);
  const glyphs = normalizeGlyphs(spec.glyphs);
  const stageSpriteIds = normalizeStageSpriteIds(spec.stageSpriteIds);
  const rotation = !!spec.rotation;
  const primaryYield = normalizePrimaryYield(spec.primaryYield);
  const seed = normalizeSeed(spec.seed);
  const sheaf = normalizeSheaf(spec.sheaf);
  const salvage = normalizeSalvage(spec.salvage);
  const aliases = normalizeAliases(spec.aliases);
  const processing = normalizeProcessing(spec.processing);

  const plant = {
    id,
    key,
    name,
    category,
    type,
    baseDays,
    baseYield,
    nitrogenUse,
    glyphs,
    stageSpriteIds,
    rotation,
    primaryYield,
    seed,
    sheaf,
    salvage,
    aliases,
    processing,
  };

  ensureRequiredFields(plant);
  return deepFreeze(plant);
}

const rawPlants = Array.isArray(plantsJson?.plants) ? plantsJson.plants : [];
const normalizedPlants = rawPlants.map(normalizePlant);
const plantById = new Map();
for (const plant of normalizedPlants) {
  if (plantById.has(plant.id)) {
    throw new Error(`Duplicate plant id detected: ${plant.id}`);
  }
  plantById.set(plant.id, plant);
}

const arablePlants = normalizedPlants.filter((plant) => plant.category === 'arable');
const gardenPlants = normalizedPlants.filter((plant) => plant.category === 'garden');

const cropsById = Object.freeze(Object.fromEntries(arablePlants.map((plant) => [plant.id, plant])));
const cropsByKey = (() => {
  const entries = new Map();
  for (const plant of arablePlants) {
    if (plant.key) {
      if (entries.has(plant.key)) {
        throw new Error(`Duplicate plant key detected: ${plant.key}`);
      }
      entries.set(plant.key, plant);
    }
  }
  return Object.freeze(Object.fromEntries(entries));
})();

const rotationIds = Array.isArray(plantsJson?.rotation) ? plantsJson.rotation : [];
const rotationPlants = rotationIds.map((id) => {
  const plant = plantById.get(id);
  if (!plant) throw new Error(`Rotation references unknown plant id: ${id}`);
  return plant;
});

const stageSpritesByKey = Object.freeze(Object.fromEntries(
  arablePlants
    .filter((plant) => plant.key && plant.stageSpriteIds.length)
    .map((plant) => [plant.key, plant.stageSpriteIds])
));

const glyphsByKey = Object.freeze(Object.fromEntries(
  arablePlants
    .filter((plant) => plant.key && plant.glyphs.length)
    .map((plant) => [plant.key, plant.glyphs])
));

const strawPerBushelById = Object.freeze(Object.fromEntries(
  arablePlants
    .filter((plant) => plant.sheaf && Number.isFinite(plant.sheaf.strawPerBushel))
    .map((plant) => [plant.id, plant.sheaf.strawPerBushel])
));

const seedRateBuPerAcreById = Object.freeze(Object.fromEntries(
  normalizedPlants
    .filter((plant) => plant.seed.rate.unit === 'bu_per_acre')
    .map((plant) => [plant.id, plant.seed.rate.value])
));

const seedConfigs = (() => {
  const entries = [];
  for (const plant of normalizedPlants) {
    const { inventoryKey, resourceKey, marketItem, startingQuantity } = plant.seed;
    if (!inventoryKey && !resourceKey && !marketItem && !plant.seed.rate.value) continue;
    entries.push({
      plantId: plant.id,
      inventoryKey: inventoryKey ?? null,
      resourceKey: resourceKey ?? null,
      marketItem: marketItem ?? null,
      startingQuantity,
      rate: plant.seed.rate,
    });
  }
  return deepFreeze(entries);
})();

const seedConfigByPlantId = Object.freeze(Object.fromEntries(seedConfigs.map((config) => [config.plantId, config])));
const seedConfigByInventoryKey = Object.freeze(Object.fromEntries(
  seedConfigs
    .filter((config) => config.inventoryKey)
    .map((config) => [config.inventoryKey, config])
));
const seedConfigByResourceKey = Object.freeze(Object.fromEntries(
  seedConfigs
    .filter((config) => config.resourceKey)
    .map((config) => [config.resourceKey, config])
));
const seedConfigByMarketItem = Object.freeze(Object.fromEntries(
  seedConfigs
    .filter((config) => config.marketItem)
    .map((config) => [config.marketItem, config])
));

const sheafKeyMap = (() => {
  const map = new Map();
  for (const plant of arablePlants) {
    if (plant.sheaf?.key) {
      const keys = new Set([plant.sheaf.key, plant.id, plant.id?.toUpperCase?.(), plant.key].filter(Boolean));
      for (const key of keys) {
        if (map.has(key)) {
          throw new Error(`Duplicate sheaf key detected: ${key}`);
        }
        map.set(key, plant.id);
      }
    }
  }
  return Object.freeze(Object.fromEntries(map));
})();

const primaryYieldStoreKeyById = Object.freeze(Object.fromEntries(
  normalizedPlants
    .filter((plant) => plant.primaryYield.storeKey)
    .map((plant) => [plant.id, plant.primaryYield.storeKey])
));

const primaryYieldMarketKeyById = Object.freeze(Object.fromEntries(
  normalizedPlants
    .filter((plant) => plant.primaryYield.marketKey)
    .map((plant) => [plant.id, plant.primaryYield.marketKey])
));

const salvageById = Object.freeze(Object.fromEntries(
  normalizedPlants
    .filter((plant) => plant.salvage || plant.primaryYield.storeKey)
    .map((plant) => [plant.id, {
      storeKey: plant.salvage?.storeKey ?? plant.primaryYield.storeKey ?? null,
      multiplier: plant.salvage?.multiplier ?? 1,
    }])
));

const winnowablePlants = Object.freeze(arablePlants.filter((plant) => plant.processing.winnow));

const aliasToPlantId = Object.freeze(Object.fromEntries(
  normalizedPlants
    .flatMap((plant) => plant.aliases.map((alias) => [alias, plant.id]))
));

export const PLANTS = deepFreeze([...normalizedPlants]);
export const PLANTS_BY_ID = plantById;
export const CROPS = cropsById;
export const CROPS_BY_KEY = cropsByKey;
export const ROTATION = Object.freeze([...rotationPlants]);
export const ROTATION_IDS = Object.freeze(rotationPlants.map((plant) => plant.id));
export const STAGE_SIDS_BY_KEY = stageSpritesByKey;
export const CROP_GLYPHS_BY_KEY = glyphsByKey;
export const STRAW_PER_BUSHEL_BY_ID = strawPerBushelById;
export const SEED_RATE_BU_PER_ACRE_BY_ID = seedRateBuPerAcreById;
export const SEED_CONFIGS = seedConfigs;
export const SEED_CONFIG_BY_PLANT_ID = seedConfigByPlantId;
export const SEED_CONFIG_BY_INVENTORY_KEY = seedConfigByInventoryKey;
export const SEED_CONFIG_BY_RESOURCE_KEY = seedConfigByResourceKey;
export const SEED_CONFIG_BY_MARKET_ITEM = seedConfigByMarketItem;
export const SHEAF_KEY_TO_PLANT_ID = sheafKeyMap;
export const PRIMARY_YIELD_STORE_KEY_BY_ID = primaryYieldStoreKeyById;
export const PRIMARY_YIELD_MARKET_KEY_BY_ID = primaryYieldMarketKeyById;
export const SALVAGE_INFO_BY_ID = salvageById;
export const WINNOWABLE_PLANTS = winnowablePlants;
export const GARDEN_PLANTS = Object.freeze([...gardenPlants]);
export const ARABLE_PLANTS = Object.freeze([...arablePlants]);
export const ALIAS_TO_PLANT_ID = aliasToPlantId;

export function getPlantById(id) {
  return plantById.get(id) ?? null;
}

export function getPlantByKey(key) {
  if (!key) return null;
  return cropsByKey[key] ?? plantById.get(key) ?? null;
}

export function getPlantForSheafKey(key) {
  if (!key) return null;
  const str = typeof key === 'string' ? key : String(key);
  const plantId = sheafKeyMap[str] ?? sheafKeyMap[str.toUpperCase()];
  return plantId ? plantById.get(plantId) ?? null : null;
}

export function getPlantByAlias(alias) {
  if (!alias) return null;
  const str = typeof alias === 'string' ? alias : String(alias);
  const id = aliasToPlantId[str] ?? aliasToPlantId[str.toLowerCase()];
  return id ? plantById.get(id) ?? null : null;
}
