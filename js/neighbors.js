import { MINUTES_PER_DAY } from './time.js';
import { NEIGHBOR_FARMS } from './config/neighbors.js';

function cloneRect(rect) {
  if (!rect) return null;
  return {
    x: Number.isFinite(rect.x) ? rect.x : 0,
    y: Number.isFinite(rect.y) ? rect.y : 0,
    w: Number.isFinite(rect.w) ? rect.w : 0,
    h: Number.isFinite(rect.h) ? rect.h : 0,
  };
}

function clonePoint(point) {
  if (!point) return null;
  return {
    x: Number.isFinite(point.x) ? Math.round(point.x) : 0,
    y: Number.isFinite(point.y) ? Math.round(point.y) : 0,
  };
}

function clampMinute(minute) {
  if (!Number.isFinite(minute)) return 0;
  if (minute < 0) return 0;
  if (minute >= MINUTES_PER_DAY) return MINUTES_PER_DAY - 1;
  return Math.floor(minute);
}

function normalizeScheduleEntry(entry, bed, index) {
  const start = clampMinute(entry.start ?? 0);
  const rawDuration = Number.isFinite(entry.duration) ? Math.max(1, Math.floor(entry.duration)) : 60;
  const duration = Math.min(rawDuration, MINUTES_PER_DAY);
  const waypoints = Array.isArray(entry.waypoints) && entry.waypoints.length > 0
    ? entry.waypoints.map(clonePoint)
    : [clonePoint(bed)];
  return {
    id: entry.id || `chore_${index}`,
    label: entry.label || 'Chore',
    start,
    duration,
    end: Math.min(start + duration, MINUTES_PER_DAY),
    waypoints,
    loop: entry.loop !== false,
    linger: Number.isFinite(entry.linger) ? Math.max(0, Math.floor(entry.linger)) : 0,
  };
}

function ensureScheduleCoverage(schedule, bed) {
  if (!schedule.length) {
    schedule.push({
      id: 'rest',
      label: 'Resting',
      start: 0,
      duration: MINUTES_PER_DAY,
      end: MINUTES_PER_DAY,
      waypoints: [clonePoint(bed)],
      loop: false,
      linger: 0,
    });
    return schedule;
  }

  schedule.sort((a, b) => a.start - b.start);

  if (schedule[0].start > 0) {
    schedule.unshift({
      id: 'auto_rest_start',
      label: 'Resting',
      start: 0,
      duration: schedule[0].start,
      end: schedule[0].start,
      waypoints: [clonePoint(bed)],
      loop: false,
      linger: 0,
    });
  }

  const last = schedule[schedule.length - 1];
  const tailStart = last.start + last.duration;
  if (tailStart < MINUTES_PER_DAY) {
    schedule.push({
      id: 'auto_rest_end',
      label: 'Resting',
      start: tailStart,
      duration: MINUTES_PER_DAY - tailStart,
      end: MINUTES_PER_DAY,
      waypoints: [clonePoint(bed)],
      loop: false,
      linger: 0,
    });
  }

  return schedule;
}

function clonePlot(plot) {
  return {
    id: plot.id || null,
    name: plot.name || plot.label || '',
    type: plot.type || 'arable',
    crop: plot.crop || null,
    stage: Number.isFinite(plot.stage) ? Math.max(1, Math.min(5, Math.floor(plot.stage))) : null,
    x: Number.isFinite(plot.x) ? plot.x : 0,
    y: Number.isFinite(plot.y) ? plot.y : 0,
    w: Number.isFinite(plot.w) ? plot.w : 0,
    h: Number.isFinite(plot.h) ? plot.h : 0,
  };
}

function createNeighborFromTemplate(template) {
  const farmhouse = cloneRect(template.farmhouse);
  const barn = cloneRect(template.barn);
  const well = clonePoint(template.well);
  const bed = clonePoint(template.bed) || (farmhouse
    ? { x: farmhouse.x + Math.floor(farmhouse.w / 2), y: farmhouse.y + farmhouse.h - 2 }
    : { x: 0, y: 0 });

  const schedule = ensureScheduleCoverage(
    (Array.isArray(template.schedule) ? template.schedule : []).map((entry, idx) => normalizeScheduleEntry(entry, bed, idx)),
    bed,
  );

  const farmer = {
    name: template.farmerName || 'Neighbor',
    x: bed.x,
    y: bed.y,
    task: schedule.length ? schedule[0].label : 'Resting',
    holdMin: 0,
  };

  return {
    id: template.id || `neighbor_${Math.random().toString(16).slice(2)}`,
    name: template.name || template.label || 'Neighbor Farm',
    farmerName: template.farmerName || 'Neighbor',
    farmhouse,
    barn,
    well,
    bed,
    home: { ...bed },
    plots: Array.isArray(template.plots) ? template.plots.map(clonePlot) : [],
    schedule,
    farmer,
    currentChoreId: null,
    nextWaypointIndex: 0,
    _lastMinute: null,
  };
}

function ensureFarmer(neighbor) {
  if (!neighbor.farmer) {
    neighbor.farmer = {
      name: neighbor.farmerName || 'Neighbor',
      x: neighbor.home?.x ?? 0,
      y: neighbor.home?.y ?? 0,
      task: 'Resting',
      holdMin: 0,
    };
  }
  return neighbor.farmer;
}

function resetNeighbor(neighbor) {
  const farmer = ensureFarmer(neighbor);
  farmer.x = neighbor.home?.x ?? 0;
  farmer.y = neighbor.home?.y ?? 0;
  farmer.task = 'Resting';
  farmer.holdMin = 0;
  neighbor.currentChoreId = null;
  neighbor.nextWaypointIndex = 0;
  neighbor._lastMinute = null;
}

function resolveChoreAtMinute(neighbor, minute) {
  const schedule = neighbor.schedule;
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const m = clampMinute(minute);
  for (let i = schedule.length - 1; i >= 0; i -= 1) {
    const entry = schedule[i];
    if (m >= entry.start && m < entry.end) return entry;
  }
  return schedule[schedule.length - 1];
}

function moveOneStep(actor, target) {
  if (!actor || !target) return false;
  if (actor.x === target.x && actor.y === target.y) return true;
  if (actor.x !== target.x) {
    actor.x += actor.x < target.x ? 1 : -1;
  } else if (actor.y !== target.y) {
    actor.y += actor.y < target.y ? 1 : -1;
  }
  return actor.x === target.x && actor.y === target.y;
}

function updateNeighborAtMinute(neighbor, minute) {
  const farmer = ensureFarmer(neighbor);
  const chore = resolveChoreAtMinute(neighbor, minute);
  if (!chore) return;

  if (neighbor.currentChoreId !== chore.id) {
    neighbor.currentChoreId = chore.id;
    neighbor.nextWaypointIndex = 0;
    farmer.task = chore.label || 'Working';
    farmer.holdMin = 0;
  }

  const points = chore.waypoints?.length ? chore.waypoints : [neighbor.home];
  if (!points?.length) return;

  if (farmer.holdMin > 0) {
    farmer.holdMin -= 1;
    return;
  }

  const idx = Math.max(0, Math.min(neighbor.nextWaypointIndex, points.length - 1));
  const target = points[idx] || points[0];
  const arrived = moveOneStep(farmer, target);
  if (arrived) {
    farmer.holdMin = chore.linger || 0;
    if (chore.loop) {
      neighbor.nextWaypointIndex = (idx + 1) % points.length;
    } else if (idx < points.length - 1) {
      neighbor.nextWaypointIndex = idx + 1;
    }
  }
}

function advanceNeighbor(neighbor, minute, { fromStart = false } = {}) {
  const target = clampMinute(minute);
  if (fromStart) {
    resetNeighbor(neighbor);
    for (let m = 0; m <= target; m += 1) updateNeighborAtMinute(neighbor, m);
    neighbor._lastMinute = target;
    return;
  }

  const last = Number.isFinite(neighbor._lastMinute) ? neighbor._lastMinute : null;
  if (last == null) {
    resetNeighbor(neighbor);
    for (let m = 0; m <= target; m += 1) updateNeighborAtMinute(neighbor, m);
  } else if (target < last) {
    resetNeighbor(neighbor);
    for (let m = 0; m <= target; m += 1) updateNeighborAtMinute(neighbor, m);
  } else if (target > last) {
    for (let m = last + 1; m <= target; m += 1) updateNeighborAtMinute(neighbor, m);
  }
  neighbor._lastMinute = target;
}

export function createNeighborStates() {
  return NEIGHBOR_FARMS.map(createNeighborFromTemplate);
}

export function stepNeighborFarms(world) {
  if (!world || !Array.isArray(world.neighbors)) return;
  const minute = clampMinute(world?.calendar?.minute ?? 0);
  for (const neighbor of world.neighbors) {
    advanceNeighbor(neighbor, minute);
  }
}

export function neighborsDailyTurn(world) {
  if (!world || !Array.isArray(world.neighbors)) return;
  for (const neighbor of world.neighbors) {
    resetNeighbor(neighbor);
    updateNeighborAtMinute(neighbor, 0);
    neighbor._lastMinute = 0;
  }
}

export function syncNeighborsToTime(world) {
  if (!world || !Array.isArray(world.neighbors)) return;
  const minute = clampMinute(world?.calendar?.minute ?? 0);
  for (const neighbor of world.neighbors) {
    advanceNeighbor(neighbor, minute, { fromStart: true });
  }
}
