import { makeWorld, createPathfindingGrid } from './world.js';
import { stepOneMinute, planDay, onNewMonth, simulateMonths, processFarmerHalfStep } from './simulation.js';
import { monthHudInfo } from './tasks.js';
import { getSeedFromURL, clamp, log } from './utils.js';
import { MINUTES_PER_DAY, CONFIG, MONTH_NAMES, DAYS_PER_MONTH } from './constants.js';
import { renderColored, flushLine } from './render.js';
import { advisorHud } from './advisor.js';
import { saveToLocalStorage, loadFromLocalStorage, downloadSave } from './persistence.js';
import { minutesToAdvance, getSpeed, setSpeed } from './timeflow.js';
import { initSpeedControls, syncSpeedControls } from './ui/speed.js';

let world;
let lastFrameTime = null;
let workAccumulator = 0;
let moveAccumulator = 0;
const DEBUG = { showParcels: false, showRows: false, showSoilBars: true, showTaskQueue: false, showWorkability: true, showKPI: false };

let charSize = { width: 8, height: 17 };
let screenRef;
let overlayRef;
let messageRef;
let drawerRef;
let menuToggleRef;
let followButtonRef;
let panelContentRef;
let panelButtons = [];
let drawerOpen = false;
let activePanel = 'overview';
let lastPanelHtml = '';
let lastMessagesKey = null;

const CAMERA_STEP = 6;

const PANEL_RENDERERS = {
  overview: renderOverviewPanel,
  inventory: renderInventoryPanel,
  parcels: renderParcelsPanel,
  messages: renderMessagesPanel,
  controls: renderControlsPanel,
};

function resizeOverlayCanvas() {
  if (!overlayRef || !screenRef) return;
  const dpr = window.devicePixelRatio || 1;
  overlayRef.width = Math.round(screenRef.clientWidth * dpr);
  overlayRef.height = Math.round(screenRef.clientHeight * dpr);
  overlayRef.style.width = `${screenRef.clientWidth}px`;
  overlayRef.style.height = `${screenRef.clientHeight}px`;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(minutes) {
  const total = Math.max(0, Math.floor(minutes));
  const hours = String(Math.floor(total / 60)).padStart(2, '0');
  const mins = String(total % 60).padStart(2, '0');
  return `${hours}:${mins}`;
}

function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const rounded = Math.round(minutes);
  const hours = (rounded / 60).toFixed(1);
  return `${rounded} min (${hours} h)`;
}

function titleCase(str) {
  if (!str) return '';
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function renderTableRows(entries) {
  return entries
    .map(([label, value]) => (
      `<tr><th scope="row">${escapeHtml(label)}</th><td class="numeric">${escapeHtml(value)}</td></tr>`
    ))
    .join('');
}

function renderOverviewPanel(w) {
  if (!w) return '';
  const { day, month, year, minute } = w.calendar;
  const weather = w.weather || { tempC: 0, rain_mm: 0, wind_ms: 0, dryStreakDays: 0 };
  const daylight = w.daylight || { sunrise: 0, sunset: 0 };
  const labour = monthHudInfo(w);
  const labourPct = labour.b ? Math.floor((labour.u / labour.b) * 100) : 0;
  const dateLabel = `Year ${year}, Month ${MONTH_NAMES[month - 1]} Day ${day} of ${DAYS_PER_MONTH}`;
  const weatherLabel = `Temp ${weather.tempC.toFixed(0)}°C · Rain ${weather.rain_mm.toFixed(1)}mm · Wind ${weather.wind_ms.toFixed(1)}m/s`;
  const dryLabel = `Dry streak: ${weather.dryStreakDays} day${weather.dryStreakDays === 1 ? '' : 's'}`;
  return `
    <section>
      <h2>Day &amp; Weather</h2>
      <dl class="detail-list">
        <div><dt>Date</dt><dd>${escapeHtml(dateLabel)}</dd></div>
        <div><dt>Time</dt><dd>${formatTime(minute)}</dd></div>
        <div><dt>Weather</dt><dd>${escapeHtml(weatherLabel)}</dd></div>
        <div><dt>Dry Spell</dt><dd>${escapeHtml(dryLabel)}</dd></div>
        <div><dt>Sunlight</dt><dd>${formatTime(daylight.sunrise)} – ${formatTime(daylight.sunset)}</dd></div>
        <div><dt>Flex Field</dt><dd>${escapeHtml(w.flexChoice || 'Pending')}</dd></div>
        <div><dt>Speed</dt><dd>${getSpeed().toFixed(2)}× min/s</dd></div>
      </dl>
      <h2>Labour</h2>
      <dl class="detail-list">
        <div><dt>Budget</dt><dd>${formatMinutes(labour.b)}</dd></div>
        <div><dt>Used</dt><dd>${formatMinutes(labour.u)} (${labourPct}%)</dd></div>
        <div><dt>Active Tasks</dt><dd>${labour.a}</dd></div>
        <div><dt>Queued</dt><dd>${labour.q}</dd></div>
        <div><dt>Overdue</dt><dd>${labour.o}</dd></div>
        <div><dt>Next Task</dt><dd>${escapeHtml(labour.nextTxt)}</dd></div>
      </dl>
      <h2>Advisor</h2>
      <p>${escapeHtml(advisorHud(w))}</p>
    </section>
  `;
}

function renderInventoryPanel(w) {
  if (!w) return '';
  const store = w.store || {};
  const sheaves = w.storeSheaves || {};
  const livestock = w.livestock || {};
  const cash = typeof w.cash === 'number' ? w.cash : 0;
  const grainRows = [
    ['Cash', `£${cash.toFixed(2)}`],
    ['Wheat', `${Math.floor(store.wheat ?? 0)} bu`],
    ['Barley', `${Math.floor(store.barley ?? 0)} bu`],
    ['Oats', `${Math.floor(store.oats ?? 0)} bu`],
    ['Pulses', `${Math.floor(store.pulses ?? 0)} bu`],
  ];
  const fodderRows = [
    ['Hay', `${(store.hay ?? 0).toFixed(2)} t`],
    ['Straw', `${Math.floor(store.straw ?? 0)} bundles`],
    ['Manure', `${Math.floor(store.manure_units ?? 0)} units`],
    ['Water', `${Math.floor(store.water ?? 0)} buckets`],
  ];
  const sheafRows = [
    ['Wheat', `${Math.floor(sheaves.WHEAT ?? 0)} sheaves`],
    ['Barley', `${Math.floor(sheaves.BARLEY ?? 0)} sheaves`],
    ['Oats', `${Math.floor(sheaves.OATS ?? 0)} sheaves`],
    ['Pulses', `${Math.floor(sheaves.PULSES ?? 0)} sheaves`],
  ];
  const livestockRows = Object.entries(livestock).map(([kind, count]) => [titleCase(kind), String(count)]);
  return `
    <section>
      <h2>Granary &amp; Cash</h2>
      <table class="panel-table"><tbody>${renderTableRows(grainRows)}</tbody></table>
      <h2>Fodder &amp; Supplies</h2>
      <table class="panel-table"><tbody>${renderTableRows(fodderRows)}</tbody></table>
      <h2>Sheaves in Field</h2>
      <table class="panel-table"><tbody>${renderTableRows(sheafRows)}</tbody></table>
      <h2>Livestock</h2>
      <table class="panel-table"><tbody>${renderTableRows(livestockRows)}</tbody></table>
    </section>
  `;
}

function formatParcelCrop(parcel) {
  if (!parcel?.rows?.length) return parcel.status?.cropNote || '—';
  const crops = new Map();
  for (const row of parcel.rows) {
    if (row?.crop?.name) {
      crops.set(row.crop.name, (crops.get(row.crop.name) || 0) + 1);
    }
  }
  if (!crops.size) return parcel.status?.cropNote || 'Fallow';
  const [name] = Array.from(crops.entries()).sort((a, b) => b[1] - a[1])[0];
  return name;
}

function formatParcelStatus(parcel) {
  if (!parcel) return '';
  const parts = [];
  if (parcel.rows?.length) {
    const totalGrowth = parcel.rows.reduce((sum, row) => sum + (row?.growth ?? 0), 0);
    const avgGrowth = parcel.rows.length ? totalGrowth / parcel.rows.length : 0;
    if (Number.isFinite(avgGrowth)) parts.push(`Growth ${Math.round(avgGrowth * 100)}%`);
  }
  if (parcel.status?.targetHarvestM) parts.push(`Target M${parcel.status.targetHarvestM}`);
  if ((parcel.status?.lateSow ?? 0) > 0) parts.push(`Late sow +${parcel.status.lateSow}`);
  if ((parcel.status?.mud ?? 0) > 0.35) parts.push('Mud risk');
  if ((parcel.fieldStore?.sheaves ?? 0) > 0) parts.push(`${Math.floor(parcel.fieldStore.sheaves)} sheaves ready`);
  if (parcel.pasture?.biomass_t > 0) parts.push(`Pasture ${parcel.pasture.biomass_t.toFixed(2)} t`);
  if (parcel.hayCuring) {
    parts.push(`Hay curing ${Math.round(parcel.hayCuring.dryness * 100)}% (loss ${parcel.hayCuring.loss_t.toFixed(2)} t)`);
  }
  if (parcel.status?.cropNote) parts.push(parcel.status.cropNote);
  return parts.length ? parts.join(' · ') : 'Stable';
}

function renderParcelsPanel(w) {
  if (!w) return '';
  const rows = (w.parcels || []).map((p) => (
    `<tr><td>${escapeHtml(p.name)}</td><td class="numeric">${escapeHtml(String(p.acres ?? 0))}</td><td>${escapeHtml(formatParcelCrop(p))}</td><td>${escapeHtml(formatParcelStatus(p))}</td></tr>`
  )).join('');
  const body = rows || '<tr><td colspan="4">No parcels available.</td></tr>';
  return `
    <section>
      <h2>Parcels</h2>
      <table class="panel-table">
        <thead>
          <tr><th>Parcel</th><th class="numeric">Acres</th><th>Crop</th><th>Status</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `;
}

function renderMessagesPanel(w) {
  if (!w) return '';
  const entries = (w.logs || []).slice(0, 50);
  if (!entries.length) {
    return '<section><h2>Messages</h2><p>No messages yet.</p></section>';
  }
  const items = entries.map((msg) => `<li>${escapeHtml(msg)}</li>`).join('');
  return `<section><h2>Messages</h2><ul class="panel-list">${items}</ul></section>`;
}

function renderControlsPanel() {
  return `
    <section>
      <h2>Controls</h2>
      <ul class="panel-list">
        <li>
          <strong>Camera</strong>
          <p><span class="kbd">W</span><span class="kbd">A</span><span class="kbd">S</span><span class="kbd">D</span> or <span class="kbd">Arrow Keys</span> pan the view and unlock follow mode.</p>
          <p><span class="kbd">C</span> or the Follow Farmer button recenters the camera and locks onto the farmer.</p>
        </li>
        <li>
      <strong>Time</strong>
          <p>The speed slider in the lower-left sets the pace. <span class="kbd">Space</span> toggles pause, <span class="kbd">,</span> advances one minute, <span class="kbd">.</span> advances ten, and <span class="kbd">N</span> skips to day end.</p>
          <p><span class="kbd">1</span>–<span class="kbd">5</span> jump to preset speeds; the on-screen buttons offer the same choices plus a pause toggle.</p>
        </li>
        <li>
          <strong>Management</strong>
          <p><span class="kbd">L</span> with <span class="kbd">Shift</span> buys a cow; <span class="kbd">Alt</span> + <span class="kbd">L</span> sells one.</p>
          <p><span class="kbd">R</span> resets the simulation; <span class="kbd">Shift</span>+<span class="kbd">R</span> starts with a new seed.</p>
          <p><span class="kbd">F5</span> saves and <span class="kbd">F9</span> loads from browser storage.</p>
        </li>
        <li>
          <strong>Display</strong>
          <p><span class="kbd">P</span> toggles the information drawer. <span class="kbd">H</span> posts a help message; <span class="kbd">Shift</span>+<span class="kbd">H</span> toggles high contrast mode.</p>
        </li>
      </ul>
    </section>
  `;
}

function updatePanelContent() {
  if (!panelContentRef) return;
  const renderer = PANEL_RENDERERS[activePanel];
  const html = renderer ? renderer(world) : '';
  if (html !== lastPanelHtml) {
    panelContentRef.innerHTML = html;
    lastPanelHtml = html;
  }
}

function setActivePanel(panelKey) {
  if (!PANEL_RENDERERS[panelKey]) return;
  activePanel = panelKey;
  lastPanelHtml = '';
  panelButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.panel === panelKey));
  updatePanelContent();
}

function setDrawerOpen(open) {
  drawerOpen = open;
  if (drawerRef) {
    drawerRef.hidden = !open;
  }
  if (menuToggleRef) {
    menuToggleRef.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuToggleRef.textContent = open ? 'Close Menu' : 'Open Menu';
    menuToggleRef.title = open ? 'Hide information panels' : 'Open information panels';
  }
}

function updateFollowButton() {
  if (!followButtonRef || !world) return;
  const following = world.camera?.follow !== false;
  followButtonRef.textContent = following ? 'Following Farmer' : 'Free Camera';
  followButtonRef.setAttribute('aria-pressed', following ? 'true' : 'false');
  followButtonRef.title = following ? 'Click to unlock the camera' : 'Click to follow the farmer';
}

function ensureCameraState(w) {
  if (!w.camera) w.camera = { x: 0, y: 0, follow: true };
  if (typeof w.camera.follow !== 'boolean') w.camera.follow = true;
  if (!Number.isFinite(w.camera.x)) w.camera.x = 0;
  if (!Number.isFinite(w.camera.y)) w.camera.y = 0;
}

function centerCameraOnFarmer() {
  if (!world) return;
  world.camera.x = clamp(world.farmer.x - CONFIG.SCREEN.W / 2, 0, CONFIG.WORLD.W - CONFIG.SCREEN.W);
  world.camera.y = clamp(world.farmer.y - CONFIG.SCREEN.H / 2, 0, CONFIG.WORLD.H - CONFIG.SCREEN.H);
}

function moveCamera(dx, dy) {
  if (!world) return;
  const maxX = CONFIG.WORLD.W - CONFIG.SCREEN.W;
  const maxY = CONFIG.WORLD.H - CONFIG.SCREEN.H;
  world.camera.x = clamp((world.camera.x ?? 0) + dx, 0, maxX);
  world.camera.y = clamp((world.camera.y ?? 0) + dy, 0, maxY);
}

function setFollow(follow) {
  if (!world) return;
  world.camera.follow = follow;
  if (follow) centerCameraOnFarmer();
  updateFollowButton();
}

function updateMessageStack() {
  if (!messageRef || !world) return;
  const messages = (world.logs || []).slice(0, 3);
  const key = messages.join('||');
  if (key === lastMessagesKey) return;
  lastMessagesKey = key;
  if (!messages.length) {
    messageRef.innerHTML = '';
    return;
  }
  messageRef.innerHTML = messages.map((msg) => `<div class="message">${escapeHtml(msg)}</div>`).join('');
}

function syncUiAfterWorldChange({ forceCenter = false } = {}) {
  if (!world) return;
  ensureCameraState(world);
  if (forceCenter) world.camera.follow = true;
  if (world.camera.follow !== false) {
    centerCameraOnFarmer();
  } else {
    moveCamera(0, 0);
  }
  lastPanelHtml = '';
  lastMessagesKey = null;
  updateFollowButton();
  updatePanelContent();
  updateMessageStack();
}

function resetFrameClock() {
  lastFrameTime = performance.now();
}

function advanceMinutes(count) {
  if (!world || count <= 0) return;
  const whole = Math.floor(count);
  if (whole <= 0) return;
  for (let i = 0; i < whole * 2; i++) processFarmerHalfStep(world);
  for (let i = 0; i < whole; i++) stepOneMinute(world);
  workAccumulator = 0;
  moveAccumulator = 0;
  resetFrameClock();
  draw();
}

function skipToDayEnd() {
  if (!world) return;
  const remaining = Math.max(0, MINUTES_PER_DAY - (world.calendar.minute ?? 0));
  advanceMinutes(remaining);
}

function onFrame(now) {
  if (!world) {
    requestAnimationFrame(onFrame);
    return;
  }
  if (lastFrameTime == null) lastFrameTime = now;
  const dt = Math.max(0, now - lastFrameTime);
  lastFrameTime = now;

  const deltaMin = minutesToAdvance(dt);
  workAccumulator += deltaMin;
  moveAccumulator += deltaMin;

  while (moveAccumulator >= 0.5) {
    processFarmerHalfStep(world);
    moveAccumulator -= 0.5;
  }

  while (workAccumulator >= 1) {
    stepOneMinute(world);
    workAccumulator -= 1;
  }

  world.paused = getSpeed() === 0;
  draw();
  requestAnimationFrame(onFrame);
}

function drawDebugOverlay(w, canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);
  const cssWidth = canvas.width / dpr;
  const cssHeight = canvas.height / dpr;
  ctx.font = '12px ui-monospace';
  const lineH = 14;
  const paddingLeft = Number.isFinite(charSize.paddingLeft)
    ? charSize.paddingLeft
    : parseFloat(getComputedStyle(screenRef).paddingLeft) || 0;
  const paddingTop = Number.isFinite(charSize.paddingTop)
    ? charSize.paddingTop
    : parseFloat(getComputedStyle(screenRef).paddingTop) || 0;
  const overlayMargin = 4;
  const camX = Math.round(w.camera.x);
  const camY = Math.round(w.camera.y);

  if (DEBUG.showParcels) {
    for (const p of w.parcels) {
      const pSX = (p.x - camX) * charSize.width + paddingLeft;
      const pSY = (p.y - camY) * charSize.height + paddingTop;
      const pSW = p.w * charSize.width;
      const pSH = p.h * charSize.height;
      if (pSX + pSW < 0 || pSX > cssWidth || pSY + pSH < 0 || pSY > cssHeight) continue;
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
    ctx.fillRect(paddingLeft - overlayMargin, paddingTop - overlayMargin, 360, 14 + lineH * q.length);
    ctx.fillStyle = '#ddd';
    ctx.fillText('Queue:', paddingLeft + 2, paddingTop + 8);
    q.forEach((l, i) => ctx.fillText(l, paddingLeft + 2, paddingTop + 22 + lineH * i));
  }

  if (DEBUG.showKPI) {
    const line = advisorHud(w);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(paddingLeft - overlayMargin, paddingTop + 108, 880, 20);
    ctx.fillStyle = '#ddd';
    ctx.fillText(line, paddingLeft + 2, paddingTop + 123);
  }
}

function draw() {
  if (!world) return;
  const { buf, styleBuf } = renderColored(world, { speed: getSpeed(), accMin: workAccumulator, moveAcc: moveAccumulator });
  const lines = [];
  for (let y = 0; y < buf.length; y++) lines.push(flushLine(buf[y], styleBuf[y]));
  screenRef.innerHTML = lines.join('\n');
  updateMessageStack();
  updatePanelContent();
  updateFollowButton();
  drawDebugOverlay(world, overlayRef);
}

function measureCharSize() {
  const style = getComputedStyle(screenRef);
  const temp = document.createElement('span');
  temp.textContent = 'M';
  temp.style.font = style.font;
  temp.style.position = 'absolute';
  temp.style.visibility = 'hidden';
  document.body.appendChild(temp);
  charSize = {
    width: temp.offsetWidth,
    height: temp.offsetHeight,
    paddingLeft: parseFloat(style.paddingLeft) || 0,
    paddingTop: parseFloat(style.paddingTop) || 0,
  };
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
    if (e.key === ',') {
      e.preventDefault();
      world.snapCamera = true;
      advanceMinutes(1);
      world.snapCamera = false;
    } else if (e.key === '.') {
      e.preventDefault();
      advanceMinutes(10);
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      skipToDayEnd();
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
        log(world, `Seed: ${world.seed}`);
        onNewMonth(world);
        planDay(world);
        syncUiAfterWorldChange({ forceCenter: true });
        draw();
      }
    } else if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      setDrawerOpen(!drawerOpen);
      updatePanelContent();
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      setFollow(true);
      draw();
    } else if (
      e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
      e.key === 'w' || e.key === 'W' || e.key === 'a' || e.key === 'A' || e.key === 's' || e.key === 'S' || e.key === 'd' || e.key === 'D'
    ) {
      const step = e.shiftKey ? CAMERA_STEP * 2 : CAMERA_STEP;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') dy -= step;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') dy += step;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') dx -= step;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') dx += step;
      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        setFollow(false);
        moveCamera(dx, dy);
        draw();
      }
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
        setSpeed(0);
        resetFrameClock();
        log(world, 'Help: WASD/Arrows(pan) ,(1m) .(10m) N(1d) Space(pause) 1..5(speed presets) C(follow) P(menu) R(reset) Shift+R(new) Shift+H(contrast) Shift+L(buy) Alt+L(sell)');
        syncSpeedControls();
        draw();
      }
    } else if (e.key === 'Escape') {
      if (drawerOpen) {
        e.preventDefault();
        setDrawerOpen(false);
      }
    } else if (e.key === 'F5') {
      e.preventDefault();
      saveToLocalStorage(world);
    } else if (e.key === 'F9') {
      e.preventDefault();
      const loaded = loadFromLocalStorage();
      if (loaded) {
        world = loaded;
        world.pathGrid = createPathfindingGrid();
      }
      planDay(world);
      syncUiAfterWorldChange();
      draw();
    } else if (e.key === 'F1') { e.preventDefault(); DEBUG.showParcels = !DEBUG.showParcels; draw(); }
    else if (e.key === 'F2') { e.preventDefault(); DEBUG.showTaskQueue = !DEBUG.showTaskQueue; draw(); }
    else if (e.key === 'F3') { e.preventDefault(); DEBUG.showKPI = !DEBUG.showKPI; draw(); }
  });
}

function init() {
  const loaded = loadFromLocalStorage();
  world = loaded || makeWorld(getSeedFromURL());
  log(world, `Seed: ${world.seed}`);
  if (!loaded) onNewMonth(world);
  screenRef = document.getElementById('screen');
  overlayRef = document.getElementById('debug-overlay');
  messageRef = document.getElementById('message-stack');
  drawerRef = document.getElementById('info-drawer');
  menuToggleRef = document.getElementById('menu-toggle');
  followButtonRef = document.getElementById('follow-toggle');
  panelContentRef = document.getElementById('panel-content');
  panelButtons = Array.from(document.querySelectorAll('#menu .menu-item'));
  panelButtons.forEach((btn) => {
    btn.addEventListener('click', () => setActivePanel(btn.dataset.panel));
  });
  if (menuToggleRef) {
    menuToggleRef.addEventListener('click', () => {
      setDrawerOpen(!drawerOpen);
      updatePanelContent();
    });
  }
  if (followButtonRef) {
    followButtonRef.addEventListener('click', () => {
      if (!world) return;
      const following = world.camera?.follow !== false;
      setFollow(!following);
      draw();
    });
  }
  setDrawerOpen(false);
  const resizeObserver = new ResizeObserver(() => {
    resizeOverlayCanvas();
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
  setActivePanel(activePanel);
  attachDebugToggles();
  attachSaveHelpers();
  bindKeyboard();
  initSpeedControls();
  window.simulateMonths = simulateMonths;
  resizeOverlayCanvas();
  measureCharSize();
  syncUiAfterWorldChange({ forceCenter: true });
  draw();
  resetFrameClock();
  requestAnimationFrame(onFrame);
}

document.addEventListener('DOMContentLoaded', init);
