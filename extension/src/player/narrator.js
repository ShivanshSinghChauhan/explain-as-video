// Thin wrapper over the Web Speech API (speechSynthesis). Speaks one caption
// chunk at a time: short utterances avoid Chrome's habit of stalling on long
// ones and keep captions exactly in sync with the voice.

export class Narrator {
  constructor(synth = globalThis.speechSynthesis) {
    this.synth = synth || null;
    this.voice = null;
    this.token = 0;
  }

  get supported() {
    return !!this.synth && typeof globalThis.SpeechSynthesisUtterance === 'function';
  }

  /** Resolve with the voice list; Chrome fills it asynchronously. */
  async voices(timeoutMs = 1500) {
    if (!this.supported) return [];
    const now = this.synth.getVoices();
    if (now.length) return now;
    return new Promise((resolve) => {
      const done = () => resolve(this.synth.getVoices());
      this.synth.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, timeoutMs);
    });
  }

  setVoice(voice) {
    this.voice = voice || null;
  }

  /** Speak text; callbacks for a cancelled utterance are suppressed. */
  speak(text, { rate = 1, onEnd, onError } = {}) {
    if (!this.supported) {
      onError?.('unsupported');
      return;
    }
    const token = ++this.token;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    }
    u.onend = () => token === this.token && onEnd?.();
    u.onerror = (e) => {
      if (token !== this.token) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      onError?.(e.error || 'speech-error');
    };
    this.synth.speak(u);
  }

  cancel() {
    this.token++;
    if (this.supported) this.synth.cancel();
  }
}
