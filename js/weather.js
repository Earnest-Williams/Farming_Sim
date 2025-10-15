import { WX_BASE, normalizeMonth } from './constants.js';
import { clamp, clamp01, randomNormal } from './utils.js';

function classifyWeather({ temp, rain, frostTonight, dryStreakDays, month, cloudCover }) {
  let label = 'Fair';
  let skyHue = 210;
  let sunGlow = 0.35;
  let lightShift = 0;

  if (rain >= 14) {
    label = 'Storm';
    skyHue = 208;
    sunGlow = 0.08;
    lightShift = -0.25;
  } else if (rain >= 5) {
    label = 'Rain';
    skyHue = 205;
    sunGlow = 0.16;
    lightShift = -0.12;
  } else if (dryStreakDays >= 6) {
    label = 'Drought';
    skyHue = 42;
    sunGlow = 0.58;
    lightShift = 0.12;
  } else if (temp >= 26) {
    label = 'Hot';
    skyHue = 48;
    sunGlow = 0.62;
    lightShift = 0.16;
  } else if ((temp <= -1 && rain > 0.25) || (frostTonight && month >= 7)) {
    label = 'Snow';
    skyHue = 200;
    sunGlow = 0.18;
    lightShift = -0.18;
  } else if (frostTonight) {
    label = 'Frost';
    skyHue = 195;
    sunGlow = 0.2;
    lightShift = -0.08;
  } else if (cloudCover > 0.68) {
    label = 'Overcast';
    skyHue = 210;
    sunGlow = 0.18;
    lightShift = -0.15;
  } else if (month >= 7 && temp <= 6) {
    label = 'Chill';
    skyHue = 205;
    sunGlow = 0.22;
    lightShift = -0.06;
  }

  return { label, skyHue, sunGlow, lightShift };
}

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
  const dryStreak = (rain <= 0.2) ? (world.weather.dryStreakDays + 1) : 0;
  world.weather.dryStreakDays = dryStreak;

  const humidity = clamp01(0.35 + rain * 0.02 + Math.max(0, 14 - Math.abs(temp - base.tMean)) * 0.01);
  const cloudCover = clamp01(0.18 + rain * 0.03 + humidity * 0.32 - Math.max(0, wind - 6) * 0.015);
  const { label, skyHue, sunGlow, lightShift } = classifyWeather({
    temp,
    rain,
    frostTonight: frost,
    dryStreakDays: dryStreak,
    month: m,
    cloudCover,
  });
  const baseLight = clamp01(0.35 + (1 - cloudCover) * 0.55 + lightShift);

  world.weather.label = label;
  world.weather.humidity = humidity;
  world.weather.cloudCover = cloudCover;
  world.weather.lightLevel = baseLight;
  world.weather.sunGlow = clamp01(sunGlow + (1 - cloudCover) * 0.25);
  world.weather.skyHue = clamp(skyHue, 15, 220);
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
