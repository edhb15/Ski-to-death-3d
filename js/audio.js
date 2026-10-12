'use strict';
// Tiny procedural sound engine: wind, cracks and thuds from filtered noise.
const Sfx = {
  ctx: null,
  init() {
    if (this.ctx) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
      const wind = ctx.createBufferSource(); wind.buffer = this.noise; wind.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      this.windFilter = bp;
      wind.connect(bp).connect(this.windGain).connect(this.master);
      wind.start();
    } catch (e) { this.ctx = null; }
  },
  setWind(speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(Math.min(0.4, speed / 45 * 0.4), t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + speed * 18, t, 0.2);
  },
  burst(freq, type, dur, vol, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  },
  crack(intensity = 1) {
    this.burst(2200, 'highpass', 0.07, 0.9 * intensity);
    this.burst(900, 'bandpass', 0.05, 0.6 * intensity, 0.025);
  },
  thud(intensity = 1) {
    this.burst(180, 'lowpass', 0.22, 1.2 * intensity);
  },
  boom() {
    this.burst(90, 'lowpass', 0.9, 1.5);
  },
};
