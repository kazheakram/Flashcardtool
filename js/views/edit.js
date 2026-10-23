/* Deck editor: title, folder, cards with tags, images, formatting and cloze. */
(function () {
  const { esc, $, $$, render, go, toast, onLeave } = UI;

  const needsPreview = (t) => /\*\*|__|==|~~|`|\$|!\[|\{\{|^\s*([-*•]|\d+[.)])\s/m.test(t);

  Views.edit = function (id) {
    const isNew = id === 'new';
    const deck = isNew ? null : Store.getDeck(id);
    if (!isNew && !deck) return UI.notFound();
    const rows = deck ? Store.toRows(deck.cards) : [{ front: '', back: '', tags: '' }, { front: '', back: '', tags: '' }, { front: '', back: '', tags: '' }];
    let dirty = false;
    let lastField = null;
    const folders = Store.allFolders();

    render(`
      <nav class="crumbs"><a href="#/">Decks</a> / ${deck ? `<a href="#/deck/${deck.id}">${esc(deck.name)}</a> / <span>Edit</span>` : '<span>New deck</span>'}</nav>
      <div class="editor-head">
        <input class="input input-lg" id="name" placeholder="Deck title, e.g. Biology – Cell structure" value="${esc(deck ? deck.name : '')}">
        <textarea class="input" id="desc" rows="2" placeholder="Description (optional)">${esc(deck ? deck.description : '')}</textarea>
        <label class="field"><input class="input" id="folder" list="folders" placeholder="Folder, e.g. Biology/Topic 2/2.3 (optional)" value="${esc(deck ? deck.folder : '')}"><span>Folder — use / for subfolders</span></label>
        <datalist id="folders">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
      </div>
      <details class="help format-help">
        <summary>Formatting, maths, images & cloze cards</summary>
        <div class="format-grid">
          <code>**bold**</code><span><b>bold</b></span>
          <code>*italic*</code><span><i>italic</i></span>
          <code>==highlight==</code><span><mark>highlight</mark></span>
          <code>- point</code><span>bullet list</span>
          <code>$x^2 + y^2$</code><span>inline maths (LaTeX)</span>
          <code>$$\\int_0^1 x\\,dx$$</code><span>display maths</span>
          <code>$\\ce{H2SO4}$</code><span>chemistry</span>
          <code>{{answer}}</code><span>cloze blank — one card per blank</span>
          <code>{{c1::answer::hint}}</code><span>numbered blank with a hint; same number = same card</span>
          <code>- point [[key, word]]</code><span>mark-scheme keywords for long answers</span>
        </div>
        <p class="muted small">Paste or drop an image into any field, or use the 🖼 button. Press <kbd>Tab</kbd> in the last definition to add a new card.</p>
      </details>
      <div class="row between">
        <p class="muted small">Need lots of cards? <a href="#/import${deck ? '?deck=' + deck.id : ''}">Import them instead</a>.</p>
        <button class="btn btn-sm" id="swap" title="Swap terms and definitions of basic cards">⇄ Swap all</button>
      </div>
      <div id="rows" class="edit-rows"></div>
      <button class="btn btn-block add-row" id="add">+ Add card</button>
      <input type="file" id="img-file" accept="image/*" hidden>
      <div class="sticky-actions">
        <a class="btn" href="${deck ? '#/deck/' + deck.id : '#/'}">Cancel</a>
        <button class="btn btn-primary" id="save">${isNew ? 'Create deck' : 'Save'}</button>
      </div>`);

    function rowHtml(r, i) {
      const cloze = Rich.hasCloze(r.front);
      const n = cloze ? Rich.clozeIndices(r.front).length : 0;
      return `
        <div class="edit-row" data-i="${i}">
          <div class="row-top">
            <span class="num">${i + 1}</span>
            ${cloze ? `<span class="badge b-cloze">cloze · ${n} card${n === 1 ? '' : 's'}</span>` : ''}
            <span class="spacer"></span>
            <button class="icon-btn" data-cloze="${i}" title="Turn the selected text into a cloze blank">{{ }}</button>
            <button class="icon-btn" data-img="${i}" title="Add image">🖼</button>
            <button class="icon-btn" data-del="${i}" title="Delete card">🗑</button>
          </div>
          <div class="row-fields">
            <label class="field"><textarea class="input" data-f="front" rows="2" placeholder="${cloze ? 'Text with {{blanks}}' : 'Term'}">${esc(r.front)}</textarea><span>${cloze ? 'Cloze text' : 'Term'}</span></label>
            <label class="field"><textarea class="input" data-f="back" rows="2" placeholder="${cloze ? 'Extra info (optional)' : 'Definition'}">${esc(r.back)}</textarea><span>${cloze ? 'Extra' : 'Definition'}</span></label>
          </div>
          <input class="input input-tags" data-f="tags" placeholder="Tags (optional): paper1 topic2" value="${esc(r.tags || '')}">
          <div class="preview-pane rich" ${needsPreview(r.front + r.back) ? '' : 'hidden'}></div>
        </div>`;
    }

    function updatePreview(rowEl) {
      const r = rows[+rowEl.dataset.i];
      const pane = rowEl.querySelector('.preview-pane');
      if (!needsPreview(r.front + r.back)) {
        pane.hidden = true;
        return;
      }
      pane.hidden = false;
      const cloze = Rich.hasCloze(r.front);
      const front = cloze ? Rich.render(Rich.clozeQuestion(r.front, Rich.clozeIndices(r.front)[0])) : Rich.render(r.front);
      pane.innerHTML = `<div class="pp-label">Preview</div><div class="pp-grid"><div>${front}</div><div>${cloze ? Rich.render(Rich.clozeAnswer(r.front, Rich.clozeIndices(r.front)[0])) + (r.back ? '<div class="extra">' + Rich.render(r.back) + '</div>' : '') : Rich.render(r.back)}</div></div>`;
      Images.hydrate(pane);
    }

    async function insertImage(ta, file) {
      if (!file || !file.type.startsWith('image/')) return;
      try {
        const key = await Images.add(file);
        const md = `![](img:${key})`;
        const pos = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, pos) + (pos && !/\s$/.test(ta.value.slice(0, pos)) ? '\n' : '') + md + ta.value.slice(ta.selectionEnd ?? pos);
        ta.dispatchEvent(new Event('input'));
      } catch (e) {
        toast('Could not save image: ' + e.message);
      }
    }

    function renderRows(focusLast) {
      $('#rows').innerHTML = rows.map(rowHtml).join('');
      $$('#rows .edit-row').forEach(updatePreview);
      $$('#rows [data-f]').forEach((el) => {
        const rowEl = el.closest('.edit-row');
        const i = +rowEl.dataset.i;
        let t;
        el.oninput = () => {
          const wasCloze = Rich.hasCloze(rows[i].front);
          rows[i][el.dataset.f] = el.value;
          dirty = true;
          clearTimeout(t);
          t = setTimeout(() => updatePreview(rowEl), 250);
          if (el.dataset.f === 'front' && wasCloze !== Rich.hasCloze(el.value)) {
            // Refresh labels/badge without losing focus.
            const pos = el.selectionStart;
            renderRows();
            const ta = $(`#rows .edit-row[data-i="${i}"] textarea[data-f="front"]`);
            ta.focus();
            ta.setSelectionRange(pos, pos);
          }
        };
        el.onfocus = () => (lastField = el);
        if (el.tagName === 'TEXTAREA') {
          el.onpaste = (e) => {
            const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              insertImage(el, file);
            }
          };
          el.ondragover = (e) => e.preventDefault();
          el.ondrop = (e) => {
            const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              insertImage(el, file);
            }
          };
        }
        if (el.dataset.f === 'tags' && i === rows.length - 1) {
          el.onkeydown = (e) => {
            if (e.key === 'Tab' && !e.shiftKey) {
              e.preventDefault();
              rows.push({ front: '', back: '', tags: el.value });
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
      $$('[data-img]').forEach((b) => {
        b.onclick = () => {
          const rowEl = b.closest('.edit-row');
          const target = lastField && rowEl.contains(lastField) && lastField.tagName === 'TEXTAREA' ? lastField : rowEl.querySelector('textarea[data-f="back"]');
          const input = $('#img-file');
          input.value = '';
          input.onchange = () => insertImage(target, input.files[0]);
          input.click();
        };
      });
      $$('[data-cloze]').forEach((b) => {
        b.onmousedown = (e) => e.preventDefault(); // keep the textarea selection
        b.onclick = () => {
          const ta = b.closest('.edit-row').querySelector('textarea[data-f="front"]');
          const { selectionStart: a, selectionEnd: z, value } = ta;
          if (a === z) return toast('Select a word or phrase in the term field first');
          const sel = value.slice(a, z).replace(/^\s+|\s+$/g, '');
          ta.value = value.slice(0, a) + `{{${sel}}}` + value.slice(z);
          ta.dispatchEvent(new Event('input'));
        };
      });
      if (focusLast) {
        const tas = $$('#rows textarea[data-f="front"]');
        tas[tas.length - 1].focus();
      }
    }
    renderRows();

    $('#add').onclick = () => {
      rows.push({ front: '', back: '', tags: rows.length ? rows[rows.length - 1].tags : '' });
      renderRows(true);
    };
    $('#swap').onclick = () => {
      rows.forEach((r) => {
        if (!Rich.hasCloze(r.front)) [r.front, r.back] = [r.back, r.front];
      });
      dirty = true;
      renderRows();
    };
    $('#name').oninput = $('#desc').oninput = $('#folder').oninput = () => (dirty = true);

    $('#save').onclick = () => {
      const name = $('#name').value.trim();
      if (!name) {
        $('#name').focus();
        toast('Give your deck a title');
        return;
      }
      const clean = rows.filter((r) => r.front.trim() || r.back.trim());
      const folder = Store.cleanFolder($('#folder').value);
      if (isNew) {
        const d = Store.createDeck(name, $('#desc').value.trim(), clean, { folder });
        dirty = false;
        go('#/deck/' + d.id);
        return;
      }
      deck.cards = Store.expandRows(clean, deck.cards);
      Object.assign(deck, { name, description: $('#desc').value.trim(), folder, updated: Date.now() });
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
    onLeave(() => window.removeEventListener('beforeunload', beforeUnload));
  };
})();
