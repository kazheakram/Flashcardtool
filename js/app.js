/*
 * Recall — flashcards with spaced repetition and active recall.
 * Plain JS single-page app; hash routes:
 *   #/                     decks
 *   #/deck/:id             deck overview
 *   #/deck/:id/edit        card editor (id "new" creates a deck)
 *   #/review/:id           spaced-repetition review (id "all" = every deck)
 *   #/flash/:id            flip-card mode
 *   #/quiz/:id             quiz (multiple choice / written / true-false)
 *   #/import               import cards
 *   #/settings             settings & backup
 */
(function () {
  const app = document.getElementById('app');
  let keyHandler = null; // keyboard handler of the active view
  let cleanup = null;

  // ---------- helpers ----------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2400);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
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

  const slug = (s) => (s || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';

  function srsOptions() {
    const s = Store.state.settings;
    return { learningSteps: s.learningSteps, relearningSteps: s.relearningSteps, graduatingInterval: s.graduatingInterval, easyInterval: s.easyInterval };
  }

  function decksFor(id) {
    if (id === 'all') return Store.state.decks;
    const d = Store.getDeck(id);
    return d ? [d] : [];
  }

  function notFound() {
    app.innerHTML = `<div class="empty"><h2>Deck not found</h2><a class="btn" href="#/">Back to decks</a></div>`;
  }

  // ---------- answer checking (active recall) ----------

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
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /** Returns 'correct' | 'close' | 'wrong'. */
  function checkAnswer(input, answer) {
    const given = normalize(input);
    if (!given) return 'wrong';
    const options = [answer, ...String(answer).split(/\s*(?:[/;,\n]|\bor\b)\s*/)].map(normalize).filter(Boolean);
    let best = 0;
    for (const opt of options) {
      if (opt === given) return 'correct';
      const sim = 1 - levenshtein(given, opt) / Math.max(given.length, opt.length);
      best = Math.max(best, sim);
    }
    if (best >= 0.85) return 'close';
    // Longer definitions: accept if most key words were recalled.
    const keywords = normalize(answer).split(' ').filter((w) => w.length > 3);
    if (keywords.length >= 3) {
      const givenWords = new Set(given.split(' '));
      const hit = keywords.filter((w) => givenWords.has(w) || [...givenWords].some((g) => g.length > 3 && 1 - levenshtein(g, w) / Math.max(g.length, w.length) >= 0.8)).length;
      if (hit / keywords.length >= 0.75) return 'correct';
      if (hit / keywords.length >= 0.5) return 'close';
    }
    return 'wrong';
  }

  function hintText(answer, level) {
    // level 1: first letter of each word, level 2: first half of each word
    return String(answer).replace(/\p{L}+/gu, (w) => {
      const keep = level === 1 ? 1 : Math.ceil(w.length / 2);
      return w.slice(0, keep) + '_'.repeat(Math.max(0, w.length - keep));
    });
  }

  // ---------- views: home ----------

  function viewHome() {
    const now = Date.now();
    const decks = Store.state.decks;
    const log = Store.state.log[Store.todayKey(now)] || { reviews: 0 };
    let totalDue = 0;
    const deckCards = decks
      .map((d) => {
        const s = Store.deckStats(d, now);
        const due = s.due + s.dueLearning;
        totalDue += due;
        const pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
        return `
        <a class="deck-card" href="#/deck/${d.id}">
          <div class="deck-card-top">
            <h3>${esc(d.name)}</h3>
            <span class="muted">${plural(s.total, 'card')}</span>
          </div>
          ${d.description ? `<p class="muted small clamp">${esc(d.description)}</p>` : ''}
          <div class="mastery-bar" title="${s.mastered} mastered, ${s.young} reviewing, ${s.learning} learning, ${s.new} new">
            <span class="seg mastered" style="flex:${s.mastered}"></span>
            <span class="seg young" style="flex:${s.young}"></span>
            <span class="seg learning" style="flex:${s.learning}"></span>
            <span class="seg new" style="flex:${s.new}"></span>
          </div>
          <div class="deck-card-foot">
            <span class="pill ${due ? 'pill-due' : ''}">${due} due</span>
            <span class="pill pill-new">${s.new} new</span>
            <span class="muted small">${pct}% mastered</span>
          </div>
        </a>`;
      })
      .join('');

    app.innerHTML = `
      <section class="hero">
        <div class="stats-row">
          <div class="stat"><span class="stat-num">${Store.streak(now)}</span><span class="stat-label">day streak 🔥</span></div>
          <div class="stat"><span class="stat-num">${totalDue}</span><span class="stat-label">cards due</span></div>
          <div class="stat"><span class="stat-num">${log.reviews}</span><span class="stat-label">reviewed today</span></div>
        </div>
        <div class="hero-actions">
          ${totalDue ? `<a class="btn btn-primary" href="#/review/all">Review all due (${totalDue})</a>` : ''}
          <a class="btn" href="#/deck/new/edit">+ New deck</a>
          <a class="btn" href="#/import">Import</a>
        </div>
      </section>
      ${
        decks.length
          ? `<h2 class="section-title">Your decks</h2><div class="deck-grid">${deckCards}</div>`
          : `<div class="empty">
              <h2>No decks yet</h2>
              <p class="muted">Create a deck, import from Quizlet / Anki / CSV, or try a sample deck.</p>
              <div class="row center">
                <a class="btn btn-primary" href="#/deck/new/edit">Create a deck</a>
                <a class="btn" href="#/import">Import cards</a>
                <button class="btn" id="sample">Try a sample deck</button>
              </div>
            </div>`
      }`;
    const sample = $('#sample');
    if (sample)
      sample.onclick = () => {
        const d = Store.createDeck('Sample: World capitals', 'A small deck to try out review, flashcards and quiz modes.', [
          { front: 'France', back: 'Paris' },
          { front: 'Japan', back: 'Tokyo' },
          { front: 'Canada', back: 'Ottawa' },
          { front: 'Australia', back: 'Canberra' },
          { front: 'Brazil', back: 'Brasília' },
          { front: 'Kenya', back: 'Nairobi' },
          { front: 'Egypt', back: 'Cairo' },
          { front: 'Norway', back: 'Oslo' },
          { front: 'Argentina', back: 'Buenos Aires' },
          { front: 'South Korea', back: 'Seoul' },
        ]);
        go('#/deck/' + d.id);
      };
  }

  // ---------- views: deck overview ----------

  function viewDeck(id) {
    const deck = Store.getDeck(id);
    if (!deck) return notFound();
    const now = Date.now();
    const s = Store.deckStats(deck, now);
    const due = s.due + s.dueLearning;
    const settings = Store.state.settings;
    const daily = deck.daily && deck.daily.date === Store.todayKey(now) ? deck.daily : { newCount: 0 };
    const newAvail = Math.min(s.new, Math.max(0, settings.newPerDay - daily.newCount));
    let filter = '';
    let starredOnly = false;

    const nextDue = deck.cards.filter((c) => c.srs.state !== 'new' && c.srs.due > now).sort((a, b) => a.srs.due - b.srs.due)[0];

    app.innerHTML = `
      <nav class="crumbs"><a href="#/">Decks</a> / <span>${esc(deck.name)}</span></nav>
      <header class="deck-head">
        <div>
          <h1>${esc(deck.name)}</h1>
          ${deck.description ? `<p class="muted">${esc(deck.description)}</p>` : ''}
        </div>
        <div class="row">
          <a class="btn" href="#/deck/${deck.id}/edit">Edit</a>
          <div class="dropdown">
            <button class="btn" id="more" aria-haspopup="true">⋯</button>
            <div class="menu" id="menu" hidden>
              <button data-act="export-json">Export (JSON with progress)</button>
              <button data-act="export-txt">Export text (Quizlet / Anki)</button>
              <button data-act="import">Import more cards</button>
              <button data-act="reset">Reset progress</button>
              <button data-act="delete" class="danger">Delete deck</button>
            </div>
          </div>
        </div>
      </header>

      <div class="mastery-summary">
        <div class="ms"><b class="c-new">${s.new}</b><span>New</span></div>
        <div class="ms"><b class="c-learning">${s.learning}</b><span>Learning</span></div>
        <div class="ms"><b class="c-young">${s.young}</b><span>Reviewing</span></div>
        <div class="ms"><b class="c-mastered">${s.mastered}</b><span>Mastered</span></div>
      </div>

      <div class="modes">
        <a class="mode mode-primary" href="#/review/${deck.id}">
          <span class="mode-icon">🧠</span>
          <span class="mode-title">Review</span>
          <span class="mode-sub">${due || newAvail ? `${due} due · ${newAvail} new` : nextDue ? 'All caught up · next in ' + SRS.formatInterval(nextDue.srs.due - now) : 'All caught up'}</span>
          <span class="mode-desc">Spaced repetition with active recall</span>
        </a>
        <a class="mode" href="#/flash/${deck.id}">
          <span class="mode-icon">🃏</span>
          <span class="mode-title">Flashcards</span>
          <span class="mode-desc">Flip through and sort what you know</span>
        </a>
        <a class="mode" href="#/quiz/${deck.id}">
          <span class="mode-icon">✍️</span>
          <span class="mode-title">Quiz</span>
          <span class="mode-desc">Multiple choice, written & true/false</span>
        </a>
      </div>

      <div class="list-head">
        <h2 class="section-title">${plural(deck.cards.length, 'card')}</h2>
        <div class="row">
          <label class="check"><input type="checkbox" id="starred"> ★ only</label>
          <input class="input" id="search" type="search" placeholder="Search cards">
        </div>
      </div>
      <div id="cardlist" class="card-list"></div>`;

    function renderList() {
      const q = filter.toLowerCase();
      const items = deck.cards.filter((c) => (!starredOnly || c.starred) && (!q || c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)));
      $('#cardlist').innerHTML = items.length
        ? items
            .map((c) => {
              const lvl = SRS.masteryLevel(c.srs);
              const dueTxt = c.srs.state === 'new' ? 'new' : c.srs.due <= now ? 'due now' : 'due in ' + SRS.formatInterval(c.srs.due - now);
              return `
            <div class="card-row">
              <div class="card-front">${esc(c.front)}</div>
              <div class="card-back">${esc(c.back)}</div>
              <div class="card-meta">
                <span class="badge b-${lvl}" title="${dueTxt}">${lvl === 'young' ? 'reviewing' : lvl}</span>
                <button class="star ${c.starred ? 'on' : ''}" data-star="${c.id}" title="Star">★</button>
              </div>
            </div>`;
            })
            .join('')
        : `<p class="muted center pad">${deck.cards.length ? 'No matching cards.' : 'This deck is empty. <a href="#/deck/' + deck.id + '/edit">Add cards</a> or <a href="#/import?deck=' + deck.id + '">import</a>.'}</p>`;
      $$('[data-star]').forEach((b) => {
        b.onclick = () => {
          const c = deck.cards.find((x) => x.id === b.dataset.star);
          c.starred = !c.starred;
          Store.save();
          b.classList.toggle('on', c.starred);
        };
      });
    }
    renderList();
    $('#search').oninput = (e) => {
      filter = e.target.value;
      renderList();
    };
    $('#starred').onchange = (e) => {
      starredOnly = e.target.checked;
      renderList();
    };

    const menu = $('#menu');
    $('#more').onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    };
    const closeMenu = () => (menu.hidden = true);
    document.addEventListener('click', closeMenu);
    cleanup = () => document.removeEventListener('click', closeMenu);

    menu.onclick = (e) => {
      const act = e.target.dataset.act;
      if (act === 'export-json') download(slug(deck.name) + '.json', Store.exportJson([deck]));
      if (act === 'export-txt') download(slug(deck.name) + '.txt', deck.cards.map((c) => c.front.replace(/[\t\n]/g, ' ') + '\t' + c.back.replace(/[\t\n]/g, ' ')).join('\n'), 'text/plain');
      if (act === 'import') go('#/import?deck=' + deck.id);
      if (act === 'reset' && confirm('Reset spaced-repetition progress for every card in this deck?')) {
        deck.cards.forEach((c) => (c.srs = SRS.newSrs()));
        deck.daily = null;
        Store.save();
        render();
      }
      if (act === 'delete' && confirm(`Delete "${deck.name}" and all ${deck.cards.length} cards? This can't be undone.`)) {
        Store.deleteDeck(deck.id);
        go('#/');
      }
    };
  }

  // ---------- views: editor ----------

  function viewEdit(id) {
    const isNew = id === 'new';
    const deck = isNew ? null : Store.getDeck(id);
    if (!isNew && !deck) return notFound();
    const rows = deck ? deck.cards.map((c) => ({ id: c.id, front: c.front, back: c.back })) : [{ front: '', back: '' }, { front: '', back: '' }, { front: '', back: '' }];
    let dirty = false;

    app.innerHTML = `
      <nav class="crumbs"><a href="#/">Decks</a> / ${deck ? `<a href="#/deck/${deck.id}">${esc(deck.name)}</a> / <span>Edit</span>` : '<span>New deck</span>'}</nav>
      <div class="editor-head">
        <input class="input input-lg" id="name" placeholder="Deck title, e.g. Biology – Cell structure" value="${esc(deck ? deck.name : '')}">
        <textarea class="input" id="desc" rows="2" placeholder="Description (optional)">${esc(deck ? deck.description : '')}</textarea>
      </div>
      <div class="row between">
        <p class="muted small">Tip: press <kbd>Tab</kbd> in the last definition to add a new card. Need to add lots? <a href="#/import${deck ? '?deck=' + deck.id : ''}">Import instead</a>.</p>
        <button class="btn" id="swap" title="Swap terms and definitions">⇄ Swap all</button>
      </div>
      <div id="rows" class="edit-rows"></div>
      <button class="btn btn-block add-row" id="add">+ Add card</button>
      <div class="sticky-actions">
        <a class="btn" href="${deck ? '#/deck/' + deck.id : '#/'}">Cancel</a>
        <button class="btn btn-primary" id="save">${isNew ? 'Create deck' : 'Save'}</button>
      </div>`;

    function renderRows(focusLast) {
      $('#rows').innerHTML = rows
        .map(
          (r, i) => `
        <div class="edit-row" data-i="${i}">
          <span class="num">${i + 1}</span>
          <label class="field"><textarea class="input" data-f="front" rows="2" placeholder="Term">${esc(r.front)}</textarea><span>Term</span></label>
          <label class="field"><textarea class="input" data-f="back" rows="2" placeholder="Definition">${esc(r.back)}</textarea><span>Definition</span></label>
          <button class="icon-btn" data-del="${i}" title="Delete card">🗑</button>
        </div>`
        )
        .join('');
      $$('#rows textarea').forEach((ta) => {
        const i = +ta.closest('.edit-row').dataset.i;
        ta.oninput = () => {
          rows[i][ta.dataset.f] = ta.value;
          dirty = true;
        };
        if (ta.dataset.f === 'back' && i === rows.length - 1) {
          ta.onkeydown = (e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              rows.push({ front: '', back: '' });
              renderRows(true);
            }
          };
        }
      });
      $$('[data-del]').forEach((b) => {
        b.onclick = () => {
          rows.splice(+b.dataset.del, 1);
          dirty = true;
          renderRows();
        };
      });
      if (focusLast) {
        const tas = $$('#rows textarea[data-f="front"]');
        tas[tas.length - 1].focus();
      }
    }
    renderRows();

    $('#add').onclick = () => {
      rows.push({ front: '', back: '' });
      renderRows(true);
    };
    $('#swap').onclick = () => {
      rows.forEach((r) => ([r.front, r.back] = [r.back, r.front]));
      dirty = true;
      renderRows();
    };
    $('#name').oninput = $('#desc').oninput = () => (dirty = true);

    $('#save').onclick = () => {
      const name = $('#name').value.trim();
      if (!name) {
        $('#name').focus();
        toast('Give your deck a title');
        return;
      }
      const clean = rows.filter((r) => r.front.trim() || r.back.trim());
      if (isNew) {
        const d = Store.createDeck(name, $('#desc').value.trim(), clean);
        dirty = false;
        go('#/deck/' + d.id);
        return;
      }
      const byId = new Map(deck.cards.map((c) => [c.id, c]));
      deck.cards = clean.map((r) => {
        const existing = r.id && byId.get(r.id);
        if (existing) return Object.assign(existing, { front: r.front, back: r.back });
        return Store.makeCard(r.front, r.back);
      });
      deck.name = name;
      deck.description = $('#desc').value.trim();
      deck.updated = Date.now();
      Store.save();
      dirty = false;
      toast('Saved');
      go('#/deck/' + deck.id);
    };

    const beforeUnload = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    cleanup = () => window.removeEventListener('beforeunload', beforeUnload);
  }

  // ---------- views: spaced-repetition review ----------

  const LEARN_AHEAD = 20 * SRS.MINUTE;

  function viewReview(id) {
    const decks = decksFor(id);
    if (!decks.length) return id === 'all' ? go('#/') : notFound();
    const settings = Store.state.settings;
    const opts = srsOptions();
    const start = Date.now();
    const today = Store.todayKey(start);
    const title = id === 'all' ? 'All decks' : decks[0].name;
    const back = id === 'all' ? '#/' : '#/deck/' + id;

    // Build the session: learning cards, due reviews, then today's new cards.
    const entries = []; // { card, deck }
    const learn = []; // learning/relearning entries, ordered by due
    const reviews = [];
    const news = [];
    for (const deck of decks) {
      const daily = deck.daily && deck.daily.date === today ? deck.daily : (deck.daily = { date: today, newCount: 0, reviewCount: 0 });
      const newLeft = Math.max(0, settings.newPerDay - daily.newCount);
      const revLeft = Math.max(0, settings.reviewsPerDay - daily.reviewCount);
      const deckReviews = [];
      const deckNew = [];
      for (const card of deck.cards) {
        const e = { card, deck };
        const st = card.srs.state;
        if ((st === 'learning' || st === 'relearning') && card.srs.due <= start + LEARN_AHEAD) learn.push(e);
        else if (st === 'review' && card.srs.due <= start) deckReviews.push(e);
        else if (st === 'new') deckNew.push(e);
      }
      deckReviews.sort((a, b) => a.card.srs.due - b.card.srs.due);
      reviews.push(...deckReviews.slice(0, revLeft));
      news.push(...deckNew.slice(0, newLeft));
    }
    learn.sort((a, b) => a.card.srs.due - b.card.srs.due);
    // Interleave new cards among reviews so sessions don't end with a wall of new material.
    const main = [];
    const revShuffled = shuffle(reviews);
    const ratio = news.length ? Math.max(1, Math.floor(revShuffled.length / news.length)) : 0;
    let ni = 0;
    revShuffled.forEach((e, i) => {
      main.push(e);
      if (ratio && (i + 1) % ratio === 0 && ni < news.length) main.push(news[ni++]);
    });
    while (ni < news.length) main.push(news[ni++]);

    let current = null;
    let revealed = false;
    let typed = '';
    let result = null;
    let hintLevel = 0;
    let swapped = false;
    let history = []; // for undo
    const session = { reviewed: 0, correct: 0, again: 0 };
    let typeMode = settings.typeAnswer;

    function counts() {
      const c = { new: 0, learning: learn.length, review: 0 };
      for (const e of main) c[e.card.srs.state === 'new' ? 'new' : 'review'] += 1;
      if (current) {
        const st = current.card.srs.state;
        if (st === 'new') c.new++;
        else if (st === 'review') c.review++;
        else c.learning++;
      }
      return c;
    }

    function pickNext() {
      const now = Date.now();
      if (learn.length && learn[0].card.srs.due <= now) return learn.shift();
      if (main.length) return main.shift();
      if (learn.length && learn[0].card.srs.due <= now + LEARN_AHEAD) return learn.shift();
      return null;
    }

    function next() {
      current = pickNext();
      revealed = false;
      typed = '';
      result = null;
      hintLevel = 0;
      draw();
    }

    function sides() {
      const c = current.card;
      return swapped ? { q: c.back, a: c.front } : { q: c.front, a: c.back };
    }

    function reveal() {
      if (revealed) return;
      if (typeMode) {
        const inp = $('#answer-input');
        typed = inp ? inp.value : '';
        result = typed.trim() ? checkAnswer(typed, sides().a) : null;
      }
      revealed = true;
      draw();
    }

    function rate(r) {
      if (!revealed || !current) return;
      const { card, deck } = current;
      const now = Date.now();
      const wasNew = card.srs.state === 'new';
      history.push({ entry: current, srs: card.srs, daily: Object.assign({}, deck.daily), main: main.slice(), learn: learn.slice(), session: Object.assign({}, session) });
      if (history.length > 20) history.shift();

      card.srs = SRS.schedule(card.srs, r, now, opts);
      if (wasNew) deck.daily.newCount += 1;
      else deck.daily.reviewCount += 1;
      Store.logReview(wasNew, r, now);
      session.reviewed += 1;
      if (r >= 3) session.correct += 1;
      if (r === 1) session.again += 1;

      const st = card.srs.state;
      if ((st === 'learning' || st === 'relearning') && card.srs.due - now <= LEARN_AHEAD * 3) {
        learn.push(current);
        learn.sort((a, b) => a.card.srs.due - b.card.srs.due);
      }
      Store.save();
      next();
    }

    function undo() {
      const h = history.pop();
      if (!h) return;
      h.entry.card.srs = h.srs;
      h.entry.deck.daily = h.daily;
      main.splice(0, main.length, ...h.main);
      learn.splice(0, learn.length, ...h.learn);
      Object.assign(session, h.session);
      const log = Store.state.log[Store.todayKey()];
      if (log && log.reviews > 0) log.reviews -= 1;
      Store.save();
      current = h.entry;
      revealed = false;
      typed = '';
      result = null;
      hintLevel = 0;
      draw();
      toast('Undone');
    }

    function draw() {
      if (!current) return drawDone();
      const c = counts();
      const { q, a } = sides();
      const st = current.card.srs.state;
      const pv = revealed ? SRS.preview(current.card.srs, Date.now(), opts) : null;
      const suggested = result === 'correct' ? 3 : result === 'close' ? 2 : result === 'wrong' ? 1 : 0;
      const resultMsg = { correct: '✓ Correct!', close: '≈ Almost — check the details', wrong: '✗ Not quite' }[result];

      app.innerHTML = `
        <div class="study-top">
          <a class="btn btn-ghost" href="${back}">✕</a>
          <div class="study-title">${esc(title)}</div>
          <div class="queue-counts" title="New · Learning · Review">
            <span class="c-new">${c.new}</span><span class="c-learning">${c.learning}</span><span class="c-young">${c.review}</span>
          </div>
        </div>
        <div class="study-tools">
          <label class="check"><input type="checkbox" id="type-mode" ${typeMode ? 'checked' : ''}> Type answers</label>
          <label class="check"><input type="checkbox" id="swap" ${swapped ? 'checked' : ''}> Definition first</label>
          <button class="btn btn-ghost btn-sm" id="undo" ${history.length ? '' : 'disabled'} title="Undo (U)">↶ Undo</button>
        </div>

        <div class="review-card ${revealed ? 'is-revealed' : ''}">
          <span class="state-tag t-${st}">${st === 'new' ? 'New card' : st === 'review' ? 'Review' : 'Learning'}${current.deck && id === 'all' ? ' · ' + esc(current.deck.name) : ''}</span>
          <div class="rc-q">${esc(q)}</div>
          ${
            revealed
              ? `<hr><div class="rc-a">${esc(a)}</div>
                 ${typed.trim() ? `<div class="typed typed-${result}"><span class="muted small">You wrote</span><div>${esc(typed)}</div><b>${resultMsg}</b></div>` : ''}`
              : `${hintLevel ? `<div class="hint">${esc(hintText(a, hintLevel))}</div>` : ''}
                 ${typeMode ? `<textarea id="answer-input" class="input answer-input" rows="2" placeholder="Type your answer from memory…" autocomplete="off" spellcheck="false"></textarea>` : `<p class="muted small recall-tip">Recall the answer in your head first, then reveal.</p>`}`
          }
        </div>

        <div class="answer-bar">
          ${
            revealed
              ? `<div class="ratings">
                  ${[
                    [1, 'Again', 'again'],
                    [2, 'Hard', 'hard'],
                    [3, 'Good', 'good'],
                    [4, 'Easy', 'easy'],
                  ]
                    .map(
                      ([r, label, cls]) => `
                    <button class="rate rate-${cls} ${suggested === r ? 'suggested' : ''}" data-r="${r}">
                      <span class="rate-int">${SRS.formatInterval(pv[r])}</span>
                      <span class="rate-label">${label}</span>
                      <kbd>${r}</kbd>
                    </button>`
                    )
                    .join('')}
                </div>`
              : `<div class="row center">
                   ${hintLevel < 2 ? `<button class="btn" id="hint">Hint <kbd>H</kbd></button>` : ''}
                   <button class="btn btn-primary btn-wide" id="show">${typeMode ? 'Check' : 'Show answer'} <kbd>${typeMode ? 'Enter' : 'Space'}</kbd></button>
                 </div>`
          }
        </div>`;

      const inp = $('#answer-input');
      if (inp) {
        inp.focus();
        inp.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            reveal();
          }
        };
      }
      const show = $('#show');
      if (show) show.onclick = reveal;
      const hint = $('#hint');
      if (hint)
        hint.onclick = () => {
          const val = inp ? inp.value : '';
          hintLevel++;
          draw();
          const ni = $('#answer-input');
          if (ni) ni.value = val;
        };
      $$('[data-r]').forEach((b) => (b.onclick = () => rate(+b.dataset.r)));
      $('#type-mode').onchange = (e) => {
        typeMode = e.target.checked;
        settings.typeAnswer = typeMode;
        Store.save();
        if (!revealed) draw();
      };
      $('#swap').onchange = (e) => {
        swapped = e.target.checked;
        draw();
      };
      $('#undo').onclick = undo;
    }

    function drawDone() {
      const now = Date.now();
      const upcoming = decks
        .flatMap((d) => d.cards)
        .filter((c) => c.srs.state !== 'new' && c.srs.due > now)
        .sort((a, b) => a.srs.due - b.srs.due)[0];
      const acc = session.reviewed ? Math.round((session.correct / session.reviewed) * 100) : 0;
      app.innerHTML = `
        <div class="done">
          <div class="done-emoji">${session.reviewed ? '🎉' : '✅'}</div>
          <h1>${session.reviewed ? 'Session complete!' : 'All caught up!'}</h1>
          ${
            session.reviewed
              ? `<div class="stats-row">
                  <div class="stat"><span class="stat-num">${session.reviewed}</span><span class="stat-label">reviews</span></div>
                  <div class="stat"><span class="stat-num">${acc}%</span><span class="stat-label">recalled</span></div>
                  <div class="stat"><span class="stat-num">${Store.streak(now)}</span><span class="stat-label">day streak 🔥</span></div>
                </div>`
              : '<p class="muted">Nothing is due right now. Spaced repetition works best when you come back later.</p>'
          }
          ${upcoming ? `<p class="muted">Next card due in <b>${SRS.formatInterval(upcoming.srs.due - now)}</b>.</p>` : ''}
          <div class="row center">
            <a class="btn btn-primary" href="${back}">Done</a>
            ${id !== 'all' ? `<a class="btn" href="#/flash/${id}">Keep practising with flashcards</a><a class="btn" href="#/quiz/${id}">Take a quiz</a>` : ''}
            ${history.length ? '<button class="btn btn-ghost" id="undo">↶ Undo last</button>' : ''}
          </div>
        </div>`;
      const u = $('#undo');
      if (u) u.onclick = undo;
    }

    keyHandler = (e) => {
      const inInput = e.target.matches('input, textarea');
      if (inInput && e.key !== 'Escape') return;
      if (e.key === 'Escape') return go(back);
      if (!current) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        reveal();
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) rate(+e.key);
      else if (revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        rate(result === 'wrong' ? 1 : result === 'close' ? 2 : 3);
      } else if (!revealed && e.key.toLowerCase() === 'h' && hintLevel < 2) $('#hint') && $('#hint').click();
      else if (e.key.toLowerCase() === 'u') undo();
    };

    Store.save();
    next();
  }

  // ---------- views: flashcards (flip mode) ----------

  function viewFlash(id) {
    const deck = Store.getDeck(id);
    if (!deck) return notFound();
    if (!deck.cards.length) return go('#/deck/' + id + '/edit');
    let starredOnly = false;
    let swapped = false;
    let order = deck.cards.slice();
    let idx = 0;
    let flipped = false;
    let known = new Set();
    let learning = new Set();
    let sortMode = true; // Quizlet-style "track progress" sorting

    function pool() {
      return starredOnly ? deck.cards.filter((c) => c.starred) : deck.cards.slice();
    }

    function restart(cards) {
      order = cards;
      idx = 0;
      flipped = false;
      known = new Set();
      learning = new Set();
      draw();
    }

    function draw() {
      if (!order.length) {
        app.innerHTML = `<div class="empty"><h2>No cards to show</h2><p class="muted">No starred cards in this deck.</p><button class="btn" id="all">Show all cards</button></div>`;
        $('#all').onclick = () => {
          starredOnly = false;
          restart(pool());
        };
        return;
      }
      if (idx >= order.length) return drawSummary();
      const c = order[idx];
      const front = swapped ? c.back : c.front;
      const backTxt = swapped ? c.front : c.back;
      app.innerHTML = `
        <div class="study-top">
          <a class="btn btn-ghost" href="#/deck/${deck.id}">✕</a>
          <div class="study-title">${esc(deck.name)}</div>
          <div class="muted">${idx + 1} / ${order.length}</div>
        </div>
        <div class="progress"><span style="width:${(idx / order.length) * 100}%"></span></div>
        <div class="study-tools">
          <label class="check"><input type="checkbox" id="sort" ${sortMode ? 'checked' : ''}> Track progress</label>
          <label class="check"><input type="checkbox" id="swap" ${swapped ? 'checked' : ''}> Definition first</label>
          <label class="check"><input type="checkbox" id="starred" ${starredOnly ? 'checked' : ''}> ★ only</label>
          <button class="btn btn-ghost btn-sm" id="shuffle">🔀 Shuffle</button>
        </div>
        ${sortMode ? `<div class="sort-counts"><span class="pill pill-learning">${learning.size} still learning</span><span class="pill pill-known">${known.size} know</span></div>` : ''}
        <div class="flip-wrap">
          <div class="flip ${flipped ? 'flipped' : ''}" id="flip" tabindex="0" aria-label="Flashcard, click to flip">
            <div class="face front"><button class="star ${c.starred ? 'on' : ''}" id="star" title="Star">★</button><div class="face-text">${esc(front)}</div><span class="muted small face-hint">Click or press Space to flip</span></div>
            <div class="face back"><div class="face-text">${esc(backTxt)}</div></div>
          </div>
        </div>
        <div class="flash-controls">
          ${
            sortMode
              ? `<button class="btn btn-learning" id="still">✗ Still learning <kbd>1</kbd></button>
                 <button class="btn btn-ghost" id="prev" ${idx ? '' : 'disabled'}>← Back</button>
                 <button class="btn btn-known" id="know">✓ Know <kbd>2</kbd></button>`
              : `<button class="btn" id="prev" ${idx ? '' : 'disabled'}>← Prev</button>
                 <button class="btn" id="next">Next →</button>`
          }
        </div>`;

      const flip = $('#flip');
      flip.onclick = (e) => {
        if (e.target.id === 'star') return;
        flipped = !flipped;
        flip.classList.toggle('flipped', flipped);
      };
      $('#star').onclick = () => {
        c.starred = !c.starred;
        Store.save();
        $('#star').classList.toggle('on', c.starred);
      };
      $('#prev').onclick = prev;
      if (sortMode) {
        $('#still').onclick = () => mark(false);
        $('#know').onclick = () => mark(true);
      } else $('#next').onclick = nextCard;
      $('#sort').onchange = (e) => {
        sortMode = e.target.checked;
        draw();
      };
      $('#swap').onchange = (e) => {
        swapped = e.target.checked;
        flipped = false;
        draw();
      };
      $('#starred').onchange = (e) => {
        starredOnly = e.target.checked;
        restart(pool());
      };
      $('#shuffle').onclick = () => {
        restart(shuffle(pool()));
        toast('Shuffled');
      };
    }

    function mark(isKnown) {
      const c = order[idx];
      (isKnown ? known : learning).add(c.id);
      (isKnown ? learning : known).delete(c.id);
      nextCard();
    }
    function nextCard() {
      idx++;
      flipped = false;
      draw();
    }
    function prev() {
      if (!idx) return;
      idx--;
      flipped = false;
      draw();
    }

    function drawSummary() {
      const stillCards = order.filter((c) => learning.has(c.id));
      app.innerHTML = `
        <div class="done">
          <div class="done-emoji">${stillCards.length ? '💪' : '🏆'}</div>
          <h1>${sortMode ? (stillCards.length ? 'Nice work — keep going!' : 'You know them all!') : 'End of deck'}</h1>
          ${
            sortMode
              ? `<div class="stats-row">
                  <div class="stat"><span class="stat-num c-mastered">${known.size}</span><span class="stat-label">know</span></div>
                  <div class="stat"><span class="stat-num c-learning">${learning.size}</span><span class="stat-label">still learning</span></div>
                </div>`
              : ''
          }
          <div class="row center">
            ${stillCards.length ? `<button class="btn btn-primary" id="again">Study ${plural(stillCards.length, 'card')} you're still learning</button>` : ''}
            <button class="btn" id="restart">Restart</button>
            <a class="btn" href="#/review/${deck.id}">Spaced-repetition review</a>
            <a class="btn" href="#/quiz/${deck.id}">Take a quiz</a>
          </div>
        </div>`;
      const again = $('#again');
      if (again) again.onclick = () => restart(shuffle(stillCards));
      $('#restart').onclick = () => restart(pool());
    }

    keyHandler = (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'Escape') return go('#/deck/' + deck.id);
      if (idx >= order.length) return;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        $('#flip').click();
      } else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') sortMode ? mark(true) : nextCard();
      else if (sortMode && e.key === '1') mark(false);
      else if (sortMode && e.key === '2') mark(true);
    };

    draw();
  }

  // ---------- views: quiz ----------

  function viewQuiz(id) {
    const deck = Store.getDeck(id);
    if (!deck) return notFound();
    const usable = deck.cards.filter((c) => c.front.trim() && c.back.trim());
    if (usable.length < 2) {
      app.innerHTML = `<div class="empty"><h2>Add a few more cards</h2><p class="muted">A quiz needs at least 2 cards with both a term and a definition.</p><a class="btn" href="#/deck/${deck.id}/edit">Edit deck</a></div>`;
      return;
    }
    const cfg = { count: Math.min(20, usable.length), mc: true, written: true, tf: usable.length >= 2, answerWith: 'back', focusWeak: true };

    function setup() {
      app.innerHTML = `
        <nav class="crumbs"><a href="#/">Decks</a> / <a href="#/deck/${deck.id}">${esc(deck.name)}</a> / <span>Quiz</span></nav>
        <div class="panel narrow">
          <h1>Set up your quiz</h1>
          <label class="form-row"><span>Questions</span><input class="input" type="number" id="count" min="1" max="${usable.length}" value="${cfg.count}"> <span class="muted small">of ${usable.length}</span></label>
          <label class="form-row"><span>Answer with</span>
            <select class="input" id="answerWith">
              <option value="back" ${cfg.answerWith === 'back' ? 'selected' : ''}>Definition</option>
              <option value="front" ${cfg.answerWith === 'front' ? 'selected' : ''}>Term</option>
              <option value="both" ${cfg.answerWith === 'both' ? 'selected' : ''}>Both (mixed)</option>
            </select></label>
          <div class="form-row"><span>Question types</span>
            <div class="stack">
              <label class="check"><input type="checkbox" id="mc" ${cfg.mc ? 'checked' : ''}> Multiple choice</label>
              <label class="check"><input type="checkbox" id="written" ${cfg.written ? 'checked' : ''}> Written (active recall)</label>
              <label class="check"><input type="checkbox" id="tf" ${cfg.tf ? 'checked' : ''}> True / false</label>
            </div>
          </div>
          <label class="check"><input type="checkbox" id="focusWeak" ${cfg.focusWeak ? 'checked' : ''}> Prioritise cards I struggle with</label>
          <button class="btn btn-primary btn-block" id="start">Start quiz</button>
        </div>`;
      $('#start').onclick = () => {
        cfg.count = Math.max(1, Math.min(usable.length, parseInt($('#count').value, 10) || 10));
        cfg.answerWith = $('#answerWith').value;
        cfg.mc = $('#mc').checked;
        cfg.written = $('#written').checked;
        cfg.tf = $('#tf').checked;
        cfg.focusWeak = $('#focusWeak').checked;
        if (!cfg.mc && !cfg.written && !cfg.tf) return toast('Pick at least one question type');
        run(buildQuestions());
      };
    }

    function weakness(c) {
      const s = c.srs;
      if (s.state === 'new') return 2;
      return (s.lapses || 0) * 2 + (s.state !== 'review' ? 3 : 0) + (s.interval < 7 ? 1 : 0) + Math.random();
    }

    function buildQuestions() {
      let cards = shuffle(usable);
      if (cfg.focusWeak) cards = cards.sort((a, b) => weakness(b) - weakness(a));
      cards = shuffle(cards.slice(0, cfg.count));
      const types = [cfg.mc && 'mc', cfg.written && 'written', cfg.tf && 'tf'].filter(Boolean);
      return cards.map((card, i) => {
        const dir = cfg.answerWith === 'both' ? (Math.random() < 0.5 ? 'back' : 'front') : cfg.answerWith;
        const prompt = dir === 'back' ? card.front : card.back;
        const answer = dir === 'back' ? card.back : card.front;
        const type = types[i % types.length];
        const others = shuffle(usable.filter((c) => c.id !== card.id).map((c) => (dir === 'back' ? c.back : c.front)).filter((t) => t !== answer));
        const q = { card, type, prompt, answer, dir };
        if (type === 'mc') q.options = shuffle([answer, ...Array.from(new Set(others)).slice(0, 3)]);
        if (type === 'tf') {
          q.isTrue = Math.random() < 0.5 || !others.length;
          q.shown = q.isTrue ? answer : others[0];
        }
        return q;
      });
    }

    function run(questions) {
      let i = 0;
      let score = 0;
      const results = [];
      let answered = null; // { correct, given }

      function draw() {
        if (i >= questions.length) return summary();
        const q = questions[i];
        const label = q.dir === 'back' ? 'Term' : 'Definition';
        let body = '';
        if (q.type === 'mc') {
          body = `<p class="muted small">Choose the matching ${q.dir === 'back' ? 'definition' : 'term'}</p>
            <div class="options">${q.options
              .map((o, k) => {
                let cls = '';
                if (answered) cls = o === q.answer ? 'opt-correct' : o === answered.given ? 'opt-wrong' : 'opt-dim';
                return `<button class="option ${cls}" data-o="${k}" ${answered ? 'disabled' : ''}><kbd>${k + 1}</kbd><span>${esc(o)}</span></button>`;
              })
              .join('')}</div>`;
        } else if (q.type === 'tf') {
          body = `<div class="tf-shown"><span class="muted small">${q.dir === 'back' ? 'Definition' : 'Term'}</span><div>${esc(q.shown)}</div></div>
            <div class="options two">
              <button class="option ${answered ? (q.isTrue ? 'opt-correct' : answered.given === true ? 'opt-wrong' : 'opt-dim') : ''}" data-tf="1" ${answered ? 'disabled' : ''}><kbd>1</kbd><span>True</span></button>
              <button class="option ${answered ? (!q.isTrue ? 'opt-correct' : answered.given === false ? 'opt-wrong' : 'opt-dim') : ''}" data-tf="0" ${answered ? 'disabled' : ''}><kbd>2</kbd><span>False</span></button>
            </div>
            ${answered && !q.isTrue ? `<p class="muted small">Correct answer: <b>${esc(q.answer)}</b></p>` : ''}`;
        } else {
          body = answered
            ? `<div class="typed typed-${answered.result}"><span class="muted small">You wrote</span><div>${esc(answered.given) || '<i>(blank)</i>'}</div></div>
               <div class="correct-answer"><span class="muted small">Correct answer</span><div>${esc(q.answer)}</div></div>
               ${!answered.correct ? `<button class="btn btn-ghost btn-sm" id="override">I was right — count it</button>` : ''}`
            : `<p class="muted small">Type the ${q.dir === 'back' ? 'definition' : 'term'} from memory</p>
               <textarea class="input answer-input" id="written" rows="2" autocomplete="off" spellcheck="false" placeholder="Your answer"></textarea>
               <div class="row"><button class="btn btn-primary" id="submit">Answer <kbd>Enter</kbd></button><button class="btn btn-ghost" id="dunno">I don't know</button></div>`;
        }
        app.innerHTML = `
          <div class="study-top">
            <a class="btn btn-ghost" href="#/deck/${deck.id}">✕</a>
            <div class="study-title">Quiz · ${esc(deck.name)}</div>
            <div class="muted">${i + 1} / ${questions.length}</div>
          </div>
          <div class="progress"><span style="width:${(i / questions.length) * 100}%"></span></div>
          <div class="quiz-card">
            <span class="muted small">${label}</span>
            <div class="quiz-prompt">${esc(q.prompt)}</div>
            ${body}
            ${answered ? `<div class="feedback ${answered.correct ? 'fb-good' : 'fb-bad'}">${answered.correct ? '✓ ' + pick(['Nice!', 'Correct!', 'You got it!', 'Great recall!']) : '✗ ' + pick(['Not quite — you\'ll get it next time.', 'Keep at it!', 'Almost there.'])}</div>
              <button class="btn btn-primary btn-block" id="continue">Continue <kbd>Enter</kbd></button>` : ''}
          </div>`;

        $$('[data-o]').forEach((b) => (b.onclick = () => submit(q.options[+b.dataset.o])));
        $$('[data-tf]').forEach((b) => (b.onclick = () => submit(b.dataset.tf === '1')));
        const w = $('#written');
        if (w) {
          w.focus();
          w.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              submit(w.value);
            }
          };
          $('#submit').onclick = () => submit(w.value);
          $('#dunno').onclick = () => submit('');
        }
        const cont = $('#continue');
        if (cont) {
          cont.onclick = advance;
          cont.focus();
        }
        const ov = $('#override');
        if (ov)
          ov.onclick = () => {
            answered.correct = true;
            answered.result = 'correct';
            results[results.length - 1].correct = true;
            score++;
            draw();
          };
      }

      function pick(a) {
        return a[Math.floor(Math.random() * a.length)];
      }

      function submit(given) {
        if (answered) return;
        const q = questions[i];
        let correct;
        let result;
        if (q.type === 'mc') correct = given === q.answer;
        else if (q.type === 'tf') correct = given === q.isTrue;
        else {
          result = checkAnswer(given, q.answer);
          correct = result === 'correct';
        }
        if (correct) score++;
        answered = { correct, given, result };
        results.push({ q, correct, given });
        draw();
      }

      function advance() {
        answered = null;
        i++;
        draw();
      }

      function summary() {
        const pct = Math.round((score / questions.length) * 100);
        const wrong = results.filter((r) => !r.correct);
        app.innerHTML = `
          <div class="done">
            <div class="score-ring" style="--p:${pct}"><span>${pct}%</span></div>
            <h1>${pct === 100 ? 'Perfect score! 🏆' : pct >= 80 ? 'Great job!' : pct >= 50 ? 'Getting there!' : 'Keep practising!'}</h1>
            <p class="muted">${score} of ${questions.length} correct</p>
            <div class="row center">
              ${wrong.length ? `<button class="btn btn-primary" id="retry">Retry ${plural(wrong.length, 'missed question')}</button>` : ''}
              ${wrong.length ? `<button class="btn" id="tosrs" title="Marks missed cards as forgotten so they come up in your next review">Send missed cards to review</button>` : ''}
              <button class="btn" id="new">New quiz</button>
              <a class="btn" href="#/deck/${deck.id}">Back to deck</a>
            </div>
            ${
              wrong.length
                ? `<h2 class="section-title">Review your mistakes</h2>
                   <div class="card-list left">${wrong
                     .map(
                       (r) => `<div class="card-row">
                         <div class="card-front">${esc(r.q.prompt)}</div>
                         <div class="card-back"><div class="c-mastered">${esc(r.q.answer)}</div>${r.q.type === 'written' && r.given ? `<div class="small c-learning">You wrote: ${esc(r.given)}</div>` : ''}</div>
                       </div>`
                     )
                     .join('')}</div>`
                : ''
            }
          </div>`;
        const retry = $('#retry');
        if (retry) retry.onclick = () => run(shuffle(wrong.map((r) => r.q)));
        const tosrs = $('#tosrs');
        if (tosrs)
          tosrs.onclick = () => {
            const now = Date.now();
            const ids = new Set(wrong.map((r) => r.q.card.id));
            deck.cards.forEach((c) => {
              if (!ids.has(c.id) || c.srs.state === 'new') return;
              c.srs = SRS.schedule(c.srs, 1, now, srsOptions());
              c.srs.due = now;
            });
            Store.save();
            tosrs.disabled = true;
            toast('Missed cards will come up in your next review');
          };
        $('#new').onclick = setup;
      }

      keyHandler = (e) => {
        if (e.key === 'Escape') return go('#/deck/' + deck.id);
        if (i >= questions.length) return;
        const q = questions[i];
        if (answered) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            advance();
          }
          return;
        }
        if (e.target.matches('input, textarea')) return;
        if (q.type === 'mc' && /^[1-9]$/.test(e.key) && q.options[+e.key - 1] !== undefined) submit(q.options[+e.key - 1]);
        if (q.type === 'tf' && (e.key === '1' || e.key.toLowerCase() === 't')) submit(true);
        if (q.type === 'tf' && (e.key === '2' || e.key.toLowerCase() === 'f')) submit(false);
      };
      draw();
    }

    setup();
  }

  // ---------- views: import ----------

  const TERM_SEPS = { tab: '\t', comma: ',', dash: ' - ', colon: ':' };
  const CARD_SEPS = { nl: '\n', semi: ';', blank: '\n\n' };

  function viewImport(params) {
    const decks = Store.state.decks;
    const targetDeck = params.get('deck');
    let text = '';
    let fmt = { format: 'auto' };
    let termSep = '\t';
    let cardSep = '\n';
    let parsed = null;
    let error = '';
    let fileName = '';

    app.innerHTML = `
      <nav class="crumbs"><a href="#/">Decks</a> / <span>Import</span></nav>
      <h1>Import flashcards</h1>
      <div class="import-grid">
        <div class="panel">
          <div class="dropzone" id="drop">
            <input type="file" id="file" accept=".txt,.csv,.tsv,.json,text/plain,text/csv,application/json" hidden>
            <p><b>Drop a file here</b> or <button class="link" id="browse">browse</button></p>
            <p class="muted small">CSV, TSV, TXT (Quizlet / Anki export) or JSON backup</p>
            <p class="small" id="fname"></p>
          </div>
          <p class="or"><span>or paste your cards</span></p>
          <textarea class="input mono" id="paste" rows="10" placeholder="Word 1&#9;Definition 1&#10;Word 2&#9;Definition 2&#10;Word 3&#9;Definition 3"></textarea>

          <div class="sep-grid">
            <fieldset>
              <legend>Between term and definition</legend>
              <label class="check"><input type="radio" name="ts" value="auto" checked> Auto-detect</label>
              <label class="check"><input type="radio" name="ts" value="tab"> Tab</label>
              <label class="check"><input type="radio" name="ts" value="comma"> Comma</label>
              <label class="check"><input type="radio" name="ts" value="dash"> Dash ( - )</label>
              <label class="check"><input type="radio" name="ts" value="colon"> Colon</label>
              <label class="check"><input type="radio" name="ts" value="custom"> Custom <input class="input input-sm" id="ts-custom" placeholder="e.g. =" size="4"></label>
            </fieldset>
            <fieldset>
              <legend>Between cards</legend>
              <label class="check"><input type="radio" name="cs" value="nl" checked> New line</label>
              <label class="check"><input type="radio" name="cs" value="semi"> Semicolon</label>
              <label class="check"><input type="radio" name="cs" value="blank"> Blank line</label>
              <label class="check"><input type="radio" name="cs" value="custom"> Custom <input class="input input-sm" id="cs-custom" placeholder="e.g. |" size="4"></label>
            </fieldset>
          </div>

          <details class="help">
            <summary>How to export from Quizlet, Anki, RevisionDojo or a spreadsheet</summary>
            <ul>
              <li><b>Quizlet:</b> open the set → <i>⋯</i> menu → <i>Export</i> → <i>Copy text</i>, then paste here. The default (Tab / New line) works out of the box.</li>
              <li><b>Anki:</b> <i>File → Export</i> → "Notes in Plain Text (.txt)", then drop the file here.</li>
              <li><b>RevisionDojo / other apps:</b> copy your cards as text (one card per line, term and definition separated by a tab, comma or dash) and paste them here.</li>
              <li><b>Google Sheets / Excel:</b> put terms in column A and definitions in column B, then copy the cells and paste (Tab-separated), or download as CSV.</li>
              <li>Fields containing commas or line breaks can be wrapped in "double quotes".</li>
            </ul>
          </details>
        </div>

        <div class="panel">
          <div class="row between">
            <h2 class="section-title" id="count">Preview</h2>
            <label class="check"><input type="checkbox" id="swap"> Swap term/definition</label>
          </div>
          <div id="preview" class="preview"></div>
          <div class="dest">
            <label class="form-row"><span>Import into</span>
              <select class="input" id="dest">
                <option value="new">A new deck</option>
                ${decks.map((d) => `<option value="${d.id}" ${d.id === targetDeck ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
              </select>
            </label>
            <label class="form-row" id="name-row"><span>Deck title</span><input class="input" id="deckname" placeholder="Imported deck"></label>
            <button class="btn btn-primary btn-block" id="do-import" disabled>Import</button>
          </div>
        </div>
      </div>`;

    const paste = $('#paste');

    function currentFormat() {
      if (fmt.format === 'json' || fmt.format === 'anki') return fmt;
      return { format: 'delimited', termSep, cardSep };
    }

    function update() {
      error = '';
      parsed = null;
      const tsVal = $('input[name=ts]:checked').value;
      const csVal = $('input[name=cs]:checked').value;
      const detected = text.trim() ? (fileName ? Importer.detectFile(fileName, text) : Importer.detect(text)) : { format: 'delimited', termSep: '\t', cardSep: '\n' };
      fmt = tsVal === 'auto' ? detected : { format: 'delimited' };
      termSep = tsVal === 'auto' ? detected.termSep || '\t' : tsVal === 'custom' ? $('#ts-custom').value || '\t' : TERM_SEPS[tsVal];
      cardSep = csVal === 'custom' ? $('#cs-custom').value || '\n' : CARD_SEPS[csVal];
      if (tsVal === 'auto' && detected.cardSep && csVal === 'nl') cardSep = detected.cardSep;
      if (text.trim()) {
        try {
          parsed = Importer.parse(text, currentFormat());
          if ($('#swap').checked) parsed.decks.forEach((d) => d.cards.forEach((c) => ([c.front, c.back] = [c.back, c.front])));
        } catch (e) {
          error = e.message;
        }
      }
      drawPreview();
    }

    function drawPreview() {
      const total = parsed ? parsed.decks.reduce((n, d) => n + d.cards.length, 0) : 0;
      const multi = parsed && parsed.decks.length > 1;
      $('#count').textContent = total ? `Preview · ${plural(total, 'card')}${multi ? ' in ' + parsed.decks.length + ' decks' : ''}` : 'Preview';
      $('#do-import').disabled = !total;
      $('#do-import').textContent = total ? `Import ${plural(total, 'card')}` : 'Import';
      const dest = $('#dest');
      dest.disabled = multi;
      if (multi) dest.value = 'new';
      $('#name-row').hidden = dest.value !== 'new' || multi;
      if (parsed && parsed.decks.length === 1 && parsed.decks[0].name !== 'Imported deck' && !$('#deckname').value) $('#deckname').placeholder = parsed.decks[0].name;
      if (fileName && !$('#deckname').value && (!parsed || parsed.decks[0].name === 'Imported deck')) $('#deckname').placeholder = fileName.replace(/\.[^.]+$/, '');

      if (error) return ($('#preview').innerHTML = `<p class="error">Couldn't read that: ${esc(error)}</p>`);
      if (!total) return ($('#preview').innerHTML = `<p class="muted center pad">Your cards will appear here.</p>`);
      const shown = [];
      for (const d of parsed.decks) {
        if (multi) shown.push(`<div class="preview-deck">${esc(d.name)} · ${plural(d.cards.length, 'card')}</div>`);
        for (const c of d.cards.slice(0, 100)) shown.push(`<div class="preview-row"><div>${esc(c.front) || '<i class="muted">(empty)</i>'}</div><div>${esc(c.back) || '<i class="muted">(empty)</i>'}</div></div>`);
      }
      if (total > 100 && !multi) shown.push(`<p class="muted small center">…and ${total - 100} more</p>`);
      $('#preview').innerHTML = shown.join('');
    }

    paste.oninput = () => {
      text = paste.value;
      fileName = '';
      $('#fname').textContent = '';
      update();
    };
    $$('input[name=ts], input[name=cs], #swap').forEach((r) => (r.onchange = update));
    $('#ts-custom').oninput = () => {
      $('input[name=ts][value=custom]').checked = true;
      update();
    };
    $('#cs-custom').oninput = () => {
      $('input[name=cs][value=custom]').checked = true;
      update();
    };
    $('#dest').onchange = drawPreview;

    function readFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        text = String(reader.result).replace(/^﻿/, '');
        fileName = file.name;
        paste.value = text.length > 200000 ? text.slice(0, 200000) + '\n…' : text;
        $('#fname').textContent = '📄 ' + file.name;
        $('input[name=ts][value=auto]').checked = true;
        $('input[name=cs][value=nl]').checked = true;
        update();
      };
      reader.readAsText(file);
    }
    $('#browse').onclick = () => $('#file').click();
    $('#file').onchange = (e) => readFile(e.target.files[0]);
    const drop = $('#drop');
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add('over');
    };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      readFile(e.dataTransfer.files[0]);
    };

    $('#do-import').onclick = () => {
      if (!parsed) return;
      const dest = $('#dest').value;
      if (parsed.decks.length > 1 || dest === 'new') {
        let last;
        for (const d of parsed.decks) {
          const name = parsed.decks.length === 1 ? $('#deckname').value.trim() || $('#deckname').placeholder || d.name : d.name;
          last = Store.createDeck(name, d.description, d.cards);
        }
        toast(`Imported ${plural(parsed.decks.reduce((n, d) => n + d.cards.length, 0), 'card')}`);
        go(parsed.decks.length === 1 ? '#/deck/' + last.id : '#/');
      } else {
        const deck = Store.getDeck(dest);
        const existing = new Set(deck.cards.map((c) => c.front.trim().toLowerCase() + '\u0000' + c.back.trim().toLowerCase()));
        let added = 0;
        for (const c of parsed.decks[0].cards) {
          const key = c.front.trim().toLowerCase() + '\u0000' + c.back.trim().toLowerCase();
          if (existing.has(key)) continue;
          existing.add(key);
          deck.cards.push(Store.makeCard(c.front, c.back, c.srs ? { srs: c.srs } : null));
          added++;
        }
        deck.updated = Date.now();
        Store.save();
        const skipped = parsed.decks[0].cards.length - added;
        toast(`Added ${plural(added, 'card')}${skipped ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)` : ''}`);
        go('#/deck/' + deck.id);
      }
    };

    update();
  }

  // ---------- views: settings ----------

  function viewSettings() {
    const s = Store.state.settings;
    app.innerHTML = `
      <nav class="crumbs"><a href="#/">Decks</a> / <span>Settings</span></nav>
      <h1>Settings</h1>
      <div class="panel narrow">
        <h2 class="section-title">Daily limits</h2>
        <label class="form-row"><span>New cards per day (per deck)</span><input class="input" type="number" min="0" id="newPerDay" value="${s.newPerDay}"></label>
        <label class="form-row"><span>Maximum reviews per day (per deck)</span><input class="input" type="number" min="0" id="reviewsPerDay" value="${s.reviewsPerDay}"></label>

        <h2 class="section-title">Spaced repetition</h2>
        <label class="form-row"><span>Learning steps (minutes)</span><input class="input" id="learningSteps" value="${s.learningSteps.join(' ')}"></label>
        <label class="form-row"><span>Relearning steps (minutes)</span><input class="input" id="relearningSteps" value="${s.relearningSteps.join(' ')}"></label>
        <label class="form-row"><span>Graduating interval (days)</span><input class="input" type="number" min="1" id="graduatingInterval" value="${s.graduatingInterval}"></label>
        <label class="form-row"><span>Easy interval (days)</span><input class="input" type="number" min="1" id="easyInterval" value="${s.easyInterval}"></label>
        <p class="muted small">New cards go through the learning steps (e.g. 1 min, then 10 min) before graduating to day-based reviews. Each successful review multiplies the interval by the card's ease (starting at 250%); forgetting a card lowers its ease and sends it back through relearning.</p>

        <h2 class="section-title">Appearance</h2>
        <label class="form-row"><span>Theme</span>
          <select class="input" id="theme">
            ${['auto', 'light', 'dark'].map((t) => `<option value="${t}" ${s.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}
          </select></label>
        <button class="btn btn-primary" id="save">Save settings</button>
      </div>

      <div class="panel narrow">
        <h2 class="section-title">Backup</h2>
        <p class="muted small">Everything is stored in this browser. Export a backup to move your decks and progress to another device.</p>
        <div class="row">
          <button class="btn" id="export">Export all decks</button>
          <a class="btn" href="#/import">Restore from backup</a>
          <button class="btn btn-danger" id="reset">Delete all data</button>
        </div>
      </div>`;

    const steps = (v) => {
      const arr = v.split(/[\s,]+/).map(Number).filter((n) => n > 0);
      return arr.length ? arr : null;
    };
    $('#save').onclick = () => {
      const ls = steps($('#learningSteps').value);
      const rs = steps($('#relearningSteps').value);
      if (!ls || !rs) return toast('Steps need at least one number of minutes');
      Object.assign(s, {
        newPerDay: Math.max(0, parseInt($('#newPerDay').value, 10) || 0),
        reviewsPerDay: Math.max(0, parseInt($('#reviewsPerDay').value, 10) || 0),
        learningSteps: ls,
        relearningSteps: rs,
        graduatingInterval: Math.max(1, parseInt($('#graduatingInterval').value, 10) || 1),
        easyInterval: Math.max(1, parseInt($('#easyInterval').value, 10) || 4),
        theme: $('#theme').value,
      });
      Store.save();
      applyTheme();
      toast('Settings saved');
    };
    $('#export').onclick = () => download('recall-backup-' + Store.todayKey() + '.json', Store.exportJson());
    $('#reset').onclick = () => {
      if (confirm('Delete ALL decks, cards and progress? Export a backup first if you might want them back.') && confirm('Are you absolutely sure?')) {
        Store.replaceAll({});
        go('#/');
      }
    };
  }

  // ---------- router ----------

  function applyTheme() {
    const t = Store.state.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function render() {
    if (cleanup) cleanup();
    cleanup = null;
    keyHandler = null;
    const [path, query] = (location.hash.slice(1) || '/').split('?');
    const params = new URLSearchParams(query || '');
    const parts = path.split('/').filter(Boolean);
    window.scrollTo(0, 0);
    document.body.classList.toggle('studying', ['review', 'flash', 'quiz'].includes(parts[0]));
    if (!parts.length) viewHome();
    else if (parts[0] === 'deck' && parts[2] === 'edit') viewEdit(parts[1]);
    else if (parts[0] === 'deck') viewDeck(parts[1]);
    else if (parts[0] === 'review') viewReview(parts[1]);
    else if (parts[0] === 'flash') viewFlash(parts[1]);
    else if (parts[0] === 'quiz') viewQuiz(parts[1]);
    else if (parts[0] === 'import') viewImport(params);
    else if (parts[0] === 'settings') viewSettings();
    else viewHome();
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (keyHandler) keyHandler(e);
  });
  window.addEventListener('hashchange', render);
  // Refresh "due" counts on the deck list when coming back to the tab.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !document.body.classList.contains('studying') && !location.hash.includes('/edit') && !location.hash.startsWith('#/import')) render();
  });
  applyTheme();
  render();
})();
