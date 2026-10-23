/*
 * Card images, stored in IndexedDB (localStorage is too small for pictures).
 * Cards reference them as ![alt](img:ID).
 */
(function (root) {
  const DB = 'recall-images';
  const STORE = 'images';
  const urls = new Map(); // id -> object URL
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }

  const id = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Downscale large photos so decks stay small. Keeps PNG/GIF/SVG as-is when already small. */
  async function shrink(file, maxSide = 1400) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 150 * 1024) return file;
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/png' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise((r) => canvas.toBlob(r, type, 0.85));
    return blob && blob.size < file.size ? blob : file;
  }

  async function add(file) {
    const blob = await shrink(file);
    const key = id();
    await tx('readwrite', (s) => s.put(blob, key));
    return key;
  }

  async function getBlob(key) {
    return tx('readonly', (s) => s.get(key));
  }

  async function url(key) {
    if (urls.has(key)) return urls.get(key);
    const blob = await getBlob(key);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    urls.set(key, u);
    return u;
  }

  /** Fill in src for every <img data-img> inside el. */
  function hydrate(el) {
    el.querySelectorAll('img[data-img]:not([src])').forEach(async (img) => {
      const u = await url(img.dataset.img).catch(() => null);
      if (u) img.src = u;
      else img.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: '[missing image]' }));
    });
  }

  const toDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  async function dataUrlToBlob(d) {
    return (await fetch(d)).blob();
  }

  /** { id: dataURL } for the given ids (for backups, sync). */
  async function exportMap(ids) {
    const out = {};
    for (const key of new Set(ids)) {
      const blob = await getBlob(key).catch(() => null);
      if (blob) out[key] = await toDataUrl(blob);
    }
    return out;
  }

  async function importMap(map) {
    for (const [key, d] of Object.entries(map || {})) {
      if (urls.has(key) || (await getBlob(key).catch(() => null))) continue;
      const blob = await dataUrlToBlob(d);
      await tx('readwrite', (s) => s.put(blob, key));
    }
  }

  async function clear() {
    await tx('readwrite', (s) => s.clear());
    urls.clear();
  }

  root.Images = { add, url, hydrate, exportMap, importMap, getBlob, toDataUrl, clear };
})(window);
