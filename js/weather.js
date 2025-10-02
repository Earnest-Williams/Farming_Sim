import { WX_BASE, normalizeMonth } from './constants.js';
import { randomNormal } from './utils.js';

export function generateWeatherToday(world) {
  const m = normalizeMonth(world.calendar.month);
  const rng = world.rng;
  const base = WX_BASE[m] || WX_BASE[1];
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

export function dailyWeatherEvents(world) {
  const w = world.weather;
  const m = normalizeMonth(world.calendar.month);
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
