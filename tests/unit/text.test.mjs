import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, splitSentences, truncateAtBoundary, prepareSelection, safeFileStem, LIMITS, countWords } from '../../extension/src/lib/text.js';

test('normalizeText strips control, zero-width and bidi characters and collapses whitespace', () => {
  const raw = 'Hello\u0000 ​world‮!\r\n\r\n\r\n\tNext   line here ';
  assert.equal(normalizeText(raw), 'Hello world!\n\nNext line here');
});

test('normalizeText tolerates non-strings', () => {
  assert.equal(normalizeText(undefined), '');
  assert.equal(normalizeText(42), '');
});

test('splitSentences handles punctuation, paragraphs and CJK full stops', () => {
  assert.deepEqual(splitSentences('One. Two! Three?\nFour'), ['One.', 'Two!', 'Three?', 'Four']);
  assert.deepEqual(splitSentences('他来了。她走了。'), ['他来了。', '她走了。']);
  assert.deepEqual(splitSentences('   '), []);
});

test('truncateAtBoundary prefers sentence, then word boundaries', () => {
  const text = 'First sentence is here. Second sentence is a bit longer than the first.';
  assert.equal(truncateAtBoundary(text, 40), 'First sentence is here.');
  assert.equal(truncateAtBoundary('alpha beta gamma delta epsilon', 22), 'alpha beta gamma');
  assert.equal(truncateAtBoundary('short', 100), 'short');
});

test('prepareSelection rejects empty and too-short selections with a helpful message', () => {
  assert.equal(prepareSelection('').ok, false);
  assert.match(prepareSelection('').error, /No text was selected/);
  assert.match(prepareSelection('too short').error, /too short/);
  assert.equal(prepareSelection(null).ok, false);
});

test('prepareSelection trims long selections to sendMax and flags truncation', () => {
  const long = 'This is a sentence about something. '.repeat(1000); // ~36k chars
  const r = prepareSelection(long);
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= LIMITS.sendMax);
  assert.ok(r.text.endsWith('.'));
  assert.equal(r.originalLength, long.length);
});

test('prepareSelection caps huge input before normalising (no catastrophic work)', () => {
  const huge = 'x'.repeat(5_000_000);
  const t0 = Date.now();
  const r = prepareSelection(huge);
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(r.text.length <= LIMITS.sendMax);
  assert.equal(r.truncated, true);
});

test('safeFileStem produces a filesystem-safe name', () => {
  assert.equal(safeFileStem('../../etc/passwd <script>'), 'etc-passwd-script');
  assert.equal(safeFileStem(''), 'explainer');
  assert.ok(safeFileStem('a'.repeat(200)).length <= 50);
});

test('countWords', () => {
  assert.equal(countWords('  one two\nthree '), 3);
  assert.equal(countWords(''), 0);
});
