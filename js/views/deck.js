/* Deck overview: stats, exam date, study modes, card list. */
(function () {
  const { esc, $, $$, plural, render, go, toast, download, slug, onLeave } = UI;

  function dateInputValue(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** One list row per note: cloze siblings are grouped. */
  function noteRows(cards) {
    const rows = [];
    const byNote = new Map();
    for (const c of cards) {
      if (c.type === 'cloze') {
        if (byNote.has(c.noteId)) {
          byNote.get(c.noteId).cards.push(c);
          continue;
        }
        const r = { lead: c, cards: [c] };
        byNote.set(c.noteId, r);
        rows.push(r);
      } else rows.push({ lead: c, cards: [c] });
    }
    return rows;
  }

  const LEVEL_ORDER = ['new', 'learning', 'young', 'mastered'];

  Views.deck = function (id) {
    const deck = Store.getDeck(id);
    if (!deck) return UI.notFound();
    const now = Date.now();
    const s = Store.deckStats(deck, now);
    const due = s.due + s.dueLearning;
    const settings = Store.state.settings;
    const daily = deck.daily && deck.daily.date === Store.todayKey(now) ? deck.daily : { newCount: 0 };
    const newAvail = Math.min(s.new, Math.max(0, settings.newPerDay - daily.newCount));
    const exam = Store.daysUntil(deck.examDate, now);
    const examActive = exam != null && exam >= 0;
    const seen = s.total - s.new;
    const nextDue = deck.cards.filter((c) => c.srs.state !== 'new' && c.srs.due > now).sort((a, b) => a.srs.due - b.srs.due)[0];
    const tags = [...new Set(deck.cards.flatMap((c) => c.tags))].sort();
    let filter = '';
    let starredOnly = false;
    let tagFilter = null;

    const crumbs = Store.folderParts(deck.folder)
      .map((p, i, a) => `<a href="#/review/f:${encodeURIComponent(a.slice(0, i + 1).join('/'))}" title="Review this folder">${esc(p)}</a> / `)
      .join('');

    render(`
      <nav class="crumbs"><a href="#/">Decks</a> / ${crumbs}<span>${esc(deck.name)}</span></nav>
      <header class="deck-head">
        <div>
          <h1>${esc(deck.name)}</h1>
          ${deck.description ? `<p class="muted">${esc(deck.description)}</p>` : ''}
        </div>
        <div class="row">
          <a class="btn" href="#/deck/${deck.id}/edit">Edit</a>
          <button class="btn" id="share">Share</button>
          <div class="dropdown">
            <button class="btn" id="more" aria-haspopup="true" aria-label="More actions">⋯</button>
            <div class="menu" id="menu" hidden>
              <button data-act="export-json">Export (JSON with progress & images)</button>
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

      <div class="exam-panel ${examActive ? 'active' : ''}">
        <div>
          <b>📅 Exam date</b>
          ${
            examActive
              ? `<span class="exam-countdown">${exam === 0 ? 'Today!' : exam === 1 ? 'Tomorrow' : exam + ' days to go'}</span>
                 <div class="muted small">${seen}/${s.total} cards studied. Reviews are scheduled to land before the exam${s.new ? `, and new cards are paced so you'll see them all in time` : ''}.</div>`
              : `<div class="muted small">Set a test date and Recall makes sure every card is reviewed before it.</div>`
          }
        </div>
        <div class="row">
          <input type="date" class="input input-date" id="exam" value="${dateInputValue(deck.examDate)}" aria-label="Exam date">
          ${deck.examDate ? '<button class="btn btn-ghost btn-sm" id="clear-exam">Clear</button>' : ''}
        </div>
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
          <span class="mode-desc">Multiple choice, written, long answer</span>
        </a>
        <a class="mode" href="#/match/${deck.id}">
          <span class="mode-icon">⚡</span>
          <span class="mode-title">Match</span>
          <span class="mode-desc">${deck.matchBest ? 'Best: ' + (deck.matchBest / 1000).toFixed(1) + 's' : 'Race the clock'}</span>
        </a>
        ${
          examActive && s.total - s.new > 0
            ? `<a class="mode" href="#/review/${deck.id}?cram=1">
                <span class="mode-icon">🔥</span>
                <span class="mode-title">Cram</span>
                <span class="mode-desc">Review everything, weakest first</span>
              </a>`
            : ''
        }
      </div>

      <div class="list-head">
        <h2 class="section-title">${plural(deck.cards.length, 'card')}</h2>
        <div class="row">
          <label class="check"><input type="checkbox" id="starred"> ★ only</label>
          <input class="input" id="search" type="search" placeholder="Search cards">
        </div>
      </div>
      ${tags.length ? `<div class="tag-bar" id="tags">${tags.map((t) => `<button class="chip" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
      <div id="cardlist" class="card-list"></div>`);

    function renderList() {
      const q = filter.toLowerCase();
      const items = noteRows(deck.cards).filter(({ lead }) => (!starredOnly || lead.starred) && (!tagFilter || lead.tags.includes(tagFilter)) && (!q || Rich.plainText(lead.front).toLowerCase().includes(q) || Rich.plainText(lead.back).toLowerCase().includes(q)));
      const el = $('#cardlist');
      el.innerHTML = items.length
        ? items
            .map(({ lead, cards }) => {
              const lvl = cards.map((c) => SRS.masteryLevel(c.srs)).sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))[0];
              const soonest = cards.reduce((m, c) => (c.srs.state === 'new' ? m : Math.min(m, c.srs.due)), Infinity);
              const dueTxt = soonest === Infinity ? 'new' : soonest <= now ? 'due now' : 'due in ' + SRS.formatInterval(soonest - now);
              const front = lead.type === 'cloze' ? Rich.render(Rich.clozeDisplay(lead.front)) : Rich.render(lead.front);
              return `
            <div class="card-row">
              <div class="card-front rich">${front}${lead.tags.length ? `<div class="card-tags">${lead.tags.map((t) => '#' + esc(t)).join(' ')}</div>` : ''}</div>
              <div class="card-back rich">${lead.back ? Rich.render(lead.back) : lead.type === 'cloze' ? '<span class="muted small">Cloze</span>' : ''}</div>
              <div class="card-meta">
                ${lead.type === 'cloze' ? `<span class="badge b-cloze" data-tip="${cards.length} blank${cards.length === 1 ? '' : 's'}, each studied as its own card">cloze ×${cards.length}</span>` : ''}
                <span class="badge b-${lvl}" data-tip="${dueTxt}">${lvl === 'young' ? 'reviewing' : lvl}</span>
                <button class="star ${lead.starred ? 'on' : ''}" data-star="${lead.id}" aria-label="Star">★</button>
              </div>
            </div>`;
            })
            .join('')
        : `<p class="muted center pad">${deck.cards.length ? 'No matching cards.' : `This deck is empty. <a href="#/deck/${deck.id}/edit">Add cards</a> or <a href="#/import?deck=${deck.id}">import</a>.`}</p>`;
      Images.hydrate(el);
      $$('[data-star]').forEach((b) => {
        b.onclick = () => {
          const lead = deck.cards.find((x) => x.id === b.dataset.star);
          const on = !lead.starred;
          deck.cards.filter((c) => c === lead || (lead.type === 'cloze' && c.noteId === lead.noteId)).forEach((c) => Object.assign(c, { starred: on, updated: Date.now() }));
          Store.save();
          b.classList.toggle('on', on);
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
    $$('[data-tag]').forEach((b) => {
      b.onclick = () => {
        tagFilter = tagFilter === b.dataset.tag ? null : b.dataset.tag;
        $$('[data-tag]').forEach((x) => x.classList.toggle('on', x.dataset.tag === tagFilter));
        renderList();
      };
    });

    $('#exam').onchange = (e) => {
      const v = e.target.value;
      // End of the chosen day, local time.
      deck.examDate = v ? new Date(v + 'T23:59:00').getTime() : null;
      deck.updated = Date.now();
      Store.save();
      toast(v ? 'Exam date set — reviews will be scheduled before it' : 'Exam date cleared');
      Views.deck(id);
    };
    const clear = $('#clear-exam');
    if (clear)
      clear.onclick = () => {
        deck.examDate = null;
        deck.updated = Date.now();
        Store.save();
        Views.deck(id);
      };

    $('#share').onclick = () => Share.openDialog(deck);

    const menu = $('#menu');
    $('#more').onclick = (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    };
    const closeMenu = () => (menu.hidden = true);
    document.addEventListener('click', closeMenu);
    onLeave(() => document.removeEventListener('click', closeMenu));

    menu.onclick = async (e) => {
      const act = e.target.dataset.act;
      if (act === 'export-json') download(slug(deck.name) + '.json', await Store.exportJson([deck]));
      if (act === 'export-txt') {
        const rows = Store.toRows(deck.cards);
        download(slug(deck.name) + '.txt', rows.map((r) => [r.front, r.back, r.tags].map((f) => f.replace(/[\t\n]/g, ' ')).join('\t')).join('\n'), 'text/plain');
      }
      if (act === 'import') go('#/import?deck=' + deck.id);
      if (act === 'reset' && confirm('Reset spaced-repetition progress for every card in this deck?')) {
        deck.cards.forEach((c) => Object.assign(c, { srs: SRS.newSrs(), updated: Date.now() }));
        deck.daily = null;
        Store.save();
        Views.deck(id);
      }
      if (act === 'delete' && confirm(`Delete "${deck.name}" and all ${deck.cards.length} cards? This can't be undone.`)) {
        Store.deleteDeck(deck.id);
        go('#/');
      }
    };
  };
})();
