/* Guided demo of the Emerging Risk Register.
   Runs on top of the register page with sample data held in this browser only.
   Steps highlight part of the page and explain it; the "morning scan" step adds
   three signals with a short animation, and the review step lets the visitor
   (or the demo) decide one of them. */
(function () {
  'use strict';
  var NEW_SIGNALS = window.__DEMO_SIGNALS__ || [];
  var css = document.createElement('style');
  css.textContent =
    '.tour-card{position:fixed;z-index:90;right:16px;bottom:16px;width:min(380px,calc(100% - 32px));background:var(--panel,#fff);color:var(--ink,#131f2a);border:1px solid var(--line,#d2dae2);border-radius:10px;box-shadow:0 12px 40px rgba(10,20,30,.28);padding:16px;display:grid;gap:10px;font-family:var(--f-body,sans-serif)}' +
    '.tour-card h3{margin:0;font-family:var(--f-display,sans-serif);font-size:20px;text-transform:uppercase;letter-spacing:.02em}' +
    '.tour-card p{margin:0;font-size:14px;line-height:1.5}.tour-card ul{margin:0;padding-left:18px;font-size:14px;line-height:1.5}' +
    '.tour-step{font-size:12px;color:var(--muted,#55677a);text-transform:uppercase;letter-spacing:.08em}' +
    '.tour-nav{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap}' +
    '.tour-nav .grp{display:flex;gap:8px}' +
    '.tour-btn{border:1px solid var(--line,#d2dae2);background:var(--panel,#fff);color:inherit;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit;font-size:14px}' +
    '.tour-btn.primary{background:var(--accent,#1a5ccf);border-color:var(--accent,#1a5ccf);color:var(--accent-ink,#fff);font-weight:600}' +
    '.tour-btn:disabled{opacity:.5;cursor:not-allowed}' +
    '.tour-skip{background:none;border:0;color:var(--muted,#55677a);cursor:pointer;font:inherit;font-size:13px;text-decoration:underline;padding:0}' +
    '.tour-hl{outline:3px solid var(--accent,#1a5ccf)!important;outline-offset:4px;border-radius:8px;transition:outline-color .2s}' +
    '.tour-bar{height:6px;border-radius:3px;background:var(--panel2,#e8edf2);overflow:hidden}.tour-bar i{display:block;height:100%;width:0;background:var(--accent,#1a5ccf);transition:width .5s}' +
    '.tour-log{font-family:var(--f-mono,monospace);font-size:12px;color:var(--muted,#55677a);display:grid;gap:2px}' +
    '.demo-ribbon{position:fixed;z-index:85;left:16px;bottom:16px;background:var(--ink,#131f2a);color:var(--bg,#fff);font-size:12px;padding:6px 10px;border-radius:6px;font-family:var(--f-body,sans-serif)}' +
    '.demo-ribbon button{background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:0;margin-left:8px}' +
    '@media (max-width:760px){.tour-card{left:16px;right:16px;bottom:12px;width:auto;max-height:52vh;overflow:auto}}';
  document.head.appendChild(css);

  var db = null;
  window.claude.use('db').then(function (d) { db = d; });
  function $(s) { return document.querySelector(s); }
  function go(tab) { if (location.hash !== '#' + tab) location.hash = tab; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function click(sel) { var e = $(sel); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!e; }
  var scanned = false, decided = false;
  var firstNew = function () { return NEW_SIGNALS.length ? NEW_SIGNALS[0].id : ''; };

  function runScan(card) {
    var bar = card.querySelector('.tour-bar i'), log = card.querySelector('.tour-log'), btn = card.querySelector('[data-t=act]');
    btn.disabled = true;
    var lines = ['Reading the register: 5 risks, recent signals, 124 approved sources', 'Searching grade A sources: DoE, EWEC, NCM, UKMTO, CISA…', 'Searching grade B sources and news wires…',
      'Opening and checking 9 candidate pages…', 'Dropping 6 duplicates of signals already captured', 'Saving ' + NEW_SIGNALS.length + ' proposed signals'];
    var p = Promise.resolve();
    lines.forEach(function (l, i) {
      p = p.then(function () { log.insertAdjacentHTML('beforeend', '<span>✓ ' + l + '</span>'); bar.style.width = Math.round((i + 1) / lines.length * 100) + '%'; return wait(650); });
    });
    return p.then(function () {
      var now = new Date().toISOString();
      var w = NEW_SIGNALS.map(function (s) { var d = Object.assign({}, s); delete d.id; d.captured = now.slice(0, 10); d.at = now; return db.doc('signals/' + s.id).set(d); });
      w.push(db.doc('meta/scan').set({ at: now, by: 'claude', count: NEW_SIGNALS.length, note: 'Demo scan.' }));
      w.push(db.collection('log').add({ at: now, by: 'claude', ref: '', text: 'Demo scan: added ' + NEW_SIGNALS.length + ' proposed signals (' + NEW_SIGNALS.map(function (s) { return s.id; }).join(', ') + ').' }));
      return Promise.all(w);
    }).then(function () { scanned = true; btn.textContent = 'Scan finished'; render(); });
  }
  function decideForMe(card) {
    var btn = card.querySelector('[data-t=act]'); btn.disabled = true;
    var id = firstNew();
    go('signals');
    return wait(300).then(function () {
      if (!$('.drawer')) click('tr[data-id="' + id + '"]');
      return wait(400);
    }).then(function () {
      click('button[data-act="seg"][data-f="checked"][data-v="Yes"]'); return wait(350);
    }).then(function () {
      click('button[data-act="seg"][data-f="decision"][data-v="Add to existing risk"]'); return wait(450);
    }).then(function () {
      var sel = $('select[data-f="risk_id"]');
      var want = NEW_SIGNALS[0] && NEW_SIGNALS[0].risk_id;
      if (sel && want) { sel.value = want; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.dispatchEvent(new Event('input', { bubbles: true })); }
      return wait(450);
    }).then(function () { click('button[data-act="save-sig"]'); return wait(600); })
      .then(function () { decided = true; btn.textContent = 'Done'; render(); });
  }

  var STEPS = [
    { tab: 'radar', title: 'Horizon Scanner', html: '<p>This demo shows how the scanner finds early warnings for Abu Dhabi\'s power and water networks, and how the risk team turns them into a scored register.</p><ul><li>It uses a copy of the register. Your clicks stay in this browser and reset when you reload.</li><li>Takes about 3 minutes. Use Next, or explore freely at any time.</li></ul>' },
    { tab: 'radar', sel: '.scan', title: 'When it last scanned', html: '<p>Every morning at 08:35 an AI scan searches about 125 approved sources, opens and checks each page, and adds up to 8 <b>proposed</b> signals. This strip shows when it last ran and how many signals wait for a decision.</p>' },
    { tab: 'radar', sel: '.kpis', title: 'The headline numbers', html: '<p>Open risks, how many are rated High, signals waiting for a decision, items on watch, overdue reviews and risks without an owner.</p>' },
    { tab: 'radar', sel: '#radar-box', title: 'The risk radar', html: '<p>Each <b>wedge</b> is an impact area (cyber, supply chain, finance…). Each <b>ring</b> is when it could hit: short, medium or long term. Each <b>dot</b> is a risk, coloured by rating (likelihood × impact) and sized by impact. Click a dot to open the risk.</p>' },
    { tab: 'radar', sel: '.ent', title: 'Entity risk score', html: '<p>One number from 0 to 100 for the whole organisation, built from four weighted dimensions. It moves as risks are scored, and says what governance action fits the level.</p>' },
    { tab: 'radar', sel: '.scan', title: 'Run the morning scan', act: 'Run the demo scan', run: runScan, html: '<p>Press the button to see what a scan does. In the real system this runs by itself every morning.</p><div class="tour-bar"><i></i></div><div class="tour-log"></div>', need: function () { return scanned; } },
    { tab: 'signals', sel: '.tbl tbody tr:first-child', title: 'New signals to review', html: '<p>The new signals are at the top, marked <b>Proposed by the system</b>. Each one has a summary, the source link and what a person should check. Nothing counts until the team confirms it.</p>' },
    { tab: 'signals', sel: '.tbl tbody tr:first-child', title: 'Decide a signal', act: 'Do it for me', run: decideForMe, html: '<p>Open a signal, check the source, set <b>Checked = Yes</b>, then choose a decision: <b>New risk</b>, <b>Add to existing risk</b>, <b>Watch</b> or <b>Reject</b>. A signal can only join the register once it is checked.</p><p>Try it yourself on the first row, or let the demo do it.</p>', need: function () { return decided; } },
    { tab: 'register', sel: '.tbl', title: 'The register', html: '<p>Confirmed signals become evidence on a risk (see the Signals column). Risk owners set likelihood and impact, an owner and an action; the score updates the radar straight away.</p>' },
    { tab: 'movement', sel: '#heat-box', title: 'What moved', html: '<p>Daily snapshots show how risks changed over a month or three: arrows on the heat map, risks getting worse or easing, and which risks draw the most new evidence.</p>' },
    { tab: 'radar', title: 'That is the scanner', html: '<ul><li><b>Daily:</b> the AI scan proposes signals at 08:35.</li><li><b>Team:</b> reviews and decides in the app, with a shared team code.</li><li><b>Register:</b> scores, radar, movement and entity score update live.</li></ul><p>Explore freely now, or start the demo again.</p>' }
  ];
  var i = 0, card = null, hl = null;
  function render() {
    var s = STEPS[i];
    go(s.tab);
    if (!card) { card = document.createElement('div'); card.className = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite'); document.body.appendChild(card); }
    var blocked = s.need && !s.need();
    card.innerHTML = '<div class="tour-step">Step ' + (i + 1) + ' of ' + STEPS.length + '</div><h3>' + s.title + '</h3>' + s.html +
      (s.act ? '<div><button type="button" class="tour-btn primary" data-t="act"' + (blocked ? '' : ' disabled') + '>' + (blocked ? s.act : 'Done') + '</button></div>' : '') +
      '<div class="tour-nav"><button type="button" class="tour-skip" data-t="close">' + (i === STEPS.length - 1 ? 'Close' : 'Explore on my own') + '</button><div class="grp">' +
      (i > 0 ? '<button type="button" class="tour-btn" data-t="back">Back</button>' : '') +
      (i < STEPS.length - 1 ? '<button type="button" class="tour-btn primary" data-t="next"' + (blocked ? ' disabled title="Use the button above first"' : '') + '>Next</button>' : '<button type="button" class="tour-btn primary" data-t="restart">Start again</button>') +
      '</div></div>';
    card.querySelector('[data-t=close]').onclick = close;
    var b = card.querySelector('[data-t=back]'); if (b) b.onclick = function () { i--; render(); };
    var n = card.querySelector('[data-t=next]'); if (n) n.onclick = function () { i++; render(); };
    var r = card.querySelector('[data-t=restart]'); if (r) r.onclick = function () { resetData(); };
    var a = card.querySelector('[data-t=act]'); if (a && blocked) a.onclick = function () { s.run(card); };
    setTimeout(function () { highlight(s.sel); }, 250);
  }
  function highlight(sel) {
    if (hl) hl.classList.remove('tour-hl');
    hl = sel ? $(sel) : null;
    if (hl) { hl.classList.add('tour-hl'); hl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function close() {
    if (hl) hl.classList.remove('tour-hl');
    if (card) { card.remove(); card = null; }
    ribbon();
  }
  function ribbon() {
    if ($('.demo-ribbon')) return;
    var r = document.createElement('div'); r.className = 'demo-ribbon';
    r.innerHTML = 'Demo with sample data<button type="button">Resume the tour</button><button type="button">Reset</button>';
    var bs = r.querySelectorAll('button');
    bs[0].onclick = function () { r.remove(); render(); };
    bs[1].onclick = resetData;
    document.body.appendChild(r);
  }
  function resetData() { if (window.resetRegisterData) window.resetRegisterData(); else location.reload(); }
  window.addEventListener('hashchange', function () { if (card) setTimeout(function () { highlight(STEPS[i].sel); }, 300); });
  function start() { setTimeout(render, 900); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
