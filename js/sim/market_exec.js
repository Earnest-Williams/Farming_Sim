const SPECIAL_ITEM_PATHS = {
  meat_lb: ['meat_salted'],
  bacon_side: ['bacon_sides'],
};

function pathForItem(item) {
  if (!item) return [item];
  if (SPECIAL_ITEM_PATHS[item]) return SPECIAL_ITEM_PATHS[item];
  if (item.startsWith('seed_')) {
    const withoutSeed = item.slice(5);
    const normalized = withoutSeed.endsWith('_bu')
      ? withoutSeed.slice(0, -3)
      : withoutSeed;
    return ['seed', normalized];
  }
  if (item.endsWith('_bu')) return [item.slice(0, -3)];
  if (item.endsWith('_t')) return [item.slice(0, -2)];
  if (item.endsWith('_lb')) return [item.slice(0, -3)];
  return [item];
}

function cloneInventory(inventory = {}) {
  const base = { ...inventory };
  const seed = inventory?.seed;
  base.seed = typeof seed === 'object' && seed !== null ? { ...seed } : {};
  return base;
}

function getQty(inventory, item) {
  const path = pathForItem(item);
  let cursor = inventory;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return 0;
    cursor = cursor[key];
  }
  return Number.isFinite(cursor) ? cursor : 0;
}

function setQty(inventory, item, value) {
  const path = pathForItem(item);
  if (!path.length) return;
  let cursor = inventory;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  const lastKey = path[path.length - 1];
  cursor[lastKey] = value;
}

function normaliseOps(manifest) {
  if (!manifest) return [];
  if (Array.isArray(manifest)) return manifest.filter((op) => op && Number.isFinite(op.qty) && op.qty !== 0);
  const ops = [];
  const sell = Array.isArray(manifest.sell) ? manifest.sell : [];
  const buy = Array.isArray(manifest.buy) ? manifest.buy : [];
  for (const line of sell) {
    if (!line) continue;
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const unitPrice = Number(line.unitPrice);
    ops.push({ kind: 'sell', item: line.item, qty, unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0 });
  }
  for (const line of buy) {
    if (!line) continue;
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const unitPrice = Number(line.unitPrice);
    ops.push({ kind: 'buy', item: line.item, qty, unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0 });
  }
  return ops;
}

export function simulateManifest(inventory, cash, manifest) {
  const ops = normaliseOps(manifest);
  const tmpInv = cloneInventory(inventory || {});
  let tmpCash = Number.isFinite(cash) ? cash : 0;

  const sells = ops.filter((op) => op.kind === 'sell');
  const buys = ops.filter((op) => op.kind === 'buy');

  for (const op of sells) {
    const qty = Number(op.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const have = getQty(tmpInv, op.item);
    if (have + 1e-9 < qty) {
      return { ok: false, reason: `insufficient ${op.item} to sell (${have} < ${qty})` };
    }
  }

  for (const op of sells) {
    const qty = Number(op.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const have = getQty(tmpInv, op.item);
    setQty(tmpInv, op.item, have - qty);
    const price = Number(op.unitPrice);
    if (Number.isFinite(price)) {
      tmpCash += qty * price;
    }
  }

  for (const op of buys) {
    const qty = Number(op.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const price = Number(op.unitPrice) || 0;
    const cost = qty * price;
    if (tmpCash + 1e-9 < cost) {
      return { ok: false, reason: `insufficient cash (${tmpCash} < ${cost})` };
    }
    tmpCash -= cost;
    const have = getQty(tmpInv, op.item);
    setQty(tmpInv, op.item, have + qty);
  }

  return { ok: true, nextInventory: tmpInv, nextCash: tmpCash };
}

export function applyManifest(state, manifest) {
  if (!state) return { ok: false, reason: 'missing state' };
  const { ok, nextInventory, nextCash, reason } = simulateManifest(state.store, state.cash, manifest);
  if (!ok) return { ok, reason };
  state.store = nextInventory;
  state.cash = nextCash;
  if (state.finance && typeof state.finance === 'object') {
    state.finance.cash = nextCash;
  }
  return { ok: true };
}

export function operationsToSummary(manifest) {
  const ops = normaliseOps(manifest);
  const summary = { sell: [], buy: [] };
  for (const op of ops) {
    const entry = { item: op.item, qty: op.qty, unitPrice: op.unitPrice };
    if (op.kind === 'sell') summary.sell.push(entry);
    else if (op.kind === 'buy') summary.buy.push(entry);
  }
  return summary;
}
