/*
 * Persistence (localStorage) and data helpers.
 */
(function (root) {
  const KEY = 'recall.v1';

  const DEFAULT_SETTINGS = {
    newPerDay: 20,
    reviewsPerDay: 200,
    learningSteps: [1, 10],
    relearningSteps: [10],
    graduatingInterval: 1,
    easyInterval: 4,
    typeAnswer: false,
    theme: 'auto',
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayKey(now) {
    const d = new Date(now || Date.now());
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function blank() {
    return { decks: [], settings: Object.assign({}, DEFAULT_SETTINGS), log: {} };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const data = JSON.parse(raw);
      data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
      data.decks = data.decks || [];
      data.log = data.log || {};
      return data;
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
  }

  function makeCard(front, back, extra) {
    return Object.assign({ id: uid(), front: front || '', back: back || '', starred: false, created: Date.now(), srs: SRS.newSrs() }, extra || {});
  }

  function createDeck(name, description, cards) {
    const deck = { id: uid(), name: name || 'Untitled deck', description: description || '', created: Date.now(), updated: Date.now(), cards: (cards || []).map((c) => makeCard(c.front, c.back, { srs: c.srs || SRS.newSrs(), starred: !!c.starred })) };
    state.decks.unshift(deck);
    save();
    return deck;
  }

  function getDeck(id) {
    return state.decks.find((d) => d.id === id);
  }

  function deleteDeck(id) {
    state.decks = state.decks.filter((d) => d.id !== id);
    save();
  }

  function logReview(isNew, rating, now) {
    const k = todayKey(now);
    const entry = state.log[k] || (state.log[k] = { reviews: 0, newCards: 0, correct: 0 });
    entry.reviews += 1;
    if (isNew) entry.newCards += 1;
    if (rating >= 3) entry.correct += 1;
  }

  function streak(now) {
    let n = 0;
    const d = new Date(now || Date.now());
    // Today counts if studied; otherwise the streak is still alive from yesterday.
    if (!state.log[todayKey(d)]) d.setDate(d.getDate() - 1);
    while (state.log[todayKey(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function deckStats(deck, now) {
    now = now || Date.now();
    const s = { total: deck.cards.length, new: 0, learning: 0, due: 0, mastered: 0, young: 0 };
    for (const c of deck.cards) {
      const lvl = SRS.masteryLevel(c.srs);
      s[lvl] += 1;
      if (SRS.isDue(c.srs, now) && c.srs.state === 'review') s.due += 1;
    }
    // Learning cards due now are also "due".
    s.dueLearning = deck.cards.filter((c) => (c.srs.state === 'learning' || c.srs.state === 'relearning') && c.srs.due <= now).length;
    return s;
  }

  function exportJson(decks) {
    return JSON.stringify({ app: 'recall', version: 1, exported: new Date().toISOString(), decks: decks || state.decks }, null, 2);
  }

  const Store = {
    get state() {
      return state;
    },
    replaceAll(data) {
      state = Object.assign(blank(), data);
      save();
    },
    save,
    uid,
    todayKey,
    makeCard,
    createDeck,
    getDeck,
    deleteDeck,
    logReview,
    streak,
    deckStats,
    exportJson,
    DEFAULT_SETTINGS,
  };
  root.Store = Store;
})(window);
