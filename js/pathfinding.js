import { CONFIG, HOUSE, BYRE } from './constants.js';

let Pathfinding = null;

function hasLibrary() {
  return !!(Pathfinding && typeof Pathfinding.Grid === 'function' && typeof Pathfinding.AStarFinder === 'function');
}

function normalizeRect(rect, width, height) {
  if (!rect) return null;
  const rawX = Number.isFinite(rect.x) ? rect.x : 0;
  const rawY = Number.isFinite(rect.y) ? rect.y : 0;
  const rawW = Number.isFinite(rect.w) ? rect.w : 0;
  const rawH = Number.isFinite(rect.h) ? rect.h : 0;
  const startX = Math.max(0, Math.floor(rawX));
  const startY = Math.max(0, Math.floor(rawY));
  const endX = Math.max(startX, Math.min(width, Math.floor(rawX + rawW)));
  const endY = Math.max(startY, Math.min(height, Math.floor(rawY + rawH)));
  if (startX >= endX || startY >= endY) return null;
  return { startX, startY, endX, endY };
}

function applyWalkableRect(grid, rect, walkable, width, height) {
  const bounds = normalizeRect(rect, width, height);
  if (!bounds) return;
  for (let y = bounds.startY; y < bounds.endY; y++) {
    for (let x = bounds.startX; x < bounds.endX; x++) {
      grid.setWalkableAt(x, y, walkable);
    }
  }
}

function normalizePoint(point, width, height) {
  if (!point) return null;
  let x;
  let y;
  if (typeof point.x === 'number' && typeof point.y === 'number') {
    x = Math.round(point.x);
    y = Math.round(point.y);
  } else if (Array.isArray(point) && point.length >= 2) {
    x = Math.round(point[0]);
    y = Math.round(point[1]);
  } else {
    return null;
  }
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return { x, y };
}

export function initPathfinding(pathfinding) {
  if (pathfinding && typeof pathfinding === 'object') {
    if (typeof pathfinding.Grid === 'function' && typeof pathfinding.AStarFinder === 'function') {
      Pathfinding = pathfinding;
      return;
    }
  }
  Pathfinding = null;
  if (pathfinding != null) {
    console.warn('Pathfinding library missing required interfaces.');
  }
}

export function createGrid(world) {
  if (!hasLibrary()) return null;
  const worldWidth = CONFIG.WORLD?.W ?? 210;
  const worldHeight = CONFIG.WORLD?.H ?? 100;
  const grid = new Pathfinding.Grid(worldWidth, worldHeight);

  const parcels = Array.isArray(world?.parcels) ? world.parcels : [];
  for (const parcel of parcels) {
    applyWalkableRect(grid, parcel, true, worldWidth, worldHeight);
  }

  const houseRect = HOUSE ?? CONFIG.HOUSE ?? null;
  if (houseRect) {
    applyWalkableRect(grid, houseRect, false, worldWidth, worldHeight);
  }

  const byreRect = BYRE ?? CONFIG.BYRE ?? null;
  if (byreRect) {
    applyWalkableRect(grid, byreRect, false, worldWidth, worldHeight);
  }

  const fences = Array.isArray(world?.fences) ? world.fences : [];
  for (const fence of fences) {
    applyWalkableRect(grid, fence, false, worldWidth, worldHeight);
  }

  return grid;
}

export function findPath(grid, start, end) {
  if (!hasLibrary() || !grid) return null;
  const width = grid.width ?? CONFIG.WORLD?.W ?? 210;
  const height = grid.height ?? CONFIG.WORLD?.H ?? 100;
  const startPoint = normalizePoint(start, width, height);
  const endPoint = normalizePoint(end, width, height);
  if (!startPoint || !endPoint) return null;
  if (!grid.isWalkableAt(endPoint.x, endPoint.y)) return null;

  try {
    const finder = new Pathfinding.AStarFinder({ allowDiagonal: false, dontCrossCorners: true });
    return finder.findPath(startPoint.x, startPoint.y, endPoint.x, endPoint.y, grid.clone());
  } catch (error) {
    console.warn('Pathfinding failed:', error);
    return null;
  }
}
