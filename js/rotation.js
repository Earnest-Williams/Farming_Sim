export const ROTATIONS = Object.freeze({
  arable6: ['turnips', 'barley_clover', 'clover_hay', 'wheat', 'pulses', 'flex'],
  close3: ['oats_close', 'grass_close', 'hay_close'],
});

export function stageFor(rotationId, rotationIndex, monthIndexZeroBased = 0) {
  const seq = ROTATIONS[rotationId];
  if (!seq) throw new Error(`Unknown rotationId: ${rotationId}`);
  const length = seq.length;
  if (length <= 0) throw new Error(`Rotation ${rotationId} must contain at least one stage`);
  const idx = ((rotationIndex | 0) + (monthIndexZeroBased | 0)) % length;
  return seq[(idx + length) % length];
}

export function stageNow(parcel, monthIndexZeroBased = 0) {
  if (!parcel || !parcel.rotationId) return null;
  return stageFor(parcel.rotationId, parcel.rotationIndex, monthIndexZeroBased);
}

export function labelFor(parcel, monthIndexZeroBased = 0) {
  if (!parcel) return '';
  const stage = stageNow(parcel, monthIndexZeroBased);
  const stageLabel = typeof stage === 'string' ? stage.replaceAll('_', ' ') : '';
  if (parcel.fieldNo != null) return `Field ${parcel.fieldNo} — ${stageLabel}`;
  if (parcel.closeNo != null) return `Close ${parcel.closeNo} — ${stageLabel}`;
  if (parcel.name) return `${parcel.name}${stageLabel ? ` — ${stageLabel}` : ''}`;
  return stageLabel;
}
