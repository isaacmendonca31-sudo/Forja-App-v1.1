/**
 * FORJA — Cronômetro de descanso entre séries.
 *
 * Funciona por TIMESTAMP (instante final), não por contagem de ticks: se o
 * navegador pausar o JavaScript com a tela bloqueada, o tempo restante continua
 * correto ao voltar. Ao terminar: vibração e/ou bipe (conforme Ajustes) e aviso
 * visual + leitor de tela.
 */
import { h, fmtClock, icon } from './utils.js';
import { getSettings } from './store.js';

let root = null;
let clockEl; let labelEl; let announceEl; let doneBtn;
let endAt = 0;
let duration = 0;
let interval = null;
let finished = false;
let audioCtx = null;

export function initTimer(container) {
  root = container;
  clockEl = h('span', { class: 'clock', 'aria-hidden': 'true' }, '0:00');
  labelEl = h('span', { class: 'label' }, 'Descanso');
  // Região "viva" só anuncia o FIM do descanso (não a cada segundo).
  announceEl = h('span', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  doneBtn = h('button', { type: 'button', class: 'btn ghost small', onClick: stopRest }, 'Pular');
  root.append(
    icon('timer'),
    h('span', { class: 'timer-progress', 'aria-hidden': 'true' }),
    clockEl,
    labelEl,
    h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Menos 15 segundos', onClick: () => adjust(-15) }, '−15'),
    h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'Mais 15 segundos', onClick: () => adjust(15) }, '+15'),
    doneBtn,
    announceEl,
  );
}

/** Inicia (ou reinicia) o descanso. Deve ser chamado a partir de um toque do usuário. */
export function startRest(seconds, text = 'Descanso') {
  if (!root) return;
  prepareAudio();
  finished = false;
  duration = Math.max(1, seconds);
  endAt = Date.now() + seconds * 1000;
  labelEl.textContent = text;
  announceEl.textContent = '';
  doneBtn.textContent = 'Pular';
  root.classList.remove('finished');
  root.hidden = false;
  document.getElementById('main')?.classList.add('has-timer');
  clearInterval(interval);
  interval = setInterval(tick, 250);
  tick();
}

export function stopRest() {
  clearInterval(interval);
  interval = null;
  finished = false;
  if (root) root.hidden = true;
  document.getElementById('main')?.classList.remove('has-timer');
}

function adjust(delta) {
  if (finished) return;
  endAt += delta * 1000;
  duration = Math.max(1, duration + delta);
  tick();
}

function tick() {
  const left = Math.ceil((endAt - Date.now()) / 1000);
  root.style.setProperty('--timer-progress', `${Math.max(0, Math.min(100, (left / duration) * 100))}%`);
  if (left > 0) { clockEl.textContent = fmtClock(left); return; }
  if (finished) return;
  finished = true;
  clearInterval(interval);
  clockEl.textContent = '0:00';
  labelEl.textContent = 'Descanso concluído';
  announceEl.textContent = 'Descanso concluído';
  doneBtn.textContent = 'Fechar';
  root.classList.add('finished');
  const s = getSettings();
  if (s.vibrate) navigator.vibrate?.([200, 100, 200]);
  if (s.sound) beep();
}

/** O AudioContext só pode iniciar após um gesto do usuário. */
function prepareAudio() {
  if (!getSettings().sound) return;
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch { /* sem áudio: segue sem som */ }
}

function beep() {
  try {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.55);
  } catch { /* ignora */ }
}
