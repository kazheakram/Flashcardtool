/*
 * Recall — flashcards with spaced repetition and active recall.
 * Hash routes:
 *   #/                     decks
 *   #/deck/:id             deck overview
 *   #/deck/:id/edit        editor ("new" creates a deck)
 *   #/review/:scope        review: deck id, "all", "f:<folder>" or "t:<tag>"; ?cram=1 for cram
 *   #/flash/:id  #/quiz/:id  #/match/:id
 *   #/import  #/stats  #/settings  #/share/<data>
 */
(function () {
  const STUDY = ['review', 'flash', 'quiz', 'match'];

  function applyTheme() {
    const t = Store.state.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function render() {
    UI.leave();
    const [path, query] = (location.hash.slice(1) || '/').split('?');
    const params = new URLSearchParams(query || '');
    const parts = path.split('/').filter(Boolean);
    const route = parts[0] === 'deck' && parts[2] === 'edit' ? 'edit' : parts[0] || 'home';
    document.body.dataset.route = route;
    document.body.classList.toggle('studying', STUDY.includes(route));
    document.querySelectorAll('.topnav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/' + (parts[0] || '')));
    window.scrollTo(0, 0);
    switch (route) {
      case 'home':
        return Views.home();
      case 'edit':
        return Views.edit(parts[1]);
      case 'deck':
        return Views.deck(parts[1]);
      case 'review':
        return Views.review(parts.slice(1).join('/'), params);
      case 'flash':
      case 'quiz':
      case 'match':
        return Views[route](parts[1]);
      case 'import':
        return Views.import(params);
      case 'stats':
        return Views.stats(params);
      case 'settings':
        return Views.settings();
      case 'share':
        return Views.share(parts.slice(1).join('/'));
      default:
        return Views.home();
    }
  }

  // ---------- reminders ----------

  const REMINDED_KEY = 'recall.lastReminder';
  async function checkReminder() {
    const s = Store.state.settings;
    if (!s.reminderEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    const [h, m] = (s.reminderTime || '18:00').split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
    const today = Store.todayKey(now);
    let last = null;
    try {
      last = localStorage.getItem(REMINDED_KEY);
    } catch (e) {
      /* ignore */
    }
    if (last === today) return;
    const reviews = (Store.state.log[today] || { reviews: 0 }).reviews;
    const stats = Store.statsFor(Store.state.decks.flatMap((d) => d.cards), Date.now());
    const due = stats.due + stats.dueLearning;
    if ((s.dailyGoal && reviews >= s.dailyGoal) || (!due && !stats.new)) return;
    try {
      localStorage.setItem(REMINDED_KEY, today);
    } catch (e) {
      /* ignore */
    }
    const body = [due ? `${due} cards due` : `${stats.new} new cards waiting`, s.dailyGoal ? `${Math.max(0, s.dailyGoal - reviews)} reviews to reach your goal` : ''].filter(Boolean).join(' · ');
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'recall-reminder', data: { url: location.origin + location.pathname + '#/review/all' } };
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration().catch(() => null));
    if (reg) reg.showNotification('🧠 Time to review', opts);
    else new Notification('🧠 Time to review', opts);
  }

  // ---------- start ----------

  window.App = { applyTheme, render };
  window.addEventListener('hashchange', () => {
    render();
    if (!STUDY.includes(document.body.dataset.route)) Sync.schedule(2000);
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__installPrompt = e;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return Sync.schedule(0);
    checkReminder();
    const r = document.body.dataset.route;
    if (r === 'home' || r === 'deck') render(); // refresh due counts
    Sync.schedule(500);
  });
  Sync.onStatus((st) => {
    const dot = document.getElementById('sync-dot');
    dot.hidden = false;
    dot.className = 'sync-dot s-' + st.state;
    dot.title = st.state === 'error' ? 'Sync problem: ' + st.message : st.state === 'syncing' ? 'Syncing…' : st.state === 'off' ? '' : 'Synced';
    if (st.state === 'off') dot.hidden = true;
    // Re-draw pages that show synced data once fresh data lands.
    if (st.state === 'ok' && ['home', 'deck', 'stats'].includes(document.body.dataset.route)) render();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker not registered', e));
  }

  applyTheme();
  render();
  setInterval(checkReminder, 60 * 1000);
  setTimeout(checkReminder, 3000);
  if (Sync.enabled()) Sync.syncNow().catch(() => {});
})();
