import { makeWorld } from '../world.js';
import { stepOneMinute, planDay, onNewMonth } from '../simulation.js';
import { MINUTES_PER_DAY } from '../time.js';

export function headlessSmoke(seed = 12345){
  const w = makeWorld(seed);
  onNewMonth(w);
  planDay(w);
  // run one day minute-by-minute
  for (let m = 0; m < MINUTES_PER_DAY; m++) stepOneMinute(w);

  const anyInstant = w.tasks.month.done.some(t => t.doneMin < t.estMin);
  if (anyInstant) throw new Error('Instant completion detected');

  const anyWorkOutside = w.kpi && w.kpi._workOutsideWindow; // set below
  if (anyWorkOutside) throw new Error('Work accrued outside daylight window');
  return w;
}
