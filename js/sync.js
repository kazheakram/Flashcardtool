/*
 * Cloud sync through a private GitHub Gist, using a personal access token with the
 * "gist" scope. Each device merges its data with the gist (newer edits win, deletions
 * propagate) and uploads the result, so phone and laptop stay in step.
 */
(function (root) {
  const API = 'https://api.github.com';
  const DATA_FILE = 'recall-sync.json';
  const IMAGES_FILE = 'recall-images.json';
  let timer = null;
  let running = null;
  let status = { state: 'off', at: null, message: '' };
  const listeners = [];

  const token = () => Store.secrets().githubToken || '';
  const gistId = () => Store.secrets().gistId || '';
  const enabled = () => !!(token() && gistId());

  function setStatus(s) {
    status = Object.assign({}, status, s);
    listeners.forEach((fn) => fn(status));
  }

  async function gh(path, opts) {
    const res = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token(), 'X-GitHub-Api-Version': '2022-11-28' }, (opts && opts.headers) || {}) }));
    if (res.status === 401) throw new Error('GitHub rejected the token. Check it has the "gist" permission and hasn’t expired.');
    if (!res.ok) throw new Error(`GitHub error ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.status === 204 ? null : res.json();
  }

  async function fileContent(file) {
    if (!file) return null;
    // Files over ~1 MB come back truncated; fetch the raw file instead.
    if (file.truncated) return (await fetch(file.raw_url)).text();
    return file.content;
  }

  /** Find the user's Recall gist or create one. */
  async function connect(newToken) {
    Store.setSecret('githubToken', newToken);
    try {
      let found = null;
      for (let page = 1; page <= 10 && !found; page++) {
        const gists = await gh(`/gists?per_page=100&page=${page}`);
        found = gists.find((g) => g.files && g.files[DATA_FILE]);
        if (gists.length < 100) break;
      }
      if (!found) {
        found = await gh('/gists', {
          method: 'POST',
          body: JSON.stringify({ description: 'Recall flashcards sync data', public: false, files: { [DATA_FILE]: { content: JSON.stringify(Store.state) } } }),
        });
      }
      Store.setSecret('gistId', found.id);
      await syncNow();
      return found.id;
    } catch (e) {
      Store.setSecret('githubToken', '');
      throw e;
    }
  }

  function disconnect() {
    Store.setSecret('githubToken', '');
    Store.setSecret('gistId', '');
    setStatus({ state: 'off', message: '' });
  }

  function imageIdsIn(state) {
    return [...new Set(state.decks.flatMap((d) => d.cards.flatMap((c) => Rich.imageIds(c.front).concat(Rich.imageIds(c.back)))))];
  }

  async function doSync() {
    setStatus({ state: 'syncing', message: 'Syncing…' });
    const gist = await gh('/gists/' + gistId());
    const remoteText = await fileContent(gist.files[DATA_FILE]);
    const remote = remoteText ? JSON.parse(remoteText) : null;
    const merged = remote ? Store.merge(Store.state, remote) : Store.state;

    // Images: pull ones we don't have, push ones the gist doesn't have.
    const remoteImagesText = await fileContent(gist.files[IMAGES_FILE]);
    const remoteImages = remoteImagesText ? JSON.parse(remoteImagesText) : {};
    await Images.importMap(remoteImages);
    const needed = imageIdsIn(merged);
    const missing = needed.filter((id) => !remoteImages[id]);
    const files = { [DATA_FILE]: { content: JSON.stringify(merged) } };
    if (missing.length) {
      const all = Object.assign({}, remoteImages, await Images.exportMap(missing));
      // Drop images no card uses any more.
      for (const k of Object.keys(all)) if (!needed.includes(k)) delete all[k];
      files[IMAGES_FILE] = { content: JSON.stringify(all) };
    }
    const changedRemote = !remote || JSON.stringify(merged) !== JSON.stringify(Store.normalize(remote)) || missing.length;
    if (changedRemote) await gh('/gists/' + gistId(), { method: 'PATCH', body: JSON.stringify({ files }) });
    Store.replaceAll(merged);
    setStatus({ state: 'ok', at: Date.now(), message: 'Synced' });
  }

  // Replacing the data mid-session would detach the cards a view is holding, so wait.
  const busy = () => ['review', 'flash', 'quiz', 'match', 'edit', 'import'].includes(document.body.dataset.route);

  async function syncNow() {
    if (!enabled()) return;
    if (busy()) return schedule(15000);
    if (running) return running;
    running = doSync()
      .catch((e) => {
        setStatus({ state: 'error', message: e.message });
        throw e;
      })
      .finally(() => (running = null));
    return running;
  }

  /** Sync a little while after changes settle. */
  function schedule(delay) {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow().catch(() => {}), delay == null ? 4000 : delay);
  }

  root.Sync = { connect, disconnect, syncNow, schedule, enabled, get status() {
    return status;
  }, onStatus: (fn) => listeners.push(fn) };
})(window);
