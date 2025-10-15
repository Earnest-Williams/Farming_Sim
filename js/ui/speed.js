import { setSpeed, getSpeed } from '../timeflow.js';

const KEY_PRESETS = {
  Digit1: 0.03,
  Digit2: 0.06,
  Digit3: 0.12,
  Digit4: 0.5,
  Digit5: 2.0,
  Digit6: 10.0,
};

let slider;
let label;
let buttons;

function updateActiveButton(speed = getSpeed()) {
  if (!buttons) return;
  const current = Number.isFinite(speed) ? speed : 0;
  buttons.forEach((btn) => {
    const value = parseFloat(btn.dataset.speed);
    const isMatch = Number.isFinite(value) && Math.abs(value - current) < 0.0001;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
  });
}

export function syncSpeedControls() {
  if (!slider || !label) return;
  slider.value = String(getSpeed());
  if (slider.value !== '0') slider.dataset.prev = slider.value;
  label.textContent = `${getSpeed().toFixed(2)}× min/s`;
  updateActiveButton();
}

export function initSpeedControls() {
  slider = document.getElementById('speedSlider');
  label = document.getElementById('speedLabel');
  buttons = document.querySelectorAll('#speed-controls button');
  if (!slider || !label) return;

  function updateLabel() {
    label.textContent = `${getSpeed().toFixed(2)}× min/s`;
  }

  slider.addEventListener('input', () => {
    setSpeed(parseFloat(slider.value));
    if (slider.value !== '0') slider.dataset.prev = slider.value;
    updateLabel();
    updateActiveButton(parseFloat(slider.value));
  });

  buttons.forEach((btn) => {
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      const value = parseFloat(btn.dataset.speed);
      if (!Number.isFinite(value)) return;
      setSpeed(value);
      slider.value = String(value);
      if (value > 0) slider.dataset.prev = String(value);
      updateLabel();
      updateActiveButton(value);
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const current = getSpeed();
      if (current === 0) {
        const stored = parseFloat(slider.dataset.prev ?? slider.value);
        const preset = Number.isFinite(stored) && stored > 0 ? stored : 1.0;
        setSpeed(preset);
        slider.value = String(preset);
      } else {
        setSpeed(0);
        slider.dataset.prev = String(current);
        slider.value = '0';
      }
      updateLabel();
      updateActiveButton(getSpeed());
      e.preventDefault();
    }
    if (KEY_PRESETS[e.code] != null) {
      const value = KEY_PRESETS[e.code];
      setSpeed(value);
      slider.value = String(value);
      slider.dataset.prev = String(value);
      updateLabel();
      updateActiveButton(value);
    }
  });

  syncSpeedControls();
}
