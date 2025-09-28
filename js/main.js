import { createInitialWorld } from './world.js';
import { renderColored, flushLine } from './render.js';
import {
  resetTime,
  getSimTime,
  advanceSimMinutes,
  MINUTES_PER_DAY,
  formatSimTime,
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
} from './scheduler.js';
import { initSpeedControls } from './ui/speed.js';
import { minutesToAdvance } from './timeflow.js';
import { PARCEL_KIND, CONFIG } from './constants.js';
import { CONFIG_PACK_V1 } from './config/pack_v1.js';
import { clamp } from './utils.js';
import { assertConfigCompleteness } from './config/guards.js';

assertConfigCompleteness();

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

let rafHandle = null;
let lastFrameTime = null;
let simMinuteBacklog = 0;

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
}

function initEvents() {
  if (DOM.menuToggle) {
    DOM.menuToggle.addEventListener('click', () => {
      const hidden = DOM.drawer.hasAttribute('hidden');
      if (hidden) {
        DOM.drawer.removeAttribute('hidden');
      } else {
        DOM.drawer.setAttribute('hidden', '');
      }
      DOM.menuToggle.setAttribute('aria-expanded', hidden ? 'true' : 'false');
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
    });
  }
}

function updateLabourState() {
  const usage = getLabourUsage();
  state.world.labour = { ...state.world.labour, ...usage };
  return usage;
}

function computeJobStatus(job) {
  if (!job) return 'planned';
  const engine = state.engine;
  const calendar = state.world?.calendar ?? {};
  const currentMonth = calendar.month ?? 1;
  const monthIdx = monthIndexFromLabel(currentMonth);
  const startIdx = monthIndexFromLabel(job.window?.[0] ?? currentMonth);
  const endIdx = monthIndexFromLabel(job.window?.[1] ?? currentMonth);
  const doneSet = engine?.progress?.done instanceof Set ? engine.progress.done : new Set();
  if (doneSet.has(job.id)) return 'completed';
  if (monthIdx > endIdx) return 'overdue';
  if (!engine) return 'planned';
  if (monthIdx < startIdx) return 'planned';
  if (!prerequisitesMet(engine, job)) return 'planned';
  if (!guardAllows(engine, job)) return 'unscheduled';
  if (engine.currentTask?.definition?.id === job.id) return 'working';
  if (inWindow(engine, job.window)) return 'queued';
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
  const usage = updateLabourState();
  state.monthJobs = generateMonthJobs(state.world, month);
  refreshJobStatus();
  state.world.labour = { ...usage };
  state.lastPreparedMonth = month;
}

function initWorld() {
  resetTime();
  state.world = createInitialWorld();
  state.engine = createEngineState(state.world);
  updateFollowToggleLabel(state.world.camera?.follow !== false);
  resetLabour(state.world.calendar.month);
  updateLabourState();
  prepareMonth(state.world.calendar.month, { resetBudget: true });
  simMinuteBacklog = 0;
}

function ensureMonthPrepared() {
  const currentMonth = state.world?.calendar?.month;
  if (!currentMonth) return;
  if (state.lastPreparedMonth !== currentMonth) {
    prepareMonth(currentMonth, { resetBudget: true });
  }
}

function processDayWork() {
  ensureMonthPrepared();
  if (!state.engine) state.engine = createEngineState(state.world);
  state.engine.world = state.world;
  const dayBudgetSimMin = LABOUR.HOURS_PER_DAY * MINUTES_PER_HOUR;
  runEngineTick(state.engine, dayBudgetSimMin);
  updateLabourState();
  refreshJobStatus();
  state.world.calendar = { ...getSimTime() };
}

function stepSimulation(dtMs) {
  if (!state.world) return;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return;
  const minutes = minutesToAdvance(dtMs);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  simMinuteBacklog += minutes;
  const MIN_STEP = 1e-4;
  while (simMinuteBacklog >= MIN_STEP) {
    const current = getSimTime();
    const minutesToday = current.minute ?? 0;
    const actualRemaining = MINUTES_PER_DAY - minutesToday;
    const remainingToday = actualRemaining > MIN_STEP ? actualRemaining : MINUTES_PER_DAY;
    const step = Math.min(simMinuteBacklog, remainingToday);
    if (step < MIN_STEP) {
      break;
    }
    advanceSimMinutes(step);
    simMinuteBacklog -= step;
    const after = getSimTime();
    state.world.calendar = { ...after };
    if (actualRemaining <= step + MIN_STEP) {
      processDayWork();
    }
  }
}

function renderHud() {
  const { label, time } = formatSimTime();
  if (DOM.hudDate) DOM.hudDate.textContent = label;
  if (DOM.hudTime) DOM.hudTime.textContent = time;
  const usage = getLabourUsage();
  const labourLabel = `Labour: ${usage.used.toFixed(1)} / ${usage.budget} h`;
  if (DOM.hudLabour) DOM.hudLabour.textContent = labourLabel;
}

function renderScreen() {
  if (!DOM.screen || !state.world) return;
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
  const hours = Math.floor(minute / 60);
  const mins = minute % 60;
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
    const windowLabel = Array.isArray(job.window) ? escapeHtml(job.window.join('–')) : '—';
    return `
      <tr class="${escapeHtml(status)}">
        <td>${escapeHtml(job.field ?? '—')}</td>
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

function renderParcelsPanel() {
  const parcels = Array.isArray(state.world.parcels) ? state.world.parcels : [];
  const fieldRows = parcels
    .filter((parcel) => parcel.kind === PARCEL_KIND.ARABLE)
    .map((parcel) => (
      `<tr><th scope="row">${escapeHtml(parcel.name ?? parcel.key)}</th>` +
      `<td>${escapeHtml(parcel.crop ?? '—')}</td>` +
      `<td>${escapeHtml(parcel.phase ?? '—')}</td></tr>`
    ))
    .join('');
  const closeRows = parcels
    .filter((parcel) => parcel.kind === PARCEL_KIND.CLOSE)
    .map((parcel) => (
      `<tr><th scope="row">${escapeHtml(parcel.name ?? parcel.key)}</th>` +
      `<td>${escapeHtml(parcel.crop ?? '—')}</td>` +
      `<td>${escapeHtml(parcel.phase ?? '—')}</td></tr>`
    ))
    .join('');
  return `
    <section>
      <h2>Fields</h2>
      <table class="panel-table"><thead><tr><th>Field</th><th>Crop</th><th>Phase</th></tr></thead><tbody>${fieldRows}</tbody></table>
      <h2>Closes</h2>
      <table class="panel-table"><thead><tr><th>Close</th><th>Crop</th><th>Phase</th></tr></thead><tbody>${closeRows}</tbody></table>
    </section>
  `;
}

function renderMessagesPanel() {
  if (!Array.isArray(state.world.completedJobs) || state.world.completedJobs.length === 0) {
    return '<p>No work completed yet this month.</p>';
  }
  const items = state.world.completedJobs.map((job) => (
    `<li><strong>${escapeHtml(job.kind)}</strong> on ${escapeHtml(job.field ?? 'estate')}</li>`
  )).join('');
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

function startLoop() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return;
  }
  if (rafHandle != null) {
    window.cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  lastFrameTime = null;
  const frame = (now) => {
    if (lastFrameTime == null) {
      lastFrameTime = now;
    }
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    stepSimulation(dt);
    renderAll();
    rafHandle = window.requestAnimationFrame(frame);
  };
  rafHandle = window.requestAnimationFrame(frame);
}

function boot() {
  selectDom();
  initEvents();
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (ev) => {
      const target = ev.target;
      if (isTextInput(target)) return;
      let dx = 0;
      let dy = 0;
      switch (ev.key) {
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
  initSpeedControls();
  startLoop();
}

document.addEventListener('DOMContentLoaded', boot);
