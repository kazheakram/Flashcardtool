/*
 * Spaced repetition schedulers.
 *
 *   fsrs (default) – FSRS-5: models each card's memory stability (days until recall
 *                    probability falls to 90%) and difficulty (1–10), and schedules the
 *                    next review for when recall is predicted to drop to the desired retention.
 *   sm2            – classic SM-2 / Anki-style ease factors.
 *
 * Both use short learning steps (minutes) for new and forgotten cards.
 *
 * Card states: new · learning · review · relearning
 * Ratings:     1 = Again, 2 = Hard, 3 = Good, 4 = Easy
 */
(function (root) {
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  // FSRS-5 default parameters.
  const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
  const DECAY = -0.5;
  const FACTOR = 19 / 81;

  const DEFAULTS = {
    algorithm: 'fsrs',
    desiredRetention: 0.9,
    learningSteps: [1, 10], // minutes
    relearningSteps: [10], // minutes
    graduatingInterval: 1, // days (SM-2)
    easyInterval: 4, // days (SM-2)
    startingEase: 2.5,
    minEase: 1.3,
    easyBonus: 1.3,
    hardFactor: 1.2,
    lapseFactor: 0.5,
    maxInterval: 365 * 5,
    examDate: null, // timestamp; reviews are capped so cards come up before it
    fuzz: true,
  };

  const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

  function newSrs() {
    return { state: 'new', due: 0, interval: 0, ease: null, stability: null, difficulty: null, step: 0, reps: 0, lapses: 0, lastReview: null };
  }

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // ---------- FSRS maths ----------

  function retrievability(elapsedDays, stability) {
    return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
  }
  function fsrsInterval(stability, retention) {
    return (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  }
  const initStability = (g) => Math.max(0.1, W[g - 1]);
  const initDifficulty = (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
  function nextDifficulty(d, g) {
    const delta = -W[6] * (g - 3);
    const d2 = d + (delta * (10 - d)) / 9;
    return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * d2, 1, 10);
  }
  function recallStability(d, s, r, g) {
    const hardPenalty = g === 2 ? W[15] : 1;
    const easyBonus = g === 4 ? W[16] : 1;
    return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus);
  }
  function forgetStability(d, s, r) {
    return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
  }
  const shortTermStability = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));

  /** Fill in FSRS memory state for cards created under SM-2 (or older versions). */
  function ensureMemory(s) {
    if (s.stability != null && s.difficulty != null) return;
    if (s.state === 'new') return;
    s.stability = Math.max(0.5, s.interval || 1);
    const ease = s.ease || 2.5;
    s.difficulty = clamp(10 - (ease - 1.3) * 4.2, 1, 10);
  }

  /** Probability (0–1) the card is currently remembered. */
  function recallProbability(srs, now) {
    if (!srs || srs.state === 'new' || !srs.lastReview) return 0;
    const s = Object.assign({}, srs);
    ensureMemory(s);
    return retrievability(Math.max(0, (now - srs.lastReview) / DAY), s.stability);
  }

  // ---------- shared helpers ----------

  function fuzzed(days, opts, rand) {
    if (!opts.fuzz || days < 3) return days;
    const spread = Math.max(1, Math.round(days * 0.05));
    return days + Math.round((rand() * 2 - 1) * spread);
  }

  function capForExam(days, now, opts) {
    if (!opts.examDate) return days;
    const daysLeft = Math.floor((opts.examDate - now) / DAY);
    if (daysLeft < 2) return days; // exam is today/tomorrow or already over
    return Math.min(days, daysLeft - 1); // last review the day before the exam
  }

  function finishInterval(days, now, opts) {
    return clamp(Math.round(capForExam(Math.min(opts.maxInterval, days), now, opts)), 1, opts.maxInterval);
  }

  /**
   * Returns a new srs object after answering with `rating` at time `now`.
   * Does not mutate the input.
   */
  function schedule(srs, rating, now, options, rand) {
    if (![1, 2, 3, 4].includes(rating)) throw new Error('Invalid rating: ' + rating);
    const opts = Object.assign({}, DEFAULTS, options || {});
    rand = rand || Math.random;
    return opts.algorithm === 'sm2' ? scheduleSm2(srs, rating, now, opts, rand) : scheduleFsrs(srs, rating, now, opts, rand);
  }

  // Learning / relearning steps, shared by both algorithms. Returns true if the card graduated.
  function stepCard(s, rating, now, steps, graduate) {
    switch (rating) {
      case 1:
        s.step = 0;
        s.due = now + steps[0] * MINUTE;
        return false;
      case 2: {
        const mins = s.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[s.step] * 1.5;
        s.due = now + mins * MINUTE;
        return false;
      }
      case 3:
        s.step += 1;
        if (s.step >= steps.length) {
          graduate(3);
          return true;
        }
        s.due = now + steps[s.step] * MINUTE;
        return false;
      case 4:
        graduate(4);
        return true;
    }
  }

  function toReview(s, days, now) {
    s.state = 'review';
    s.step = 0;
    s.interval = days;
    s.due = now + days * DAY;
  }

  // ---------- FSRS ----------

  function scheduleFsrs(srs, rating, now, opts, rand) {
    const s = Object.assign(newSrs(), srs || {});
    const prevReview = s.lastReview;
    s.reps += 1;
    s.lastReview = now;
    const ivl = (stab) => fsrsInterval(stab, opts.desiredRetention);

    if (s.state === 'new') {
      s.state = 'learning';
      s.step = 0;
      s.stability = initStability(rating);
      s.difficulty = initDifficulty(rating);
      stepCard(s, rating, now, opts.learningSteps, (g) => {
        // Easy from new should beat what Good would have given.
        const good = ivl(initStability(3));
        const days = g === 4 ? Math.max(ivl(s.stability), good + 1) : ivl(s.stability);
        toReview(s, finishInterval(days, now, opts), now);
      });
      return s;
    }

    ensureMemory(s);

    if (s.state === 'learning' || s.state === 'relearning') {
      s.difficulty = nextDifficulty(s.difficulty, rating);
      s.stability = Math.max(0.1, shortTermStability(s.stability, rating));
      const steps = s.state === 'relearning' ? opts.relearningSteps : opts.learningSteps;
      stepCard(s, rating, now, steps, () => toReview(s, finishInterval(ivl(s.stability), now, opts), now));
      return s;
    }

    // Review card
    const elapsed = prevReview ? Math.max(0, (now - prevReview) / DAY) : s.interval;
    const r = retrievability(elapsed, s.stability);
    const d = s.difficulty;
    if (rating === 1) {
      s.lapses += 1;
      s.difficulty = nextDifficulty(d, 1);
      s.stability = Math.max(0.1, forgetStability(d, s.stability, r));
      s.state = 'relearning';
      s.step = 0;
      s.interval = Math.max(1, Math.round(ivl(s.stability)));
      s.due = now + opts.relearningSteps[0] * MINUTE;
      return s;
    }
    // Compute all three so intervals stay ordered Hard < Good < Easy.
    const stab = { 2: recallStability(d, s.stability, r, 2), 3: recallStability(d, s.stability, r, 3), 4: recallStability(d, s.stability, r, 4) };
    let hard = Math.max(1, Math.round(ivl(stab[2])));
    let good = Math.max(1, Math.round(fuzzed(ivl(stab[3]), opts, rand)));
    let easy = Math.max(1, Math.round(fuzzed(ivl(stab[4]), opts, rand)));
    hard = Math.min(hard, good);
    good = Math.max(good, hard + 1);
    easy = Math.max(easy, good + 1);
    s.difficulty = nextDifficulty(d, rating);
    s.stability = stab[rating];
    toReview(s, finishInterval({ 2: hard, 3: good, 4: easy }[rating], now, opts), now);
    return s;
  }

  // ---------- SM-2 ----------

  function scheduleSm2(srs, rating, now, opts, rand) {
    const s = Object.assign(newSrs(), srs || {});
    if (s.ease == null) s.ease = opts.startingEase;
    const prevReview = s.lastReview;
    s.reps += 1;
    s.lastReview = now;

    if (s.state !== 'review') {
      const relearn = s.state === 'relearning';
      if (s.state === 'new') {
        s.state = 'learning';
        s.step = 0;
      }
      stepCard(s, rating, now, relearn ? opts.relearningSteps : opts.learningSteps, (g) => {
        const days = relearn ? (g === 4 ? s.interval + 1 : s.interval) : g === 4 ? opts.easyInterval : opts.graduatingInterval;
        toReview(s, finishInterval(days, now, opts), now);
      });
      return s;
    }

    const prev = Math.max(1, s.interval);
    const elapsed = prevReview ? Math.max(0, (now - prevReview) / DAY) : prev;
    const base = Math.max(prev, elapsed); // reward cards remembered after a late review
    switch (rating) {
      case 1:
        s.lapses += 1;
        s.ease = Math.max(opts.minEase, s.ease - 0.2);
        s.interval = finishInterval(prev * opts.lapseFactor, now, opts);
        s.state = 'relearning';
        s.step = 0;
        s.due = now + opts.relearningSteps[0] * MINUTE;
        return s;
      case 2:
        s.ease = Math.max(opts.minEase, s.ease - 0.15);
        toReview(s, finishInterval(Math.max(prev + 1, fuzzed(prev * opts.hardFactor, opts, rand)), now, opts), now);
        return s;
      case 3:
        toReview(s, finishInterval(Math.max(prev + 1, fuzzed(base * s.ease, opts, rand)), now, opts), now);
        return s;
      case 4:
        s.ease += 0.15;
        toReview(s, finishInterval(Math.max(prev + 2, fuzzed(base * s.ease * opts.easyBonus, opts, rand)), now, opts), now);
        return s;
    }
  }

  /** Time until next review for each rating, for labelling the answer buttons. */
  function preview(srs, now, options) {
    const out = {};
    for (const r of [1, 2, 3, 4]) out[r] = schedule(srs, r, now, Object.assign({}, options, { fuzz: false })).due - now;
    return out;
  }

  function formatInterval(ms) {
    const mins = ms / MINUTE;
    if (mins < 1) return '<1m';
    if (mins < 60) return Math.round(mins) + 'm';
    const hours = mins / 60;
    if (hours < 24) return Math.round(hours) + 'h';
    const days = ms / DAY;
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) return +(days / 30).toFixed(1) + 'mo';
    return +(days / 365).toFixed(1) + 'y';
  }

  function isDue(srs, now) {
    return srs.state !== 'new' && srs.due <= now;
  }

  /** "Mastered" = review card with an interval of 21+ days (Anki's "mature"). */
  function masteryLevel(srs) {
    if (!srs || srs.state === 'new') return 'new';
    if (srs.state === 'learning' || srs.state === 'relearning') return 'learning';
    return srs.interval >= 21 ? 'mastered' : 'young';
  }

  const SRS = { DEFAULTS, RATING, MINUTE, DAY, newSrs, schedule, preview, formatInterval, isDue, masteryLevel, recallProbability, retrievability, fsrsInterval };
  if (typeof module !== 'undefined' && module.exports) module.exports = SRS;
  else root.SRS = SRS;
})(typeof window !== 'undefined' ? window : globalThis);
