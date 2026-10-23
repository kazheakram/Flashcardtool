const test = require('node:test');
const assert = require('node:assert');
const SRS = require('../js/srs.js');

const { MINUTE, DAY } = SRS;
const now = Date.UTC(2026, 0, 1);
const noFuzz = { fuzz: false };

test('new card: Good walks through learning steps then graduates', () => {
  let s = SRS.newSrs();
  s = SRS.schedule(s, 3, now, noFuzz);
  assert.equal(s.state, 'learning');
  assert.equal(s.due - now, 10 * MINUTE);
  s = SRS.schedule(s, 3, now + 10 * MINUTE, noFuzz);
  assert.equal(s.state, 'review');
  assert.equal(s.interval, 1);
});

test('new card: Again resets to first step, Easy graduates immediately', () => {
  const again = SRS.schedule(SRS.newSrs(), 1, now, noFuzz);
  assert.equal(again.due - now, 1 * MINUTE);
  const easy = SRS.schedule(SRS.newSrs(), 4, now, noFuzz);
  assert.equal(easy.state, 'review');
  assert.equal(easy.interval, 4);
});

test('review intervals grow with ease and order Hard < Good < Easy', () => {
  const card = { state: 'review', interval: 10, ease: 2.5, step: 0, reps: 5, lapses: 0, due: now, lastReview: now - 10 * DAY };
  const p = SRS.preview(card, now);
  assert.ok(p[2] < p[3] && p[3] < p[4], 'ordering');
  assert.equal(SRS.schedule(card, 3, now, noFuzz).interval, 25);
});

test('forgetting a review card lowers ease and enters relearning', () => {
  const card = { state: 'review', interval: 20, ease: 2.5, step: 0, reps: 5, lapses: 0, due: now, lastReview: now - 20 * DAY };
  const s = SRS.schedule(card, 1, now, noFuzz);
  assert.equal(s.state, 'relearning');
  assert.equal(s.lapses, 1);
  assert.equal(s.ease, 2.3);
  assert.equal(s.interval, 10);
  const back = SRS.schedule(s, 3, now + 10 * MINUTE, noFuzz);
  assert.equal(back.state, 'review');
  assert.equal(back.interval, 10);
});

test('ease never drops below minimum', () => {
  let s = { state: 'review', interval: 5, ease: 1.35, step: 0, reps: 1, lapses: 0, due: now, lastReview: now };
  s = SRS.schedule(s, 2, now, noFuzz);
  assert.equal(s.ease, 1.3);
});

test('does not mutate input and formats intervals', () => {
  const s = SRS.newSrs();
  SRS.schedule(s, 3, now);
  assert.equal(s.state, 'new');
  assert.equal(SRS.formatInterval(10 * MINUTE), '10m');
  assert.equal(SRS.formatInterval(3 * DAY), '3d');
  assert.equal(SRS.masteryLevel({ state: 'review', interval: 30 }), 'mastered');
});
