import { CONFIG_PACK_V1 } from '../config/pack_v1.js';

function manhattan(a, b) {
  return Math.abs((a.x ?? 0) - (b.x ?? 0)) + Math.abs((a.y ?? 0) - (b.y ?? 0));
}

export function assertCloseFieldWithinSteps() {
  const farmhouse = CONFIG_PACK_V1.estate?.farmhouse;
  const parcels = Array.isArray(CONFIG_PACK_V1.estate?.parcels) ? CONFIG_PACK_V1.estate.parcels : [];
  const closes = Array.isArray(CONFIG_PACK_V1.estate?.closes) ? CONFIG_PACK_V1.estate.closes : [];
  const searchPool = parcels.concat(closes);
  const closeField = searchPool.find((parcel) => parcel?.key === 'oats_close')
    ?? searchPool.find((parcel) => parcel?.key?.toLowerCase?.().includes('close'));
  const limit = CONFIG_PACK_V1.rules?.closeFieldMaxSteps ?? Infinity;

  if (!farmhouse || !closeField) {
    throw new Error('Missing farmhouse or close parcel in config pack');
  }

  const farmhouseCentre = {
    x: farmhouse.x + Math.floor((farmhouse.w ?? 0) / 2),
    y: farmhouse.y + Math.floor((farmhouse.h ?? 0) / 2),
  };
  const fieldEntry = {
    x: closeField.x + Math.floor((closeField.w ?? 1) / 2),
    y: closeField.y + Math.floor((closeField.h ?? 1) / 2),
  };

  const distance = manhattan(farmhouseCentre, fieldEntry);
  if (distance > limit) {
    throw new Error(`Close field distance ${distance} exceeds limit ${limit}`);
  }
  return true;
}

export function assertStepMatchesTick() {
  const travelCost = CONFIG_PACK_V1.labour?.travelStepSimMin;
  const tick = CONFIG_PACK_V1.time?.tickSimMin;
  if (!Number.isFinite(travelCost) || !Number.isFinite(tick)) {
    throw new Error('Missing travel or tick configuration values');
  }
  if (Math.abs(travelCost - tick) > 1e-9) {
    throw new Error(`Travel cost (${travelCost}) differs from tickSimMin (${tick})`);
  }
  return true;
}
