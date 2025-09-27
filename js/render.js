import { clamp, lerp, hash01, isToday, CAMERA_LERP } from './utils.js';
import { SCREEN_W, SCREEN_H, HOUSE, WELL } from './world.js';
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

export function renderColored(world) {
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
  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) {
      const tileJitter = (hash01(x + camX, y + camY, world.seed) - 0.5) * 0.1;
      const v = clamp(avgMoisture + bias + tileJitter, 0, 1);
      const sid = v < 0.30 ? SID.GRASS_DRY : v < 0.55 ? SID.GRASS_NORMAL : v < 0.80 ? SID.GRASS_LUSH : SID.GRASS_VERY_LUSH;
      putStyled(buf, styleBuf, x, y, GRASS_GLYPHS[sid] || '.', sid);
    }
  }
  for (const p of world.parcels) {
    if (!p.rows.length) continue;
    let sSid = p.soil.moisture > 0.6 ? SID.SOIL_MOIST : SID.SOIL_UNTILLED;
    if (isToday(p.status.lastPlantedOn, world)) sSid = SID.SOIL_TILLED;
    for (let y = p.y + 1; y < p.y + p.h - 1; y++) {
      for (let x = p.x + 1; x < p.x + p.w - 1; x++) {
        putStyled(buf, styleBuf, x - camX, y - camY, '.', sSid);
      }
    }
  }
  const houseSX = HOUSE.x - camX;
  const houseSY = HOUSE.y - camY;
  if (houseSX + HOUSE.w >= 0 && houseSX <= SCREEN_W && houseSY + HOUSE.h >= 0 && houseSY <= SCREEN_H) {
    for (let y = houseSY + 1; y < houseSY + HOUSE.h - 1; y++) {
      for (let x = houseSX + 1; x < houseSX + HOUSE.w - 1; x++) {
        putStyled(buf, styleBuf, x, y, '=', SID.WOOD_FLOOR);
      }
    }
    for (let i = 1; i < HOUSE.w - 1; i++) {
      putStyled(buf, styleBuf, houseSX + i, houseSY, '-', SID.BORDER);
      putStyled(buf, styleBuf, houseSX + i, houseSY + HOUSE.h - 1, '-', SID.BORDER);
    }
    for (let i = 1; i < HOUSE.h - 1; i++) {
      putStyled(buf, styleBuf, houseSX, houseSY + i, '|', SID.BORDER);
      putStyled(buf, styleBuf, houseSX + HOUSE.w - 1, houseSY + i, '|', SID.BORDER);
    }
    putStyled(buf, styleBuf, houseSX, houseSY, '+', SID.BORDER);
    putStyled(buf, styleBuf, houseSX + HOUSE.w - 1, houseSY, '+', SID.BORDER);
    putStyled(buf, styleBuf, houseSX, houseSY + HOUSE.h - 1, '+', SID.BORDER);
    putStyled(buf, styleBuf, houseSX + HOUSE.w - 1, houseSY + HOUSE.h - 1, '+', SID.BORDER);
    const midx = houseSX + Math.floor(HOUSE.w / 2);
    for (let i = 1; i < HOUSE.h - 1; i++) putStyled(buf, styleBuf, houseSX + 6, houseSY + i, '|', SID.HOUSE_WALL);
    putStyled(buf, styleBuf, midx, houseSY + HOUSE.h - 1, ' ', SID.DOOR);
    putStyled(buf, styleBuf, midx - 1, houseSY + HOUSE.h - 1, ' ', SID.DOOR);
    putStyled(buf, styleBuf, midx - 2, houseSY + HOUSE.h - 1, '-', SID.DOOR);
    putStyled(buf, styleBuf, midx + 1, houseSY + HOUSE.h - 1, '-', SID.DOOR);
    label(buf, styleBuf, houseSX + 1, houseSY + 1, 'Bed', SID.HOUSE_WALL);
    label(buf, styleBuf, houseSX + 8, houseSY + 1, 'Living', SID.HOUSE_WALL);
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
            putStyled(buf, styleBuf, xx - camX, yy - camY, finalGlyph, finalSid);
          }
        }
      }
    }
  }
  putStyled(buf, styleBuf, world.farmer.x - camX, world.farmer.y - camY, '@', SID.FARMER);
  return { buf, styleBuf };
}
