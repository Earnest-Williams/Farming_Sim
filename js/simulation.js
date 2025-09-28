import { clamp, clamp01, lerp, log, randomNormal } from './utils.js';
import {
  CROPS,
  WORK_MINUTES,
  TASK_KINDS,
  PASTURE,
  RATION,
  MANURE,
  WX_BASE,
  SOIL,
  DEMAND,
  N_MAX,
  ROTATION,
  PARCEL_KIND,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  seasonOfMonth,
  DAYS_PER_YEAR,
  MID_MONTH_LABOUR_THRESHOLD,
} from './constants.js';
import { makeWorld } from './world.js';
import {
  makeTask,
  minutesFor,
  planDayMonthly,
  tickWorkMinute,
  endOfDayMonth,
  moistureToMud,
  syncFarmerToActive,
  hasActiveWork,
  sendFarmerHome,
} from './tasks.js';
import { advisorExecute, reprioritiseByVPM, updateKPIs } from './advisor.js';
import { attachPastureIfNeeded } from './world.js';
import { rowGrowthMultiplier } from './state.js';
import { autosave } from './persistence.js';
import { MINUTES_PER_DAY, computeDaylightByIndex, dayIndex } from './time.js';

export { processFarmerHalfStep } from './tasks.js';
import { assertNoWorkOutsideWindow } from './tests/invariants.js';

function chooseFlex(world, option) {
  world.flexChoice = option;
  const key = 'flex';
  const pid = world.parcelByKey[key];
  const p = world.parcels[pid];
  const payload = { crop: option };
  const estMin = minutesFor(TASK_KINDS.Sow, p, payload);
  if (option === 'FLAX') {
    world.tasks.month.queued.push(makeTask(world, { kind: TASK_KINDS.Sow, parcelId: pid, payload, latestDay: 10, estMin }));
    p.status.targetHarvestM = 4;
  } else {
    world.tasks.month.queued.push(makeTask(world, { kind: TASK_KINDS.Sow, parcelId: pid, payload, latestDay: 16, estMin }));
    p.status.targetHarvestM = 4;
  }
}

function chooseFlexAuto(world) {
  if ((world.store.oats || 0) < 40) return chooseFlex(world, 'OATS');
  return chooseFlex(world, 'FLAX');
}

function generateMonthlyTasks(world, month) {
  const byKey = world.parcelByKey;
  const P = world.parcels;
  const sumValues = (obj) => Object.values(obj || {}).reduce((acc, val) => acc + (val || 0), 0);
  const estimateStandaloneMinutes = (kind, payload) => {
    switch (kind) {
      case TASK_KINDS.MoveHerd:
        return WORK_MINUTES.MoveHerd_flat;
      case TASK_KINDS.Slaughter: {
        const count = payload?.count ?? 1;
        return count * WORK_MINUTES.Slaughter_perHead;
      }
      case TASK_KINDS.Thresh: {
        const sheaves = sumValues(world.storeSheaves);
        return Math.max(1, sheaves) * WORK_MINUTES.Thresh_perBushel;
      }
      case TASK_KINDS.Winnow: {
        const store = world.store || {};
        const grain = (store.wheat || 0) + (store.barley || 0) + (store.oats || 0) + (store.pulses || 0);
        return Math.max(1, grain) * WORK_MINUTES.Winnow_perBushel;
      }
      case TASK_KINDS.StackRicks: {
        const acresWithSheaves = world.parcels.reduce((acc, parcel) => {
          if ((parcel.fieldStore?.sheaves || 0) > 0) {
            return acc + (parcel.acres || 0);
          }
          return acc;
        }, 0);
        if (acresWithSheaves > 0) {
          return acresWithSheaves * WORK_MINUTES.StackRicks_perAcre;
        }
        const sheaves = sumValues(world.storeSheaves);
        if (sheaves > 0) {
          return Math.max(1, sheaves / 20) * WORK_MINUTES.StackRicks_perAcre;
        }
        return WORK_MINUTES.StackRicks_perAcre;
      }
      case TASK_KINDS.Repair:
        return WORK_MINUTES.Repair_perJob;
      default:
        return WORK_MINUTES.Repair_perJob;
    }
  };
  const push = (kind, key, payload, latestDay, priority = 5) => {
    const pid = key ? byKey[key] : null;
    const est = pid != null ? minutesFor(kind, P[pid], payload) : estimateStandaloneMinutes(kind, payload);
    world.tasks.month.queued.push(makeTask(world, { kind, parcelId: pid, payload, latestDay, estMin: est, priority }));
  };
  switch (month) {
    case 1:
      push(TASK_KINDS.PloughPlot, 'barley_clover', {}, 10, 7);
      push(TASK_KINDS.HarrowPlot, 'barley_clover', {}, 12, 7);
      push(TASK_KINDS.Sow, 'barley_clover', { crop: 'BARLEY', companion: 'CLOVER' }, 16, 9);
      push(TASK_KINDS.Sow, 'pulses', { crop: 'PULSES' }, 18, 8);
      push(TASK_KINDS.Sow, 'oats_close', { crop: 'OATS' }, 16, 8);
      push(TASK_KINDS.GardenSow, 'homestead', { items: ['onions', 'cabbages', 'carrots'] }, 18, 4);
      push(TASK_KINDS.MoveHerd, null, { herd: 'sheep', from: 'turnips', to: 'clover_hay' }, 4, 10);
      if (!world.flexChoice) chooseFlexAuto(world);
      break;
    case 2:
      push(TASK_KINDS.DrillPlot, 'turnips', {}, 10, 9);
      push(TASK_KINDS.HoeRow, 'pulses', {}, 18, 6);
      push(TASK_KINDS.HoeRow, 'oats_close', {}, 18, 6);
      push(TASK_KINDS.GardenSow, 'homestead', { items: ['succession'] }, 18, 3);
      push(TASK_KINDS.Repair, null, { scope: 'hedge_ditch' }, 18, 2);
      if (!world.flexChoice) chooseFlexAuto(world);
      break;
    case 3:
      push(TASK_KINDS.CutCloverHay, 'clover_hay', {}, 16, 9);
      push(TASK_KINDS.HoeRow, 'turnips', {}, 18, 5);
      push(TASK_KINDS.GardenSow, 'homestead', { items: ['maintenance'] }, 18, 3);
      push(TASK_KINDS.Prune, 'orchard', { light: true }, 18, 2);
      break;
    case 4:
      push(TASK_KINDS.HarvestParcel, 'barley_clover', {}, 16, 10);
      push(TASK_KINDS.CartSheaves, 'barley_clover', {}, 18, 9);
      push(TASK_KINDS.HarvestParcel, 'oats_close', {}, 16, 9);
      push(TASK_KINDS.CartSheaves, 'oats_close', {}, 18, 8);
      push(TASK_KINDS.HarvestParcel, 'pulses', {}, 18, 6);
      push(TASK_KINDS.CartSheaves, 'pulses', {}, 19, 5);
      if (world.flexChoice) {
        push(TASK_KINDS.HarvestParcel, 'flex', {}, 18, 7);
        push(TASK_KINDS.CartSheaves, 'flex', {}, 19, 6);
      }
      push(TASK_KINDS.StackRicks, null, {}, 20, 6);
      break;
    case 5:
      push(TASK_KINDS.HarvestParcel, 'wheat', {}, 12, 10);
      push(TASK_KINDS.CartSheaves, 'wheat', {}, 16, 9);
      push(TASK_KINDS.StackRicks, null, {}, 18, 8);
      push(TASK_KINDS.OrchardHarvest, 'orchard', {}, 18, 5);
      push(TASK_KINDS.ClampRoots, 'close_c', { tons: 2.5 }, 20, 4);
      break;
    case 6:
      push(TASK_KINDS.PloughPlot, 'wheat', {}, 8, 8);
      push(TASK_KINDS.SpreadManure, 'wheat', { nDelta: 0.10 }, 10, 7);
      push(TASK_KINDS.Sow, 'wheat', { crop: 'WHEAT' }, 14, 9);
      push(TASK_KINDS.ClampRoots, 'close_c', { tons: 2.5 }, 18, 5);
      push(TASK_KINDS.Thresh, null, {}, 20, 4);
      break;
    case 7:
      push(TASK_KINDS.MoveHerd, null, { herd: 'sheep', from: 'clover_hay', to: 'turnips' }, 4, 10);
      push(TASK_KINDS.FoldSheep, 'turnips', { days: 10 }, 12, 8);
      push(TASK_KINDS.Slaughter, null, { species: 'geese', count: 6 }, 14, 4);
      push(TASK_KINDS.Repair, null, { scope: 'tools_wagon_fences' }, 20, 3);
      break;
    case 8:
      push(TASK_KINDS.Thresh, null, {}, 16, 7);
      push(TASK_KINDS.Winnow, null, {}, 18, 6);
      push(TASK_KINDS.Prune, 'orchard', { winter: true }, 18, 4);
      push(TASK_KINDS.Repair, null, { scope: 'general' }, 20, 3);
      break;
  }
}

export function onNewMonth(world) {
  world.tasks.month = { queued: [], active: [], done: [], overdue: [] };
  world.labour.usedMin = 0;
  world.nextTaskId = (world.calendar.month === 1 && world.calendar.day === 1) ? 0 : (world.nextTaskId || 0);
  generateMonthlyTasks(world, world.calendar.month);
}

function midMonthReprioritise(world) {
  if (world.calendar.day !== 10) return;
  const urgent = world.tasks.month.queued.filter(t => t.latestDay <= 14).length;
  const labourUsed = world.labour.usedMin / world.labour.monthBudgetMin;
  if (urgent > 0 && labourUsed < MID_MONTH_LABOUR_THRESHOLD) {
    world.tasks.month.queued = world.tasks.month.queued.filter(t => {
      if (['Repair', 'Prune', 'GardenSow'].includes(t.kind)) {
        t.priority = 0;
        t.latestDay = 20;
        return true;
      }
      return true;
    });
  }
}

export function planDay(world) {
  updateKPIs(world);
  reprioritiseByVPM(world);
  if (world.advisor?.enabled && world.advisor.mode === 'auto') {
    advisorExecute(world);
  }
  planDayMonthly(world);
  syncFarmerToActive(world);
}

export function stepOneMinute(world) {
  const minute = world.calendar.minute ?? 0;
  const daylight = world.daylight || { workStart: 0, workEnd: MINUTES_PER_DAY };

  if (minute >= daylight.workStart && minute <= daylight.workEnd) {
    tickWorkMinute(world);
    if (!hasActiveWork(world)) planDay(world);
  } else if (!world.farmer.queue?.length) {
    sendFarmerHome(world);
  }

  world.calendar.minute = minute + 1;
  if (world.calendar.minute >= MINUTES_PER_DAY) {
    world.calendar.minute = 0;
    dailyTurn(world);
    planDay(world);
  }

  assertNoWorkOutsideWindow(world);
}

export function pastureRegrow(world) {
  const m = world.calendar.month;
  for (const p of world.parcels) {
    if (!p.pasture) continue;
    const canRegrow = (p.key === 'clover_hay') || (p.status.cropNote?.includes('aftermath'));
    if (!canRegrow) continue;
    const add = (m >= 1 && m <= 4) ? (PASTURE.REGROW_T_PER_ACRE_PER_DAY * p.acres) : 0;
    const cap = p.acres * PASTURE.MAX_BIOMASS_T_PER_ACRE;
    p.pasture.biomass_t = Math.min(cap, p.pasture.biomass_t + add);
    p.pasture.grazedToday_t = 0;
  }
}

function grazeIfPresent(world, parcelKey, heads, consPerHeadT) {
  const id = world.parcelByKey[parcelKey];
  if (id == null) return 0;
  const p = world.parcels[id];
  attachPastureIfNeeded(p);
  const want = heads * consPerHeadT;
  const take = Math.min(want, p.pasture.biomass_t);
  p.pasture.biomass_t -= take;
  p.pasture.grazedToday_t += take;
  return take;
}

export function consumeLivestock(world) {
  const S = world.store;
  const L = world.livestock;
  const H = world.herdLoc;
  if (!S || !L || !H) return;
  world.alerts = [];
  let pastureT = 0;
  if (H.sheep === 'clover_hay') {
    pastureT += grazeIfPresent(world, 'clover_hay', L.sheep, PASTURE.SHEEP_CONS_T_PER_DAY);
  }
  if (H.geese === 'orchard') {
    pastureT += grazeIfPresent(world, 'orchard', L.geese, PASTURE.GOOSE_CONS_T_PER_DAY);
  }
  const oatsNeed_bu = (L.horses * RATION.HORSE.oats_bu) + (L.oxen * RATION.OX.oats_bu) + (L.geese * RATION.GOOSE.oats_bu) + (L.poultry * RATION.HEN.oats_bu);
  const oatsDraw_bu = Math.min(S.oats, oatsNeed_bu);
  S.oats = Math.max(0, S.oats - oatsDraw_bu);
  const hayNeed_t = (L.horses * RATION.HORSE.hay_t) + (L.oxen * RATION.OX.hay_t) + (L.cows * RATION.COW.hay_t) + (H.sheep === 'clover_hay' ? 0 : L.sheep * RATION.SHEEP.hay_t);
  const hayDraw_t = Math.min(S.hay, Math.max(0, hayNeed_t - pastureT));
  S.hay = Math.max(0, S.hay - hayDraw_t);
  const eggsDoz = Math.max(0, Math.round((L.poultry * 0.5) / 12));
  S.eggs_dozen += eggsDoz;
  const manureUnits = (L.horses * MANURE.HORSE) + (L.oxen * MANURE.OX) + (L.cows * MANURE.COW) + (L.sheep * MANURE.SHEEP) + (L.geese * MANURE.GOOSE) + (L.poultry * MANURE.HEN);
  S.manure_units = (S.manure_units || 0) + manureUnits;
  if (S.oats < 10) world.alerts.push('Oats low');
  if (S.hay < 1) world.alerts.push('Hay low');
}

export function generateWeatherToday(world) {
  const m = world.calendar.month;
  const rng = world.rng;
  const base = WX_BASE[m];
  const temp = base.tMean + 3.0 * randomNormal(rng);
  const wetChance = 0.45 + (base.rainMean - 2.0) * 0.06;
  const rain = (rng() < wetChance) ? Math.max(0, base.rainMean + 5 * randomNormal(rng)) : 0;
  const wind = Math.max(0, 2 + 2 * randomNormal(rng));
  const frost = (m <= 2) && (temp < 2) && (rng() < 0.3);
  world.weather.tempC = temp;
  world.weather.rain_mm = Math.max(0, rain);
  world.weather.wind_ms = wind;
  world.weather.frostTonight = !!frost;
  world.weather.dryStreakDays = (rain <= 0.2) ? (world.weather.dryStreakDays + 1) : 0;
}

export function updateSoilWaterDaily(world) {
  const W = world.weather;
  const rain = W.rain_mm;
  const etp = WX_BASE[world.calendar.month].etp;
  for (const p of world.parcels) {
    let m = p.soil.moisture;
    const hasCanopy = p.rows?.some(r => r.crop && (r.growth || 0) > 0.15);
    const infil = rain * SOIL.INFIL_PER_MM * (hasCanopy ? 0.8 : 1.0);
    m += infil;
    const evap = etp * 0.02 * (hasCanopy ? 1.0 : 0.6);
    m -= evap;
    if (m > SOIL.FIELD_CAP) m -= SOIL.DRAIN_RATE * (m - SOIL.FIELD_CAP);
    m = Math.max(0, Math.min(SOIL.SAT, m));
    p.soil.moisture = m;
    p.status.mud = moistureToMud(m);
  }
}

export function updateHayCuring(world) {
  const w = world.weather;
  for (const p of world.parcels) {
    const h = p.hayCuring;
    if (!h) continue;
    if (w.rain_mm <= 0.2) {
      const base = 0.22;
      const windBonus = Math.min(0.10, 0.02 * Math.max(0, w.wind_ms - 2));
      const tempBonus = Math.max(0, (w.tempC - 12) * 0.01);
      h.dryness = Math.min(1, h.dryness + base + windBonus + tempBonus);
    } else {
      h.dryness = Math.max(0, h.dryness - 0.15);
      h.loss_t += Math.min(h.mass_t * 0.03, 0.1);
    }
  }
}

export function dailyWeatherEvents(world) {
  const w = world.weather;
  const m = world.calendar.month;
  if (w.frostTonight) {
    const g = world.parcels[world.parcelByKey.homestead];
    g.status.frost = (g.status.frost || 0) + 1;
    const o = world.parcels[world.parcelByKey.orchard];
    o.status.frostBites = (o.status.frostBites || 0) + 1;
  }
  if (m >= 3 && m <= 5 && w.wind_ms >= 10) {
    const hit = [];
    for (const key of ['barley_clover', 'oats_close', 'pulses', 'flex', 'wheat']) {
      const p = world.parcels[world.parcelByKey[key]];
      if (!p || !p.rows?.length) continue;
      const matureish = p.rows.some(r => r.crop && r.growth > 0.6);
      if (matureish && (p.status.mud || 0) > 0.2) {
        p.status.lodgingPenalty = Math.max(p.status.lodgingPenalty || 0, 0.08 + 0.04 * Math.random());
        hit.push(p.name);
      }
    }
    if (hit.length) (world.alerts = world.alerts || []).push(`Storm lodging: ${hit.join(', ')}`);
  }
}

export function dailyTurn(world) {
  generateWeatherToday(world);
  updateSoilWaterDaily(world);
  pastureRegrow(world);
  updateHayCuring(world);
  consumeLivestock(world);
  midMonthReprioritise(world);

  for (const p of world.parcels) {
    if (!p.rows.length) continue;
    const s = seasonOfMonth(world.calendar.month);
    let sf = 1.0;
    if (s === 'Winter') sf = 0.15;
    else if (s === 'Autumn') sf = 0.75;
    if (world.weather.label === 'Hot') sf *= 0.85;
    if (world.weather.label === 'Snow') sf *= 0.85;
    if (world.weather.label === 'Rain' || world.weather.label === 'Storm') sf *= 1.05;
    let sumNUse = 0;
    for (const row of p.rows) {
      row.moisture = lerp(row.moisture, p.soil.moisture, 0.5);
      row.weed = clamp01((row.weed || 0) + 0.002);
      const crop = row.crop;
      if (crop) {
        sumNUse += crop.nUse;
        const baseRate = 1 / (crop.baseDays * (world.daylight.dayLenHours * 60));
        row.growth = clamp01(row.growth + baseRate * MINUTES_PER_DAY * sf * rowGrowthMultiplier(p, row, crop));
      }
    }
    const baseRecover = 0.003 * Math.max(0, 1 - p.soil.nitrogen);
    const legumeCredit = p.rows.length > 0 ? 0.010 * Math.max(0, sumNUse) / p.rows.length : 0;
    const uptake = p.rows.length > 0 ? 0.006 * Math.max(0, -sumNUse) / p.rows.length : 0;
    p.soil.nitrogen = clamp01(p.soil.nitrogen + baseRecover + legumeCredit - uptake);
  }

  world.calendar.day++;
  if (world.calendar.day > DAYS_PER_MONTH) {
    world.calendar.day = 1;
    world.calendar.month++;
    if (world.calendar.month > MONTHS_PER_YEAR) {
      endOfYear(world);
      world.calendar.month = 1;
      world.calendar.year++;
    }
    onNewMonth(world);
  }
  const daylightIdx = dayIndex(world.calendar.day, world.calendar.month);
  world.daylight = computeDaylightByIndex(daylightIdx);

  if (world.store.wheat > 0) world.store.wheat = Math.max(0, world.store.wheat - DEMAND.household_wheat_bu_per_day);

  dailyWeatherEvents(world);
  endOfDayMonth(world);
  updateKPIs(world);
  autosave(world);
}

export function endOfYear(world) {
  log(world, `Year ${world.calendar.year} ended. Cleaning fields...`);
  for (const p of world.parcels) {
    if (!p.rows.length) continue;
    for (let rIdx = 0; rIdx < p.rows.length; rIdx++) {
      const row = p.rows[rIdx];
      if (row.crop && row.growth >= 0.85) {
        const c = row.crop;
        const nNorm = clamp(p.soil.nitrogen / N_MAX, 0, 1);
        const nFactor = lerp(0.4, 1.1, nNorm);
        const moistFactor = clamp(lerp(0.6, 1.1, row.moisture), 0.5, 1.1);
        const yieldUnits = Math.round((c.baseYield * p.acres / p.rows.length) * moistFactor * nFactor * 0.5);
        if (c.type === 'grain') world.store[c.name.split('/')[0].toLowerCase()] += yieldUnits;
        else if (c.type === 'root') world.store.turnips += yieldUnits;
        else if (c.type === 'legume') world.store.hay += Math.round(yieldUnits * 0.8);
        log(world, `Salvaged ${p.name}, Row ${rIdx + 1}: +${yieldUnits} ${c.type}.`);
      }
      row.crop = null;
      row.companion = null;
      row.growth = 0;
      row.plantedOn = null;
      row.harvested = false;
      row.moisture = p.soil.moisture;
    }
    if (p.kind === PARCEL_KIND.ARABLE && p.rotationIndex != null) p.rotationIndex = (p.rotationIndex + 1) % ROTATION.length;
    p.soil.moisture = clamp01(p.soil.moisture + 0.1);
  }
  log(world, `Rotation advanced for new year.`);
}

export function simulateMonths(seed = 12345, months = 8) {
  let w = makeWorld(seed);
  onNewMonth(w);
  planDay(w);
  const results = [];
  for (let i = 0; i < months; i++) {
    for (let d = 0; d < DAYS_PER_MONTH; d++) {
      dailyTurn(w);
      planDay(w);
    }
    results.push({
      month: w.calendar.month,
      wheat: w.store.wheat | 0,
      barley: w.store.barley | 0,
      oats: w.store.oats | 0,
      hay: +w.store.hay.toFixed(2),
      cash: +w.cash.toFixed(2),
    });
  }
  console.table(results);
  return { world: w, results };
}
