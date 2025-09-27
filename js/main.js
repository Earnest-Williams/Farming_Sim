import { makeWorld, createPathfindingGrid } from './world.js';
import { processFarmerMinute, dailyTurn, planDay, generateWeatherToday, updateSoilWaterDaily, pastureRegrow, updateHayCuring, consumeLivestock, dailyWeatherEvents, endOfYear, onNewMonth, simulateMonths } from './simulation.js';
import { tickWorkMinute } from './tasks.js';
import { getSeedFromURL, clamp, log } from './utils.js';
import { MINUTES_PER_DAY, LABOUR_DAY_MIN, CONFIG } from './constants.js';
import { renderColored, flushLine } from './render.js';
import { advisorHud } from './advisor.js';
import { saveToLocalStorage, loadFromLocalStorage, downloadSave, autosave } from './persistence.js';

let world;
const TIMECTRL = { mode: 'normal', minutesPerFrame: 10, ff: { daysRemaining: 0, stopOnAlerts: true, report: [] } };
const DEBUG = { showParcels: false, showRows: false, showSoilBars: true, showTaskQueue: false, showWorkability: true, showKPI: false };

let charSize = { width: 8, height: 17 };
let screenRef;
let overlayRef;

function stepOneMinute(w) {
  tickWorkMinute(w);
  processFarmerMinute(w);
  w.calendar.minute++;
  if (w.calendar.minute >= MINUTES_PER_DAY) {
    w.calendar.minute = 0;
    dailyTurn(w);
  }
}

function onFrame() {
  if (!world) return;
  if (TIMECTRL.mode === 'normal') {
    if (!world.paused) stepOneMinute(world);
  } else if (TIMECTRL.mode === 'scaled') {
    if (!world.paused) {
      for (let i = 0; i < TIMECTRL.minutesPerFrame; i++) stepOneMinute(world);
    }
  } else if (TIMECTRL.mode === 'ff') {
    runFastForwardFrame(world);
  }
  draw();
  requestAnimationFrame(onFrame);
}

function setTimeMode(mode, minutesPerFrame = 10) {
  TIMECTRL.mode = mode;
  TIMECTRL.minutesPerFrame = minutesPerFrame;
}

function runFastForward(days, stopOnAlerts = true) {
  TIMECTRL.mode = 'ff';
  TIMECTRL.ff.daysRemaining = days;
  TIMECTRL.ff.stopOnAlerts = stopOnAlerts;
  TIMECTRL.ff.report = [];
}

function runOneDay(w) {
  generateWeatherToday(w);
  updateSoilWaterDaily(w);
  pastureRegrow(w);
  updateHayCuring(w);
  consumeLivestock(w);
  planDay(w);
  for (let m = 0; m < LABOUR_DAY_MIN; m++) tickWorkMinute(w);
  dailyWeatherEvents(w);
  autosave(w);
  w.calendar.day += 1;
  if (w.calendar.day > 20) {
    w.calendar.day = 1;
    w.calendar.month += 1;
    if (w.calendar.month > 8) {
      w.calendar.month = 1;
      w.calendar.year = (w.calendar.year || 1) + 1;
      endOfYear(w);
    }
    planDay(w);
  }
}

function runFastForwardFrame(w) {
  if (TIMECTRL.ff.daysRemaining <= 0) {
    TIMECTRL.mode = 'normal';
    return;
  }
  const hasAlerts = Array.isArray(w?.alerts) && w.alerts.length > 0;
  const hasWarnings = !!(w?.kpi && Array.isArray(w.kpi.warnings) && w.kpi.warnings.length > 0);
  if (TIMECTRL.ff.stopOnAlerts && (hasAlerts || hasWarnings)) {
    TIMECTRL.mode = 'normal';
    return;
  }
  dailyTurn(w);
  for (let m = 0; m < MINUTES_PER_DAY; m++) tickWorkMinute(w);
  TIMECTRL.ff.report.push({ y: w.calendar.year, m: w.calendar.month, d: w.calendar.day, oats: w.store.oats, hay: w.store.hay, wheat: w.store.wheat, cash: w.cash });
  TIMECTRL.ff.daysRemaining -= 1;
}

function drawDebugOverlay(w, canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '12px ui-monospace';
  const lineH = 14;
  const padding = 12;
  const camX = Math.round(w.camera.x);
  const camY = Math.round(w.camera.y);

  if (DEBUG.showParcels) {
    for (const p of w.parcels) {
      const pSX = (p.x - camX) * charSize.width + padding;
      const pSY = (p.y - camY) * charSize.height + padding;
      const pSW = p.w * charSize.width;
      const pSH = p.h * charSize.height;
      if (pSX + pSW < 0 || pSX > canvas.width || pSY + pSH < 0 || pSY > canvas.height) continue;
      const mud = p.status.mud || 0;
      ctx.strokeStyle = `rgba(200,${Math.floor(200 * (1 - mud))},0,0.8)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(pSX, pSY, pSW, pSH);
      if (DEBUG.showSoilBars) {
        const mx = Math.min(1, p.soil.moisture);
        const nx = Math.min(1, p.soil.nitrogen);
        ctx.fillStyle = '#58a';
        ctx.fillRect(pSX + 2, pSY + 2, Math.floor(pSW * 0.3 * mx), 3);
        ctx.fillStyle = '#8a5';
        ctx.fillRect(pSX + 2, pSY + 7, Math.floor(pSW * 0.3 * nx), 3);
      }
      if (DEBUG.showWorkability && mud >= 0.35) {
        ctx.fillStyle = 'rgba(200,0,0,0.7)';
        ctx.fillText('MUD', pSX + 2, pSY + 20);
      }
    }
  }

  if (DEBUG.showTaskQueue) {
    const q = w.tasks.month.queued.slice(0, 8).map(t => `${t.kind}(${t.latestDay}) p:${t.priority}`);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 8, 360, 14 + lineH * q.length);
    ctx.fillStyle = '#ddd';
    ctx.fillText('Queue:', 14, 20);
    q.forEach((l, i) => ctx.fillText(l, 14, 34 + lineH * i));
  }

  if (DEBUG.showKPI) {
    const line = advisorHud(w);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 120, 880, 20);
    ctx.fillStyle = '#ddd';
    ctx.fillText(line, 14, 135);
  }
}

function draw() {
  const { buf, styleBuf } = renderColored(world);
  const lines = [];
  for (let y = 0; y < buf.length; y++) lines.push(flushLine(buf[y], styleBuf[y]));
  screenRef.innerHTML = lines.join('\n');
  drawDebugOverlay(world, overlayRef);
}

function measureCharSize() {
  const temp = document.createElement('span');
  temp.textContent = 'M';
  temp.style.font = getComputedStyle(screenRef).font;
  temp.style.position = 'absolute';
  temp.style.visibility = 'hidden';
  document.body.appendChild(temp);
  charSize = { width: temp.offsetWidth, height: temp.offsetHeight };
  document.body.removeChild(temp);
}

function attachDebugToggles() {
  window.debugToggle = (k) => {
    DEBUG[k] = !DEBUG[k];
    draw();
  };
}

function attachSaveHelpers() {
  window._save = () => downloadSave(world);
}

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      world.paused = !world.paused;
      draw();
    } else if (e.key === ',') {
      e.preventDefault();
      world.snapCamera = true;
      stepOneMinute(world);
      draw();
      world.snapCamera = false;
    } else if (e.key === '.') {
      e.preventDefault();
      for (let i = 0; i < 10; i++) stepOneMinute(world);
      draw();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      const currentMinute = world.calendar.minute;
      for (let i = 0; i < MINUTES_PER_DAY - currentMinute; i++) stepOneMinute(world);
      draw();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      if (e.shiftKey) {
        const newSeed = (Math.random() * 2 ** 31) | 0;
        log(world, `New random seed: ${newSeed}`);
        const url = new URL(location.href);
        url.searchParams.set('seed', newSeed);
        location.href = url.toString();
      } else {
        world = makeWorld(getSeedFromURL());
        world.timeCtrl = TIMECTRL;
        log(world, `Seed: ${world.seed}`);
        onNewMonth(world);
        planDay(world);
        draw();
      }
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      world.showPanel = !world.showPanel;
      draw();
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      world.camera.x = clamp(world.farmer.x - CONFIG.SCREEN.W / 2, 0, CONFIG.WORLD.W - CONFIG.SCREEN.W);
      world.camera.y = clamp(world.farmer.y - CONFIG.SCREEN.H / 2, 0, CONFIG.WORLD.H - CONFIG.SCREEN.H);
      draw();
    } else if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      if (e.shiftKey) {
        if (world.store.barley >= CONFIG.LIVESTOCK_BUY_COST) {
          world.livestock.cows++;
          world.store.barley -= CONFIG.LIVESTOCK_BUY_COST;
          log(world, `Bought 1 cow for ${CONFIG.LIVESTOCK_BUY_COST} barley. Total cows: ${world.livestock.cows}`);
        } else {
          log(world, `Not enough barley to buy a cow (need ${CONFIG.LIVESTOCK_BUY_COST}, have ${world.store.barley}).`);
        }
      } else if (e.altKey) {
        if (world.livestock.cows > 0) {
          world.livestock.cows--;
          world.store.barley += CONFIG.LIVESTOCK_SELL_VALUE;
          log(world, `Sold 1 cow for ${CONFIG.LIVESTOCK_SELL_VALUE} barley. Total cows: ${world.livestock.cows}`);
        } else {
          log(world, 'No cows to sell.');
        }
      }
      draw();
    } else if (e.key === 'h' || e.key === 'H') {
      if (e.shiftKey) {
        document.body.classList.toggle('hc');
        localStorage.setItem('farm_hc', document.body.classList.contains('hc') ? '1' : '0');
      } else {
        e.preventDefault();
        world.paused = true;
        log(world, 'Help: ,(1m) .(10m) N(1d) Space(pause) +/- speed C(center) R(reset) Shift+R(new) Shift+H(contrast) Shift+L(buy) Alt+L(sell)');
        draw();
      }
    } else if (e.key === '1') setTimeMode('normal');
    else if (e.key === '2') setTimeMode('scaled', 10);
    else if (e.key === '3') setTimeMode('scaled', 60);
    else if (e.key === '4') runFastForward(5, true);
    else if (e.key === 'F5') {
      e.preventDefault();
      saveToLocalStorage(world);
    } else if (e.key === 'F9') {
      e.preventDefault();
      const loaded = loadFromLocalStorage();
      if (loaded) {
        world = loaded;
        world.pathGrid = createPathfindingGrid();
        world.timeCtrl = TIMECTRL;
      }
      planDay(world);
      draw();
    } else if (e.key === 'F1') { e.preventDefault(); DEBUG.showParcels = !DEBUG.showParcels; draw(); }
    else if (e.key === 'F2') { e.preventDefault(); DEBUG.showTaskQueue = !DEBUG.showTaskQueue; draw(); }
    else if (e.key === 'F3') { e.preventDefault(); DEBUG.showKPI = !DEBUG.showKPI; draw(); }
  });
}

function init() {
  const loaded = loadFromLocalStorage();
  world = loaded || makeWorld(getSeedFromURL());
  world.timeCtrl = TIMECTRL;
  log(world, `Seed: ${world.seed}`);
  if (!loaded) onNewMonth(world);
  screenRef = document.getElementById('screen');
  overlayRef = document.getElementById('debug-overlay');
  const resizeObserver = new ResizeObserver(() => {
    overlayRef.width = screenRef.clientWidth;
    overlayRef.height = screenRef.clientHeight;
    overlayRef.style.width = `${screenRef.clientWidth}px`;
    overlayRef.style.height = `${screenRef.clientHeight}px`;
    measureCharSize();
    draw();
  });
  resizeObserver.observe(screenRef);
  screenRef.addEventListener('scroll', () => {
    overlayRef.style.transform = `translate(${-screenRef.scrollLeft}px, ${-screenRef.scrollTop}px)`;
  });
  if (new URLSearchParams(location.search).has('hc')) document.body.classList.add('hc');
  if (localStorage.getItem('farm_hc') === '1') document.body.classList.add('hc');
  planDay(world);
  attachDebugToggles();
  attachSaveHelpers();
  bindKeyboard();
  window.simulateMonths = simulateMonths;
  overlayRef.width = screenRef.clientWidth;
  overlayRef.height = screenRef.clientHeight;
  overlayRef.style.width = `${screenRef.clientWidth}px`;
  overlayRef.style.height = `${screenRef.clientHeight}px`;
  measureCharSize();
  draw();
  requestAnimationFrame(onFrame);
}

document.addEventListener('DOMContentLoaded', init);
