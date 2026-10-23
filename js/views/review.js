/* Spaced-repetition review with active recall (typed answers, hints, mark schemes). */
(function () {
  const { esc, $, $$, render, go, toast, shuffle, srsOptions, checkAnswer, gradePoints, pointsResult, hintText, setKeys } = UI;
  const LEARN_AHEAD = 20 * SRS.MINUTE;

  /** New-card allowance today; raised when an exam is coming so every card gets seen in time. */
  function newLimit(deck, settings, newCount, now) {
    let limit = settings.newPerDay;
    const days = Store.daysUntil(deck.examDate, now);
    if (days != null && days >= 0) {
      const unseen = deck.cards.filter((c) => c.srs.state === 'new').length;
      limit = Math.max(limit, Math.ceil(unseen / Math.max(1, days - 1)));
    }
    return limit;
  }

  Views.review = function (id, params) {
    const sc = Store.scope(id);
    if (!sc) return id === 'all' ? go('#/') : UI.notFound();
    const cram = params.get('cram') === '1';
    const settings = Store.state.settings;
    const start = Date.now();
    const today = Store.todayKey(start);
    const back = sc.deck ? '#/deck/' + sc.deck.id : '#/';
    const title = (cram ? 'Cram · ' : '') + sc.title;

    const learn = [];
    const main = [];
    if (cram) {
      // Every studied card, least-remembered first. Ratings still update the schedule.
      const all = sc.decks.flatMap((deck) => deck.cards.filter((c) => sc.filter(c) && c.srs.state !== 'new').map((card) => ({ card, deck })));
      all.sort((a, b) => SRS.recallProbability(a.card.srs, start) - SRS.recallProbability(b.card.srs, start));
      main.push(...all);
    } else {
      const reviews = [];
      const news = [];
      for (const deck of sc.decks) {
        const daily = deck.daily && deck.daily.date === today ? deck.daily : (deck.daily = { date: today, newCount: 0, reviewCount: 0 });
        const newLeft = Math.max(0, newLimit(deck, settings, daily.newCount, start) - daily.newCount);
        const revLeft = Math.max(0, settings.reviewsPerDay - daily.reviewCount);
        const deckReviews = [];
        const deckNew = [];
        for (const card of deck.cards) {
          if (!sc.filter(card)) continue;
          const e = { card, deck };
          const st = card.srs.state;
          if ((st === 'learning' || st === 'relearning') && card.srs.due <= start + LEARN_AHEAD) learn.push(e);
          else if (st === 'review' && card.srs.due <= start) deckReviews.push(e);
          else if (st === 'new') deckNew.push(e);
        }
        deckReviews.sort((a, b) => a.card.srs.due - b.card.srs.due);
        reviews.push(...deckReviews.slice(0, revLeft));
        // Keep cloze siblings apart: take at most one blank per note per session pass.
        const seenNotes = new Set();
        const spread = [];
        const later = [];
        for (const e of deckNew) {
          if (e.card.type === 'cloze' && seenNotes.has(e.card.noteId)) later.push(e);
          else {
            seenNotes.add(e.card.noteId);
            spread.push(e);
          }
        }
        news.push(...spread.concat(later).slice(0, newLeft));
      }
      learn.sort((a, b) => a.card.srs.due - b.card.srs.due);
      // Interleave new cards among reviews.
      const revShuffled = shuffle(reviews);
      const ratio = news.length ? Math.max(1, Math.floor(revShuffled.length / news.length)) : 0;
      let ni = 0;
      revShuffled.forEach((e, i) => {
        main.push(e);
        if (ratio && (i + 1) % ratio === 0 && ni < news.length) main.push(news[ni++]);
      });
      while (ni < news.length) main.push(news[ni++]);
    }

    let current = null;
    let revealed = false;
    let typed = '';
    let result = null;
    let graded = null;
    let hintLevel = 0;
    let swapped = false;
    let shownAt = Date.now();
    const history = [];
    const session = { reviewed: 0, correct: 0, ms: 0 };
    let typeMode = settings.typeAnswer;

    function counts() {
      const c = { new: 0, learning: learn.length, review: 0 };
      for (const e of main) c[e.card.srs.state === 'new' ? 'new' : e.card.srs.state === 'review' ? 'review' : 'learning'] += 1;
      if (current) {
        const st = current.card.srs.state;
        c[st === 'new' ? 'new' : st === 'review' ? 'review' : 'learning'] += 1;
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

    function resetCardState() {
      revealed = false;
      typed = '';
      result = null;
      graded = null;
      hintLevel = 0;
      shownAt = Date.now();
    }

    function next() {
      current = pickNext();
      resetCardState();
      draw();
    }

    const sides = () => Rich.cardSides(current.card, swapped);
    const points = () => (current.card.type === 'cloze' ? null : Rich.markPoints(sides().answerRaw));

    function reveal() {
      if (revealed) return;
      if (typeMode) {
        const inp = $('#answer-input');
        typed = inp ? inp.value : '';
        if (typed.trim()) {
          const pts = points();
          if (pts) {
            graded = gradePoints(typed, pts);
            result = pointsResult(graded);
          } else result = checkAnswer(typed, sides().answerRaw);
        }
      }
      revealed = true;
      draw();
    }

    function rate(r) {
      if (!revealed || !current) return;
      const { card, deck } = current;
      const now = Date.now();
      const wasNew = card.srs.state === 'new';
      const ms = now - shownAt;
      history.push({ entry: current, srs: card.srs, updated: card.updated, daily: Object.assign({}, deck.daily), main: main.slice(), learn: learn.slice(), session: Object.assign({}, session), ms, wasNew, r });
      if (history.length > 30) history.shift();

      card.srs = SRS.schedule(card.srs, r, now, srsOptions(deck));
      card.updated = now;
      if (deck.daily) {
        if (wasNew) deck.daily.newCount += 1;
        else deck.daily.reviewCount += 1;
      }
      Store.logReview(wasNew, r, now, ms);
      session.reviewed += 1;
      session.ms += Math.min(ms, 120000);
      if (r >= 3) session.correct += 1;

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
      h.entry.card.updated = h.updated;
      h.entry.deck.daily = h.daily;
      main.splice(0, main.length, ...h.main);
      learn.splice(0, learn.length, ...h.learn);
      Object.assign(session, h.session);
      const log = Store.state.log[Store.todayKey()];
      if (log && log.reviews > 0) {
        log.reviews -= 1;
        if (h.wasNew) log.newCards = Math.max(0, log.newCards - 1);
        if (h.r >= 3) log.correct = Math.max(0, log.correct - 1);
        log.ms = Math.max(0, (log.ms || 0) - Math.min(h.ms, 120000));
      }
      Store.save();
      current = h.entry;
      resetCardState();
      draw();
      toast('Undone');
    }

    function draw() {
      if (!current) return drawDone();
      const c = counts();
      const sd = sides();
      const st = current.card.srs.state;
      const opts = srsOptions(current.deck);
      const pv = revealed ? SRS.preview(current.card.srs, Date.now(), opts) : null;
      const suggested = result === 'correct' ? 3 : result === 'close' ? 2 : result === 'wrong' ? 1 : 0;
      const resultMsg = { correct: '✓ Correct!', close: '≈ Almost — check the details', wrong: '✗ Not quite' }[result];
      const pts = points();
      const isCloze = current.card.type === 'cloze';

      render(`
        <div class="study-top">
          <a class="btn btn-ghost" href="${back}" aria-label="Exit">✕</a>
          <div class="study-title">${esc(title)}</div>
          <div class="queue-counts" data-tip="New · Learning · Review">
            <span class="c-new">${c.new}</span><span class="c-learning">${c.learning}</span><span class="c-young">${c.review}</span>
          </div>
        </div>
        <div class="study-tools">
          <label class="check"><input type="checkbox" id="type-mode" ${typeMode ? 'checked' : ''}> Type answers</label>
          ${isCloze ? '' : `<label class="check"><input type="checkbox" id="swap" ${swapped ? 'checked' : ''}> Definition first</label>`}
          <button class="btn btn-ghost btn-sm" id="undo" ${history.length ? '' : 'disabled'} title="Undo (U)">↶ Undo</button>
        </div>

        <div class="review-card ${revealed ? 'is-revealed' : ''}">
          <span class="state-tag t-${st}">${st === 'new' ? 'New card' : st === 'review' ? 'Review' : 'Learning'}${isCloze ? ' · cloze' : ''}${sc.multi ? ' · ' + esc(current.deck.name) : ''}</span>
          <div class="rc-q rich">${sd.q}</div>
          ${
            revealed
              ? `<hr>
                 ${graded ? '' : `<div class="rc-a rich">${sd.a}</div>`}
                 ${
                   graded
                     ? `<div class="mark-scheme">
                         <div class="ms-head"><b>Mark scheme</b><span class="ms-score">${graded.filter((g) => g.hit).length}/${graded.length}</span></div>
                         ${graded.map((g, i) => `<button class="ms-point ${g.hit ? 'hit' : ''}" data-pt="${i}" title="Click to change">${g.hit ? '✓' : '✗'} ${esc(g.text)}</button>`).join('')}
                         <p class="muted small">Tap a point to mark it yourself if the auto-check got it wrong.</p>
                       </div>`
                     : ''
                 }
                 ${typed.trim() ? `<div class="typed typed-${result}"><span class="muted small">You wrote</span><div>${esc(typed)}</div><b>${resultMsg}</b></div>` : ''}`
              : `${hintLevel ? `<div class="hint">${esc(hintText(sd.answerRaw, hintLevel))}</div>` : ''}
                 ${
                   typeMode
                     ? `<textarea id="answer-input" class="input answer-input" rows="${pts ? 5 : 2}" placeholder="${pts ? `Write your answer — ${pts.length} marking points…` : 'Type your answer from memory…'}" autocomplete="off" spellcheck="false"></textarea>`
                     : `<p class="muted small recall-tip">Recall the answer in your head first, then reveal.${pts ? ` (${pts.length} marking points)` : ''}</p>`
                 }`
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
        </div>`);

      const inp = $('#answer-input');
      if (inp) {
        inp.focus();
        inp.onkeydown = (e) => {
          // Long answers: Enter makes a new line; Ctrl/Cmd+Enter checks.
          if (e.key === 'Enter' && (pts ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
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
      $$('[data-pt]').forEach((b) => {
        b.onclick = () => {
          const g = graded[+b.dataset.pt];
          g.hit = !g.hit;
          result = pointsResult(graded);
          draw();
        };
      });
      $$('[data-r]').forEach((b) => (b.onclick = () => rate(+b.dataset.r)));
      $('#type-mode').onchange = (e) => {
        typeMode = e.target.checked;
        settings.typeAnswer = typeMode;
        Store.save();
        if (!revealed) draw();
      };
      const sw = $('#swap');
      if (sw)
        sw.onchange = (e) => {
          swapped = e.target.checked;
          draw();
        };
      $('#undo').onclick = undo;
    }

    function drawDone() {
      const now = Date.now();
      const upcoming = sc.decks
        .flatMap((d) => d.cards)
        .filter((c) => sc.filter(c) && c.srs.state !== 'new' && c.srs.due > now)
        .sort((a, b) => a.srs.due - b.srs.due)[0];
      const acc = session.reviewed ? Math.round((session.correct / session.reviewed) * 100) : 0;
      const goal = settings.dailyGoal;
      const todayReviews = (Store.state.log[Store.todayKey(now)] || { reviews: 0 }).reviews;
      render(`
        <div class="done">
          <div class="done-emoji">${session.reviewed ? '🎉' : '✅'}</div>
          <h1>${session.reviewed ? (cram ? 'Cram complete!' : 'Session complete!') : 'All caught up!'}</h1>
          ${
            session.reviewed
              ? `<div class="stats-row">
                  <div class="stat"><span class="stat-num">${session.reviewed}</span><span class="stat-label">reviews</span></div>
                  <div class="stat"><span class="stat-num">${acc}%</span><span class="stat-label">recalled</span></div>
                  <div class="stat"><span class="stat-num">${UI.fmtDuration(session.ms)}</span><span class="stat-label">studied</span></div>
                  <div class="stat"><span class="stat-num">${Store.streak(now)}</span><span class="stat-label">day streak 🔥</span></div>
                </div>`
              : '<p class="muted">Nothing is due right now. Spaced repetition works best when you come back later.</p>'
          }
          ${goal ? `<p class="muted">${todayReviews >= goal ? `🎯 Daily goal reached — ${todayReviews} reviews today!` : `🎯 ${goal - todayReviews} more reviews to hit today's goal.`}</p>` : ''}
          ${upcoming ? `<p class="muted">Next card due in <b>${SRS.formatInterval(upcoming.srs.due - now)}</b>.</p>` : ''}
          <div class="row center">
            <a class="btn btn-primary" href="${back}">Done</a>
            ${sc.deck ? `<a class="btn" href="#/flash/${sc.deck.id}">Flashcards</a><a class="btn" href="#/quiz/${sc.deck.id}">Quiz</a><a class="btn" href="#/match/${sc.deck.id}">Match</a>` : ''}
            ${history.length ? '<button class="btn btn-ghost" id="undo">↶ Undo last</button>' : ''}
          </div>
        </div>`);
      const u = $('#undo');
      if (u) u.onclick = undo;
      Sync.schedule();
    }

    setKeys((e) => {
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
    });

    Store.save();
    next();
  };
})();
