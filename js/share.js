/*
 * Share links: the whole deck is compressed into the URL itself (#/share/<data>),
 * so no server is needed. Progress and stored images are not included.
 */
(function (root) {
  const { esc, $, $$, render, go, toast, plural, copyText } = UI;

  const b64url = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

  async function pipe(bytes, stream) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  }

  function payload(deck) {
    let stripped = 0;
    const strip = (t) =>
      t.replace(/!\[([^\]]*)\]\(img:[\w-]+\)/g, (a, alt) => {
        stripped++;
        return alt ? `[${alt}]` : '[image]';
      });
    const c = Store.toRows(deck.cards).map((r) => {
      const row = [strip(r.front), strip(r.back)];
      if (r.tags) row.push(r.tags);
      return row;
    });
    return { data: { share: 1, n: deck.name, d: deck.description || '', c }, stripped };
  }

  async function encode(deck) {
    const { data, stripped } = payload(deck);
    const bytes = await pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream('deflate-raw'));
    return { url: location.origin + location.pathname + '#/share/' + b64url(bytes), stripped };
  }

  async function decode(str) {
    const bytes = await pipe(fromB64url(str), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function modal(html) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => e.target === wrap && close());
    UI.onLeave(close);
    return { el: wrap, close };
  }

  async function openDialog(deck) {
    if (!('CompressionStream' in window)) return toast('Your browser is too old to create share links');
    const { url, stripped } = await encode(deck);
    const m = modal(`
      <h2>Share “${esc(deck.name)}”</h2>
      <p class="muted small">Anyone with this link can add a copy of the ${plural(deck.cards.length, 'card')} to their own Recall. Your progress isn't shared.${stripped ? ` <b>${plural(stripped, 'image')} can't travel in a link</b> — export the deck as JSON to share those.` : ''}</p>
      <textarea class="input mono share-url" rows="3" readonly>${esc(url)}</textarea>
      ${url.length > 8000 ? `<p class="small c-young">This link is long (${Math.round(url.length / 1000)}k characters). It works in browsers, but some chat apps may cut it off — for big decks, send the JSON export instead.</p>` : ''}
      <div class="row">
        <button class="btn btn-primary" id="copy-link">Copy link</button>
        ${navigator.share ? '<button class="btn" id="native-share">Share…</button>' : ''}
        <button class="btn btn-ghost" id="close-modal">Close</button>
      </div>`);
    const ta = m.el.querySelector('.share-url');
    ta.onfocus = () => ta.select();
    m.el.querySelector('#copy-link').onclick = async () => toast((await copyText(url)) ? 'Link copied' : 'Copy failed — select the link and copy it');
    const ns = m.el.querySelector('#native-share');
    if (ns) ns.onclick = () => navigator.share({ title: deck.name, text: `Flashcards: ${deck.name}`, url }).catch(() => {});
    m.el.querySelector('#close-modal').onclick = m.close;
  }

  Views.share = async function (data) {
    render(`<div class="empty"><p class="muted">Opening shared deck…</p></div>`);
    let deck;
    try {
      deck = Importer.parseJson(JSON.stringify(await decode(data))).decks[0];
    } catch (e) {
      render(`<div class="empty"><h2>This share link is broken</h2><p class="muted">It may have been cut off when it was sent. Ask for the link again, or for a JSON export of the deck.</p><a class="btn" href="#/">Go to my decks</a></div>`);
      return;
    }
    render(`
      <nav class="crumbs"><a href="#/">Decks</a> / <span>Shared deck</span></nav>
      <div class="panel narrow">
        <p class="muted small">Someone shared a deck with you</p>
        <h1>${esc(deck.name)}</h1>
        ${deck.description ? `<p class="muted">${esc(deck.description)}</p>` : ''}
        <p><b>${plural(deck.cards.length, 'card')}</b></p>
        <label class="field"><input class="input" id="folder" list="folders" placeholder="Folder (optional)"><span>Save into folder</span></label>
        <datalist id="folders">${Store.allFolders().map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
        <button class="btn btn-primary btn-block" id="add">Add to my decks</button>
      </div>
      <div class="card-list">${deck.cards
        .slice(0, 300)
        .map((c) => `<div class="card-row"><div class="card-front rich">${Rich.render(Rich.hasCloze(c.front) ? Rich.clozeDisplay(c.front) : c.front)}</div><div class="card-back rich">${Rich.render(c.back)}</div><div></div></div>`)
        .join('')}</div>`);
    $('#add').onclick = () => {
      const d = Store.createDeck(deck.name, deck.description, deck.cards, { folder: Store.cleanFolder($('#folder').value) });
      toast('Deck added');
      go('#/deck/' + d.id);
    };
  };

  root.Share = { encode, decode, openDialog, modal };
})(window);
