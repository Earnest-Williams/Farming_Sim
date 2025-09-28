const RESOURCE_MAP = Object.freeze({
  cash: { path: ['cash'] },
  turnips: { path: ['store', 'turnips'] },
  seed_barley: { path: ['store', 'seed', 'barley'] },
  seed_oats: { path: ['store', 'seed', 'oats'] },
  seed_pulses: { path: ['store', 'seed', 'pulses'] },
});

function resolveContainer(root, path, create = false) {
  let target = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!target) return null;
    const key = path[i];
    if (!(key in target)) {
      if (!create) return null;
      target[key] = {};
    }
    target = target[key];
  }
  return target;
}

function getResourceSlot(world, key, { create = false } = {}) {
  const mapping = RESOURCE_MAP[key];
  if (!mapping) return null;
  const container = resolveContainer(world, mapping.path, create);
  if (!container) return null;
  const finalKey = mapping.path[mapping.path.length - 1];
  return { container, finalKey };
}

export function readResource(world, key) {
  if (!world) return 0;
  const slot = getResourceSlot(world, key, { create: false });
  if (!slot) return 0;
  const value = slot.container[slot.finalKey];
  return Number.isFinite(value) ? value : 0;
}

export function canFulfillResources(world, deltas) {
  if (!Array.isArray(deltas) || !deltas.length) return true;
  for (const delta of deltas) {
    if (!delta) continue;
    const qty = Number(delta.qty) || 0;
    if (qty >= 0) continue;
    const available = readResource(world, delta.key);
    if (available + qty < -1e-6) {
      return false;
    }
  }
  return true;
}

export function applyResourceDeltas(world, deltas) {
  if (!world || !Array.isArray(deltas)) return;
  for (const delta of deltas) {
    if (!delta) continue;
    const slot = getResourceSlot(world, delta.key, { create: true });
    if (!slot) continue;
    const current = Number(slot.container[slot.finalKey]) || 0;
    const qty = Number(delta.qty) || 0;
    slot.container[slot.finalKey] = current + qty;
  }
}

