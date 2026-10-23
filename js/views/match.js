/* Match: pair terms with definitions against the clock. Tap or drag a tile onto its partner. */
(function () {
  const { esc, $, $$, render, go, shuffle, setKeys, onLeave } = UI;
  const PAIRS = 6;
  const PENALTY = 1000;
  const flat = (s) => s.replace(/^\s*([-*•]|\d+[.)])\s+/gm, '').replace(/\s*\n+\s*/g, '; ');
  const clip = (s, n) => (s = flat(s)).length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

  Views.match = function (id) {
    const deck = Store.getDeck(id);
    if (!deck) return UI.notFound();
    // One tile pair per note; skip cards whose sides are empty or identical.
    const seenNotes = new Set();
    const pool = deck.cards.filter((c) => {
      if (c.type === 'cloze') {
        if (seenNotes.has(c.noteId)) return false;
        seenNotes.add(c.noteId);
      }
      const sd = Rich.cardSides(c);
      return sd.promptPlain && Rich.plainText(sd.answerRaw) && sd.promptPlain !== Rich.plainText(sd.answerRaw);
    });
    if (pool.length < 2) {
      render(`<div class="empty"><h2>Not enough cards</h2><p class="muted">Match needs at least 2 cards with different terms and definitions.</p><a class="btn" href="#/deck/${deck.id}">Back</a></div>`);
      return;
    }

    let timer = null;
    onLeave(() => clearInterval(timer));

    function intro() {
      render(`
        <div class="done">
          <div class="done-emoji">⚡</div>
          <h1>Match</h1>
          <p class="muted">Match all the terms with their definitions as fast as you can. Wrong matches add a 1-second penalty.</p>
          ${deck.matchBest ? `<p>Your best: <b>${(deck.matchBest / 1000).toFixed(1)}s</b></p>` : ''}
          <div class="row center">
            <button class="btn btn-primary btn-wide" id="go">Start game</button>
            <a class="btn" href="#/deck/${deck.id}">Back</a>
          </div>
        </div>`);
      $('#go').onclick = play;
      setKeys((e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          play();
        } else if (e.key === 'Escape') go('#/deck/' + deck.id);
      });
    }

    function play() {
      const cards = shuffle(pool).slice(0, PAIRS);
      const tiles = shuffle(
        cards.flatMap((c) => {
          const sd = Rich.cardSides(c);
          return [
            { pair: c.id, text: clip(sd.promptPlain.replace(/_{3}/g, '___'), 120), kind: 'term' },
            { pair: c.id, text: clip(Rich.plainText(sd.answerRaw), 120), kind: 'def' },
          ];
        })
      ).map((t, i) => Object.assign(t, { i }));
      let selected = null;
      let left = cards.length;
      let penalty = 0;
      const started = performance.now();

      render(`
        <div class="study-top">
          <a class="btn btn-ghost" href="#/deck/${deck.id}" aria-label="Exit">✕</a>
          <div class="study-title">Match · ${esc(deck.name)}</div>
          <div class="match-timer" id="timer">0.0s</div>
        </div>
        <div class="match-grid" id="grid">
          ${tiles.map((t) => `<button class="tile tile-${t.kind}" data-i="${t.i}" draggable="true">${esc(t.text)}</button>`).join('')}
        </div>`);

      const elapsed = () => performance.now() - started + penalty;
      clearInterval(timer);
      timer = setInterval(() => {
        const el = $('#timer');
        if (el) el.textContent = (elapsed() / 1000).toFixed(1) + 's';
      }, 100);

      const tileEl = (i) => $(`.tile[data-i="${i}"]`);

      function attempt(a, b) {
        if (a === b) return;
        const ta = tiles[a];
        const tb = tiles[b];
        const ea = tileEl(a);
        const eb = tileEl(b);
        ea.classList.remove('selected');
        eb.classList.remove('selected');
        selected = null;
        if (ta.pair === tb.pair && ta.kind !== tb.kind) {
          [ea, eb].forEach((el) => {
            el.classList.add('matched');
            el.disabled = true;
          });
          left--;
          if (!left) finish();
        } else {
          penalty += PENALTY;
          [ea, eb].forEach((el) => {
            el.classList.add('wrong');
            setTimeout(() => el.classList.remove('wrong'), 450);
          });
          const t = $('#timer');
          t.classList.add('penalty');
          setTimeout(() => t.classList.remove('penalty'), 450);
        }
      }

      $$('.tile').forEach((el) => {
        const i = +el.dataset.i;
        el.onclick = () => {
          if (el.disabled) return;
          if (selected == null) {
            selected = i;
            el.classList.add('selected');
          } else if (selected === i) {
            selected = null;
            el.classList.remove('selected');
          } else attempt(selected, i);
        };
        el.ondragstart = (e) => {
          e.dataTransfer.setData('text/plain', String(i));
          el.classList.add('selected');
        };
        el.ondragend = () => el.classList.remove('selected');
        el.ondragover = (e) => e.preventDefault();
        el.ondrop = (e) => {
          e.preventDefault();
          const from = +e.dataTransfer.getData('text/plain');
          if (!Number.isNaN(from) && !el.disabled) attempt(from, i);
        };
      });

      function finish() {
        clearInterval(timer);
        const ms = Math.round(elapsed());
        const best = deck.matchBest;
        const isBest = !best || ms < best;
        if (isBest && cards.length === Math.min(PAIRS, pool.length)) {
          deck.matchBest = ms;
          deck.updated = Date.now();
          Store.save();
        }
        setTimeout(() => {
          render(`
            <div class="done">
              <div class="done-emoji">${isBest ? '🏆' : '⚡'}</div>
              <h1>${(ms / 1000).toFixed(1)} seconds</h1>
              <p class="muted">${isBest ? (best ? 'New personal best!' : 'First time set — now beat it!') : `Your best is ${(best / 1000).toFixed(1)}s`}${penalty ? ` · includes ${penalty / 1000}s of penalties` : ''}</p>
              <div class="row center">
                <button class="btn btn-primary" id="again">Play again <kbd>Enter</kbd></button>
                <a class="btn" href="#/review/${deck.id}">Review</a>
                <a class="btn" href="#/deck/${deck.id}">Back to deck</a>
              </div>
            </div>`);
          $('#again').onclick = play;
          setKeys((e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              play();
            } else if (e.key === 'Escape') go('#/deck/' + deck.id);
          });
        }, 350);
      }

      setKeys((e) => {
        if (e.key === 'Escape') go('#/deck/' + deck.id);
      });
    }

    intro();
  };
})();
