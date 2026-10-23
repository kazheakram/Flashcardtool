/* Statistics: activity heatmap, review forecast, recall rate, card states. */
(function () {
  const { esc, $, render, plural, fmtDuration } = UI;
  const DAY = SRS.DAY;
  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  function startOfDay(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function heatmap(log, now) {
    const weeks = 26;
    const end = startOfDay(now);
    const start = new Date(end);
    start.setDate(start.getDate() - (weeks * 7 - 1));
    // Align the first column to Monday.
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const days = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    const counts = days.map((d) => (log[Store.todayKey(d)] || {}).reviews || 0);
    const max = Math.max(1, ...counts);
    const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
    const cell = 13;
    const gap = 3;
    const cols = Math.ceil(days.length / 7);
    const w = 28 + cols * (cell + gap);
    const h = 18 + 7 * (cell + gap);
    let monthLabels = '';
    let lastMonth = -1;
    const rects = days
      .map((d, i) => {
        const col = Math.floor(i / 7);
        const row = (d.getDay() + 6) % 7;
        if (row === 0 && d.getMonth() !== lastMonth) {
          lastMonth = d.getMonth();
          monthLabels += `<text x="${28 + col * (cell + gap)}" y="10" class="axis-label">${d.toLocaleDateString(undefined, { month: 'short' })}</text>`;
        }
        const n = counts[i];
        return `<rect x="${28 + col * (cell + gap)}" y="${18 + row * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="hm hm-${level(n)}" data-tip="<b>${fmtDay(d)}</b><br>${plural(n, 'review')}"/>`;
      })
      .join('');
    const dayLabels = ['Mon', 'Wed', 'Fri'].map((t, i) => `<text x="0" y="${18 + (i * 2) * (cell + gap) + 10}" class="axis-label">${t}</text>`).join('');
    return `<svg class="chart heatmap" viewBox="0 0 ${w} ${h}" role="img" aria-label="Reviews per day over the last 26 weeks">${monthLabels}${dayLabels}${rects}</svg>
      <div class="hm-legend muted small">Less ${[0, 1, 2, 3, 4].map((l) => `<span class="hm-key hm-${l}"></span>`).join('')} More</div>`;
  }

  /** Vertical bars, one series. values: [{ label, value, tip }] */
  function bars(values, opts) {
    const W = 640;
    const H = 200;
    const left = 34;
    const bottom = 22;
    const top = 8;
    const max = Math.max(1, ...values.map((v) => v.value));
    const nice = niceMax(max);
    const bw = (W - left) / values.length;
    const y = (v) => H - bottom - ((H - bottom - top) * v) / nice;
    const ticks = [0, nice / 2, nice].map((t) => `<line x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end" class="axis-label">${Math.round(t)}</text>`).join('');
    const rects = values
      .map((v, i) => {
        const x = left + i * bw + 1;
        const bh = Math.max(0, H - bottom - y(v.value));
        const width = Math.max(2, bw - 2);
        const r = Math.min(4, width / 2, bh);
        const path = bh > 0 ? `M${x},${H - bottom} V${y(v.value) + r} Q${x},${y(v.value)} ${x + r},${y(v.value)} H${x + width - r} Q${x + width},${y(v.value)} ${x + width},${y(v.value) + r} V${H - bottom} Z` : '';
        return `<g data-tip="${v.tip}"><rect x="${left + i * bw}" y="${top}" width="${bw}" height="${H - bottom - top}" class="hit"/>${path ? `<path d="${path}" class="bar"/>` : ''}</g>${v.label ? `<text x="${x + width / 2}" y="${H - 6}" text-anchor="middle" class="axis-label">${v.label}</text>` : ''}`;
      })
      .join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">${ticks}${rects}</svg>`;
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  /** Recall % per day as a line, with gaps on days without reviews. */
  function line(points) {
    const W = 640;
    const H = 200;
    const left = 40;
    const bottom = 22;
    const top = 10;
    const step = (W - left - 8) / Math.max(1, points.length - 1);
    const x = (i) => left + i * step;
    const y = (p) => H - bottom - ((H - bottom - top) * p) / 100;
    const ticks = [0, 50, 100].map((t) => `<line x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end" class="axis-label">${t}%</text>`).join('');
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      if (p.value == null) return (pen = false);
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.value).toFixed(1);
      pen = true;
    });
    const dots = points
      .map((p, i) => (p.value == null ? '' : `<circle cx="${x(i)}" cy="${y(p.value)}" r="3.5" class="dot"/>`))
      .join('');
    const hits = points.map((p, i) => `<rect x="${x(i) - step / 2}" y="${top}" width="${step}" height="${H - bottom - top}" class="hit" data-tip="${p.tip}"/>`).join('');
    const labels = points.map((p, i) => (p.label ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="axis-label">${p.label}</text>` : '')).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Percentage of reviews recalled per day">${ticks}<path d="${d}" class="line"/>${dots}${labels}${hits}</svg>`;
  }

  Views.stats = function (params) {
    const now = Date.now();
    const st = Store.state;
    const deckId = params.get('deck') || 'all';
    const deck = deckId !== 'all' ? Store.getDeck(deckId) : null;
    const cards = deck ? deck.cards : st.decks.flatMap((d) => d.cards);
    const log = st.log;
    const today = startOfDay(now);

    // Summary numbers
    const days30 = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days30.push(d);
    }
    const sum = (arr, k) => arr.reduce((n, d) => n + ((log[Store.todayKey(d)] || {})[k] || 0), 0);
    const rev30 = sum(days30, 'reviews');
    const cor30 = sum(days30, 'correct');
    const ms30 = sum(days30, 'ms');
    const allLog = Object.values(log);
    const totalReviews = allLog.reduce((n, e) => n + e.reviews, 0);
    const todayLog = log[Store.todayKey(now)] || { reviews: 0, ms: 0 };
    const activeDays = days30.filter((d) => log[Store.todayKey(d)]).length;
    const s = Store.statsFor(cards, now);

    // Forecast: next 30 days (overdue counted today)
    const forecast = Array.from({ length: 30 }, () => 0);
    for (const c of cards) {
      if (c.srs.state === 'new') continue;
      const idx = Math.max(0, Math.floor((startOfDay(c.srs.due) - today) / DAY));
      if (idx < 30) forecast[idx]++;
    }
    const fValues = forecast.map((n, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return { value: n, label: i % 7 === 0 ? (i === 0 ? 'Today' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })) : '', tip: `<b>${i === 0 ? 'Today (incl. overdue)' : fmtDay(d)}</b><br>${plural(n, 'card')} due` };
    });
    const week = forecast.slice(0, 7).reduce((a, b) => a + b, 0);

    const rPoints = days30.map((d, i) => {
      const e = log[Store.todayKey(d)];
      const v = e && e.reviews ? Math.round((e.correct / e.reviews) * 100) : null;
      return { value: v, label: i % 7 === 0 ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '', tip: `<b>${fmtDay(d)}</b><br>${v == null ? 'No reviews' : `${v}% recalled (${e.correct}/${e.reviews})`}` };
    });

    const stateRows = [
      ['new', 'New', s.new],
      ['learning', 'Learning', s.learning],
      ['young', 'Reviewing (<21d)', s.young],
      ['mastered', 'Mastered (21d+)', s.mastered],
    ];

    render(`
      <nav class="crumbs"><a href="#/">Decks</a> / <span>Stats</span></nav>
      <div class="row between">
        <h1>Statistics</h1>
        <select class="input input-auto" id="deck">
          <option value="all">All decks</option>
          ${st.decks.map((d) => `<option value="${d.id}" ${d.id === deckId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
      </div>

      <div class="tiles">
        <div class="tile-stat"><span class="stat-num">${Store.streak(now)}</span><span class="stat-label">day streak 🔥</span></div>
        <div class="tile-stat"><span class="stat-num">${todayLog.reviews}</span><span class="stat-label">reviews today · ${fmtDuration(todayLog.ms || 0)}</span></div>
        <div class="tile-stat"><span class="stat-num">${rev30 ? Math.round((cor30 / rev30) * 100) + '%' : '—'}</span><span class="stat-label">recalled (30 days)</span></div>
        <div class="tile-stat"><span class="stat-num">${activeDays}/30</span><span class="stat-label">days studied</span></div>
        <div class="tile-stat"><span class="stat-num">${fmtDuration(ms30)}</span><span class="stat-label">studied (30 days)</span></div>
        <div class="tile-stat"><span class="stat-num">${totalReviews}</span><span class="stat-label">reviews all time</span></div>
      </div>

      <section class="panel chart-panel">
        <h2 class="section-title">Activity <span class="muted small">· all decks, last 26 weeks</span></h2>
        <div class="chart-scroll">${heatmap(log, now)}</div>
      </section>

      <section class="panel chart-panel">
        <h2 class="section-title">Upcoming reviews <span class="muted small">· ${plural(week, 'card')} in the next 7 days</span></h2>
        ${bars(fValues, { label: 'Cards due per day for the next 30 days' })}
      </section>

      <section class="panel chart-panel">
        <h2 class="section-title">Recall rate <span class="muted small">· all decks, last 30 days</span></h2>
        ${rev30 ? line(rPoints) : '<p class="muted center pad">Review some cards to see how well you recall them.</p>'}
      </section>

      <section class="panel chart-panel">
        <h2 class="section-title">Cards by stage <span class="muted small">· ${plural(s.total, 'card')}</span></h2>
        ${
          s.total
            ? `<div class="stack-bar">${stateRows.map(([k, label, n]) => (n ? `<span class="seg ${k}" style="flex:${n}" data-tip="<b>${label}</b><br>${n} cards (${Math.round((n / s.total) * 100)}%)"></span>` : '')).join('')}</div>
               <div class="legend">${stateRows.map(([k, label, n]) => `<span class="legend-item"><span class="swatch ${k}"></span>${label} <b>${n}</b></span>`).join('')}</div>`
            : '<p class="muted center pad">No cards yet.</p>'
        }
      </section>

      <details class="panel">
        <summary><b>Table view</b></summary>
        <table class="data-table">
          <thead><tr><th>Day</th><th>Reviews</th><th>Recalled</th><th>New cards</th><th>Time</th></tr></thead>
          <tbody>${days30
            .slice()
            .reverse()
            .map((d) => {
              const e = log[Store.todayKey(d)];
              return `<tr><td>${fmtDay(d)}</td><td>${e ? e.reviews : 0}</td><td>${e && e.reviews ? Math.round((e.correct / e.reviews) * 100) + '%' : '—'}</td><td>${e ? e.newCards : 0}</td><td>${e ? fmtDuration(e.ms || 0) : '—'}</td></tr>`;
            })
            .join('')}</tbody>
        </table>
      </details>`);

    $('#deck').onchange = (e) => UI.go(e.target.value === 'all' ? '#/stats' : '#/stats?deck=' + e.target.value);
  };
})();
