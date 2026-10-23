/* Import: paste text or drop a file. */
(function () {
  const { esc, $, $$, plural, render, go, toast } = UI;
  const TERM_SEPS = { tab: '\t', comma: ',', dash: ' - ', colon: ':' };
  const CARD_SEPS = { nl: '\n', semi: ';', blank: '\n\n' };

  Views.import = function (params) {
    const decks = Store.state.decks;
    const targetDeck = params.get('deck');
    let text = '';
    let fmt = { format: 'auto' };
    let parsed = null;
    let error = '';
    let fileName = '';

    render(`
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
              <li><b>Quizlet:</b> open the set → <i>⋯</i> menu → <i>Export</i> → <i>Copy text</i>, then paste here. The default (Tab / New line) works as is.</li>
              <li><b>Anki:</b> <i>File → Export</i> → "Notes in Plain Text (.txt)", then drop the file here. Cloze notes are kept as cloze cards and a tags column is imported.</li>
              <li><b>RevisionDojo / other apps:</b> copy your cards as text (one card per line, term and definition separated by a tab, comma or dash) and paste them here.</li>
              <li><b>Google Sheets / Excel:</b> terms in column A, definitions in column B, optional tags in column C. Copy the cells and paste, or download as CSV.</li>
              <li>Fields containing commas or line breaks can be wrapped in "double quotes". Formatting, $maths$ and {{cloze}} syntax all work in imported text.</li>
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
            <label class="form-row new-only"><span>Deck title</span><input class="input" id="deckname" placeholder="Imported deck"></label>
            <label class="form-row new-only"><span>Folder</span><input class="input" id="folder" list="folders" placeholder="optional, e.g. Biology/Topic 2"></label>
            <datalist id="folders">${Store.allFolders().map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
            <label class="form-row"><span>Add tags</span><input class="input" id="tags" placeholder="optional, e.g. paper1"></label>
            <button class="btn btn-primary btn-block" id="do-import" disabled>Import</button>
          </div>
        </div>
      </div>`);

    const paste = $('#paste');

    function update() {
      error = '';
      parsed = null;
      const tsVal = $('input[name=ts]:checked').value;
      const csVal = $('input[name=cs]:checked').value;
      const detected = text.trim() ? (fileName ? Importer.detectFile(fileName, text) : Importer.detect(text)) : { format: 'delimited', termSep: '\t', cardSep: '\n' };
      let termSep;
      let cardSep;
      fmt = tsVal === 'auto' ? detected : { format: 'delimited' };
      termSep = tsVal === 'auto' ? detected.termSep || '\t' : tsVal === 'custom' ? $('#ts-custom').value || '\t' : TERM_SEPS[tsVal];
      cardSep = csVal === 'custom' ? $('#cs-custom').value || '\n' : CARD_SEPS[csVal];
      if (tsVal === 'auto' && detected.cardSep && csVal === 'nl') cardSep = detected.cardSep;
      if (text.trim()) {
        try {
          parsed = Importer.parse(text, fmt.format === 'json' || fmt.format === 'anki' ? fmt : { format: 'delimited', termSep, cardSep });
          if ($('#swap').checked) parsed.decks.forEach((d) => d.cards.forEach((c) => !Rich.hasCloze(c.front) && ([c.front, c.back] = [c.back, c.front])));
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
      $$('.new-only').forEach((el) => (el.hidden = dest.value !== 'new' || multi));
      const name = $('#deckname');
      if (parsed && parsed.decks.length === 1 && parsed.decks[0].name !== 'Imported deck') name.placeholder = parsed.decks[0].name;
      else if (fileName) name.placeholder = fileName.replace(/\.[^.]+$/, '');
      if (parsed && parsed.decks.length === 1 && parsed.decks[0].folder && !$('#folder').value) $('#folder').value = parsed.decks[0].folder;

      const pv = $('#preview');
      if (error) return (pv.innerHTML = `<p class="error">Couldn't read that: ${esc(error)}</p>`);
      if (!total) return (pv.innerHTML = `<p class="muted center pad">Your cards will appear here.</p>`);
      const shown = [];
      parsed.decks.forEach((d, di) => {
        if (multi) shown.push(`<div class="preview-deck">${esc(d.name)} · ${plural(d.cards.length, 'card')}</div>`);
        d.cards.slice(0, multi ? 30 : 200).forEach((c, ci) => {
          const cloze = Rich.hasCloze(c.front);
          const tags = Store.parseTags(c.tags);
          shown.push(`<div class="preview-row">
            <div class="rich">${c.front ? Rich.render(cloze ? Rich.clozeDisplay(c.front) : c.front) : '<i class="muted">(empty)</i>'}${cloze ? ' <span class="badge b-cloze">cloze</span>' : ''}</div>
            <div class="rich">${c.back ? Rich.render(c.back) : cloze ? '' : '<i class="muted">(empty)</i>'}${tags.length ? `<div class="card-tags">${tags.map((t) => '#' + esc(t)).join(' ')}</div>` : ''}</div>
          </div>`);
        });
      });
      if (!multi && total > 200) shown.push(`<p class="muted small center">…and ${total - 200} more</p>`);
      pv.innerHTML = shown.join('');
      Images.hydrate(pv);
    }

    // ----- paste / file -----

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
    const dropzone = (el, fn) => {
      el.ondragover = (e) => {
        e.preventDefault();
        el.classList.add('over');
      };
      el.ondragleave = () => el.classList.remove('over');
      el.ondrop = (e) => {
        e.preventDefault();
        el.classList.remove('over');
        fn(e.dataTransfer.files[0]);
      };
    };
    dropzone($('#drop'), readFile);

    // ----- import -----

    $('#do-import').onclick = async () => {
      if (!parsed) return;
      const dest = $('#dest').value;
      const extraTags = Store.parseTags($('#tags').value);
      const withTags = (cards) => cards.map((c) => Object.assign({}, c, { tags: Store.parseTags(c.tags).concat(extraTags) }));
      if (parsed.images) await Images.importMap(parsed.images).catch((e) => toast('Some images could not be restored: ' + e.message));
      const count = parsed.decks.reduce((n, d) => n + d.cards.length, 0);
      if (parsed.decks.length > 1 || dest === 'new') {
        let last;
        for (const d of parsed.decks) {
          const single = parsed.decks.length === 1;
          const name = single ? $('#deckname').value.trim() || $('#deckname').placeholder || d.name : d.name;
          const folder = single ? Store.cleanFolder($('#folder').value) : d.folder || '';
          last = Store.createDeck(name, d.description, withTags(d.cards), { folder });
        }
        toast(`Imported ${plural(count, 'card')}`);
        go(parsed.decks.length === 1 ? '#/deck/' + last.id : '#/');
      } else {
        const deck = Store.getDeck(dest);
        const key = (c) => Rich.plainText(c.front).toLowerCase() + '\u0000' + Rich.plainText(c.back).toLowerCase();
        const existing = new Set(deck.cards.map(key));
        const fresh = withTags(parsed.decks[0].cards).filter((c) => {
          const k = key(c);
          if (existing.has(k)) return false;
          existing.add(k);
          return true;
        });
        const added = Store.cardsFromImport(fresh);
        deck.cards.push(...added);
        deck.updated = Date.now();
        Store.save();
        const skipped = parsed.decks[0].cards.length - fresh.length;
        toast(`Added ${plural(added.length, 'card')}${skipped ? ` (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped)` : ''}`);
        go('#/deck/' + deck.id);
      }
    };

    update();
  };
})();
