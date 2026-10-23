/* Settings: scheduling, goal & reminders, install, backup. */
(function () {
  const { esc, $, render, go, toast, download } = UI;

  function icsReminder(time) {
    const [h, m] = time.split(':').map(Number);
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}${pad(m)}00`;
    const url = location.origin + location.pathname;
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Recall//Flashcards//EN',
      'BEGIN:VEVENT',
      `UID:recall-daily-${Date.now()}@recall`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
      `DTSTART:${stamp}`,
      'DURATION:PT20M',
      'RRULE:FREQ=DAILY',
      'SUMMARY:🧠 Flashcard review',
      `DESCRIPTION:Time for your spaced-repetition review: ${url}`,
      `URL:${url}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Flashcard review',
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  Views.settings = function () {
    const s = Store.state.settings;
    const notifSupported = 'Notification' in window;

    render(`
      <nav class="crumbs"><a href="#/">Decks</a> / <span>Settings</span></nav>
      <h1>Settings</h1>

      <div class="panel narrow">
        <h2 class="section-title">Spaced repetition</h2>
        <label class="form-row"><span>Scheduler</span>
          <select class="input" id="algorithm">
            <option value="fsrs" ${s.algorithm === 'fsrs' ? 'selected' : ''}>FSRS (recommended)</option>
            <option value="sm2" ${s.algorithm === 'sm2' ? 'selected' : ''}>SM-2 (classic Anki)</option>
          </select></label>
        <div id="fsrs-opts">
          <label class="form-row"><span>Target recall <output id="ret-out">${Math.round(s.desiredRetention * 100)}%</output></span><input type="range" id="desiredRetention" min="0.8" max="0.97" step="0.01" value="${s.desiredRetention}"></label>
          <p class="muted small">FSRS predicts when you're about to forget each card and schedules it just before. A higher target means more reviews but fewer forgotten cards; 90% is a good balance.</p>
        </div>
        <div id="sm2-opts">
          <label class="form-row"><span>Graduating interval (days)</span><input class="input" type="number" min="1" id="graduatingInterval" value="${s.graduatingInterval}"></label>
          <label class="form-row"><span>Easy interval (days)</span><input class="input" type="number" min="1" id="easyInterval" value="${s.easyInterval}"></label>
        </div>
        <label class="form-row"><span>New cards per day (per deck)</span><input class="input" type="number" min="0" id="newPerDay" value="${s.newPerDay}"></label>
        <label class="form-row"><span>Maximum reviews per day (per deck)</span><input class="input" type="number" min="0" id="reviewsPerDay" value="${s.reviewsPerDay}"></label>
        <label class="form-row"><span>Learning steps (minutes)</span><input class="input" id="learningSteps" value="${s.learningSteps.join(' ')}"></label>
        <label class="form-row"><span>Relearning steps (minutes)</span><input class="input" id="relearningSteps" value="${s.relearningSteps.join(' ')}"></label>
        <p class="muted small">Decks with an exam date get extra new cards per day when needed so you see everything before the exam.</p>

        <h2 class="section-title">Daily goal & reminders</h2>
        <label class="form-row"><span>Daily goal (reviews, 0 = off)</span><input class="input" type="number" min="0" id="dailyGoal" value="${s.dailyGoal}"></label>
        <label class="form-row"><span>Reminder</span>
          <span class="row"><label class="check"><input type="checkbox" id="reminderEnabled" ${s.reminderEnabled ? 'checked' : ''} ${notifSupported ? '' : 'disabled'}> Notify me at</label><input class="input input-auto" type="time" id="reminderTime" value="${esc(s.reminderTime)}"></span></label>
        <p class="muted small">${notifSupported ? `Browsers only let web apps send notifications while the app is open or installed and running in the background. For a reminder that always arrives, add it to your calendar:` : 'This browser does not support notifications. Add a reminder to your calendar instead:'}
          <button class="link" id="ics">Add daily reminder to calendar (.ics)</button></p>

        <h2 class="section-title">Appearance</h2>
        <label class="form-row"><span>Theme</span>
          <select class="input" id="theme">
            ${['auto', 'light', 'dark'].map((t) => `<option value="${t}" ${s.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}
          </select></label>
        <button class="btn btn-primary" id="save">Save settings</button>
      </div>

      <div class="panel narrow">
        <h2 class="section-title">📲 Install & offline</h2>
        <p class="muted small">Install Recall as an app to study offline and launch it from your home screen.</p>
        <div class="row">
          <button class="btn" id="install" ${window.__installPrompt ? '' : 'hidden'}>Install app</button>
          <span class="muted small" id="install-help" ${window.__installPrompt ? 'hidden' : ''}>${window.matchMedia('(display-mode: standalone)').matches ? '✓ Running as an installed app.' : 'iPhone/iPad: Share → <i>Add to Home Screen</i>. Android/desktop Chrome or Edge: use the install icon in the address bar or the browser menu.'}</span>
        </div>
      </div>

      <div class="panel narrow">
        <h2 class="section-title">Backup</h2>
        <p class="muted small">Everything is stored in this browser. Export a backup (includes images and progress) to keep a copy or move your decks to another device.</p>
        <div class="row">
          <button class="btn" id="export">Export all decks</button>
          <a class="btn" href="#/import">Restore from backup</a>
          <button class="btn btn-danger" id="reset">Delete all data</button>
        </div>
      </div>`);

    const toggleAlgo = () => {
      const fsrs = $('#algorithm').value === 'fsrs';
      $('#fsrs-opts').hidden = !fsrs;
      $('#sm2-opts').hidden = fsrs;
    };
    $('#algorithm').onchange = toggleAlgo;
    toggleAlgo();
    $('#desiredRetention').oninput = (e) => ($('#ret-out').textContent = Math.round(e.target.value * 100) + '%');

    const steps = (v) => {
      const arr = v.split(/[\s,]+/).map(Number).filter((n) => n > 0);
      return arr.length ? arr : null;
    };

    $('#reminderEnabled').onchange = async (e) => {
      if (e.target.checked && Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') {
          e.target.checked = false;
          toast('Notifications are blocked for this site');
        }
      }
    };
    $('#ics').onclick = () => download('recall-reminder.ics', icsReminder($('#reminderTime').value || '18:00'), 'text/calendar');

    $('#save').onclick = () => {
      const ls = steps($('#learningSteps').value);
      const rs = steps($('#relearningSteps').value);
      if (!ls || !rs) return toast('Steps need at least one number of minutes');
      const int = (id, min, dflt) => Math.max(min, parseInt($(id).value, 10) || dflt);
      Object.assign(s, {
        algorithm: $('#algorithm').value,
        desiredRetention: +$('#desiredRetention').value,
        newPerDay: int('#newPerDay', 0, 0),
        reviewsPerDay: int('#reviewsPerDay', 0, 0),
        learningSteps: ls,
        relearningSteps: rs,
        graduatingInterval: int('#graduatingInterval', 1, 1),
        easyInterval: int('#easyInterval', 1, 4),
        dailyGoal: int('#dailyGoal', 0, 0),
        reminderEnabled: $('#reminderEnabled').checked,
        reminderTime: $('#reminderTime').value || '18:00',
        theme: $('#theme').value,
      });
      Store.save();
      App.applyTheme();
      toast('Settings saved');
    };

    const install = $('#install');
    install.onclick = async () => {
      const p = window.__installPrompt;
      if (!p) return;
      p.prompt();
      await p.userChoice.catch(() => null);
      window.__installPrompt = null;
      install.hidden = true;
    };

    $('#export').onclick = async () => download('recall-backup-' + Store.todayKey() + '.json', await Store.exportJson());
    $('#reset').onclick = async () => {
      if (confirm('Delete ALL decks, cards and progress on this device? Export a backup first if you might want them back.') && confirm('Are you absolutely sure?')) {
        Store.replaceAll({});
        await Images.clear().catch(() => {});
        go('#/');
      }
    };
  };
})();
