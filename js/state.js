import { clamp, clamp01, log } from './utils.js';
import {
  OPT_MOIST,
  STRAW_PER_BUSHEL,
  THRESH_LOSS,
  CROPS,
  TASK_KINDS } from './constants.js';
import { attachPastureIfNeeded, stamp } from './world.js';
import { priceFor, transactAtMarket, buildMarketManifest, ensureMarketState } from './market.js';
export { priceFor } from './market.js';

export function applySowPenalty(world, p) {
  const d = world.calendar.day;
  const lateDays = Math.max(0, d - 16);
  if (lateDays > 0) p.status.lateSow = (p.status.lateSow || 0) + lateDays;
}

export function applyHarvestPenalty(world, p) {
  let penalty = 0;
  const m = world.calendar.month;
  if (p.status.targetHarvestM) {
    if (m < p.status.targetHarvestM) penalty = 0.05;
    if (m > p.status.targetHarvestM) penalty = 0.10;
  }
  p.status.harvestPenalty = Math.max(p.status.harvestPenalty || 0, penalty);
}

export function rowGrowthMultiplier(parcel, row, crop) {
  const m = row.moisture ?? parcel.soil.moisture;
  const fMoist = clamp01(1.2 - 2.0 * Math.abs(m - OPT_MOIST));
  const n = parcel.soil.nitrogen;
  const fN = clamp01(0.6 + 1.6 * (n));
  const fTilth = 1.0 + 0.30 * clamp01(parcel.status.tilth || 0);
  const fWeed = 1.0 - 0.50 * clamp01(row.weed || 0);
  const fComp = row.companion && row.companion.key === 'CLOVER' && crop.key === 'BARLEY' ? 1.05 : 1.0;
  return clamp01(fMoist) * fN * fTilth * fWeed * fComp;
}

export function estimateParcelYieldBushels(parcel, crop) {
  const acres = parcel.acres || 0;
  const baseBuPerAcre = crop.baseYield;
  let avgWeed = 0;
  let avgMoist = parcel.soil.moisture;
  const rows = parcel.rows || [];
  if (rows.length) {
    for (const r of rows) avgWeed += (r.weed || 0);
    avgWeed /= rows.length;
  }
  const pseudoRow = { moisture: avgMoist, weed: avgWeed, companion: null };
  const f = rowGrowthMultiplier(parcel, pseudoRow, crop);
  return Math.max(0, acres * baseBuPerAcre * f);
}

export function estimateParcelYieldBushelsWithTiming(world, parcel, crop) {
  let bu = estimateParcelYieldBushels(parcel, crop);
  if (parcel.status.lateSow) bu *= Math.max(0.8, 1 - 0.01 * parcel.status.lateSow);
  if (parcel.status.harvestPenalty) bu *= (1 - parcel.status.harvestPenalty);
  if (parcel.status.lodgingPenalty) bu *= (1 - parcel.status.lodgingPenalty);
  return bu;
}

function ploughParcel(world, p) {
  p.status.tilth = clamp01((p.status.tilth || 0) + 0.35);
  p.status.stubble = false;
  if (p.rows) {
    for (const r of p.rows) {
      r.weed = clamp01((r.weed || 0) - 0.15);
      r._tilledOn = stamp(world);
    }
  }
  p.status.lastPloughedOn = stamp(world);
}

function harrowParcel(world, p) {
  p.status.tilth = clamp01((p.status.tilth || 0) + 0.20);
  if (p.rows) {
    for (const r of p.rows) {
      r.weed = clamp01((r.weed || 0) - 0.10);
      r._tilledOn = stamp(world);
    }
  }
  p.status.lastHarrowedOn = stamp(world);
}

function sowParcelRows(world, p, payload) {
  const mainKey = payload?.crop;
  const compKey = payload?.companion;
  const main = CROPS[mainKey];
  const comp = compKey ? CROPS[compKey] : null;
  if (!main) return;
  for (const r of p.rows) {
    r.crop = main;
    r.growth = 0;
    r.weed = r.weed || 0;
    r.companion = comp || null;
    r.plantedOn = stamp(world);
  }
  p.status.cropNote = comp ? `${main.name} + ${comp.name}` : `${main.name}`;
  const nHit = (main.nUse < 0 ? 0.02 : 0.0);
  p.soil.nitrogen = clamp01(p.soil.nitrogen - nHit);
  applySowPenalty(world, p);
  p.status.lastPlantedOn = stamp(world);
}

function drillTurnips(world, p) {
  for (const r of p.rows) {
    r.crop = CROPS.TURNIPS;
    r.growth = 0;
    r.companion = null;
    r.plantedOn = stamp(world);
    r._tilledOn = stamp(world);
  }
  p.status.stubble = false;
  p.status.cropNote = 'Turnips (drilled)';
}

function hoeParcelRows(world, p) {
  for (const r of p.rows) {
    r.weed = clamp01((r.weed || 0) - 0.40);
    p.status.tilth = clamp01((p.status.tilth || 0) + 0.05);
  }
}

function harvestParcelToSheaves(world, p) {
  if (p.fieldStore.sheaves > 0) return;
  applyHarvestPenalty(world, p);
  const row0 = p.rows?.[0];
  if (!row0 || !row0.crop) return;
  const crop = row0.crop;
  const ready = p.rows.every(r => r.crop && r.growth >= 1.0);
  if (!ready) return;
  const bu = estimateParcelYieldBushelsWithTiming(world, p, crop);
  p.fieldStore.sheaves += bu;
  p.fieldStore.cropKey = crop.key;
  for (const r of p.rows) {
    if (crop.key === 'BARLEY' && r.companion?.key === 'CLOVER') {
      r.crop = null;
      r.growth = Math.max(r.growth, 0.2);
    } else {
      r.crop = null;
      r.companion = null;
      r.growth = 0;
    }
  }
  p.status.stubble = true;
  p.status.cropNote = `Stubble (${crop.name} sheaves on field)`;
  p.soil.nitrogen = clamp01(p.soil.nitrogen + (crop.nUse || 0));
}

function cartSheaves(world, p) {
  const k = p.fieldStore.cropKey;
  const qty = p.fieldStore.sheaves || 0;
  if (!k || qty <= 0) return;
  world.storeSheaves[k] = (world.storeSheaves[k] || 0) + qty;
  p.fieldStore.sheaves = 0;
  p.fieldStore.cropKey = null;
  p.status.cropNote = 'Stubble (carted)';
}

function stackRicks(world) {
  world.stackReady = true;
}

const SHEAF_KEY_TO_STORE_FIELD = {
  W: 'wheat',
  B: 'barley',
  O: 'oats',
  P: 'pulses',
  WHEAT: 'wheat',
  BARLEY: 'barley',
  OATS: 'oats',
  PULSES: 'pulses',
};

const SHEAF_KEY_TO_STRAW_KEY = {
  W: 'WHEAT',
  B: 'BARLEY',
  O: 'OATS',
  P: 'PULSES',
  WHEAT: 'WHEAT',
  BARLEY: 'BARLEY',
  OATS: 'OATS',
  PULSES: 'PULSES',
};

function threshSheaves(world, cropKey) {
  if (!world.stackReady) return;
  const klist = cropKey ? [cropKey] : Object.keys(world.storeSheaves);
  for (const k of klist) {
    const sheaves = world.storeSheaves[k] || 0;
    if (sheaves <= 0) continue;
    const grainBu = sheaves * (1 - THRESH_LOSS);
    world.storeSheaves[k] = 0;
    const storeField = SHEAF_KEY_TO_STORE_FIELD[k] || SHEAF_KEY_TO_STORE_FIELD[k?.toUpperCase?.()];
    if (!storeField || world.store[storeField] === undefined) {
      log(world, `⚠️ Cannot credit grain for unsupported crop key: ${k}`);
      continue;
    }
    world.store[storeField] += grainBu;
    const strawKey = SHEAF_KEY_TO_STRAW_KEY[k] || SHEAF_KEY_TO_STRAW_KEY[k?.toUpperCase?.()];
    const strawPerBushel = strawKey ? STRAW_PER_BUSHEL[strawKey] : undefined;
    world.store.straw += grainBu * (strawPerBushel || 1.0);
  }
}

function winnowGrain(world, cropKey) {
  const bump = 0.01;
  if (!cropKey || cropKey === 'WHEAT') world.store.wheat *= (1 + bump);
  if (!cropKey || cropKey === 'BARLEY') world.store.barley *= (1 + bump);
  if (!cropKey || cropKey === 'OATS') world.store.oats *= (1 + bump);
  if (!cropKey || cropKey === 'PULSES') world.store.pulses *= (1 + bump);
}

function spreadManure(world, p, nDelta) {
  p.soil.nitrogen = clamp01(p.soil.nitrogen + (nDelta ?? 0.08));
  p.status.cropNote = (p.status.cropNote || '') + ' · manured';
}

function foldSheepOn(world, p, days) {
  const credit = 0.02 * (days ?? 10);
  p.soil.nitrogen = clamp01(p.soil.nitrogen + credit);
  p.status.cropNote = 'Folded by sheep (winter)';
}

function cutCloverHay(world, p) {
  const acres = p.acres || 0;
  const mass_t = 1.5 * acres;
  p.hayCuring = { mass_t, dryness: 0, loss_t: 0 };
  p.soil.nitrogen = Math.min(1, (p.soil.nitrogen || 0) + 0.05);
  p.status.cropNote = 'Clover cut; curing';
}

function cartHay(world, p) {
  const h = p.hayCuring;
  if (!h) return;
  const net = Math.max(0, h.mass_t - h.loss_t);
  world.store.hay += net;
  p.hayCuring = null;
  p.status.cropNote = 'Clover aftermath';
}

function harvestOrchard(world) {
  const p = world.parcels[world.parcelByKey.orchard];
  const tons = 2.0;
  world.store.fruit_dried += tons * 0.15 * 2204.6 / 200;
  world.store.cider_l += Math.round(tons * 500);
  p.status.cropNote = 'Orchard harvested';
}

function cartToMarket(world, payload) {
  ensureMarketState(world);
  const request = payload?.request ?? payload ?? {};
  const manifest = payload?.manifest ?? buildMarketManifest(world, request);
  if (!manifest.sell.length && !manifest.buy.length) {
    world.market.tripInProgress = false;
    return;
  }
  transactAtMarket(world, manifest);
}

function clampRoots(world, p) {
  log(world, 'Clamping roots...');
}

function markGardenSown(world, p, payload) {
  p.status.cropNote = `Garden sown: ${payload.items.join(', ')}`;
}

function moveHerd(world, payload) {
  const herd = payload?.herd;
  const to = payload?.to;
  if (!herd || !to || !world.herdLoc[herd]) return;
  if (to === 'homestead') {
    world.herdLoc[herd] = 'homestead';
  } else if (world.parcelByKey[to] != null) {
    world.herdLoc[herd] = to;
    const p = world.parcels[world.parcelByKey[to]];
    if (p) p.status.cropNote = (p.status.cropNote || '') + ` · ${herd} present`;
    attachPastureIfNeeded(p);
  }
}

function slaughter(world, payload) {
  const S = world.store;
  const L = world.livestock;
  const sp = payload?.species;
  const n = Math.max(0, payload?.count | 0);
  if (!sp || n <= 0 || !L[sp]) return;
  const take = Math.min(L[sp], n);
  L[sp] -= take;
  switch (sp) {
    case 'sheep': S.meat_salted += take * 15; break;
    case 'geese': S.meat_salted += take * 5; break;
    case 'poultry': S.meat_salted += take * 2; break;
    case 'cow': S.meat_salted += take * 250; break;
    case 'pig': S.bacon_sides += take * 2; break;
    default: break;
  }
}

function doRepair() {}
function doPrune() {}

export function applyTaskEffects(world, task) {
  const p = task.parcelId != null ? world.parcels[task.parcelId] : null;
  switch (task.kind) {
    case TASK_KINDS.PloughPlot: if (p) ploughParcel(world, p); break;
    case TASK_KINDS.HarrowPlot: if (p) harrowParcel(world, p); break;
    case TASK_KINDS.Sow: if (p) sowParcelRows(world, p, task.payload); break;
    case TASK_KINDS.DrillPlot: if (p) drillTurnips(world, p); break;
    case TASK_KINDS.HoeRow: if (p) hoeParcelRows(world, p); break;
    case TASK_KINDS.HarvestParcel: if (p) harvestParcelToSheaves(world, p); break;
    case TASK_KINDS.CartSheaves: if (p) cartSheaves(world, p); break;
    case TASK_KINDS.StackRicks: stackRicks(world); break;
    case TASK_KINDS.Thresh: threshSheaves(world, task.payload?.cropKey); break;
    case TASK_KINDS.Winnow: winnowGrain(world, task.payload?.cropKey); break;
    case TASK_KINDS.SpreadManure: if (p) spreadManure(world, p, task.payload?.nDelta || 0.08); break;
    case TASK_KINDS.FoldSheep: if (p) foldSheepOn(world, p, task.payload?.days || 10); break;
    case TASK_KINDS.ClampRoots: clampRoots(world, p); break;
    case TASK_KINDS.GardenSow: if (p) markGardenSown(world, p, task.payload); break;
    case TASK_KINDS.MoveHerd: moveHerd(world, task.payload); break;
    case TASK_KINDS.Slaughter: slaughter(world, task.payload); break;
    case TASK_KINDS.CutCloverHay: if (p) cutCloverHay(world, p); break;
    case TASK_KINDS.OrchardHarvest: harvestOrchard(world); break;
    case TASK_KINDS.Repair: doRepair(world, task.payload); break;
    case TASK_KINDS.Prune: doPrune(world, task.payload); break;
    case TASK_KINDS.CartHay: if (p) cartHay(world, p); break;
    case TASK_KINDS.CartToMarket: cartToMarket(world, task.payload); break;
    default: break;
  }
}
