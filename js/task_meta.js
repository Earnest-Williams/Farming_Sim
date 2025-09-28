import { findField } from './world.js';

function parcelTiles(parcel) {
  if (!parcel) return [];
  const startX = Math.round(parcel.x ?? 0);
  const startY = Math.round(parcel.y ?? 0);
  const width = Math.max(1, Math.round(parcel.w ?? 1));
  const height = Math.max(1, Math.round(parcel.h ?? 1));
  const tiles = [];
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function fieldSite(fieldKey) {
  return (state) => {
    const parcel = findField(state.world, fieldKey);
    return parcelTiles(parcel);
  };
}

function locationSite(selector) {
  return (state) => {
    const loc = selector(state);
    if (!loc) return [];
    return [{ x: Math.round(loc.x ?? 0), y: Math.round(loc.y ?? 0) }];
  };
}

function taskRuntimeSite(fallback) {
  return (state, task) => {
    const target = task?.runtime?.target ?? task?.target ?? fallback?.(state, task);
    if (!target) return [];
    return [{ x: Math.round(target.x ?? 0), y: Math.round(target.y ?? 0) }];
  };
}

export const TASK_META = {
  plough_barley: { site: fieldSite('barley_clover') },
  harrow_barley: { site: fieldSite('barley_clover') },
  sow_barley_clover: { site: fieldSite('barley_clover') },
  plough_pulses: { site: fieldSite('pulses') },
  harrow_pulses: { site: fieldSite('pulses') },
  sow_pulses: { site: fieldSite('pulses') },
  plough_oats_close: { site: fieldSite('oats_close') },
  harrow_oats_close: { site: fieldSite('oats_close') },
  sow_oats_close: { site: fieldSite('oats_close') },
  garden_sow_spring: { site: fieldSite('homestead') },
  move_sheep_to_clover: { site: fieldSite('clover_hay') },
  market_trip: { site: locationSite((state) => state.world?.locations?.market) },
  // Kind-based fallbacks
  plough: { site: taskRuntimeSite() },
  harrow: { site: taskRuntimeSite() },
  sow: { site: taskRuntimeSite() },
  garden_plant: { site: taskRuntimeSite() },
  move_livestock: {
    site: (state, task) => {
      const destination = task?.definition?.to ?? task?.runtime?.to ?? task?.definition?.field;
      if (destination) {
        const parcel = findField(state.world, destination);
        if (parcel) return parcelTiles(parcel);
      }
      return taskRuntimeSite()(state, task);
    },
  },
  market: { site: locationSite((state) => state.world?.locations?.market) },
};
