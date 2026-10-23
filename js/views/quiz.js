/* Quiz: multiple choice, written, true/false and mark-scheme long answers. */
(function () {
  const { esc, $, $$, plural, render, go, toast, shuffle, srsOptions, checkAnswer, gradePoints, setKeys } = UI;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  Views.quiz = function (id) {
    const deck = Store.getDeck(id);
    if (!deck) return UI.notFound();
    const usable = deck.cards.filter((c) => (c.type === 'cloze' ? Rich.clozeAnswers(c.front, c.clozeIndex).length : c.front.trim() && c.back.trim()));
    if (usable.length < 2) {
      render(`<div class="empty"><h2>Add a few more cards</h2><p class="muted">A quiz needs at least 2 cards with both a term and a definition.</p><a class="btn" href="#/deck/${deck.id}/edit">Edit deck</a></div>`);
      return;
    }
    const hasLong = usable.some((c) => c.type !== 'cloze' && Rich.markPoints(c.back));
    const cfg = { count: Math.min(20, usable.length), mc: true, written: true, tf: true, long: hasLong, answerWith: 'back', focusWeak: true };

    function setup() {
      render(`
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
              <label class="check ${hasLong ? '' : 'disabled'}" title="${hasLong ? '' : 'Add cards whose answer is a bullet list of marking points'}"><input type="checkbox" id="long" ${cfg.long ? 'checked' : ''} ${hasLong ? '' : 'disabled'}> Long answer (mark scheme)</label>
            </div>
          </div>
          <label class="check"><input type="checkbox" id="focusWeak" ${cfg.focusWeak ? 'checked' : ''}> Prioritise cards I struggle with</label>
          <button class="btn btn-primary btn-block" id="start">Start quiz</button>
        </div>`);
      $('#start').onclick = () => {
        cfg.count = Math.max(1, Math.min(usable.length, parseInt($('#count').value, 10) || 10));
        cfg.answerWith = $('#answerWith').value;
        ['mc', 'written', 'tf', 'long', 'focusWeak'].forEach((k) => (cfg[k] = $('#' + k).checked));
        if (!cfg.mc && !cfg.written && !cfg.tf && !cfg.long) return toast('Pick at least one question type');
        run(buildQuestions());
      };
    }

    function weakness(c) {
      const s = c.srs;
      if (s.state === 'new') return 2;
      return (1 - SRS.recallProbability(s, Date.now())) * 5 + (s.lapses || 0) * 2 + (s.state !== 'review' ? 3 : 0) + Math.random();
    }

    function buildQuestions() {
      let cards = shuffle(usable);
      if (cfg.focusWeak) cards = cards.sort((a, b) => weakness(b) - weakness(a));
      cards = shuffle(cards.slice(0, cfg.count));
      const types = [cfg.mc && 'mc', cfg.written && 'written', cfg.tf && 'tf'].filter(Boolean);
      return cards.map((card, i) => {
        const swap = card.type !== 'cloze' && (cfg.answerWith === 'both' ? Math.random() < 0.5 : cfg.answerWith === 'front');
        const sd = Rich.cardSides(card, swap);
        const points = card.type !== 'cloze' && Rich.markPoints(sd.answerRaw);
        let type = types.length ? types[i % types.length] : 'long';
        if (points) type = cfg.long ? 'long' : types.includes('written') ? 'written' : type;
        else if (type === 'long') type = 'written';
        const others = shuffle(usable.filter((c) => c.id !== card.id && !(card.type === 'cloze' && c.noteId === card.noteId)).map((c) => Rich.cardSides(c, swap).answerRaw).filter((t) => t && t !== sd.answerRaw));
        const q = { card, type, prompt: sd.q, answer: sd.answerRaw, answerHtml: sd.a, swap, points };
        if (type === 'mc') q.options = shuffle([sd.answerRaw, ...Array.from(new Set(others)).slice(0, 3)]);
        if (type === 'tf') {
          q.isTrue = Math.random() < 0.5 || !others.length;
          q.shown = q.isTrue ? sd.answerRaw : others[0];
        }
        return q;
      });
    }

    function run(questions) {
      let i = 0;
      let score = 0;
      const results = [];
      let answered = null;

      function draw() {
        if (i >= questions.length) return summary();
        const q = questions[i];
        const label = q.card.type === 'cloze' ? 'Fill in the blank' : q.swap ? 'Definition' : 'Term';
        const what = q.swap ? 'term' : 'definition';
        let body = '';
        if (q.type === 'mc') {
          body = `<p class="muted small">Choose the matching ${what}</p>
            <div class="options">${q.options
              .map((o, k) => {
                let cls = '';
                if (answered) cls = o === q.answer ? 'opt-correct' : o === answered.given ? 'opt-wrong' : 'opt-dim';
                return `<button class="option ${cls}" data-o="${k}" ${answered ? 'disabled' : ''}><kbd>${k + 1}</kbd><span class="rich">${Rich.render(o)}</span></button>`;
              })
              .join('')}</div>`;
        } else if (q.type === 'tf') {
          body = `<div class="tf-shown"><span class="muted small">Is this the right ${q.card.type === 'cloze' ? 'answer' : what}?</span><div class="rich">${Rich.render(q.shown)}</div></div>
            <div class="options two">
              <button class="option ${answered ? (q.isTrue ? 'opt-correct' : answered.given === true ? 'opt-wrong' : 'opt-dim') : ''}" data-tf="1" ${answered ? 'disabled' : ''}><kbd>1</kbd><span>True</span></button>
              <button class="option ${answered ? (!q.isTrue ? 'opt-correct' : answered.given === false ? 'opt-wrong' : 'opt-dim') : ''}" data-tf="0" ${answered ? 'disabled' : ''}><kbd>2</kbd><span>False</span></button>
            </div>
            ${answered && !q.isTrue ? `<div class="correct-answer"><span class="muted small">Correct answer</span><div class="rich">${q.answerHtml}</div></div>` : ''}`;
        } else if (q.type === 'long') {
          body = answered
            ? `<div class="mark-scheme">
                 <div class="ms-head"><b>Mark scheme</b><span class="ms-score">${answered.graded.filter((g) => g.hit).length}/${answered.graded.length}</span></div>
                 ${answered.graded.map((g, k) => `<button class="ms-point ${g.hit ? 'hit' : ''}" data-pt="${k}">${g.hit ? '✓' : '✗'} ${esc(g.text)}</button>`).join('')}
                 <p class="muted small">Tap a point to correct the marking.</p>
               </div>
               <div class="typed"><span class="muted small">You wrote</span><div>${esc(answered.given) || '<i>(blank)</i>'}</div></div>`
            : `<p class="muted small">Write a full answer — ${plural(q.points.length, 'marking point')}. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to submit.</p>
               <textarea class="input answer-input" id="written" rows="6" autocomplete="off" placeholder="Your answer"></textarea>
               <div class="row"><button class="btn btn-primary" id="submit">Submit</button><button class="btn btn-ghost" id="dunno">I don't know</button></div>`;
        } else {
          body = answered
            ? `<div class="typed typed-${answered.result}"><span class="muted small">You wrote</span><div>${esc(answered.given) || '<i>(blank)</i>'}</div></div>
               <div class="correct-answer"><span class="muted small">Correct answer</span><div class="rich">${q.answerHtml}</div></div>
               ${!answered.correct ? `<button class="btn btn-ghost btn-sm" id="override">I was right — count it</button>` : ''}`
            : `<p class="muted small">Type the ${q.card.type === 'cloze' ? 'missing word(s)' : what} from memory</p>
               <textarea class="input answer-input" id="written" rows="2" autocomplete="off" spellcheck="false" placeholder="Your answer"></textarea>
               <div class="row"><button class="btn btn-primary" id="submit">Answer <kbd>Enter</kbd></button><button class="btn btn-ghost" id="dunno">I don't know</button></div>`;
        }
        render(`
          <div class="study-top">
            <a class="btn btn-ghost" href="#/deck/${deck.id}" aria-label="Exit">✕</a>
            <div class="study-title">Quiz · ${esc(deck.name)}</div>
            <div class="muted">${i + 1} / ${questions.length}</div>
          </div>
          <div class="progress"><span style="width:${(i / questions.length) * 100}%"></span></div>
          <div class="quiz-card">
            <span class="muted small">${label}</span>
            <div class="quiz-prompt rich">${q.prompt}</div>
            ${body}
            ${
              answered
                ? `<div class="feedback ${answered.correct ? 'fb-good' : 'fb-bad'}">${answered.correct ? '✓ ' + pick(['Nice!', 'Correct!', 'You got it!', 'Great recall!']) : q.type === 'long' ? `${answered.graded.filter((g) => g.hit).length} of ${answered.graded.length} marks` : '✗ ' + pick(["Not quite — you'll get it next time.", 'Keep at it!', 'Almost there.'])}</div>
                   <button class="btn btn-primary btn-block" id="continue">Continue <kbd>Enter</kbd></button>`
                : ''
            }
          </div>`);

        $$('[data-o]').forEach((b) => (b.onclick = () => submit(q.options[+b.dataset.o])));
        $$('[data-tf]').forEach((b) => (b.onclick = () => submit(b.dataset.tf === '1')));
        $$('[data-pt]').forEach((b) => {
          b.onclick = () => {
            const g = answered.graded[+b.dataset.pt];
            g.hit = !g.hit;
            const wasCorrect = answered.correct;
            answered.correct = answered.graded.filter((x) => x.hit).length / answered.graded.length >= 0.8;
            score += (answered.correct ? 1 : 0) - (wasCorrect ? 1 : 0);
            results[results.length - 1].correct = answered.correct;
            draw();
          };
        });
        const w = $('#written');
        if (w) {
          w.focus();
          w.onkeydown = (e) => {
            if (e.key === 'Enter' && (q.type === 'long' ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
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

      function submit(given) {
        if (answered) return;
        const q = questions[i];
        let correct;
        let result;
        let graded;
        if (q.type === 'mc') correct = given === q.answer;
        else if (q.type === 'tf') correct = given === q.isTrue;
        else if (q.type === 'long') {
          graded = gradePoints(given, q.points);
          correct = graded.filter((g) => g.hit).length / graded.length >= 0.8;
        } else {
          result = checkAnswer(given, q.answer);
          correct = result === 'correct';
        }
        if (correct) score++;
        answered = { correct, given, result, graded };
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
        render(`
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
                         <div class="card-front rich">${r.q.prompt}</div>
                         <div class="card-back"><div class="rich">${r.q.answerHtml}</div>${(r.q.type === 'written' || r.q.type === 'long') && r.given ? `<div class="small c-learning">You wrote: ${esc(r.given)}</div>` : ''}</div>
                       </div>`
                     )
                     .join('')}</div>`
                : ''
            }
          </div>`);
        const retry = $('#retry');
        if (retry)
          retry.onclick = () => {
            const qs = shuffle(wrong.map((r) => r.q));
            run(qs);
          };
        const tosrs = $('#tosrs');
        if (tosrs)
          tosrs.onclick = () => {
            const now = Date.now();
            const ids = new Set(wrong.map((r) => r.q.card.id));
            deck.cards.forEach((c) => {
              if (!ids.has(c.id) || c.srs.state === 'new') return;
              c.srs = SRS.schedule(c.srs, 1, now, srsOptions(deck));
              c.srs.due = now;
              c.updated = now;
            });
            Store.save();
            tosrs.disabled = true;
            toast('Missed cards will come up in your next review');
          };
        $('#new').onclick = setup;
      }

      setKeys((e) => {
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
      });
      draw();
    }

    setup();
  };
})();
