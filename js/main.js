import { createInitialWorld, recordJobCompletion } from './world.js';
import {
  resetTime,
  getSimTime,
  advanceSimMinutes,
  MINUTES_PER_DAY,
  formatSimTime,
} from './time.js';
import {
  resetLabour,
  consume,
  getLabourUsage,
  LABOUR,
  labourBudgetForMonth,
} from './labour.js';
import { generateMonthJobs } from './plan.js';
import { scheduleMonth } from './scheduler.js';

const state = {
  world: null,
  monthJobs: [],
  jobStatus: new Map(),
  scheduleQueue: [],
  scheduleUsage: { used: 0, budget: labourBudgetForMonth() },
  activePanel: 'overview',
};

const DOM = {};

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function selectDom() {
  DOM.screen = document.getElementById('screen');
  DOM.messageStack = document.getElementById('message-stack');
  DOM.drawer = document.getElementById('info-drawer');
  DOM.menuToggle = document.getElementById('menu-toggle');
  DOM.followToggle = document.getElementById('follow-toggle');
  DOM.menu = document.getElementById('menu');
  DOM.panelContent = document.getElementById('panel-content');
  DOM.advanceDay = document.getElementById('advance-day');
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
      const pressed = DOM.followToggle.getAttribute('aria-pressed') === 'true';
      DOM.followToggle.setAttribute('aria-pressed', pressed ? 'false' : 'true');
    });
  }

  if (DOM.menu) {
    DOM.menu.addEventListener('click', (ev) => {
      const button = ev.target.closest('button[data-panel]');
      if (!button) return;
      setActivePanel(button.dataset.panel);
    });
  }

  if (DOM.advanceDay) {
    DOM.advanceDay.addEventListener('click', advanceDay);
  }
}

function updateLabourState() {
  const usage = getLabourUsage();
  state.world.labour = { ...usage };
  return usage;
}

function prepareMonth(month, { resetBudget = false } = {}) {
  if (resetBudget) {
    resetLabour(month);
    state.world.completedJobs = [];
  }
  const usage = updateLabourState();
  state.monthJobs = generateMonthJobs(state.world, month);
  state.jobStatus = new Map();
  state.monthJobs.forEach((job) => {
    state.jobStatus.set(job.id, 'generated');
  });
  const { selected, used, budget } = scheduleMonth(state.world, month, state.monthJobs);
  state.scheduleQueue = selected.map((job) => ({ job, status: 'queued' }));
  const scheduledIds = new Set(selected.map((job) => job.id));
  state.monthJobs.forEach((job) => {
    if (scheduledIds.has(job.id)) {
      state.jobStatus.set(job.id, 'queued');
    } else {
      state.jobStatus.set(job.id, 'unscheduled');
    }
  });
  state.scheduleUsage = { used, budget, plannedMonth: month };
  state.world.labour = { ...usage };
}

function initWorld() {
  resetTime();
  state.world = createInitialWorld();
  resetLabour(state.world.calendar.month);
  updateLabourState();
  prepareMonth(state.world.calendar.month, { resetBudget: true });
}

function nextQueuedEntry() {
  return state.scheduleQueue.find((entry) => entry.status === 'queued');
}

function runJobEntry(entry) {
  const job = entry.job;
  if (!job) return;
  if (!job.canApply(state.world)) {
    entry.status = 'skipped';
    state.jobStatus.set(job.id, 'skipped');
    return;
  }
  entry.status = 'working';
  job.apply(state.world);
  recordJobCompletion(state.world, job);
  consume(job.hours);
  updateLabourState();
  state.jobStatus.set(job.id, 'completed');
  entry.status = 'completed';
  advanceSimMinutes(job.hours * 60);
  state.world.calendar = { ...getSimTime() };
}

function advanceDay() {
  const startMonth = state.world.calendar.month;
  let worked = 0;
  while (worked < LABOUR.HOURS_PER_DAY) {
    const entry = nextQueuedEntry();
    if (!entry) break;
    runJobEntry(entry);
    worked += entry.job.hours;
  }
  const current = getSimTime();
  const minutesToday = current.minute;
  if (minutesToday > 0) {
    advanceSimMinutes(MINUTES_PER_DAY - minutesToday);
  } else {
    advanceSimMinutes(MINUTES_PER_DAY);
  }
  state.world.calendar = { ...getSimTime() };
  updateLabourState();
  if (state.world.calendar.month !== startMonth) {
    prepareMonth(state.world.calendar.month, { resetBudget: true });
  }
  renderAll();
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
  if (!DOM.screen) return;
  const lines = [];
  const { month, day, year } = state.world.calendar;
  lines.push(`Season: Month ${month} · Day ${day} · Year ${year}`);
  lines.push('');
  lines.push('Fields:');
  state.world.fields.forEach((field) => {
    lines.push(`  ${field.key.padEnd(14)} | ${String(field.crop).padEnd(18)} | ${field.phase}`);
  });
  lines.push('');
  lines.push('Closes:');
  state.world.closes.forEach((close) => {
    lines.push(`  ${close.key.padEnd(14)} | ${String(close.crop).padEnd(18)} | ${close.phase}`);
  });
  lines.push('');
  lines.push('Livestock:');
  Object.entries(state.world.livestock)
    .filter(([key]) => key !== 'where')
    .forEach(([kind, count]) => {
      const location = state.world.livestock.where?.[kind] ?? 'yard';
      lines.push(`  ${kind.padEnd(12)} : ${String(count).padStart(2)} head · at ${location}`);
    });
  DOM.screen.textContent = lines.join('\n');
}

function renderOverviewPanel() {
  const usage = getLabourUsage();
  const { month, day, year, minute } = state.world.calendar;
  const hours = Math.floor(minute / 60);
  const mins = minute % 60;
  const planned = state.scheduleQueue.filter((e) => e.status === 'queued').length;
  const completed = state.scheduleQueue.filter((e) => e.status === 'completed').length;
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
    case 'skipped':
      return 'Skipped';
    case 'unscheduled':
      return 'Not scheduled';
    default:
      return 'Planned';
  }
}

function renderPlannerPanel() {
  const month = state.world.calendar.month;
  const rows = state.monthJobs.map((job) => {
    const status = state.jobStatus.get(job.id) ?? 'planned';
    const prereqs = Array.isArray(job.prerequisites) && job.prerequisites.length > 0
      ? job.prerequisites.map((p) => `<span class="badge">${escapeHtml(p)}</span>`).join('')
      : '<span class="badge empty">None</span>';
    const hoursLabel = job.hours ? job.hours.toFixed(1) : '—';
    const acresLabel = job.acres ? job.acres.toFixed(1) : '—';
    return `
      <tr class="${escapeHtml(status)}">
        <td>${escapeHtml(job.field ?? '—')}</td>
        <td>${escapeHtml(job.operation ?? job.kind)}</td>
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
  const rows = Object.entries(state.world.stores).map(([key, value]) => (
    `<tr><th scope="row">${escapeHtml(key)}</th><td class="numeric">${escapeHtml(value)}</td></tr>`
  )).join('');
  return `
    <section>
      <h2>Stores</h2>
      <table class="panel-table"><tbody>${rows}</tbody></table>
    </section>
  `;
}

function renderParcelsPanel() {
  const fieldRows = state.world.fields.map((field) => (
    `<tr><th scope="row">${escapeHtml(field.key)}</th><td>${escapeHtml(field.crop)}</td><td>${escapeHtml(field.phase)}</td></tr>`
  )).join('');
  const closeRows = state.world.closes.map((close) => (
    `<tr><th scope="row">${escapeHtml(close.key)}</th><td>${escapeHtml(close.crop)}</td><td>${escapeHtml(close.phase)}</td></tr>`
  )).join('');
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
      <p>Use <strong>Advance Day</strong> to consume labour and progress field work according to the monthly schedule.</p>
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

function boot() {
  selectDom();
  initEvents();
  initWorld();
  renderAll();
  setActivePanel(state.activePanel);
}

document.addEventListener('DOMContentLoaded', boot);
