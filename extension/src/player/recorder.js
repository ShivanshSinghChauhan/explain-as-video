// WebM export via canvas.captureStream() + MediaRecorder.
//
// The exported file is SILENT. speechSynthesis audio is played by the OS
// speech engine, not through a Web Audio graph or media element, so an
// extension page has no MediaStream to record it from. Captions are burned
// into the video instead, and .vtt/.srt files are offered separately.

import { buildTimeline } from '../lib/captions.js';
import { drawFrame, WIDTH, HEIGHT } from './renderer.js';

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function pickMimeType(MR = globalThis.MediaRecorder) {
  if (!MR || typeof MR.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find((m) => MR.isTypeSupported(m)) || '';
}

export function webmSupport() {
  const canvasOk = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const mime = pickMimeType();
  return { supported: canvasOk && !!mime, mime };
}

/** Find which scene/caption is on screen at time `ms` of the estimated timeline. */
export function frameAt(timeline, ms) {
  const scenes = timeline.scenes;
  let sc = scenes[scenes.length - 1];
  for (const s of scenes) if (ms < s.end) { sc = s; break; }
  const cue = sc.cues.find((c) => ms >= c.start && ms < c.end);
  return { sceneIndex: sc.index, t: ms - sc.start, caption: cue ? cue.text : '' };
}

/**
 * Render the whole storyboard in real time into a WebM Blob.
 * timeScale > 1 renders faster (used by tests); the file plays back at that speed.
 */
export function exportWebM({ storyboard, rate = 1, captions = true, theme, onProgress = () => {}, signal, timeScale = 1, fps = 30 }) {
  const { supported, mime } = webmSupport();
  if (!supported) return Promise.reject(new Error('This browser cannot record canvas video as WebM.'));
  const timeline = buildTimeline(storyboard, rate);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  // Kept in the DOM (off-screen) so the compositor keeps producing frames.
  canvas.style.cssText = 'position:fixed;left:-99999px;top:0;width:320px;height:180px;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const parts = [];

  return new Promise((resolve, reject) => {
    let timer = 0;
    let start = 0;
    const cleanup = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      canvas.remove();
    };
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    recorder.onerror = (e) => { cleanup(); reject(new Error(`Recording failed: ${e.error?.message || 'unknown error'}`)); };
    recorder.onstop = () => {
      cleanup();
      if (signal?.aborted) return reject(new DOMException('Export cancelled', 'AbortError'));
      resolve({ blob: new Blob(parts, { type: 'video/webm' }), mime, durationMs: timeline.duration / timeScale });
    };
    signal?.addEventListener('abort', () => recorder.state !== 'inactive' && recorder.stop(), { once: true });

    const draw = (ms) => {
      const f = frameAt(timeline, ms);
      drawFrame(ctx, { storyboard, sceneIndex: f.sceneIndex, t: f.t, caption: f.caption, showCaptions: captions, progress: ms / timeline.duration, theme });
    };
    const tick = () => {
      if (recorder.state === 'inactive') return;
      // Wall-clock based, so content stays in sync even if the timer is throttled.
      const ms = (performance.now() - start) * timeScale;
      if (ms >= timeline.duration) {
        draw(timeline.duration - 1);
        onProgress(1);
        setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 150);
        return;
      }
      draw(ms);
      onProgress(ms / timeline.duration);
      timer = setTimeout(tick, 1000 / fps);
    };
    draw(0);
    recorder.start(1000);
    start = performance.now();
    tick();
  });
}
