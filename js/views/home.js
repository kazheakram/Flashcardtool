/* Home: daily goal, due counts, folders of decks, tags. */
(function () {
  const { esc, $, $$, plural, render, go } = UI;
  const COLLAPSE_KEY = 'recall.ui.collapsed';

  function collapsed() {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));
    } catch (e) {
      return new Set();
    }
  }
  function setCollapsed(set) {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
    } catch (e) {
      /* per-viewer convenience only */
    }
  }

  function ring(value, goal) {
    const pct = goal ? Math.min(1, value / goal) : 0;
    const r = 26;
    const c = 2 * Math.PI * r;
    return `<svg class="goal-ring" viewBox="0 0 64 64" role="img" aria-label="${value} of ${goal} reviews today">
      <circle cx="32" cy="32" r="${r}" class="ring-track"/>
      <circle cx="32" cy="32" r="${r}" class="ring-fill ${pct >= 1 ? 'done' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
      <text x="32" y="36" text-anchor="middle">${pct >= 1 ? '✓' : Math.round(pct * 100) + '%'}</text>
    </svg>`;
  }

  function deckCard(d, now) {
    const s = Store.deckStats(d, now);
    const due = s.due + s.dueLearning;
    const pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
    const exam = Store.daysUntil(d.examDate, now);
    return `
      <a class="deck-card" href="#/deck/${d.id}">
        <div class="deck-card-top">
          <h3>${esc(d.name)}</h3>
          <span class="muted">${plural(s.total, 'card')}</span>
        </div>
        ${d.description ? `<p class="muted small clamp">${esc(d.description)}</p>` : ''}
        <div class="mastery-bar" data-tip="${s.mastered} mastered · ${s.young} reviewing · ${s.learning} learning · ${s.new} new">
          <span class="seg mastered" style="flex:${s.mastered}"></span>
          <span class="seg young" style="flex:${s.young}"></span>
          <span class="seg learning" style="flex:${s.learning}"></span>
          <span class="seg new" style="flex:${s.new}"></span>
        </div>
        <div class="deck-card-foot">
          <span class="pill ${due ? 'pill-due' : ''}">${due} due</span>
          <span class="pill pill-new">${s.new} new</span>
          ${exam != null && exam >= 0 ? `<span class="pill pill-exam">📅 ${exam === 0 ? 'Exam today' : exam === 1 ? 'Exam tomorrow' : 'Exam in ' + exam + 'd'}</span>` : ''}
          <span class="muted small">${pct}% mastered</span>
        </div>
      </a>`;
  }

  function buildTree(decks) {
    const rootNode = { path: '', name: '', decks: [], children: new Map() };
    for (const d of decks) {
      let node = rootNode;
      for (const part of Store.folderParts(d.folder)) {
        const path = node.path ? node.path + '/' + part : part;
        if (!node.children.has(part)) node.children.set(part, { path, name: part, decks: [], children: new Map() });
        node = node.children.get(part);
      }
      node.decks.push(d);
    }
    return rootNode;
  }

  function allDecks(node) {
    return node.decks.concat(...[...node.children.values()].map(allDecks));
  }

  function folderHtml(node, now, closed) {
    const decks = allDecks(node);
    const s = Store.statsFor(decks.flatMap((d) => d.cards), now);
    const due = s.due + s.dueLearning;
    const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    return `
      <details class="folder" data-path="${esc(node.path)}" ${closed.has(node.path) ? '' : 'open'}>
        <summary>
          <span class="folder-name">📁 ${esc(node.name)}</span>
          <span class="muted small">${plural(decks.length, 'deck')} · ${plural(s.total, 'card')}</span>
          ${due ? `<a class="btn btn-sm btn-primary" href="#/review/f:${encodeURIComponent(node.path)}" onclick="event.stopPropagation()">Review ${due}</a>` : ''}
        </summary>
        <div class="folder-body">
          ${kids.map((k) => folderHtml(k, now, closed)).join('')}
          ${node.decks.length ? `<div class="deck-grid">${node.decks.map((d) => deckCard(d, now)).join('')}</div>` : ''}
        </div>
      </details>`;
  }

  Views.home = function () {
    const now = Date.now();
    const st = Store.state;
    const decks = st.decks;
    const log = st.log[Store.todayKey(now)] || { reviews: 0 };
    const all = Store.statsFor(decks.flatMap((d) => d.cards), now);
    const totalDue = all.due + all.dueLearning;
    const goal = st.settings.dailyGoal;
    const tree = buildTree(decks);
    const closed = collapsed();
    const tags = Store.allTags();
    const folders = [...tree.children.values()].sort((a, b) => a.name.localeCompare(b.name));

    render(`
      <section class="hero">
        <div class="hero-goal">
          ${goal ? ring(log.reviews, goal) : ''}
          <div class="stats-row">
            <div class="stat"><span class="stat-num">${Store.streak(now)}</span><span class="stat-label">day streak 🔥</span></div>
            <div class="stat"><span class="stat-num">${totalDue}</span><span class="stat-label">cards due</span></div>
            <div class="stat"><span class="stat-num">${log.reviews}${goal ? `<small class="muted">/${goal}</small>` : ''}</span><span class="stat-label">${goal ? 'daily goal' : 'reviewed today'}</span></div>
          </div>
        </div>
        <div class="hero-actions">
          ${totalDue ? `<a class="btn btn-primary" href="#/review/all">Review all due (${totalDue})</a>` : ''}
          <a class="btn" href="#/deck/new/edit">+ New deck</a>
          <a class="btn" href="#/import">Import</a>
        </div>
      </section>
      ${
        decks.length
          ? `${tags.length ? `<div class="tag-bar"><span class="muted small">Study by tag:</span>${tags.map(([t, n]) => `<a class="chip" href="#/review/t:${encodeURIComponent(t)}" data-tip="${n} cards">#${esc(t)}</a>`).join('')}</div>` : ''}
             <h2 class="section-title">Your decks</h2>
             ${folders.map((f) => folderHtml(f, now, closed)).join('')}
             ${tree.decks.length ? `<div class="deck-grid">${tree.decks.map((d) => deckCard(d, now)).join('')}</div>` : ''}`
          : `<div class="empty">
              <h2>No decks yet</h2>
              <p class="muted">Create a deck, import from Quizlet / Anki / CSV, or try a sample deck.</p>
              <div class="row center">
                <a class="btn btn-primary" href="#/deck/new/edit">Create a deck</a>
                <a class="btn" href="#/import">Import cards</a>
                <button class="btn" id="sample">Try a sample deck</button>
              </div>
            </div>`
      }`);

    $$('details.folder').forEach((el) => {
      el.addEventListener('toggle', () => {
        const set = collapsed();
        if (el.open) set.delete(el.dataset.path);
        else set.add(el.dataset.path);
        setCollapsed(set);
      });
    });

    const sample = $('#sample');
    if (sample)
      sample.onclick = () => {
        const d = Store.createDeck(
          'Sample: Biology basics',
          'Try every card type: basic, cloze (fill-in-the-blank), maths and a mark-scheme answer.',
          [
            { front: 'Mitochondria', back: 'Site of **aerobic respiration**; produces ATP', tags: 'cells' },
            { front: 'Ribosome', back: 'Site of protein synthesis (translation)', tags: 'cells' },
            { front: 'The {{nucleus}} contains the cell’s {{DNA}}.', back: '', tags: 'cells' },
            { front: 'Photosynthesis takes place in the {{c1::chloroplast}} using {{c2::light::energy source}} energy.', back: '', tags: 'plants' },
            { front: 'Word equation for photosynthesis', back: 'carbon dioxide + water → glucose + oxygen', tags: 'plants' },
            { front: 'Balanced equation for respiration', back: '$\\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}$', tags: 'respiration' },
            { front: 'Magnification formula', back: '$M = \\dfrac{\\text{image size}}{\\text{actual size}}$', tags: 'skills' },
            { front: 'Describe how an enzyme works (3 marks)', back: '- the substrate binds to the active site [[active site]]\n- forming an enzyme–substrate complex [[enzyme-substrate complex/ES complex]]\n- the activation energy is lowered [[activation energy]]', tags: 'enzymes' },
            { front: 'Osmosis', back: 'Net movement of water across a partially permeable membrane from a dilute to a more concentrated solution', tags: 'transport' },
            { front: 'Diffusion', back: 'Net movement of particles from high to low concentration', tags: 'transport' },
          ],
          { folder: 'Science/Biology' }
        );
        go('#/deck/' + d.id);
      };
  };
})();
