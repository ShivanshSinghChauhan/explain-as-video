// Slide-deck view: the same storyboard drawn as finished, static slides.
import { drawSlide, WIDTH, HEIGHT } from './renderer.js';

export class SlideDeck {
  constructor({ canvas, thumbs, storyboard, theme, onChange = () => {} }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.thumbs = thumbs;
    this.storyboard = storyboard;
    this.theme = theme;
    this.onChange = onChange;
    this.index = 0;
    this.buildThumbs();
    this.go(0);
  }

  get count() { return this.storyboard.scenes.length; }

  buildThumbs() {
    this.thumbs.replaceChildren(...this.storyboard.scenes.map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb';
      b.setAttribute('aria-label', `Slide ${i + 1}: ${s.heading}`);
      const c = document.createElement('canvas');
      c.width = WIDTH;
      c.height = HEIGHT;
      b.append(c);
      b.addEventListener('click', () => this.go(i));
      return b;
    }));
    this.drawThumbs();
  }

  drawThumbs() {
    [...this.thumbs.children].forEach((b, i) => {
      drawSlide(b.firstChild.getContext('2d'), { storyboard: this.storyboard, index: i, theme: this.theme });
      b.classList.toggle('current', i === this.index);
    });
  }

  go(i) {
    this.index = Math.max(0, Math.min(this.count - 1, i));
    drawSlide(this.ctx, { storyboard: this.storyboard, index: this.index, theme: this.theme });
    [...this.thumbs.children].forEach((b, j) => b.classList.toggle('current', j === this.index));
    this.onChange(this.index);
  }

  next() { this.go(this.index + 1); }
  prev() { this.go(this.index - 1); }

  setTheme(theme) {
    this.theme = theme;
    this.drawThumbs();
    this.go(this.index);
  }

  /** PNG blob of slide i, rendered off-screen at full resolution. */
  slideBlob(i) {
    const c = document.createElement('canvas');
    c.width = WIDTH;
    c.height = HEIGHT;
    drawSlide(c.getContext('2d'), { storyboard: this.storyboard, index: i, theme: this.theme });
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }
}
