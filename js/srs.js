/*
 * Spaced repetition scheduler (SM-2 family, Anki-style learning steps).
 *
 * Card states:
 *   new        – never studied
 *   learning   – going through short learning steps (minutes)
 *   review     – graduated; scheduled in days
 *   relearning – a review card that was forgotten; short steps again
 *
 * Ratings: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy
 */
(function (root) {
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  const DEFAULTS = {
    learningSteps: [1, 10], // minutes
    relearningSteps: [10], // minutes
    graduatingInterval: 1, // days
    easyInterval: 4, // days
    startingEase: 2.5,
    minEase: 1.3,
    easyBonus: 1.3,
    hardFactor: 1.2,
    lapseFactor: 0.5, // new interval multiplier after forgetting
    maxInterval: 365 * 5, // days
    fuzz: true,
  };

  const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

  function newSrs() {
    return { state: 'new', due: 0, interval: 0, ease: null, step: 0, reps: 0, lapses: 0, lastReview: null };
  }

  function clampInterval(days, opts) {
    return Math.min(opts.maxInterval, Math.max(1, Math.round(days)));
  }

  // Small random spread so cards learned together don't stay clumped together.
  function fuzzed(days, opts, rand) {
    if (!opts.fuzz || days < 3) return days;
    const spread = Math.max(1, Math.round(days * 0.05));
    return days + Math.round((rand() * 2 - 1) * spread);
  }

  /**
   * Returns a new srs object for `card.srs` after answering with `rating` at time `now`.
   * Does not mutate the input.
   */
  function schedule(srs, rating, now, options, rand) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    rand = rand || Math.random;
    const s = Object.assign(newSrs(), srs || {});
    if (s.ease == null) s.ease = opts.startingEase;
    s.reps += 1;
    s.lastReview = now;

    const graduate = (days) => {
      s.state = 'review';
      s.step = 0;
      s.interval = clampInterval(days, opts);
      s.due = now + s.interval * DAY;
    };

    if (s.state === 'new' || s.state === 'learning' || s.state === 'relearning') {
      const relearn = s.state === 'relearning';
      const steps = relearn ? opts.relearningSteps : opts.learningSteps;
      if (s.state === 'new') {
        s.state = 'learning';
        s.step = 0;
      }
      switch (rating) {
        case RATING.AGAIN:
          s.step = 0;
          s.due = now + steps[0] * MINUTE;
          break;
        case RATING.HARD: {
          // Repeat the current step; on the first step use the average of the first two.
          const mins = s.step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[s.step] * 1.5;
          s.due = now + mins * MINUTE;
          break;
        }
        case RATING.GOOD:
          s.step += 1;
          if (s.step >= steps.length) {
            graduate(relearn ? s.interval : opts.graduatingInterval);
          } else {
            s.due = now + steps[s.step] * MINUTE;
          }
          break;
        case RATING.EASY:
          graduate(relearn ? s.interval + 1 : opts.easyInterval);
          break;
        default:
          throw new Error('Invalid rating: ' + rating);
      }
      return s;
    }

    // Review card
    const prev = Math.max(1, s.interval);
    const elapsedDays = srs && srs.lastReview ? Math.max(0, (now - srs.lastReview) / DAY) : prev;
    switch (rating) {
      case RATING.AGAIN:
        s.lapses += 1;
        s.ease = Math.max(opts.minEase, s.ease - 0.2);
        s.interval = clampInterval(prev * opts.lapseFactor, opts);
        s.state = 'relearning';
        s.step = 0;
        s.due = now + opts.relearningSteps[0] * MINUTE;
        break;
      case RATING.HARD:
        s.ease = Math.max(opts.minEase, s.ease - 0.15);
        s.interval = clampInterval(Math.max(prev + 1, fuzzed(prev * opts.hardFactor, opts, rand)), opts);
        s.due = now + s.interval * DAY;
        break;
      case RATING.GOOD: {
        // Reward cards remembered even though they were reviewed late.
        const base = Math.max(prev, elapsedDays);
        s.interval = clampInterval(Math.max(prev + 1, fuzzed(base * s.ease, opts, rand)), opts);
        s.due = now + s.interval * DAY;
        break;
      }
      case RATING.EASY: {
        const base = Math.max(prev, elapsedDays);
        s.ease += 0.15;
        s.interval = clampInterval(Math.max(prev + 2, fuzzed(base * s.ease * opts.easyBonus, opts, rand)), opts);
        s.due = now + s.interval * DAY;
        break;
      }
      default:
        throw new Error('Invalid rating: ' + rating);
    }
    return s;
  }

  /** Time until next review for each rating, for labelling the answer buttons. */
  function preview(srs, now, options) {
    const out = {};
    for (const r of [1, 2, 3, 4]) {
      const next = schedule(srs, r, now, Object.assign({}, options, { fuzz: false }));
      out[r] = next.due - now;
    }
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

  const SRS = { DEFAULTS, RATING, MINUTE, DAY, newSrs, schedule, preview, formatInterval, isDue, masteryLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = SRS;
  else root.SRS = SRS;
})(typeof window !== 'undefined' ? window : globalThis);
