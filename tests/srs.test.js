const test = require('node:test');
const assert = require('node:assert');
const SRS = require('../js/srs.js');

const { MINUTE, DAY } = SRS;
const now = Date.UTC(2026, 0, 1);
const sm2 = { algorithm: 'sm2', fuzz: false };
const fsrs = { algorithm: 'fsrs', fuzz: false };

test('learning steps then graduation (both algorithms)', () => {
  for (const opts of [sm2, fsrs]) {
    let s = SRS.schedule(SRS.newSrs(), 3, now, opts);
    assert.equal(s.state, 'learning');
    assert.equal(s.due - now, 10 * MINUTE);
    s = SRS.schedule(s, 3, now + 10 * MINUTE, opts);
    assert.equal(s.state, 'review', opts.algorithm);
    assert.ok(s.interval >= 1);
  }
});

test('Again resets to first step; Easy graduates immediately', () => {
  for (const opts of [sm2, fsrs]) {
    assert.equal(SRS.schedule(SRS.newSrs(), 1, now, opts).due - now, MINUTE);
    const easy = SRS.schedule(SRS.newSrs(), 4, now, opts);
    assert.equal(easy.state, 'review');
  }
  assert.equal(SRS.schedule(SRS.newSrs(), 4, now, sm2).interval, 4);
});

test('FSRS: intervals ordered Hard < Good < Easy and grow with each success', () => {
  let s = SRS.schedule(SRS.schedule(SRS.newSrs(), 3, now, fsrs), 3, now + 10 * MINUTE, fsrs);
  let t = now + 10 * MINUTE;
  const intervals = [];
  for (let i = 0; i < 4; i++) {
    t = s.due;
    const p = SRS.preview(s, t, fsrs);
    assert.ok(p[2] < p[3] && p[3] < p[4], 'ordering at step ' + i);
    s = SRS.schedule(s, 3, t, fsrs);
    intervals.push(s.interval);
  }
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] > intervals[i - 1], intervals.join(','));
});

test('FSRS: higher target retention gives shorter intervals', () => {
  const card = { state: 'review', interval: 10, stability: 10, difficulty: 5, step: 0, reps: 3, lapses: 0, due: now, lastReview: now - 10 * DAY };
  const lo = SRS.schedule(card, 3, now, Object.assign({}, fsrs, { desiredRetention: 0.8 }));
  const hi = SRS.schedule(card, 3, now, Object.assign({}, fsrs, { desiredRetention: 0.95 }));
  assert.ok(hi.interval < lo.interval);
});

test('FSRS: forgetting lowers stability and enters relearning', () => {
  const card = { state: 'review', interval: 20, stability: 20, difficulty: 5, step: 0, reps: 5, lapses: 0, due: now, lastReview: now - 20 * DAY };
  const s = SRS.schedule(card, 1, now, fsrs);
  assert.equal(s.state, 'relearning');
  assert.equal(s.lapses, 1);
  assert.ok(s.stability < 20);
  assert.ok(s.difficulty > 5);
});

test('SM-2 cards migrate to FSRS', () => {
  const old = { state: 'review', interval: 12, ease: 2.5, step: 0, reps: 4, lapses: 0, due: now, lastReview: now - 12 * DAY };
  const s = SRS.schedule(old, 3, now, fsrs);
  assert.ok(s.stability > 12 && s.difficulty >= 1 && s.difficulty <= 10);
  assert.ok(s.interval > 12);
});

test('SM-2 review maths', () => {
  const card = { state: 'review', interval: 10, ease: 2.5, step: 0, reps: 5, lapses: 0, due: now, lastReview: now - 10 * DAY };
  assert.equal(SRS.schedule(card, 3, now, sm2).interval, 25);
  const lapse = SRS.schedule(card, 1, now, sm2);
  assert.equal(lapse.state, 'relearning');
  assert.equal(lapse.ease, 2.3);
});

test('exam date caps intervals so cards come up before the exam', () => {
  const card = { state: 'review', interval: 30, stability: 30, difficulty: 5, step: 0, reps: 5, lapses: 0, due: now, lastReview: now - 30 * DAY };
  const examDate = now + 10 * DAY;
  for (const opts of [sm2, fsrs]) {
    const s = SRS.schedule(card, 3, now, Object.assign({}, opts, { examDate }));
    assert.ok(s.due < examDate, opts.algorithm);
    assert.equal(s.interval, 9);
  }
  // Exam already passed: no cap.
  assert.ok(SRS.schedule(card, 3, now, Object.assign({}, fsrs, { examDate: now - DAY })).interval > 30);
});

test('recall probability, formatting and mastery', () => {
  const s = { state: 'review', stability: 10, difficulty: 5, interval: 10, lastReview: now };
  assert.ok(Math.abs(SRS.recallProbability(s, now + 10 * DAY) - 0.9) < 0.001);
  assert.equal(SRS.recallProbability(SRS.newSrs(), now), 0);
  assert.equal(SRS.formatInterval(10 * MINUTE), '10m');
  assert.equal(SRS.formatInterval(3 * DAY), '3d');
  assert.equal(SRS.masteryLevel({ state: 'review', interval: 30 }), 'mastered');
  const n = SRS.newSrs();
  SRS.schedule(n, 3, now);
  assert.equal(n.state, 'new', 'input not mutated');
});
