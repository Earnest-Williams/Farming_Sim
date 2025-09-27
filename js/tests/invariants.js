export function assertNoWorkOutsideWindow(world) {
  const minute = world.calendar.minute ?? 0;
  const daylight = world.daylight || { workStart: 0, workEnd: 0 };
  if (minute < daylight.workStart || minute > daylight.workEnd) {
    const progressed = world.tasks?.month?.done?.some(t => (t?._completedAtMinute ?? -1) === minute);
    if (progressed) throw new Error('Work progressed outside daylight window');
  }
}

export function assertCompletionNotPremature(world, task) {
  if ((task.doneMin ?? 0) < (task.estMin ?? 1)) {
    throw new Error(`Premature completion: ${task.kind} id=${task.id}`);
  }
}
