import { resolveTargetKeys } from '../world.js';
import { stageNow, labelFor } from '../rotation.js';

function lookupParcel(state, key) {
  if (!key) return null;
  const world = state?.world ?? state;
  if (world?.lookup?.parcels?.[key]) return world.lookup.parcels[key];
  if (world?.lookup?.closes?.[key]) return world.lookup.closes[key];
  if (Array.isArray(world?.parcels)) {
    return world.parcels.find((parcel) => parcel?.key === key) ?? null;
  }
  return null;
}

export function expandJob(template, state) {
  const world = state?.world ?? state;
  const monthIndex = world?.calendar?.monthIndex ?? 0;
  const keys =
    template?.target?.key
      ? resolveTargetKeys(template.target.key, world)
      : template?.targetStage
        ? resolveTargetKeys(template.targetStage, world)
        : template?.field
          ? resolveTargetKeys(template.field, world)
          : [];

  if (!Array.isArray(keys) || keys.length === 0) {
    return [
      {
        ...template,
        target: template?.target ?? null,
        field: template.field ?? template?.target?.key ?? null,
        requiresPresenceAt: template.requiresPresenceAt ?? template.field ?? template?.target?.key ?? null,
        title: template.title ?? template.label ?? template.id ?? 'Job',
      },
    ];
  }

  return keys.map((keyRaw) => {
    const key = typeof keyRaw === 'string' ? keyRaw : String(keyRaw ?? '');
    const parcel = lookupParcel(world, key);
    const stage = stageNow(parcel, monthIndex);
    const identity = {
      key,
      fieldNo: parcel?.fieldNo ?? null,
      closeNo: parcel?.closeNo ?? null,
      stage,
    };
    const titleBase = template.title ?? template.label ?? template.id ?? 'Job';
    const parcelLabel = parcel ? labelFor(parcel, monthIndex) : key;
    const presenceKeys = template.requiresPresenceAt
      ? resolveTargetKeys(template.requiresPresenceAt, world)
      : [];
    const presence = presenceKeys.includes(key)
      ? key
      : presenceKeys.find((p) => typeof p === 'string' && p.startsWith('field_'))
        ?? presenceKeys.find((p) => typeof p === 'string' && p.startsWith('close_'))
        ?? presenceKeys.find(Boolean)
        ?? key;
    return {
      ...template,
      target: identity,
      field: key,
      requiresPresenceAt: presence,
      title: `${titleBase} — ${parcelLabel}`,
    };
  });
}

export default expandJob;
