import { clamp, lerp, hash01, isToday, CAMERA_LERP } from './utils.js';
import { SCREEN_W, SCREEN_H, HOUSE, WELL, BYRE, FARMHOUSE_BED } from './world.js';
import { SID, SID_BY_CROP, CROP_GLYPHS, GRASS_GLYPHS, CONFIG, seasonOfMonth } from './constants.js';
import { rowBand } from './world.js';

export function blankBuffer(w, h) {
  const buf = new Array(h);
  const styleBuf = new Array(h);
  for (let y = 0; y < h; y++) {
    buf[y] = new Array(w);
    styleBuf[y] = new Array(w);
  }
  return { buf, styleBuf };
}

export function putStyled(buf, styleBuf, x, y, ch, sid) {
  if (x >= 0 && x < SCREEN_W && y >= 0 && y < SCREEN_H) {
    buf[y][x] = ch;
    styleBuf[y][x] = sid;
  }
}

export function label(buf, styleBuf, x, y, text, sid) {
  x = Math.max(0, x);
  const avail = SCREEN_W - x;
  if (text.length > avail) text = avail > 1 ? text.slice(0, avail - 1) + '…' : text.slice(0, avail);
  for (let i = 0; i < text.length; i++) putStyled(buf, styleBuf, x + i, y, text[i], sid);
}

function cropStageIndex(g) {
  if (g <= 0.05) return 0;
  if (g < 0.20) return 1;
  if (g < 0.40) return 2;
  if (g < 0.70) return 3;
  if (g < 1.00) return 4;
  return 5;
}

export function flushLine(chars, styles) {
  let html = '';
  let i = 0;
  while (i < chars.length) {
    const sid = styles[i] ?? SID.HUD_TEXT;
    let j = i + 1;
    while (j < chars.length && styles[j] === sid) j++;
    const chunk = chars.slice(i, j).join('');
    const text = chunk.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isRipe = (sid >= SID.T_S5 && sid <= SID.F_S5) || sid === SID.T_BULB;
    const ripeClass = isRipe ? ' ripe-pulse' : '';
    html += `<span class="s${sid}${ripeClass}">${text}</span>`;
    i = j;
  }
  return html;
}

function weatherIcon(label) {
  switch (label) {
    case 'Rain':
      return '☔';
    case 'Storm':
      return '⛈';
    case 'Snow':
      return '❄';
    case 'Frost':
      return '🧊';
    case 'Hot':
      return '🔥';
    case 'Drought':
      return '🌵';
    case 'Overcast':
      return '☁';
    case 'Chill':
      return '💨';
    default:
      return '☀';
  }
}

function weatherSid(label) {
  switch (label) {
    case 'Rain':
      return SID.W_RAIN;
    case 'Storm':
      return SID.W_STORM;
    case 'Hot':
    case 'Drought':
      return SID.W_HOT;
    case 'Snow':
    case 'Frost':
      return SID.W_SNOW;
    default:
      return SID.HUD_TEXT;
  }
}

const NEIGHBOR_PLOT_STYLES = Object.freeze({
  arable: Object.freeze({ sid: SID.SOIL_FERTILE, glyph: ';' }),
  pasture: Object.freeze({ sid: SID.GRASS_LUSH, glyph: ',' }),
  coppice: Object.freeze({ sid: SID.COPPICE_TREE, glyph: 'Y' }),
  garden: Object.freeze({ sid: SID.SOIL_TILLED, glyph: ':' }),
  orchard: Object.freeze({ sid: SID.COPPICE_TREE, glyph: 'Y' }),
  meadow: Object.freeze({ sid: SID.GRASS_NORMAL, glyph: ',' }),
});

function drawWeatherSummary(buf, styleBuf, world) {
  const weather = world.weather;
  if (!weather) return;
  const icon = weatherIcon(weather.label);
  const sid = weatherSid(weather.label);
  const temp = Number.isFinite(weather.tempC) ? `${Math.round(weather.tempC)}°C` : '';
  const rain = Number.isFinite(weather.rain_mm) && weather.rain_mm > 0.05 ? `${weather.rain_mm.toFixed(1)}mm` : '';
  const humidity = Number.isFinite(weather.humidity) ? `${Math.round(weather.humidity * 100)}%` : '';
  const parts = [icon, weather.label];
  if (temp) parts.push(temp);
  if (rain) parts.push(rain);
  if (humidity) parts.push(humidity);
  const text = parts.join(' ');
  const x = Math.max(0, SCREEN_W - Math.min(SCREEN_W, text.length + 2));
  label(buf, styleBuf, x, 1, text, sid);
}

export function renderColored(world, debugState = {}) {
  const targetX = clamp(world.farmer.x - SCREEN_W / 2, 0, CONFIG.WORLD.W - SCREEN_W);
  const targetY = clamp(world.farmer.y - SCREEN_H / 2, 0, CONFIG.WORLD.H - SCREEN_H);
  const shouldFollow = world.snapCamera || world.camera.follow !== false;
  if (shouldFollow) {
    if (world.paused || world.snapCamera) {
      world.camera.x = targetX;
      world.camera.y = targetY;
    } else {
      world.camera.x = lerp(world.camera.x, targetX, CAMERA_LERP);
      world.camera.y = lerp(world.camera.y, targetY, CAMERA_LERP);
    }
  } else {
    world.camera.x = clamp(world.camera.x, 0, CONFIG.WORLD.W - SCREEN_W);
    world.camera.y = clamp(world.camera.y, 0, CONFIG.WORLD.H - SCREEN_H);
  }
  const camX = Math.round(world.camera.x);
  const camY = Math.round(world.camera.y);
  const { buf, styleBuf } = blankBuffer(SCREEN_W, SCREEN_H);
  const avgMoisture = world.parcels.reduce((a, p) => a + p.soil.moisture, 0) / world.parcels.length;
  const s = seasonOfMonth(world.calendar.month);
  const bias = (s === 'Summer' ? +0.08 : s === 'Winter' ? -0.08 : 0);
  const brightness = clamp(world.weather?.lightLevel ?? 0.7, 0.2, 1);
  const drynessTilt = clamp(-0.012 * Math.max(0, (world.weather?.dryStreakDays ?? 0) - 3), -0.16, 0);
  const lightOffset = (brightness - 0.65) * 0.35;
  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) {
      const tileJitter = (hash01(x + camX, y + camY, world.seed) - 0.5) * 0.1;
      const v = clamp(avgMoisture + bias + tileJitter + drynessTilt + lightOffset, 0, 1);
      const sid = v < 0.30 ? SID.GRASS_DRY : v < 0.55 ? SID.GRASS_NORMAL : v < 0.80 ? SID.GRASS_LUSH : SID.GRASS_VERY_LUSH;
      putStyled(buf, styleBuf, x, y, GRASS_GLYPHS[sid] || '.', sid);
    }
  }
  drawRiverAndRoad(buf, styleBuf, camX, camY, world);
  drawNeighborFarms(buf, styleBuf, camX, camY, world);
  for (const p of world.parcels) {
    if (!p.rows.length) continue;
    const organic = clamp(p.soil?.organic ?? 0.6, 0, 1);
    const drought = clamp(p.status?.droughtStress ?? 0, 0, 1);
    const flood = clamp(p.status?.waterlogging ?? 0, 0, 1);
    let sSid = SID.SOIL_UNTILLED;
    if (isToday(p.status.lastPlantedOn, world)) {
      sSid = SID.SOIL_TILLED;
    } else if (flood > 0.55) {
      sSid = SID.SOIL_MOIST;
    } else if (drought > 0.5 || organic < 0.4) {
      sSid = SID.SOIL_PARCHED;
    } else if (organic > 0.72) {
      sSid = SID.SOIL_FERTILE;
    } else if (p.soil.moisture > 0.6) {
      sSid = SID.SOIL_MOIST;
    }
    for (let y = p.y + 1; y < p.y + p.h - 1; y++) {
      for (let x = p.x + 1; x < p.x + p.w - 1; x++) {
        putStyled(buf, styleBuf, x - camX, y - camY, '.', sSid);
      }
    }
  }
  drawFarmhouseInterior(buf, styleBuf, camX, camY);
  const byreSX = BYRE.x - camX;
  const byreSY = BYRE.y - camY;
  if (byreSX + BYRE.w >= 0 && byreSX <= SCREEN_W && byreSY + BYRE.h >= 0 && byreSY <= SCREEN_H) {
    for (let y = byreSY; y < byreSY + BYRE.h; y++) {
      for (let x = byreSX; x < byreSX + BYRE.w; x++) {
        putStyled(buf, styleBuf, x, y, '#', SID.BYRE_FLOOR);
      }
    }
    label(buf, styleBuf, byreSX + 1, byreSY + Math.floor(BYRE.h / 2), 'BYRE', SID.BYRE_LABEL);
  }

  const wellSX = WELL.x - camX;
  const wellSY = WELL.y - camY;
  if (wellSX + 4 >= 0 && wellSX - 3 <= SCREEN_W) {
    putStyled(buf, styleBuf, wellSX - 1, wellSY, 'O', SID.WELL_WATER);
    label(buf, styleBuf, wellSX - 3, wellSY + 1, 'WELL', SID.WELL_TEXT);
  }
  for (const p of world.parcels) {
    const pLabel = `[${p.name}]`;
    const pSX = p.x - camX;
    const pSY = p.y - camY;
    if (pSX + p.w < 0 || pSX > SCREEN_W || pSY + p.h < 0 || pSY > SCREEN_H) continue;
    const drought = clamp(p.status?.droughtStress ?? 0, 0, 1);
    const flood = clamp(p.status?.waterlogging ?? 0, 0, 1);
    for (let i = 1; i < p.w - 1; i++) {
      putStyled(buf, styleBuf, pSX + i, pSY, '-', SID.BORDER);
      putStyled(buf, styleBuf, pSX + i, pSY + p.h - 1, '-', SID.BORDER);
    }
    for (let i = 1; i < p.h - 1; i++) {
      putStyled(buf, styleBuf, pSX, pSY + i, '|', SID.BORDER);
      putStyled(buf, styleBuf, pSX + p.w - 1, pSY + i, '|', SID.BORDER);
    }
    putStyled(buf, styleBuf, pSX, pSY, '+', SID.BORDER);
    putStyled(buf, styleBuf, pSX + p.w - 1, pSY, '+', SID.BORDER);
    putStyled(buf, styleBuf, pSX, pSY + p.h - 1, '+', SID.BORDER);
    putStyled(buf, styleBuf, pSX + p.w - 1, pSY + p.h - 1, '+', SID.BORDER);
    label(buf, styleBuf, pSX + 2, pSY, pLabel, SID.MIXED_LABEL);
    if (drought > 0.38) {
      label(buf, styleBuf, pSX + 2, pSY + 1, 'dry', SID.W_HOT);
    }
    if (flood > 0.38) {
      label(buf, styleBuf, pSX + 2, pSY + p.h - 2, 'wet', SID.W_RAIN);
    }
    if (p.kind === 'coppice') {
      const startY = Math.max(p.y + 1, camY);
      const endY = Math.min(p.y + p.h - 1, camY + SCREEN_H);
      const startX = Math.max(p.x + 1, camX);
      const endX = Math.min(p.x + p.w - 1, camX + SCREEN_W);
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const treeGlyph = hash01(x, y, world.seed) < 0.2 ? 'T' : 't';
          putStyled(buf, styleBuf, x - camX, y - camY, treeGlyph, SID.COPPICE_TREE);
        }
      }
    }

    if (p.rows.length > 0) {
      for (let r = 0; r < p.rows.length; r++) {
        const row = p.rows[r];
        const stage = cropStageIndex(row.growth);
        if (!row.crop) continue;
        let glyph;
        let sid;
        if (stage === 0 && isToday(row._tilledOn, world)) {
          glyph = '.';
          sid = SID.SOIL_TILLED;
        } else {
          glyph = CROP_GLYPHS[row.crop.key][stage];
          sid = SID_BY_CROP[row.crop.key][stage];
        }
        const { sy, ey } = rowBand(p, r);
        for (let yy = sy; yy <= ey; yy++) {
          for (let xx = p.x + 1; xx < p.x + p.w - 1; xx++) {
            let finalSid = sid;
            let finalGlyph = glyph;
            if (row.crop.key === 'T' && stage === 5) {
              const u = hash01(xx, yy, world.seed);
              if (u < 0.15) {
                finalSid = SID.T_BULB;
                finalGlyph = 'O';
              }
            }
            if (row._irrigatedOn && isToday(row._irrigatedOn, world)) {
              if (hash01(xx, yy, 0x9e3779b1 ^ world.seed ^ world.calendar.day) < 0.07) finalSid = SID.WELL_WATER;
            }
            if (flood > 0.45 && stage < 5) {
              finalGlyph = '~';
              finalSid = SID.WELL_WATER;
            } else if (drought > 0.55 && stage < 5) {
              finalGlyph = '·';
              finalSid = SID.GRASS_DRY;
            }
            if (row.frostScorch && row.frostScorch > 0.25 && stage < 5) {
              finalGlyph = '*';
              finalSid = SID.W_SNOW;
            }
            putStyled(buf, styleBuf, xx - camX, yy - camY, finalGlyph, finalSid);
          }
        }
      }
    }
  }
  drawNeighborFarmers(buf, styleBuf, world, camX, camY);
  drawFarmer(buf, styleBuf, world, camX, camY);
  drawWeatherSummary(buf, styleBuf, world);
  debugHUD(buf, styleBuf, world, debugState);
  return { buf, styleBuf };
}

function drawNeighborBuilding(buf, styleBuf, camX, camY, rect, { fillSid, fillGlyph, labelText } = {}) {
  if (!rect) return;
  const sx = rect.x - camX;
  const sy = rect.y - camY;
  if (sx + rect.w < 0 || sx > SCREEN_W || sy + rect.h < 0 || sy > SCREEN_H) return;
  for (let y = 0; y < rect.h; y++) {
    const screenY = sy + y;
    if (screenY < 0 || screenY >= SCREEN_H) continue;
    for (let x = 0; x < rect.w; x++) {
      const screenX = sx + x;
      if (screenX < 0 || screenX >= SCREEN_W) continue;
      const borderX = x === 0 || x === rect.w - 1;
      const borderY = y === 0 || y === rect.h - 1;
      let ch;
      let sid;
      if (borderX || borderY) {
        if (borderX && borderY) {
          ch = '+';
        } else if (borderY) {
          ch = '=';
        } else {
          ch = '|';
        }
        sid = SID.HOUSE_WALL;
      } else {
        ch = fillGlyph ?? '.';
        sid = fillSid ?? SID.WOOD_FLOOR;
      }
      putStyled(buf, styleBuf, screenX, screenY, ch, sid);
    }
  }
  if (labelText) {
    const labelX = Math.max(0, Math.min(SCREEN_W - 1, sx + 1));
    const labelY = Math.max(0, sy - 1);
    label(buf, styleBuf, labelX, labelY, labelText, SID.HUD_TEXT);
  }
}

function drawNeighborPlots(buf, styleBuf, camX, camY, neighbor) {
  const plots = Array.isArray(neighbor?.plots) ? neighbor.plots : [];
  for (const plot of plots) {
    if (!plot || !Number.isFinite(plot.x) || !Number.isFinite(plot.y)) continue;
    const style = NEIGHBOR_PLOT_STYLES[plot.type] || NEIGHBOR_PLOT_STYLES.arable;
    const sx = plot.x - camX;
    const sy = plot.y - camY;
    const w = Math.max(0, Math.floor(plot.w));
    const h = Math.max(0, Math.floor(plot.h));
    if (sx + w < 0 || sx > SCREEN_W || sy + h < 0 || sy > SCREEN_H) continue;
    if (w >= 3 && h >= 3) {
      for (let yy = 1; yy < h - 1; yy++) {
        const screenY = sy + yy;
        if (screenY < 0 || screenY >= SCREEN_H) continue;
        for (let xx = 1; xx < w - 1; xx++) {
          const screenX = sx + xx;
          if (screenX < 0 || screenX >= SCREEN_W) continue;
          putStyled(buf, styleBuf, screenX, screenY, style.glyph, style.sid);
        }
      }
    }
    for (let i = 0; i < w; i++) {
      const topX = sx + i;
      const bottomX = sx + i;
      if (topX >= 0 && topX < SCREEN_W && sy >= 0 && sy < SCREEN_H) putStyled(buf, styleBuf, topX, sy, '-', SID.BORDER);
      const bottomY = sy + h - 1;
      if (bottomX >= 0 && bottomX < SCREEN_W && bottomY >= 0 && bottomY < SCREEN_H) {
        putStyled(buf, styleBuf, bottomX, bottomY, '-', SID.BORDER);
      }
    }
    for (let i = 0; i < h; i++) {
      const leftY = sy + i;
      const rightY = sy + i;
      if (sx >= 0 && sx < SCREEN_W && leftY >= 0 && leftY < SCREEN_H) putStyled(buf, styleBuf, sx, leftY, '|', SID.BORDER);
      const rightX = sx + w - 1;
      if (rightX >= 0 && rightX < SCREEN_W && rightY >= 0 && rightY < SCREEN_H) {
        putStyled(buf, styleBuf, rightX, rightY, '|', SID.BORDER);
      }
    }
    if (plot.name) {
      const labelX = Math.max(0, Math.min(SCREEN_W - 1, sx + 1));
      const labelY = Math.max(0, sy + Math.floor(h / 2));
      label(buf, styleBuf, labelX, labelY, `[${plot.name}]`, SID.HUD_TEXT);
    }
  }
}

function drawNeighborFarms(buf, styleBuf, camX, camY, world) {
  const neighbors = Array.isArray(world?.neighbors) ? world.neighbors : [];
  for (const neighbor of neighbors) {
    drawNeighborPlots(buf, styleBuf, camX, camY, neighbor);
    drawNeighborBuilding(buf, styleBuf, camX, camY, neighbor?.barn, { fillSid: SID.BYRE_FLOOR, fillGlyph: '#', labelText: 'BYRE' });
    drawNeighborBuilding(buf, styleBuf, camX, camY, neighbor?.farmhouse, {
      fillSid: SID.WOOD_FLOOR,
      fillGlyph: '.',
      labelText: neighbor?.name || null,
    });
    const well = neighbor?.well;
    if (well) {
      const wx = Math.round(well.x) - camX;
      const wy = Math.round(well.y) - camY;
      if (wx >= -2 && wx <= SCREEN_W && wy >= 0 && wy < SCREEN_H) {
        putStyled(buf, styleBuf, wx, wy, 'O', SID.WELL_WATER);
        label(buf, styleBuf, wx - 2, wy + 1, 'WELL', SID.WELL_TEXT);
      }
    }
  }
}

function drawNeighborFarmers(buf, styleBuf, world, camX, camY) {
  const neighbors = Array.isArray(world?.neighbors) ? world.neighbors : [];
  for (const neighbor of neighbors) {
    const farmer = neighbor?.farmer;
    if (!farmer) continue;
    const px = Math.round(farmer.x) - camX;
    const py = Math.round(farmer.y) - camY;
    if (px < 0 || px >= SCREEN_W || py < 0 || py >= SCREEN_H) continue;
    putStyled(buf, styleBuf, px, py, '&', SID.NEIGHBOR_FARMER);
    if (farmer.task) {
      const labelX = Math.min(SCREEN_W - 1, Math.max(0, px + 1));
      const labelY = Math.max(0, py - 1);
      label(buf, styleBuf, labelX, labelY, farmer.task, SID.HUD_TEXT);
    }
  }
}

function drawFarmer(buf, styleBuf, world, camX, camY) {
  const farmer = world.farmer || {};
  const px = farmer.x - camX;
  const py = farmer.y - camY;
  if (px < 0 || px >= SCREEN_W || py < 0 || py >= SCREEN_H) return;
  putStyled(buf, styleBuf, px, py, '@', SID.FARMER);
  if (farmer.task) {
    const labelX = Math.min(SCREEN_W - 1, Math.max(0, px + 1));
    const labelY = Math.max(0, py - 1);
    label(buf, styleBuf, labelX, labelY, farmer.task, SID.HUD_TEXT);
  }
}

function drawFarmhouseInterior(buf, styleBuf, camX, camY) {
  const houseSX = HOUSE.x - camX;
  const houseSY = HOUSE.y - camY;
  if (houseSX + HOUSE.w < 0 || houseSX > SCREEN_W || houseSY + HOUSE.h < 0 || houseSY > SCREEN_H) return;

  const doorWidth = 2;
  const doorStart = Math.floor((HOUSE.w - doorWidth) / 2);
  const bedroomWallX = 7;
  const bedroomDoorTop = HOUSE.h - 5;
  const bedroomDoorHeight = 2;
  const pantryWallY = 3;
  const pantryDoorWidth = 2;
  const pantryDoorStart = HOUSE.w - 7;
  const bedLocal = {
    x: Math.max(1, Math.min(HOUSE.w - 2, FARMHOUSE_BED.x - HOUSE.x)),
    y: Math.max(1, Math.min(HOUSE.h - 2, FARMHOUSE_BED.y - HOUSE.y)),
  };

  for (let y = 0; y < HOUSE.h; y++) {
    const screenY = houseSY + y;
    if (screenY < 0 || screenY >= SCREEN_H) continue;
    for (let x = 0; x < HOUSE.w; x++) {
      const screenX = houseSX + x;
      if (screenX < 0 || screenX >= SCREEN_W) continue;

      let ch = '.';
      let sid = SID.WOOD_FLOOR;

      const borderX = x === 0 || x === HOUSE.w - 1;
      const borderY = y === 0 || y === HOUSE.h - 1;

      if (borderX || borderY) {
        const isDoor = y === HOUSE.h - 1 && x >= doorStart && x < doorStart + doorWidth;
        if (isDoor) {
          ch = ' ';
          sid = SID.DOOR;
        } else if (borderX && borderY) {
          ch = '+';
          sid = SID.HOUSE_WALL;
        } else if (borderY) {
          ch = '=';
          sid = SID.HOUSE_WALL;
        } else {
          ch = '|';
          sid = SID.HOUSE_WALL;
        }
      } else {
        if (x === bedroomWallX) {
          const inDoor = y >= bedroomDoorTop && y < bedroomDoorTop + bedroomDoorHeight;
          if (inDoor) {
            ch = ' ';
            sid = SID.DOOR;
          } else {
            ch = '|';
            sid = SID.HOUSE_WALL;
          }
        }

        if (y === pantryWallY && x >= bedroomWallX + 1) {
          const inDoor = x >= pantryDoorStart && x < pantryDoorStart + pantryDoorWidth;
          if (inDoor) {
            ch = ' ';
            sid = SID.DOOR;
          } else {
            ch = '-';
            sid = SID.HOUSE_WALL;
          }
        }

        if (sid === SID.WOOD_FLOOR) {
          const inBedHead = x >= bedLocal.x - 1 && x <= bedLocal.x + 1 && y >= bedLocal.y - 1 && y <= bedLocal.y;
          const inBedFoot = x >= bedLocal.x - 1 && x <= bedLocal.x + 1 && y === bedLocal.y + 1;
          if (inBedHead || inBedFoot) {
            ch = inBedHead ? 'B' : 'b';
            sid = SID.BED;
          } else if (x >= 2 && x <= 3 && y >= HOUSE.h - 4 && y <= HOUSE.h - 3) {
            ch = 'C';
            sid = SID.STORAGE;
          } else if (x >= bedroomWallX - 2 && x <= bedroomWallX - 1 && y >= HOUSE.h - 4 && y <= HOUSE.h - 3) {
            ch = 'C';
            sid = SID.STORAGE;
          } else if (x >= bedroomWallX + 2 && x <= bedroomWallX + 5 && y >= pantryWallY + 3 && y <= pantryWallY + 4) {
            ch = 'T';
            sid = SID.TABLE;
          } else if (x >= HOUSE.w - 4 && x <= HOUSE.w - 2 && y >= 1 && y <= 2) {
            ch = 'H';
            sid = SID.HEARTH;
          } else if (x >= HOUSE.w - 6 && x <= HOUSE.w - 3 && y === pantryWallY - 1) {
            ch = 'S';
            sid = SID.STORAGE;
          } else if (x >= bedroomWallX + 1 && x <= bedroomWallX + 2 && y >= HOUSE.h - 3 && y <= HOUSE.h - 2) {
            ch = 'T';
            sid = SID.TABLE;
          }
        }
      }

      putStyled(buf, styleBuf, screenX, screenY, ch, sid);
    }
  }
}

function drawRiverAndRoad(buf, styleBuf, camX, camY, world) {
  const baseX = 90;
  const riverHalfWidth = 5;
  const roadOffset = 7;
  const roadHalfWidth = 2;
  const timestamp =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : typeof Date !== 'undefined' && typeof Date.now === 'function'
        ? Date.now()
        : 0;
  const rippleTime = timestamp * 0.001;
  for (let sy = 0; sy < SCREEN_H; sy++) {
    const worldY = sy + camY;
    if (worldY < 0 || worldY >= CONFIG.WORLD.H) continue;
    const t = worldY / CONFIG.WORLD.H;
    const meander = Math.sin(t * Math.PI * 2 + world.seed * 0.01) * 18;
    const gentle = Math.sin(t * Math.PI * 0.75 + world.seed * 0.02) * 6;
    const centerX = Math.round(baseX + meander + gentle);

    for (let dx = -riverHalfWidth; dx <= riverHalfWidth; dx++) {
      const worldX = centerX + dx;
      const sx = worldX - camX;
      if (sx < 0 || sx >= SCREEN_W) continue;
      const ripple = Math.sin(rippleTime * 0.9 + worldY * 0.18 + dx * 0.45 + world.seed * 0.001);
      const ch = ripple > 0.25 ? '≈' : ripple < -0.35 ? '∽' : '~';
      putStyled(buf, styleBuf, sx, sy, ch, SID.RIVER);
    }

    const roadCenter = centerX + roadOffset;
    for (let dx = -roadHalfWidth; dx <= roadHalfWidth; dx++) {
      const worldX = roadCenter + dx;
      const sx = worldX - camX;
      if (sx < 0 || sx >= SCREEN_W) continue;
      putStyled(buf, styleBuf, sx, sy, '=', SID.ROAD);
    }
  }
}

function debugHUD(buf, styleBuf, world, { speed = 0, accMin = 0, moveAcc = 0 } = {}) {
  const minute = world?.calendar?.minute ?? 0;
  const daylight = world?.daylight || { workStart: 0, workEnd: 0 };
  const farmer = world?.farmer;
  const activeWork = Array.isArray(farmer?.activeWork) ? farmer.activeWork : [];
  const slots = activeWork.map((id) => id ?? '-').join(',');
  const atX = farmer?.x ?? 0;
  const atY = farmer?.y ?? 0;
  const task = farmer?.task ?? '';
  const line = `m=${minute} ws=${daylight.workStart} we=${daylight.workEnd} slots=[${slots}] at=(${atX},${atY}) ` +
    `speed=${speed.toFixed(2)} acc=${accMin.toFixed(2)} moveAcc=${moveAcc.toFixed(2)} task=${task}`;
  label(buf, styleBuf, 1, 0, line, SID.HUD_TEXT);
}
