// Canvas renderer. All text is drawn with fillText, so untrusted storyboard
// content can never become markup or script.

export const WIDTH = 1280;
export const HEIGHT = 720;

export const THEMES = Object.freeze({
  midnight: { label: 'Midnight', bg1: '#0f172a', bg2: '#1e1b4b', fg: '#f8fafc', muted: '#cbd5e1',
    accent: '#818cf8', accent2: '#22d3ee', accent3: '#f472b6', card: 'rgba(255,255,255,0.08)', chipFg: '#0f172a', orb: 1 },
  paper: { label: 'Paper (light)', bg1: '#fdfcf8', bg2: '#efe9dc', fg: '#1f2937', muted: '#57534e',
    accent: '#b45309', accent2: '#0f766e', accent3: '#9d174d', card: 'rgba(0,0,0,0.05)', chipFg: '#ffffff', orb: 0.5 },
  sunset: { label: 'Sunset', bg1: '#3b0764', bg2: '#9a3412', fg: '#fff7ed', muted: '#fed7aa',
    accent: '#fb923c', accent2: '#facc15', accent3: '#f472b6', card: 'rgba(255,255,255,0.10)', chipFg: '#1c1917', orb: 1 },
  forest: { label: 'Forest', bg1: '#052e16', bg2: '#134e4a', fg: '#ecfdf5', muted: '#a7f3d0',
    accent: '#4ade80', accent2: '#2dd4bf', accent3: '#facc15', card: 'rgba(255,255,255,0.08)', chipFg: '#052e16', orb: 1 },
  contrast: { label: 'High contrast', bg1: '#000000', bg2: '#000000', fg: '#ffffff', muted: '#e5e5e5',
    accent: '#ffd400', accent2: '#00e5ff', accent3: '#ff4fd8', card: 'rgba(255,255,255,0.12)', chipFg: '#000000', orb: 0 },
});
export const DEFAULT_THEME = 'midnight';
// Drawing is synchronous, so the active theme is set once per frame in drawFrame().
let THEME = THEMES[DEFAULT_THEME];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp01(x), 3);
/** 0→1 progress of an animation that starts at `delay` ms and lasts `dur` ms. */
const prog = (t, delay, dur = 600) => ease((t - delay) / dur);

export function wrapLines(ctx, text, maxWidth, maxLines = 6) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function drawText(ctx, text, x, y, { size = 40, weight = 600, color = THEME.fg, align = 'left', maxWidth = 1000, maxLines = 4, lineHeight = 1.25, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const lines = wrapLines(ctx, text, maxWidth, maxLines);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lineHeight));
  ctx.restore();
  return lines.length * size * lineHeight;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function background(ctx, t, sceneIndex) {
  const g = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  g.addColorStop(0, THEME.bg1);
  g.addColorStop(1, THEME.bg2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // Slow drifting orbs give a sense of motion even on static scenes.
  const orbs = [[THEME.accent, 0.15], [THEME.accent2, 0.1], [THEME.accent3, 0.08]];
  orbs.forEach(([c, a], i) => {
    const phase = t / 4000 + i * 2.1 + sceneIndex;
    const x = WIDTH * (0.2 + 0.6 * ((Math.sin(phase) + 1) / 2));
    const y = HEIGHT * (0.2 + 0.6 * ((Math.cos(phase * 0.8) + 1) / 2));
    const rg = ctx.createRadialGradient(x, y, 0, x, y, 320);
    rg.addColorStop(0, c);
    rg.addColorStop(1, 'transparent');
    ctx.globalAlpha = a * THEME.orb;
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  });
  ctx.globalAlpha = 1;
}

function heading(ctx, scene, t) {
  const p = prog(t, 0, 500);
  drawText(ctx, scene.heading, 80, 70 + (1 - p) * 20, { size: 46, weight: 700, alpha: p, maxWidth: WIDTH - 160, maxLines: 2 });
  ctx.fillStyle = THEME.accent;
  ctx.fillRect(80, 60, 90 * p, 5);
}

const VISUALS = {
  title(ctx, scene, t, sb) {
    const p = prog(t, 0, 900);
    ctx.save();
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(WIDTH / 2, 250, 70, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();
    ctx.fillStyle = THEME.fg;
    ctx.globalAlpha = p;
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2 - 22, 215);
    ctx.lineTo(WIDTH / 2 + 34, 250);
    ctx.lineTo(WIDTH / 2 - 22, 285);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const q = prog(t, 300, 700);
    drawText(ctx, sb.title, WIDTH / 2, 360 + (1 - q) * 30, { size: 54, weight: 800, align: 'center', alpha: q, maxWidth: WIDTH - 200, maxLines: 2 });
    if (scene.heading && scene.heading !== sb.title) {
      drawText(ctx, scene.heading, WIDTH / 2, 500, { size: 30, weight: 500, color: THEME.muted, align: 'center', alpha: prog(t, 700), maxWidth: WIDTH - 260, maxLines: 2 });
    }
  },

  bullets(ctx, scene, t) {
    heading(ctx, scene, t);
    const items = scene.bullets.length ? scene.bullets : [scene.narration];
    let y = 200;
    items.forEach((b, i) => {
      const p = prog(t, 500 + i * 900, 600);
      if (p <= 0) return;
      ctx.save();
      ctx.globalAlpha = p;
      ctx.translate((1 - p) * -40, 0);
      ctx.fillStyle = [THEME.accent, THEME.accent2, THEME.accent3, THEME.accent][i % 4];
      ctx.beginPath();
      ctx.arc(104, y + 22, 10, 0, Math.PI * 2);
      ctx.fill();
      const h = drawText(ctx, b, 136, y, { size: 36, weight: 500, maxWidth: WIDTH - 240, maxLines: items.length > 3 ? 2 : 3 });
      ctx.restore();
      y += Math.max(70, h + 26);
    });
  },

  flow(ctx, scene, t) {
    heading(ctx, scene, t);
    const n = scene.bullets.length;
    const gap = 60;
    const w = (WIDTH - 160 - gap * (n - 1)) / n;
    scene.bullets.forEach((b, i) => {
      const x = 80 + i * (w + gap);
      const p = prog(t, 500 + i * 1000, 600);
      if (p <= 0) return;
      ctx.save();
      ctx.globalAlpha = p;
      roundRect(ctx, x, 260 + (1 - p) * 30, w, 220, 18);
      ctx.fillStyle = THEME.card;
      ctx.fill();
      ctx.strokeStyle = [THEME.accent, THEME.accent2, THEME.accent3, THEME.accent][i % 4];
      ctx.lineWidth = 3;
      ctx.stroke();
      drawText(ctx, String(i + 1), x + 22, 278, { size: 28, weight: 800, color: ctx.strokeStyle });
      drawText(ctx, b, x + 22, 322, { size: n > 3 ? 24 : 28, weight: 600, maxWidth: w - 44, maxLines: 4 });
      ctx.restore();
      if (i < n - 1) {
        const a = prog(t, 1000 + i * 1000, 500);
        const ax = x + w + 8;
        ctx.save();
        ctx.strokeStyle = THEME.muted;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(ax, 370);
        ctx.lineTo(ax + (gap - 16) * a, 370);
        ctx.stroke();
        if (a >= 1) {
          ctx.fillStyle = THEME.muted;
          ctx.beginPath();
          ctx.moveTo(ax + gap - 16, 360);
          ctx.lineTo(ax + gap - 6, 370);
          ctx.lineTo(ax + gap - 16, 380);
          ctx.fill();
        }
        ctx.restore();
      }
    });
  },

  compare(ctx, scene, t) {
    heading(ctx, scene, t);
    const [left, right] = scene.bullets;
    const w = (WIDTH - 220) / 2;
    [[left, 80, THEME.accent2, 500], [right, 140 + w, THEME.accent3, 1300]].forEach(([text, x, color, delay]) => {
      const p = prog(t, delay, 700);
      ctx.save();
      ctx.globalAlpha = p;
      roundRect(ctx, x, 220 + (1 - p) * 40, w, 300, 22);
      ctx.fillStyle = THEME.card;
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(x, 220 + (1 - p) * 40, w, 8);
      drawText(ctx, text, x + 30, 260, { size: 32, weight: 600, maxWidth: w - 60, maxLines: 6 });
      ctx.restore();
    });
    const v = prog(t, 1000, 400);
    drawText(ctx, 'vs', WIDTH / 2, 345, { size: 36, weight: 800, color: THEME.muted, align: 'center', alpha: v });
  },

  keyword(ctx, scene, t) {
    heading(ctx, scene, t);
    const n = scene.bullets.length;
    scene.bullets.forEach((k, i) => {
      const p = prog(t, 500 + i * 700, 500);
      if (p <= 0) return;
      const cx = WIDTH / 2 + (i - (n - 1) / 2) * Math.min(300, (WIDTH - 200) / n);
      const cy = 380 + (i % 2 ? 40 : -40);
      const s = 0.6 + 0.4 * p + Math.sin(t / 600 + i) * 0.02;
      ctx.save();
      ctx.globalAlpha = p;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.font = `700 34px ${FONT}`;
      const tw = Math.min(260, ctx.measureText(k).width + 50);
      roundRect(ctx, -tw / 2, -40, tw, 80, 40);
      ctx.fillStyle = [THEME.accent, THEME.accent2, THEME.accent3, THEME.accent][i % 4];
      ctx.fill();
      drawText(ctx, k, 0, -20, { size: 32, weight: 700, color: THEME.chipFg, align: 'center', maxWidth: tw - 30, maxLines: 1 });
      ctx.restore();
    });
  },

  quote(ctx, scene, t) {
    heading(ctx, scene, t);
    const p = prog(t, 300, 600);
    drawText(ctx, '“', 90, 170, { size: 160, weight: 800, color: THEME.accent, alpha: p });
    // Typewriter reveal of the narration line.
    const chars = Math.floor(scene.narration.length * clamp01((t - 500) / 3000));
    drawText(ctx, scene.narration.slice(0, chars), 180, 230, { size: 38, weight: 500, maxWidth: WIDTH - 300, maxLines: 6, lineHeight: 1.35 });
  },
};

/**
 * Draw one frame.
 * state: { storyboard, sceneIndex, t (ms into scene), caption, showCaptions, progress (0..1), theme, still }
 * still: draw a finished, static slide (no drift, no progress bar).
 */
export function drawFrame(ctx, { storyboard, sceneIndex, t, caption = '', showCaptions = true, progress = 0, theme = DEFAULT_THEME, still = false }) {
  THEME = THEMES[theme] || THEMES[DEFAULT_THEME];
  const scene = storyboard.scenes[sceneIndex];
  background(ctx, still ? 0 : t, sceneIndex);
  const fade = prog(t, 0, 350);
  ctx.save();
  ctx.globalAlpha = fade;
  (VISUALS[scene.visual] || VISUALS.bullets)(ctx, scene, t, storyboard);
  ctx.restore();

  // Scene counter + progress bar.
  drawText(ctx, `${sceneIndex + 1} / ${storyboard.scenes.length}`, WIDTH - 80, 30, { size: 20, weight: 600, color: THEME.muted, align: 'right' });
  if (!still) {
    ctx.fillStyle = 'rgba(127,127,127,0.25)';
    ctx.fillRect(0, HEIGHT - 6, WIDTH, 6);
    ctx.fillStyle = THEME.accent2;
    ctx.fillRect(0, HEIGHT - 6, WIDTH * clamp01(progress), 6);
  }

  if (showCaptions && caption) {
    ctx.save();
    ctx.font = `600 30px ${FONT}`;
    const lines = wrapLines(ctx, caption, WIDTH - 260, 2);
    const boxH = lines.length * 40 + 24;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    roundRect(ctx, (WIDTH - widest) / 2 - 20, HEIGHT - 40 - boxH, widest + 40, boxH, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, WIDTH / 2, HEIGHT - 40 - boxH + 12 + i * 40));
    ctx.restore();
  }
}

/** A finished slide: every animation complete, no captions. */
export function drawSlide(ctx, { storyboard, index, theme = DEFAULT_THEME }) {
  drawFrame(ctx, { storyboard, sceneIndex: index, t: 60000, showCaptions: false, theme, still: true });
}
