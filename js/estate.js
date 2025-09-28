import { CONFIG_PACK_V1 } from './config/pack_v1.js';

const FARMHOUSE = CONFIG_PACK_V1.estate?.farmhouse ?? { x: 24, y: 28 };
const MARKET = CONFIG_PACK_V1.estate?.market ?? { x: 8, y: 8 };

function parcelEntry(parcel) {
  return {
    key: parcel.key,
    name: parcel.name,
    acres: parcel.acres ?? 0,
    x: parcel.x ?? 0,
    y: parcel.y ?? 0,
  };
}

export const ESTATE = Object.freeze([
  { key: 'farmhouse', name: 'Farmhouse', acres: 0, x: FARMHOUSE.x ?? 24, y: FARMHOUSE.y ?? 28 },
  { key: 'market', name: 'Market', acres: 0, x: MARKET.x ?? 8, y: MARKET.y ?? 8 },
  ...(Array.isArray(CONFIG_PACK_V1.estate?.parcels)
    ? CONFIG_PACK_V1.estate.parcels.map(parcelEntry)
    : []),
]);

export function findParcelMeta(key) {
  if (!key) return null;
  return ESTATE.find((entry) => entry.key === key) ?? null;
}
