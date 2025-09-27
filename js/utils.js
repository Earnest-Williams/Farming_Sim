export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export const CAMERA_LERP = 0.2;

export function getSeedFromURL() {
  const m = new URLSearchParams(location.search).get('seed');
  const n = Number(m);
  if (!Number.isFinite(n)) {
    return ((Date.now() & 0xfffffff) ^ Math.floor(Math.random() * 1e9));
  }
  return n | 0;
}

export function makeRng(seed) {
  let s = seed >>> 0;
  const rng = function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.state = () => s;
  rng.set = (seed2) => {
    s = seed2 >>> 0;
  };
  return rng;
}

export function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function log(world, msg) {
  world.logs.unshift(msg);
  if (world.logs.length > 200) world.logs.length = 200;
}

export function hash01(x, y, seed) {
  let h = (x | 0) * 374761393 ^ (y | 0) * 668265263 ^ (seed | 0);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function randomNormal(rng) {
  const u = 1 - rng();
  const v = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function isToday(stamp, world) {
  if (!stamp) return false;
  if (typeof stamp === 'string') {
    const parts = stamp.split('-').map(Number);
    if (parts.length !== 3) return false;
    const [y, m, d] = parts;
    return y === world.calendar.year && m === world.calendar.month && d === world.calendar.day;
  }
  return stamp.d === world.calendar.day && stamp.m === world.calendar.month;
}
