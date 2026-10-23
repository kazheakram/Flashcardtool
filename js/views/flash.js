/* Quizlet-style flip cards with Know / Still learning sorting. */
(function () {
  const { esc, $, plural, render, go, toast, shuffle, setKeys } = UI;

  Views.flash = function (id) {
    const deck = Store.getDeck(id);
    if (!deck) return UI.notFound();
    if (!deck.cards.length) return go('#/deck/' + id + '/edit');
    let starredOnly = false;
    let swapped = false;
    let order = deck.cards.slice();
    let idx = 0;
    let flipped = false;
    let known = new Set();
    let learning = new Set();
    let sortMode = true;

    const pool = () => (starredOnly ? deck.cards.filter((c) => c.starred) : deck.cards.slice());

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
        render(`<div class="empty"><h2>No cards to show</h2><p class="muted">No starred cards in this deck.</p><button class="btn" id="all">Show all cards</button></div>`);
        $('#all').onclick = () => {
          starredOnly = false;
          restart(pool());
        };
        return;
      }
      if (idx >= order.length) return drawSummary();
      const c = order[idx];
      const sd = Rich.cardSides(c, swapped);
      render(`
        <div class="study-top">
          <a class="btn btn-ghost" href="#/deck/${deck.id}" aria-label="Exit">✕</a>
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
            <div class="face front"><button class="star ${c.starred ? 'on' : ''}" id="star" aria-label="Star">★</button><div class="face-text rich">${sd.q}</div><span class="muted small face-hint">Click or press Space to flip</span></div>
            <div class="face back"><div class="face-text rich">${sd.a}</div></div>
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
        </div>`);

      const flip = $('#flip');
      flip.onclick = (e) => {
        if (e.target.id === 'star') return;
        flipped = !flipped;
        flip.classList.toggle('flipped', flipped);
      };
      $('#star').onclick = () => {
        c.starred = !c.starred;
        c.updated = Date.now();
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
      render(`
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
            <a class="btn" href="#/match/${deck.id}">Play Match</a>
          </div>
        </div>`);
      const again = $('#again');
      if (again) again.onclick = () => restart(shuffle(stillCards));
      $('#restart').onclick = () => restart(pool());
    }

    setKeys((e) => {
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
    });

    draw();
  };
})();
