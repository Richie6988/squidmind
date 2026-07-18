/**
 * SoundFX — discrete WebAudio chimes. Zero assets (pure oscillators —
 * local-first even for audio), OFF by default, toggle persisted.
 *
 * Design rules:
 *  - Short (≤400ms), quiet (master gain 0.12), never layered spam: a
 *    per-sound 800ms throttle so a batch of 5 task completions plays once.
 *  - Sounds are semantic, not decorative: each maps to a system event you
 *    care about hearing from across the room.
 *      taskDone       soft two-note major chime
 *      taskFail       low dull thud
 *      levelUp        rising arpeggio
 *      missionDone    triumphant three-note
 *      pause / resume descending / ascending pair
 *      error          short buzz
 */

const SoundFX = {
  _ctx: null,
  _enabled: false,
  _last: {},

  init() {
    try { this._enabled = window.localStorage?.getItem('iaqua_sfx') === '1'; } catch {}
    this._renderToggle();
  },

  _ac() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this._ctx = new AC();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    return this._ctx;
  },

  setEnabled(on) {
    this._enabled = !!on;
    try { window.localStorage?.setItem('iaqua_sfx', on ? '1' : '0'); } catch {}
    this._renderToggle();
    if (on) this._tone([[660, 0, 0.08]]);   // confirmation blip
  },

  toggle() { this.setEnabled(!this._enabled); },

  _renderToggle() {
    const b = document.getElementById('ct-sfx-btn');
    if (!b) return;
    b.classList.toggle('on', this._enabled);
    b.textContent = this._enabled ? '♪ SFX ON' : '♪ SFX';
    b.title = this._enabled ? 'Sound effects on — click to mute' : 'Sound effects off — click to enable';
  },

  /** notes: [freqHz, startSec, durSec, type?] */
  _tone(notes, { gain = 0.12 } = {}) {
    if (!this._enabled) return;
    const ac = this._ac();
    if (!ac) return;
    const t0 = ac.currentTime + 0.01;
    const master = ac.createGain();
    master.gain.value = gain;
    master.connect(ac.destination);
    for (const [freq, start, dur, type = 'sine'] of notes) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(1, t0 + start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
      o.connect(g); g.connect(master);
      o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
    }
  },

  play(name) {
    if (!this._enabled) return;
    const now = Date.now();
    if (now - (this._last[name] || 0) < 800) return;   // anti-spam
    this._last[name] = now;
    switch (name) {
      case 'taskDone':    return this._tone([[523.25, 0, 0.12], [783.99, 0.10, 0.22]]);                 // C5→G5
      case 'taskFail':    return this._tone([[130.81, 0, 0.28, 'triangle'], [98, 0.02, 0.30, 'triangle']], { gain: 0.16 });
      case 'levelUp':     return this._tone([[523.25, 0, 0.09], [659.25, 0.09, 0.09], [783.99, 0.18, 0.09], [1046.5, 0.27, 0.20]]);
      case 'missionDone': return this._tone([[392, 0, 0.14], [523.25, 0.14, 0.14], [783.99, 0.28, 0.32]]);
      case 'pause':       return this._tone([[440, 0, 0.10], [330, 0.10, 0.16]]);
      case 'resume':      return this._tone([[330, 0, 0.10], [440, 0.10, 0.16]]);
      case 'error':       return this._tone([[180, 0, 0.10, 'square'], [180, 0.14, 0.10, 'square']], { gain: 0.08 });
      default: return;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => SoundFX.init());
