export class SimulationClock {
  constructor({ speedSimMinPerRealMin = 60, stepSimMin = 0.5 } = {}) {
    this.speed = Math.max(0, Number.isFinite(speedSimMinPerRealMin) ? speedSimMinPerRealMin : 0);
    this.step = Math.max(1e-6, Number.isFinite(stepSimMin) && stepSimMin > 0 ? stepSimMin : 0.5);
    this.listeners = new Set();
    this.running = false;
    this._now = 0;
    this._acc = 0;
    this._last = 0;
    this._loop = this._loop.bind(this);
  }

  onTick(fn) {
    if (typeof fn !== 'function') return () => {};
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  setSpeed(value) {
    const next = Number.isFinite(value) ? value : 0;
    this.speed = Math.max(0, next);
    if (this.speed <= 0) {
      this._acc = 0;
    }
  }

  nowSimMin() {
    return this._now;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._acc = 0;
    this._last = this._nowTimestamp();
    this._scheduleNext();
  }

  stop() {
    this.running = false;
  }

  _nowTimestamp() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    if (typeof Date !== 'undefined') {
      return Date.now();
    }
    return 0;
  }

  _scheduleNext() {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(this._loop);
    } else {
      setTimeout(() => this._loop(this._nowTimestamp()), 16);
    }
  }

  _loop(timestamp) {
    if (!this.running) return;
    const current = Number.isFinite(timestamp) ? timestamp : this._nowTimestamp();
    const dtMs = current - this._last;
    this._last = current;

    if (this.speed > 0) {
      const msPerStep = (this.step * 60000) / this.speed;
      if (msPerStep > 0 && Number.isFinite(msPerStep)) {
        this._acc += Math.max(0, dtMs);
        while (this._acc + 1e-9 >= msPerStep) {
          this._now += this.step;
          for (const fn of this.listeners) {
            fn(this.step, this._now);
          }
          this._acc -= msPerStep;
        }
      }
    }

    if (this.running) {
      this._scheduleNext();
    }
  }
}
