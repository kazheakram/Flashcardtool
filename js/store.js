/*
 * Persistence (localStorage) and data helpers.
 *
 * Deck:  { id, name, description, folder, examDate, created, updated, cards, daily, matchBest }
 * Card:  { id, type: 'basic'|'cloze', front, back, tags, starred, noteId?, clozeIndex?, created, updated, srs }
 *
 * A cloze "note" (one piece of text with several {{blanks}}) becomes one card per blank;
 * those cards share a noteId and the same front/back/tags.
 */
(function (root) {
  const KEY = 'recall.v1';
  const SECRETS_KEY = 'recall.secrets'; // API keys / tokens: never exported or synced

  const DEFAULT_SETTINGS = {
    algorithm: 'fsrs',
    desiredRetention: 0.9,
    newPerDay: 20,
    reviewsPerDay: 200,
    learningSteps: [1, 10],
    relearningSteps: [10],
    graduatingInterval: 1,
    easyInterval: 4,
    typeAnswer: false,
    theme: 'auto',
    dailyGoal: 50,
    reminderEnabled: false,
    reminderTime: '18:00',
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function todayKey(now) {
    const d = new Date(now || Date.now());
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const blank = () => ({ decks: [], settings: Object.assign({}, DEFAULT_SETTINGS), log: {}, tombstones: {}, settingsUpdated: 0 });

  function normalizeCard(c) {
    c.type = c.type || (Rich.hasCloze(c.front) ? 'cloze' : 'basic');
    c.tags = Array.isArray(c.tags) ? c.tags : [];
    c.updated = c.updated || c.created || Date.now();
    c.srs = c.srs || SRS.newSrs();
    if (c.type === 'cloze') {
      c.noteId = c.noteId || c.id;
      c.clozeIndex = c.clozeIndex || 1;
    }
    return c;
  }

  function normalize(data) {
    data = Object.assign(blank(), data || {});
    data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    data.decks.forEach((d) => {
      d.folder = d.folder || '';
      d.updated = d.updated || d.created || Date.now();
      d.cards = (d.cards || []).map(normalizeCard);
    });
    return data;
  }

  let state = load();
  const listeners = [];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      console.error('Failed to load saved data', e);
      return blank();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save', e);
      alert('Could not save — your browser storage may be full or disabled.');
    }
    listeners.forEach((fn) => fn());
  }

  function secrets() {
    try {
      return JSON.parse(localStorage.getItem(SECRETS_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }
  function setSecret(k, v) {
    const s = secrets();
    if (v) s[k] = v;
    else delete s[k];
    try {
      localStorage.setItem(SECRETS_KEY, JSON.stringify(s));
    } catch (e) {
      /* storage disabled */
    }
  }

  function makeCard(front, back, extra) {
    const now = Date.now();
    return normalizeCard(Object.assign({ id: uid(), type: 'basic', front: front || '', back: back || '', tags: [], starred: false, created: now, updated: now, srs: SRS.newSrs() }, extra || {}));
  }

  const parseTags = (v) =>
    (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/))
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .filter((t, i, a) => a.indexOf(t) === i);

  /**
   * Turn editor/import rows into cards, reusing existing cards (and their progress) where possible.
   * Row: { id?, noteId?, front, back, tags, starred?, srs? }
   */
  function expandRows(rows, existing) {
    const now = Date.now();
    const byId = new Map((existing || []).map((c) => [c.id, c]));
    const byNote = new Map((existing || []).filter((c) => c.type === 'cloze').map((c) => [c.noteId + '#' + c.clozeIndex, c]));
    const out = [];
    const update = (card, fields) => {
      const changed = ['front', 'back', 'type'].some((k) => card[k] !== fields[k]) || card.tags.join(' ') !== fields.tags.join(' ');
      Object.assign(card, fields);
      if (changed) card.updated = now;
      return card;
    };
    for (const row of rows) {
      const front = row.front || '';
      const back = row.back || '';
      const tags = parseTags(row.tags);
      if (Rich.hasCloze(front)) {
        const { text, indices } = Rich.renumber(front);
        const noteId = row.noteId || (row.id && byId.get(row.id) && byId.get(row.id).noteId) || uid();
        for (const idx of indices) {
          const prev = byNote.get(noteId + '#' + idx);
          if (prev) out.push(update(prev, { type: 'cloze', front: text, back, tags }));
          else out.push(makeCard(text, back, { type: 'cloze', noteId, clozeIndex: idx, tags, starred: !!row.starred, srs: (indices.length === 1 && row.srs) || SRS.newSrs() }));
        }
      } else {
        const prev = row.id && byId.get(row.id);
        if (prev && prev.type === 'basic') out.push(update(prev, { type: 'basic', front, back, tags }));
        else out.push(makeCard(front, back, { tags, starred: !!row.starred, srs: row.srs || SRS.newSrs() }));
      }
    }
    return out;
  }

  /**
   * Cards from imported rows. Full cards from a backup (cloze cards carrying a clozeIndex)
   * are restored as-is with fresh ids; everything else goes through expandRows.
   */
  function cardsFromImport(rows, existing) {
    const raw = rows.filter((r) => r.clozeIndex != null);
    const plain = rows.filter((r) => r.clozeIndex == null);
    const noteIds = {};
    const restored = raw.map((r) =>
      makeCard(r.front, r.back, { type: 'cloze', noteId: noteIds[r.noteId] || (noteIds[r.noteId] = uid()), clozeIndex: r.clozeIndex, tags: parseTags(r.tags), starred: !!r.starred, srs: r.srs || SRS.newSrs() })
    );
    return expandRows(plain, existing).concat(restored);
  }

  /** Group a deck's cards into editor rows (one row per cloze note). */
  function toRows(cards) {
    const rows = [];
    const seen = new Set();
    for (const c of cards) {
      if (c.type === 'cloze') {
        if (seen.has(c.noteId)) continue;
        seen.add(c.noteId);
        rows.push({ id: c.id, noteId: c.noteId, front: c.front, back: c.back, tags: c.tags.join(' ') });
      } else rows.push({ id: c.id, front: c.front, back: c.back, tags: c.tags.join(' ') });
    }
    return rows;
  }

  function createDeck(name, description, rows, extra) {
    const now = Date.now();
    const deck = Object.assign({ id: uid(), name: name || 'Untitled deck', description: description || '', folder: '', examDate: null, created: now, updated: now, cards: cardsFromImport(rows || []) }, extra || {});
    state.decks.unshift(deck);
    save();
    return deck;
  }

  const getDeck = (id) => state.decks.find((d) => d.id === id);

  function tombstone(id) {
    state.tombstones[id] = Date.now();
  }

  /** Replace a deck's cards, recording deletions for sync. */
  function setCards(deck, cards) {
    const keep = new Set(cards.map((c) => c.id));
    deck.cards.forEach((c) => keep.has(c.id) || tombstone(c.id));
    deck.cards = cards;
  }

  function deleteDeck(id) {
    const d = getDeck(id);
    if (d) d.cards.forEach((c) => tombstone(c.id));
    tombstone(id);
    state.decks = state.decks.filter((x) => x.id !== id);
    save();
  }

  function logReview(isNew, rating, now, ms) {
    const k = todayKey(now);
    const e = state.log[k] || (state.log[k] = { reviews: 0, newCards: 0, correct: 0, ms: 0 });
    e.reviews += 1;
    if (isNew) e.newCards += 1;
    if (rating >= 3) e.correct += 1;
    e.ms = (e.ms || 0) + Math.min(ms || 0, 120000);
  }

  function streak(now) {
    let n = 0;
    const d = new Date(now || Date.now());
    if (!state.log[todayKey(d)]) d.setDate(d.getDate() - 1); // today doesn't break the streak yet
    while (state.log[todayKey(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function statsFor(cards, now) {
    now = now || Date.now();
    const s = { total: cards.length, new: 0, learning: 0, young: 0, mastered: 0, due: 0, dueLearning: 0 };
    for (const c of cards) {
      s[SRS.masteryLevel(c.srs)] += 1;
      if (c.srs.state === 'review' && c.srs.due <= now) s.due += 1;
      if ((c.srs.state === 'learning' || c.srs.state === 'relearning') && c.srs.due <= now) s.dueLearning += 1;
    }
    return s;
  }
  const deckStats = (deck, now) => statsFor(deck.cards, now);

  function daysUntil(ts, now) {
    if (!ts) return null;
    const a = new Date(now || Date.now());
    a.setHours(0, 0, 0, 0);
    const b = new Date(ts);
    b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / SRS.DAY);
  }

  // ---------- folders & tags ----------

  const folderParts = (f) => String(f || '').split('/').map((p) => p.trim()).filter(Boolean);
  const cleanFolder = (f) => folderParts(f).join('/');

  function allFolders() {
    const set = new Set();
    for (const d of state.decks) {
      const parts = folderParts(d.folder);
      parts.forEach((p, i) => set.add(parts.slice(0, i + 1).join('/')));
    }
    return [...set].sort();
  }

  function allTags() {
    const counts = {};
    state.decks.forEach((d) => d.cards.forEach((c) => c.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1))));
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }

  /**
   * Resolve a study scope: 'all', a deck id, 'f:<folder>' or 't:<tag>'.
   * Returns { decks, filter(card) => bool, title } or null.
   */
  function scope(id) {
    if (!id) return null;
    if (id === 'all') return { decks: state.decks, filter: () => true, title: 'All decks', multi: true };
    if (id.startsWith('f:')) {
      const f = decodeURIComponent(id.slice(2));
      const decks = state.decks.filter((d) => d.folder === f || d.folder.startsWith(f + '/'));
      return decks.length ? { decks, filter: () => true, title: '📁 ' + f, multi: true } : null;
    }
    if (id.startsWith('t:')) {
      const t = decodeURIComponent(id.slice(2));
      const decks = state.decks.filter((d) => d.cards.some((c) => c.tags.includes(t)));
      return decks.length ? { decks, filter: (c) => c.tags.includes(t), title: '#' + t, multi: true } : null;
    }
    const d = getDeck(id);
    return d ? { decks: [d], filter: () => true, title: d.name, deck: d } : null;
  }

  // ---------- export ----------

  async function exportJson(decks, withImages) {
    decks = decks || state.decks;
    const out = { app: 'recall', version: 2, exported: new Date().toISOString(), decks };
    if (withImages !== false) {
      const ids = decks.flatMap((d) => d.cards.flatMap((c) => Rich.imageIds(c.front).concat(Rich.imageIds(c.back))));
      if (ids.length) out.images = await Images.exportMap(ids);
    }
    return JSON.stringify(out, null, 2);
  }

  // ---------- sync merge ----------

  /** Merge two full states (local + remote). Newer edits win per deck/card; deletions propagate. */
  function merge(a, b) {
    a = normalize(JSON.parse(JSON.stringify(a)));
    b = normalize(JSON.parse(JSON.stringify(b)));
    const tomb = Object.assign({}, a.tombstones);
    for (const [k, v] of Object.entries(b.tombstones)) tomb[k] = Math.max(tomb[k] || 0, v);
    const alive = (obj) => !(tomb[obj.id] && tomb[obj.id] >= (obj.updated || 0));

    const decks = new Map();
    for (const d of [...a.decks, ...b.decks]) {
      const prev = decks.get(d.id);
      if (!prev) {
        decks.set(d.id, d);
        continue;
      }
      const meta = (d.updated || 0) > (prev.updated || 0) ? d : prev;
      const cards = new Map();
      for (const c of [...prev.cards, ...d.cards]) {
        const pc = cards.get(c.id);
        if (!pc || (c.updated || 0) > (pc.updated || 0)) cards.set(c.id, c);
      }
      const daily = [prev.daily, d.daily].filter(Boolean).sort((x, y) => (x.date < y.date ? 1 : -1))[0];
      const bests = [prev.matchBest, d.matchBest].filter(Number.isFinite);
      decks.set(d.id, Object.assign({}, meta, { cards: [...cards.values()], daily, matchBest: bests.length ? Math.min(...bests) : undefined }));
    }
    const mergedDecks = [...decks.values()].filter(alive).map((d) => Object.assign(d, { cards: d.cards.filter(alive) }));
    // Keep local ordering, new remote decks first.
    const order = new Map(a.decks.map((d, i) => [d.id, i]));
    mergedDecks.sort((x, y) => (order.has(x.id) ? order.get(x.id) : -1) - (order.has(y.id) ? order.get(y.id) : -1));

    const log = Object.assign({}, a.log);
    for (const [day, e] of Object.entries(b.log)) {
      const l = log[day];
      log[day] = l ? { reviews: Math.max(l.reviews, e.reviews), newCards: Math.max(l.newCards, e.newCards), correct: Math.max(l.correct, e.correct), ms: Math.max(l.ms || 0, e.ms || 0) } : e;
    }
    const settingsSrc = (b.settingsUpdated || 0) > (a.settingsUpdated || 0) ? b : a;
    return { decks: mergedDecks, settings: settingsSrc.settings, settingsUpdated: settingsSrc.settingsUpdated, log, tombstones: tomb };
  }

  const Store = {
    get state() {
      return state;
    },
    replaceAll(data) {
      state = normalize(data);
      save();
    },
    onChange(fn) {
      listeners.push(fn);
    },
    save,
    secrets,
    setSecret,
    uid,
    todayKey,
    makeCard,
    expandRows,
    cardsFromImport,
    toRows,
    parseTags,
    createDeck,
    getDeck,
    setCards,
    deleteDeck,
    tombstone,
    logReview,
    streak,
    statsFor,
    deckStats,
    daysUntil,
    cleanFolder,
    folderParts,
    allFolders,
    allTags,
    scope,
    exportJson,
    merge,
    normalize,
    DEFAULT_SETTINGS,
  };
  root.Store = Store;
})(window);
