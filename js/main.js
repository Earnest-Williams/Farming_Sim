import { createInitialWorld, buildStageIndex, resolveTargetKeys } from './world.js';
import { renderColored, flushLine } from './render.js';
import {
  resetTime,
  getSimTime,
  formatSimTime,
  computeDaylightByIndex,
  dayIndex,
  syncSimTime,
  SIM,
  CALENDAR,
} from './time.js';
import {
  resetLabour,
  getLabourUsage,
  LABOUR,
} from './labour.js';
import { generateMonthJobs } from './plan.js';
import { createEngineState, tick as runEngineTick } from './engine.js';
import { JOBS } from './jobs.js';
import {
  guardAllows,
  inWindow,
  prerequisitesMet,
  monthIndexFromLabel,
  monthInWindow,
} from './scheduler.js';
import { initSpeedControls } from './ui/speed.js';
import { bindClock } from './timeflow.js';
import { PARCEL_KIND, CONFIG, MINUTES_PER_DAY } from './constants.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { clamp } from './utils.js';
import { assertConfigCompleteness } from './config/guards.js';
import { SimulationClock } from './time/SimulationClock.js';
import { initPathfinding } from './pathfinding.js';
import { labelFor, stageNow } from './rotation.js';

assertConfigCompleteness();

const pathfindingLib = typeof globalThis !== 'undefined' ? globalThis.PF : null;
if (pathfindingLib) {
  initPathfinding(pathfindingLib);
} else if (typeof window !== 'undefined') {
  initPathfinding(null);
  console.warn('Pathfinding library not available; using direct movement fallback.');
} else {
  initPathfinding(null);
}

const MINUTES_PER_HOUR = CONFIG_PACK_V1.time.minutesPerHour ?? 60;
const JOB_LOOKUP = new Map(JOBS.map((job) => [job.id, job]));

const state = {
  world: null,
  engine: null,
  monthJobs: [],
  jobStatus: new Map(),
  activePanel: 'overview',
  lastPreparedMonth: null,
};

const DOM = {};

function isDrawerOpen() {
  const drawer = DOM.drawer;
  return !!drawer && !drawer.hasAttribute('hidden');
}

function syncDrawerToggle() {
  if (!DOM.menuToggle) return;
  DOM.menuToggle.setAttribute('aria-expanded', isDrawerOpen() ? 'true' : 'false');
}

function setDrawerOpen(open) {
  const drawer = DOM.drawer;
  if (!drawer) return;
  if (open) {
    drawer.removeAttribute('hidden');
  } else {
    drawer.setAttribute('hidden', '');
  }
  syncDrawerToggle();
}

function toggleDrawer(force) {
  if (typeof force === 'boolean') {
    setDrawerOpen(force);
    return;
  }
  setDrawerOpen(!isDrawerOpen());
}

const clock = new SimulationClock({
  speedSimMinPerRealMin: SIM.MIN_PER_REAL_MIN,
  stepSimMin: SIM.STEP_MIN,
});

const CAMERA_STEP = 4;

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateFollowToggleLabel(enabled) {
  if (!DOM.followToggle) return;
  DOM.followToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  DOM.followToggle.textContent = enabled ? 'Following Farmer' : 'Free Camera';
}

function setFollowMode(enabled) {
  const world = state.world;
  if (world?.camera) {
    world.camera.follow = enabled;
    world.snapCamera = enabled;
  }
  updateFollowToggleLabel(enabled);
  renderScreen();
}

const WEATHER_ICONS = Object.freeze({
  Rain: '☔',
  Storm: '⛈',
  Snow: '❄️',
  Frost: '🧊',
  Hot: '🔥',
  Drought: '🌵',
  Overcast: '☁️',
  Chill: '💨',
  Fair: '☀️',
});

function iconForWeather(label) {
  return WEATHER_ICONS[label] || WEATHER_ICONS.Fair;
}

function computeSoilAverages(world) {
  const parcels = world?.parcels || [];
  const arable = parcels.filter((parcel) =>
    parcel.kind === PARCEL_KIND.ARABLE || parcel.kind === PARCEL_KIND.CLOSE
  );
  if (arable.length === 0) {
    return { organic: 0.6, stress: 0 };
  }
  let organicSum = 0;
  let stressSum = 0;
  for (const parcel of arable) {
    organicSum += Number.isFinite(parcel.soil?.organic) ? parcel.soil.organic : 0.6;
    const drought = clamp(parcel.status?.droughtStress ?? 0, 0, 1);
    const flood = clamp(parcel.status?.waterlogging ?? 0, 0, 1);
    stressSum += (drought + flood) / 2;
  }
  return {
    organic: organicSum / arable.length,
    stress: stressSum / arable.length,
  };
}

function formatTemperature(tempC) {
  if (!Number.isFinite(tempC)) return '—';
  return `${Math.round(tempC)}°C`;
}

function formatPrecip(rainMm) {
  if (!Number.isFinite(rainMm)) return '0.0 mm';
  return `${rainMm.toFixed(1)} mm`;
}

function updateWeatherHud() {
  const weather = state.world?.weather;
  if (!weather) return;
  const soil = computeSoilAverages(state.world);
  const icon = iconForWeather(weather.label);
  const temp = formatTemperature(weather.tempC);
  const rain = formatPrecip(weather.rain_mm);
  const humidity = Number.isFinite(weather.humidity)
    ? `${Math.round(weather.humidity * 100)}% RH`
    : null;
  const hudParts = [`${icon} ${weather.label}`];
  hudParts.push(temp);
  hudParts.push(rain);
  const soilHumus = `${Math.round((soil.organic ?? 0.6) * 100)}% humus`;
  const stressLevel = soil.stress >= 0.6 ? 'strained' : soil.stress >= 0.4 ? 'tense' : 'steady';
  hudParts.push(`Soil ${soilHumus}`);
  if (humidity) hudParts.push(humidity);
  if (DOM.hudWeather) DOM.hudWeather.textContent = hudParts.join(' • ');
  if (DOM.weatherIcon) DOM.weatherIcon.textContent = icon;
  if (DOM.weatherLabel) DOM.weatherLabel.textContent = weather.label || 'Fair';
  if (DOM.weatherDetails) {
    const detailParts = [temp, rain];
    if (humidity) detailParts.push(humidity);
    detailParts.push(`${soilHumus} • ${stressLevel}`);
    DOM.weatherDetails.textContent = detailParts.join(' • ');
  }
}

function updateLabourProgress(usage) {
  if (!DOM.labourProgress || !DOM.labourProgressFill || !DOM.labourProgressText) return;
  const usedValue = Number.isFinite(usage?.used) ? usage.used : 0;
  const budgetValue = Number.isFinite(usage?.budget) ? usage.budget : 0;
  const usedLabel = usedValue.toFixed(1);
  if (budgetValue <= 0) {
    DOM.labourProgressFill.style.width = '0%';
    DOM.labourProgressText.textContent = 'No labour budget';
    DOM.labourProgress.setAttribute('aria-valuenow', usedLabel);
    DOM.labourProgress.setAttribute('aria-valuemax', '0');
    DOM.labourProgress.setAttribute('aria-valuetext', 'No labour budget available');
    DOM.labourProgress.classList.remove('is-warning', 'is-critical');
    return;
  }
  const ratio = usedValue / budgetValue;
  const bounded = clamp(ratio, 0, 1);
  const percentLabel = Math.round(clamp(ratio, 0, 2) * 100);
  DOM.labourProgressFill.style.width = `${(bounded * 100).toFixed(1)}%`;
  DOM.labourProgressText.textContent = `${percentLabel}% used`;
  DOM.labourProgress.setAttribute('aria-valuenow', usedLabel);
  DOM.labourProgress.setAttribute('aria-valuemax', budgetValue.toFixed(0));
  DOM.labourProgress.setAttribute(
    'aria-valuetext',
    `${usedLabel} of ${budgetValue.toFixed(0)} hours used`
  );
  DOM.labourProgress.classList.toggle('is-warning', ratio >= 0.75 && ratio < 1);
  DOM.labourProgress.classList.toggle('is-critical', ratio >= 1);
}

function applyAtmosphereLighting() {
  const container = DOM.screenContainer;
  const world = state.world;
  if (!container || !world) return;
  const minute = world.calendar?.minute ?? 0;
  const t = MINUTES_PER_DAY > 0 ? (minute % MINUTES_PER_DAY) / MINUTES_PER_DAY : 0;
  const diurnal = Math.sin((t - 0.25) * Math.PI * 2) * 0.5 + 0.5;
  const daylightHours = world.daylight?.dayLenHours ?? 12;
  const daylightBoost = clamp(daylightHours / 16, 0.6, 1.1);
  const weatherLight = clamp(world.weather?.lightLevel ?? 0.75, 0.2, 1);
  const brightness = clamp(0.22 + diurnal * 0.58 * daylightBoost + (weatherLight - 0.6) * 0.4, 0.18, 1);
  const cloud = clamp(world.weather?.cloudCover ?? 0.28, 0, 1);
  const baseHue = Number.isFinite(world.weather?.skyHue)
    ? world.weather.skyHue
    : (world.weather?.label === 'Hot' ? 48 : 210);
  const saturation = clamp(0.42 + (weatherLight - 0.5) * 0.18 - cloud * 0.12, 0.28, 0.65);
  const sunGlow = clamp((world.weather?.sunGlow ?? 0.4) * (0.6 + diurnal * 0.7), 0.1, 0.95);
  const soilAverages = computeSoilAverages(world);
  container.style.setProperty('--sky-hue', baseHue.toFixed(1));
  container.style.setProperty('--sky-saturation', saturation.toFixed(3));
  container.style.setProperty('--sky-brightness', brightness.toFixed(3));
  container.style.setProperty('--sky-cloud', cloud.toFixed(3));
  container.style.setProperty('--sun-glow', sunGlow.toFixed(3));
  container.style.setProperty('--soil-health', (soilAverages.organic ?? 0.6).toFixed(3));
  container.style.setProperty('--soil-stress', (soilAverages.stress ?? 0).toFixed(3));
}

function isTextInput(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (!tag) return false;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
}

function panCamera(dx, dy, multiplier = 1) {
  const world = state.world;
  if (!world?.camera) return;
  const step = CAMERA_STEP * multiplier;
  const maxX = CONFIG.WORLD.W - CONFIG.SCREEN.W;
  const maxY = CONFIG.WORLD.H - CONFIG.SCREEN.H;
  const nextX = clamp(world.camera.x + dx * step, 0, maxX);
  const nextY = clamp(world.camera.y + dy * step, 0, maxY);
  if (world.camera.follow !== false || world.snapCamera) {
    setFollowMode(false);
  }
  world.snapCamera = false;
  world.camera.x = nextX;
  world.camera.y = nextY;
  renderScreen();
}

function selectDom() {
  DOM.screen = document.getElementById('screen');
  DOM.messageStack = document.getElementById('message-stack');
  DOM.drawer = document.getElementById('info-drawer');
  DOM.menuToggle = document.getElementById('menu-toggle');
  DOM.followToggle = document.getElementById('follow-toggle');
  DOM.menu = document.getElementById('menu');
  DOM.panelContent = document.getElementById('panel-content');
  DOM.hudDate = document.getElementById('hud-date');
  DOM.hudTime = document.getElementById('hud-time');
  DOM.hudLabour = document.getElementById('hud-labour');
  DOM.hudWeather = document.getElementById('hud-weather');
  DOM.screenContainer = document.getElementById('screen-container');
  DOM.weatherIcon = document.getElementById('weather-icon');
  DOM.weatherLabel = document.getElementById('weather-label');
  DOM.weatherDetails = document.getElementById('weather-details');
  DOM.labourProgress = document.getElementById('labour-progress');
  DOM.labourProgressFill = document.getElementById('labour-progress-fill');
  DOM.labourProgressText = document.getElementById('labour-progress-text');
  syncDrawerToggle();
}

function initEvents() {
  if (DOM.menuToggle) {
    DOM.menuToggle.addEventListener('click', () => {
      toggleDrawer();
    });
  }

  if (DOM.followToggle) {
    DOM.followToggle.addEventListener('click', () => {
      const followEnabled = state.world?.camera?.follow !== false;
      setFollowMode(!followEnabled);
    });
  }

  if (DOM.menu) {
    DOM.menu.addEventListener('click', (ev) => {
      const button = ev.target.closest('button[data-panel]');
      if (!button) return;
      setActivePanel(button.dataset.panel);
      setDrawerOpen(true);
    });
  }
}

function updateLabourState() {
  const usage = getLabourUsage();
  state.world.labour = { ...state.world.labour, ...usage };
  return usage;
}

export function computeJobStatus(job, { state: targetState = state } = {}) {
  if (!job) return 'planned';
  const engine = targetState.engine;
  const calendar = targetState.world?.calendar ?? {};
  const currentMonth = calendar.month ?? 1;
  const monthIdx = monthIndexFromLabel(currentMonth);
  const startIdx = monthIndexFromLabel(job.window?.[0] ?? currentMonth);
  const endIdx = monthIndexFromLabel(job.window?.[1] ?? currentMonth);
  const wraps = startIdx > endIdx;
  const totalMonths = CALENDAR.MONTHS.length;
  const normalizedEnd = wraps ? endIdx + totalMonths : endIdx;
  let normalizedMonth = monthIdx;
  if (wraps && normalizedMonth < startIdx) {
    normalizedMonth += totalMonths;
  }
  const inCurrentWindow = monthInWindow(monthIdx, startIdx, endIdx);
  const doneSet = engine?.progress?.done instanceof Set ? engine.progress.done : new Set();
  if (doneSet.has(job.id)) return 'completed';
  if (engine?.taskSkips instanceof Map && engine.taskSkips.has(job.id)) {
    return 'skipped';
  }
  if (normalizedMonth > normalizedEnd) return 'overdue';
  if (!engine) return 'planned';
  if (!wraps && monthIdx < startIdx) return 'planned';
  if (!prerequisitesMet(engine, job)) return 'planned';
  if (!guardAllows(engine, job)) return 'unscheduled';
  if (engine.currentTask?.definition?.id === job.id) return 'working';
  if (inCurrentWindow || inWindow(engine, job.window)) return 'queued';
  return 'planned';
}

function refreshJobStatus() {
  const map = new Map();
  for (const job of JOBS) {
    map.set(job.id, computeJobStatus(job));
  }
  state.jobStatus = map;
}

function prepareMonth(month, { resetBudget = false } = {}) {
  if (resetBudget) {
    resetLabour(month);
    state.world.completedJobs = [];
  }
  if (state.engine) {
    state.engine.world = state.world;
    const engineProgress = state.engine.progress;
    const year = state.world?.calendar?.year ?? 1;
    if (engineProgress) {
      if (!(engineProgress.done instanceof Set)) engineProgress.done = new Set();
      if (!(engineProgress.history instanceof Map)) engineProgress.history = new Map();
      if (engineProgress.year !== year) {
        engineProgress.done.clear();
        engineProgress.history.clear();
        engineProgress.year = year;
      }
    }
  }
  const previousLabour = state.world?.labour ?? {};
  const usage = updateLabourState();
  state.monthJobs = generateMonthJobs(state.world, month);
  state.lookup = state.world.lookup;
  refreshJobStatus();
  state.world.labour = { ...previousLabour, ...usage };
  state.lastPreparedMonth = month;
}

function initWorld() {
  resetTime();
  syncSimTime(clock.nowSimMin());
  state.world = createInitialWorld();
  state.lookup = state.world.lookup;
  state.engine = createEngineState(state.world);
  updateFollowToggleLabel(state.world.camera?.follow !== false);
  resetLabour(state.world.calendar.month);
  updateLabourState();
  prepareMonth(state.world.calendar.month, { resetBudget: true });
  updateWorldDaylight();
  if (typeof window !== 'undefined') {
    window.appState = state;
    window.appWorld = state.world;
    window.appWorld.buildStageIndex = (input) => buildStageIndex(input ?? state);
    window.appWorld.resolveTargetKeys = (name, input) => resolveTargetKeys(name, input ?? state.world);
  }
}

function ensureMonthPrepared() {
  const currentMonth = state.world?.calendar?.month;
  if (!currentMonth) return;
  if (state.lastPreparedMonth !== currentMonth) {
    prepareMonth(currentMonth, { resetBudget: true });
  }
}

function updateWorldDaylight() {
  const calendar = state.world?.calendar;
  if (!calendar) return;
  const monthSource = Number.isFinite(calendar.monthIndex)
    ? calendar.monthIndex
    : calendar.month;
  const idx = dayIndex(calendar.day, monthSource);
  state.world.daylight = computeDaylightByIndex(idx);
}

function renderHud() {
  const { label, time } = formatSimTime();
  if (DOM.hudDate) DOM.hudDate.textContent = label;
  if (DOM.hudTime) DOM.hudTime.textContent = time;
  const usage = getLabourUsage();
  const usedHours = Number.isFinite(usage.used) ? usage.used : 0;
  const budgetHours = Number.isFinite(usage.budget) ? usage.budget : 0;
  const labourLabel = `Labour: ${usedHours.toFixed(1)} / ${budgetHours.toFixed(0)} h`;
  if (DOM.hudLabour) DOM.hudLabour.textContent = labourLabel;
  updateLabourProgress({ used: usedHours, budget: budgetHours });
  updateWeatherHud();
}

function renderScreen() {
  if (!DOM.screen || !state.world) return;
  applyAtmosphereLighting();
  const { buf, styleBuf } = renderColored(state.world);
  if (!Array.isArray(buf)) {
    DOM.screen.innerHTML = '';
    return;
  }
  const rows = buf.map((row = [], idx) => {
    const chars = row.map((ch) => (ch == null ? ' ' : ch));
    const styles = (styleBuf[idx] ?? []).slice(0, chars.length);
    const spanHtml = flushLine(chars, styles);
    return `<div class="screen-row">${spanHtml}</div>`;
  });
  DOM.screen.innerHTML = rows.join('');
}

function renderOverviewPanel() {
  const usage = getLabourUsage();
  const { month, day, year, minute } = state.world.calendar;
  const hours = Math.floor(minute / MINUTES_PER_HOUR);
  const mins = Math.floor(minute % MINUTES_PER_HOUR);
  const soil = computeSoilAverages(state.world);
  const humusPct = Math.round((soil.organic ?? 0.6) * 100);
  const stressPct = Math.round((soil.stress ?? 0) * 100);
  const stressLabel = soil.stress >= 0.6 ? 'Severe strain' : soil.stress >= 0.4 ? 'Elevated stress' : 'Balanced';
  const statuses = Array.from(state.jobStatus.values());
  const planned = statuses.filter((s) => s === 'queued' || s === 'working').length;
  const completed = statuses.filter((s) => s === 'completed').length;
  return `
    <section>
      <h2>Calendar</h2>
      <dl class="detail-list">
        <div><dt>Month</dt><dd>${escapeHtml(month)}</dd></div>
        <div><dt>Day</dt><dd>${day}</dd></div>
        <div><dt>Time</dt><dd>${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}</dd></div>
        <div><dt>Year</dt><dd>${year}</dd></div>
      </dl>
      <h2>Labour</h2>
      <dl class="detail-list">
        <div><dt>Budget</dt><dd>${usage.budget.toFixed(0)} hours</dd></div>
        <div><dt>Used</dt><dd>${usage.used.toFixed(1)} hours</dd></div>
        <div><dt>Daily Capacity</dt><dd>${LABOUR.HOURS_PER_DAY} hours</dd></div>
        <div><dt>Planned Jobs</dt><dd>${planned}</dd></div>
        <div><dt>Completed</dt><dd>${completed}</dd></div>
      </dl>
      <h2>Soil Condition</h2>
      <dl class="detail-list">
        <div><dt>Humus</dt><dd>${humusPct}%</dd></div>
        <div><dt>Field stress</dt><dd>${stressLabel} (${stressPct}%)</dd></div>
      </dl>
    </section>
  `;
}

function plannerStatusLabel(status) {
  switch (status) {
    case 'queued':
      return 'Scheduled';
    case 'completed':
      return 'Completed';
    case 'working':
      return 'In progress';
    case 'skipped':
      return 'Skipped';
    case 'unscheduled':
      return 'Not scheduled';
    case 'overdue':
      return 'Overdue';
    case 'planned':
      return 'Planned';
    default:
      return 'Planned';
  }
}

function renderPlannerPanel() {
  const month = state.world.calendar.month;
  const monthIndex = state.world.calendar.monthIndex ?? 0;
  const rows = state.monthJobs.map((job) => {
    const status = state.jobStatus.get(job.id) ?? 'planned';
    const prereqs = Array.isArray(job.prerequisites) && job.prerequisites.length > 0
      ? job.prerequisites
        .map((p) => {
          const ref = JOB_LOOKUP.get(p);
          const text = ref?.label ?? ref?.kind ?? p;
          return `<span class="badge">${escapeHtml(text)}</span>`;
        })
        .join('')
      : '<span class="badge empty">None</span>';
    const hoursLabel = Number.isFinite(job.hours) ? job.hours.toFixed(1) : '—';
    const acresLabel = Number.isFinite(job.acres) ? job.acres.toFixed(1) : '—';
    const label = job.label ?? job.operation ?? job.kind;
    const parcel = state.lookup?.parcels?.[job.field] || state.lookup?.closes?.[job.field];
    const fieldLabel = parcel ? labelFor(parcel, monthIndex) : (job.field ?? '—');
    const windowLabel = Array.isArray(job.window) ? escapeHtml(job.window.join('–')) : '—';
    return `
      <tr class="${escapeHtml(status)}">
        <td>${escapeHtml(fieldLabel)}</td>
        <td>${escapeHtml(label)}</td>
        <td>${windowLabel}</td>
        <td class="numeric">${acresLabel}</td>
        <td class="numeric">${hoursLabel}</td>
        <td>${prereqs}</td>
        <td>${escapeHtml(plannerStatusLabel(status))}</td>
      </tr>
    `;
  }).join('');
  return `
    <section>
      <h2>Month ${escapeHtml(month)} Planner</h2>
      <table class="panel-table planner-table">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Operation</th>
            <th scope="col">Window</th>
            <th scope="col" class="numeric">Acres</th>
            <th scope="col" class="numeric">Hours</th>
            <th scope="col">Prerequisites</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
  `;
}

function renderInventoryPanel() {
  const entries = Object.entries(state.world.store ?? {});
  const rows = entries.map(([key, value]) => {
    let display;
    if (value && typeof value === 'object') {
      const parts = Object.entries(value).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`);
      display = parts.join(', ');
    } else {
      display = escapeHtml(value);
    }
    return `<tr><th scope="row">${escapeHtml(key)}</th><td class="numeric">${display}</td></tr>`;
  }).join('');
  return `
    <section>
      <h2>Stores</h2>
      <table class="panel-table"><tbody>${rows}</tbody></table>
    </section>
  `;
}

function describeSoilStatus(parcel) {
  if (!parcel) return '—';
  const moisture = Number.isFinite(parcel.soil?.moisture)
    ? `${Math.round(parcel.soil.moisture * 100)}%`
    : null;
  const nitrogen = Number.isFinite(parcel.soil?.nitrogen)
    ? `${Math.round(parcel.soil.nitrogen * 100)}%`
    : null;
  const organic = Number.isFinite(parcel.soil?.organic)
    ? `${Math.round(parcel.soil.organic * 100)}%`
    : null;
  const drought = parcel.status?.droughtStress ?? 0;
  const flood = parcel.status?.waterlogging ?? 0;
  const trend = parcel.status?.soilOrganicTrend ?? 0;
  const tags = [];
  if (moisture) tags.push(`Moist ${moisture}`);
  if (nitrogen) tags.push(`N ${nitrogen}`);
  if (organic) tags.push(`Humus ${organic}`);
  if (drought > 0.35) tags.push('Dry stress');
  if (flood > 0.35) tags.push('Waterlogged');
  if (trend > 0.01) tags.push('Humus rising');
  else if (trend < -0.01) tags.push('Humus falling');
  return tags.length ? tags.join(' • ') : '—';
}

function renderParcelsPanel() {
  const parcels = Array.isArray(state.world.parcels) ? state.world.parcels : [];
  const monthIndex = state.world.calendar?.monthIndex ?? 0;
  const stageLabel = (parcel) => {
    const stage = stageNow(parcel, monthIndex);
    if (typeof stage === 'string' && stage.length > 0) return stage.replaceAll('_', ' ');
    return parcel?.crop ?? '—';
  };
  const fieldRows = parcels
    .filter((parcel) => parcel.kind === PARCEL_KIND.ARABLE)
    .map((parcel) => (
      `<tr><th scope="row">${escapeHtml(labelFor(parcel, monthIndex))}</th>` +
      `<td>${escapeHtml(stageLabel(parcel))}</td>` +
      `<td>${escapeHtml(parcel.phase ?? '—')}</td>` +
      `<td>${escapeHtml(describeSoilStatus(parcel))}</td></tr>`
    ))
    .join('');
  const closeRows = parcels
    .filter((parcel) => parcel.kind === PARCEL_KIND.CLOSE)
    .map((parcel) => (
      `<tr><th scope="row">${escapeHtml(labelFor(parcel, monthIndex))}</th>` +
      `<td>${escapeHtml(stageLabel(parcel))}</td>` +
      `<td>${escapeHtml(parcel.phase ?? '—')}</td>` +
      `<td>${escapeHtml(describeSoilStatus(parcel))}</td></tr>`
    ))
    .join('');
  return `
    <section>
      <h2>Fields</h2>
      <table class="panel-table"><thead><tr><th>Field</th><th>Stage</th><th>Phase</th><th>Soil</th></tr></thead><tbody>${fieldRows}</tbody></table>
      <h2>Closes</h2>
      <table class="panel-table"><thead><tr><th>Close</th><th>Stage</th><th>Phase</th><th>Soil</th></tr></thead><tbody>${closeRows}</tbody></table>
    </section>
  `;
}

function renderMessagesPanel() {
  if (!Array.isArray(state.world.completedJobs) || state.world.completedJobs.length === 0) {
    return '<p>No work completed yet this month.</p>';
  }
  const monthIndex = state.world.calendar.monthIndex ?? 0;
  const items = state.world.completedJobs.map((job) => {
    const parcel = state.lookup?.parcels?.[job.field] || state.lookup?.closes?.[job.field];
    const label = parcel ? labelFor(parcel, monthIndex) : (job.field ?? 'estate');
    return `<li><strong>${escapeHtml(job.kind)}</strong> on ${escapeHtml(label)}</li>`;
  }).join('');
  return `
    <section>
      <h2>Recent Work</h2>
      <ul class="panel-list">${items}</ul>
    </section>
  `;
}

function renderControlsPanel() {
  return `
    <section>
      <h2>Controls</h2>
      <p>Time flows continuously. Use the speed slider or preset buttons to pause, slow, or accelerate the simulation.</p>
      <p>The planner lists acre-scaled tasks with their prerequisites. Market trips only appear when the farm needs to trade.</p>
    </section>
  `;
}

const PANEL_RENDERERS = {
  overview: renderOverviewPanel,
  planner: renderPlannerPanel,
  inventory: renderInventoryPanel,
  parcels: renderParcelsPanel,
  messages: renderMessagesPanel,
  controls: renderControlsPanel,
};

function setActivePanel(panel) {
  if (!panel) return;
  const changed = state.activePanel !== panel;
  state.activePanel = panel;
  if (DOM.menu) {
    const buttons = DOM.menu.querySelectorAll('button[data-panel]');
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.panel === panel);
    });
  }
  if (changed) {
    renderPanel();
  }
}

function renderPanel() {
  if (!DOM.panelContent) return;
  const renderer = PANEL_RENDERERS[state.activePanel] || (() => '<p>Coming soon.</p>');
  DOM.panelContent.innerHTML = renderer();
}

function renderAll() {
  renderHud();
  renderScreen();
  renderPanel();
}

function handleSimulationTick(deltaSimMin, nowSimMin) {
  if (!state.world) return;
  if (!state.engine) state.engine = createEngineState(state.world);
  if (!Number.isFinite(deltaSimMin) || deltaSimMin <= 0) return;

  const previous = state.world.calendar ? { ...state.world.calendar } : null;
  syncSimTime(nowSimMin);
  const calendar = getSimTime();
  const dayChanged =
    !previous || previous.day !== calendar.day || previous.month !== calendar.month || previous.year !== calendar.year;

  state.world.calendar = { ...calendar };
  state.engine.world = state.world;

  if (dayChanged) {
    updateWorldDaylight();
  }

  ensureMonthPrepared();
  runEngineTick(state.engine, deltaSimMin);
  updateLabourState();
  refreshJobStatus();
  renderAll();
}

function boot() {
  selectDom();
  initEvents();
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (ev) => {
      const target = ev.target;
      if (isTextInput(target)) return;
      const key = ev.key;

      if (key === 'Escape') {
        if (isDrawerOpen()) {
          setDrawerOpen(false);
          ev.preventDefault();
        }
        return;
      }

      if (key === 'm' || key === 'M') {
        toggleDrawer();
        ev.preventDefault();
        return;
      }

      let dx = 0;
      let dy = 0;
      switch (key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          dy = -1;
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          dy = 1;
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          dx = -1;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          dx = 1;
          break;
        default:
          break;
      }
      if (dx !== 0 || dy !== 0) {
        ev.preventDefault();
        const multiplier = ev.shiftKey ? 2 : 1;
        panCamera(dx, dy, multiplier);
      }
    });
  }
  initWorld();
  renderAll();
  setActivePanel(state.activePanel);
  bindClock(clock);
  clock.onTick(handleSimulationTick);
  initSpeedControls();
  if (typeof window !== 'undefined') {
    clock.start();
  }
}

export { initEvents, DOM };

document.addEventListener('DOMContentLoaded', boot);
