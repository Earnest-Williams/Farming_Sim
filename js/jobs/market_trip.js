import { CONFIG_PACK_V1 } from '../config/pack_v1.js';
import { computeMarketManifest, needsMarketTrip } from '../market.js';
import { simulateManifest } from '../sim/market_exec.js';

function cloneLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter(Boolean)
    .map((line) => ({
      item: line.item,
      qty: line.qty,
      unitPrice: line.unitPrice,
      reason: line.reason,
    }));
}

function rememberManifest(world, request, gate) {
  if (!world || typeof world !== 'object') return;
  const market = world.market;
  if (!market || typeof market !== 'object') return;
  if (gate.ok) {
    market.nextManifestOps = gate.manifest;
    market.nextManifestSummary = gate.summary;
    market.nextManifestReason = gate.reason ?? null;
    market.nextManifestRequest = request;
  } else {
    market.nextManifestOps = gate.manifest ?? null;
    market.nextManifestSummary = gate.summary ?? null;
    market.nextManifestReason = gate.reason ?? null;
    market.nextManifestRequest = request;
  }
}

export function canScheduleMarketTrip(world, request = {}) {
  if (!world) {
    return { ok: false, reason: 'no world state', manifest: [], summary: { sell: [], buy: [] } };
  }
  const needs = needsMarketTrip(world, request);
  const needSummary = {
    sell: cloneLines(needs?.manifest?.sell),
    buy: cloneLines(needs?.manifest?.buy),
  };
  if (!needs?.ok) {
    let reason = 'market trip not needed';
    if (needs && needs.goodTrade === false) {
      reason = 'manifest value below trip threshold';
    } else if (needs && needs.cooldownOk === false) {
      reason = 'market trip on cooldown';
    } else if (needs?.reason) {
      reason = needs.reason;
    }
    const gate = {
      ok: false,
      reason,
      manifest: [],
      summary: needSummary,
      needs,
    };
    rememberManifest(world, request, gate);
    return gate;
  }
  const plan = computeMarketManifest(world, request);
  const manifest = Array.isArray(plan.manifest) ? plan.manifest.filter(Boolean) : [];
  if (!manifest.length) {
    const gate = { ok: false, reason: 'no market demand', manifest: [], summary: { sell: [], buy: [] } };
    rememberManifest(world, request, gate);
    return gate;
  }
  const manifestOps = manifest.map((op) => ({ ...op }));
  const sim = simulateManifest(world.store, world.cash, manifestOps);
  const ok = !!sim.ok;
  const summary = {
    sell: cloneLines(plan.sell),
    buy: cloneLines(plan.buy),
  };
  const result = {
    ok,
    manifest: manifestOps,
    summary,
    reason: ok ? plan.reason ?? null : `manifest not viable: ${sim.reason}`,
    simulation: sim,
    value: plan.value,
    revenue: plan.revenue,
    cost: plan.cost,
  };
  rememberManifest(world, request, result);
  return result;
}

export function estimateMarketTripHours(state) {
  if (!state) return 0;
  const farmerPos = state?.farmer?.pos ?? state?.positions?.farmer ?? state?.world?.farmer ?? { x: 0, y: 0 };
  const world = state.world ?? state;
  const yard = world.locations?.yard ?? { x: 0, y: 0 };
  const origin = farmerPos?.x != null ? farmerPos : yard;
  const market = world.locations?.market ?? yard;
  const dx = Math.abs((origin.x ?? 0) - (market.x ?? 0));
  const dy = Math.abs((origin.y ?? 0) - (market.y ?? 0));
  const steps = (dx + dy) * 2;
  const simMinutesPerStep = world.config?.labour?.travelStepSimMin
    ?? world.labour?.travelStepSimMin
    ?? CONFIG_PACK_V1.labour?.travelStepSimMin
    ?? 0.5;
  const handlingMinutes = world.config?.rates?.loadUnloadMarket
    ?? world.rates?.loadUnloadMarket
    ?? CONFIG_PACK_V1.rates?.loadUnloadMarket
    ?? 30;
  const simMinutes = steps * simMinutesPerStep + 2 * handlingMinutes;
  const minutesPerHour = world.config?.time?.minutesPerHour
    ?? CONFIG_PACK_V1.time?.minutesPerHour
    ?? 60;
  if (!minutesPerHour) return 0;
  return simMinutes / minutesPerHour;
}
