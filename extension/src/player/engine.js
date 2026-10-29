// Playback engine: walks scenes → caption chunks, driven either by speech
// "end" events (narration on) or by estimated durations (narration off /
// unavailable). Renders every animation frame to the canvas.

import { chunkCaption, estimateDurationMs } from '../lib/captions.js';
import { drawFrame } from './renderer.js';

const LEAD_MS = 300;
const TAIL_MS = 700;

export class PlayerEngine {
  constructor({ canvas, storyboard, narrator, onChange = () => {} }) {
    this.ctx = canvas.getContext('2d');
    this.storyboard = storyboard;
    this.narrator = narrator;
    this.onChange = onChange;
    this.chunks = storyboard.scenes.map((s) => chunkCaption(s.narration));
    this.rate = 1;
    this.narrationOn = narrator.supported;
    this.captionsOn = true;
    this.theme = 'midnight';
    this.playing = false;
    this.ended = false;
    this.last = 0;
    this.raf = 0;
    this.goto(0, false);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // phase: 'lead' → 'chunk' (index this.chunk) → 'tail'
  goto(sceneIndex, keepPlaying = this.playing) {
    this.narrator.cancel();
    this.scene = Math.max(0, Math.min(this.storyboard.scenes.length - 1, sceneIndex));
    this.sceneT = 0;
    this.phase = 'lead';
    this.phaseT = 0;
    this.chunk = 0;
    this.speaking = false;
    this.ended = false;
    this.playing = keepPlaying;
    this.onChange(this.status());
  }

  play() {
    if (this.ended) this.goto(0, true);
    this.playing = true;
    if (this.phase === 'chunk') this.startChunk(); // resume = re-speak current line
    this.onChange(this.status());
  }

  pause() {
    this.playing = false;
    this.narrator.cancel();
    this.speaking = false;
    this.onChange(this.status());
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  next() { this.goto(this.scene + 1); }
  prev() { this.goto(this.sceneT > 1500 ? this.scene : this.scene - 1); }
  restart() { this.goto(0, true); }

  setRate(rate) {
    this.rate = rate;
    if (this.playing && this.phase === 'chunk') this.startChunk();
  }

  setNarration(on) {
    this.narrationOn = on && this.narrator.supported;
    this.narrator.cancel();
    this.speaking = false;
    if (this.playing && this.phase === 'chunk') this.startChunk();
    this.onChange(this.status());
  }

  setCaptions(on) { this.captionsOn = on; }
  setTheme(theme) { this.theme = theme; }

  currentCaption() {
    return this.phase === 'chunk' ? this.chunks[this.scene][this.chunk] || '' : '';
  }

  startChunk() {
    this.phaseT = 0;
    const text = this.currentCaption();
    this.chunkBudget = estimateDurationMs(text, this.rate);
    if (!this.narrationOn) return;
    this.speaking = true;
    this.narrator.speak(text, {
      rate: this.rate,
      onEnd: () => { this.speaking = false; this.advanceChunk(); },
      onError: (err) => {
        // Speech failed (no voice, OS TTS problem): fall back to timer mode.
        this.speaking = false;
        this.narrationOn = false;
        this.onChange({ ...this.status(), speechError: err });
      },
    });
  }

  advanceChunk() {
    if (!this.playing) return;
    this.chunk++;
    if (this.chunk < this.chunks[this.scene].length) this.startChunk();
    else { this.phase = 'tail'; this.phaseT = 0; }
  }

  step(dt) {
    if (!this.playing) return;
    this.sceneT += dt;
    this.phaseT += dt;
    if (this.phase === 'lead' && this.phaseT >= LEAD_MS) {
      this.phase = 'chunk';
      this.chunk = 0;
      if (this.chunks[this.scene].length) this.startChunk();
      else { this.phase = 'tail'; this.phaseT = 0; }
    } else if (this.phase === 'chunk') {
      // Timer mode ends a chunk on its estimate; narration mode has a watchdog
      // in case the speech engine never fires "end".
      const limit = this.narrationOn ? this.chunkBudget * 2.5 + 3000 : this.chunkBudget;
      if (this.phaseT >= limit) {
        this.narrator.cancel();
        this.speaking = false;
        this.advanceChunk();
      }
    } else if (this.phase === 'tail' && this.phaseT >= TAIL_MS) {
      if (this.scene < this.storyboard.scenes.length - 1) this.goto(this.scene + 1, true);
      else { this.playing = false; this.ended = true; this.onChange(this.status()); }
    }
  }

  progress() {
    const n = this.storyboard.scenes.length;
    const total = this.chunks[this.scene].length || 1;
    const within = this.phase === 'lead' ? 0 : this.phase === 'tail' ? 1 : this.chunk / total;
    return this.ended ? 1 : (this.scene + within) / n;
  }

  loop(now) {
    const dt = this.last ? Math.min(100, now - this.last) : 0;
    this.last = now;
    this.step(dt);
    drawFrame(this.ctx, {
      storyboard: this.storyboard, sceneIndex: this.scene, t: this.sceneT,
      caption: this.currentCaption(), showCaptions: this.captionsOn, progress: this.progress(), theme: this.theme,
    });
    this.raf = requestAnimationFrame(this.loop);
  }

  status() {
    return { scene: this.scene, playing: this.playing, ended: this.ended, narrationOn: this.narrationOn };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.narrator.cancel();
  }
}
