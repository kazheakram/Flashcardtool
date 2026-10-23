/*
 * Shared UI helpers used by every view.
 */
(function (root) {
  const app = document.getElementById('app');
  const state = { keyHandler: null, cleanup: [] };

  const esc = Rich.esc;
  const $ = (sel, el) => (el || app).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || app).querySelectorAll(sel));
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function go(hash) {
    if (location.hash === hash) root.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = hash;
  }

  /** Set the page HTML, then load images and wire up anything common. */
  function render(html) {
    app.innerHTML = html;
    Images.hydrate(app);
  }

  function toast(msg, ms) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, ms || 2400);
  }

  function download(filename, text, type) {
    const blob = text instanceof Blob ? text : new Blob([text], { type: type || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  const slug = (s) => (s || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';

  function fmtDuration(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  /** Scheduler options for a deck (adds its exam date). */
  function srsOptions(deck) {
    const s = Store.state.settings;
    return {
      algorithm: s.algorithm,
      desiredRetention: s.desiredRetention,
      learningSteps: s.learningSteps,
      relearningSteps: s.relearningSteps,
      graduatingInterval: s.graduatingInterval,
      easyInterval: s.easyInterval,
      examDate: deck && deck.examDate && deck.examDate > Date.now() ? deck.examDate : null,
    };
  }

  // ---------- answer checking ----------

  function normalize(s) {
    return String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(the|a|an|to) /, '');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  const similar = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

  const STOP = new Set('the a an and or of to in on for with by from at as is are was were be been it its this that these those which who what when where how why into than then there their they them can will would should could also not but more most less very such each other some any all one two'.split(' '));
  const contentWords = (s) => normalize(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

  function containsTerm(given, term) {
    const t = normalize(term);
    if (!t) return false;
    if ((' ' + given + ' ').includes(' ' + t + ' ')) return true;
    const words = given.split(' ');
    const n = t.split(' ').length;
    for (let i = 0; i + n <= words.length; i++) if (similar(words.slice(i, i + n).join(' '), t) >= 0.8) return true;
    return false;
  }

  /** Returns 'correct' | 'close' | 'wrong'. */
  function checkAnswer(input, answerRaw) {
    const answer = Rich.plainText(answerRaw);
    const given = normalize(input);
    if (!given) return 'wrong';
    const options = [answer, ...answer.split(/\s*(?:[/;,\n]|\bor\b)\s*/)].map(normalize).filter(Boolean);
    let best = 0;
    for (const opt of options) {
      if (opt === given) return 'correct';
      best = Math.max(best, similar(given, opt));
    }
    if (best >= 0.85) return 'close';
    const keys = contentWords(answer);
    if (keys.length >= 3) {
      const hit = keys.filter((w) => containsTerm(given, w)).length / keys.length;
      if (hit >= 0.75) return 'correct';
      if (hit >= 0.5) return 'close';
    }
    return 'wrong';
  }

  /** Grade a long answer against mark-scheme points. Returns [{ text, hit }]. */
  function gradePoints(input, points) {
    const given = normalize(input);
    return points.map((p) => {
      let hit;
      if (p.keywords.length) hit = p.keywords.every((alts) => alts.some((a) => containsTerm(given, a)));
      else {
        const keys = contentWords(p.text);
        hit = keys.length ? keys.filter((w) => containsTerm(given, w)).length / keys.length >= 0.6 : false;
      }
      return { text: p.text, hit };
    });
  }

  function pointsResult(graded) {
    const pct = graded.filter((g) => g.hit).length / graded.length;
    return pct >= 0.8 ? 'correct' : pct >= 0.5 ? 'close' : 'wrong';
  }

  function hintText(answer, level) {
    return Rich.plainText(answer).replace(/\p{L}+/gu, (w) => {
      const keep = level === 1 ? 1 : Math.ceil(w.length / 2);
      return w.slice(0, keep) + '_'.repeat(Math.max(0, w.length - keep));
    });
  }

  // ---------- tooltip (for charts and anything with data-tip) ----------

  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  document.body.appendChild(tip);
  function showTip(e) {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) return (tip.hidden = true);
    tip.innerHTML = t.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 12;
    let y = e.clientY - r.height - 10;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 12;
    if (y < 8) y = e.clientY + 16;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = y + 'px';
  }
  document.addEventListener('pointermove', showTip);
  document.addEventListener('pointerdown', showTip);
  document.addEventListener('scroll', () => (tip.hidden = true), true);

  // ---------- view lifecycle ----------

  function setKeys(fn) {
    state.keyHandler = fn;
  }
  function onLeave(fn) {
    state.cleanup.push(fn);
  }
  function leave() {
    state.cleanup.splice(0).forEach((fn) => fn());
    state.keyHandler = null;
    tip.hidden = true;
  }
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (state.keyHandler) state.keyHandler(e);
  });

  function notFound(what) {
    render(`<div class="empty"><h2>${esc(what || 'Deck')} not found</h2><a class="btn" href="#/">Back to decks</a></div>`);
  }

  root.UI = { app, esc, $, $$, plural, shuffle, go, render, toast, download, copyText, slug, fmtDuration, srsOptions, normalize, checkAnswer, gradePoints, pointsResult, hintText, setKeys, onLeave, leave, notFound };
  root.Views = {};
})(window);
