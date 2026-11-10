/* Emerging Risk Register: Supabase data adapter, sign-in and "Run scan" button.
   The register page talks to its data through window.claude.use('db' | 'user' | 'downloads').
   This file provides that interface on top of Supabase, so the page itself is unchanged.
   Needs: window.REGISTER_CONFIG = { url, anonKey } (config.js) and supabase-js (loaded before this file). */
(function () {
  'use strict';
  var cfg = window.REGISTER_CONFIG || {};
  var MISSING = !cfg.url || !cfg.anonKey || /YOUR-/.test(cfg.url + cfg.anonKey);
  var sb = MISSING ? null : window.supabase.createClient(cfg.url, cfg.anonKey);
  var TABLE = 'docs';
  var me = { email: '', name: '', team: false };

  /* ---------- small UI helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var css = document.createElement('style');
  css.textContent =
    '.auth-wrap{position:fixed;inset:0;z-index:80;display:grid;place-items:center;background:var(--bg,#f1f4f7);padding:16px}' +
    '.auth-card{width:min(400px,100%);background:var(--panel,#fff);border:1px solid var(--line,#d2dae2);border-radius:10px;padding:22px;display:grid;gap:12px}' +
    '.auth-card h1{font-family:var(--f-display,sans-serif);font-size:26px;text-transform:uppercase;margin:0}' +
    '.auth-card p{margin:0;color:var(--muted,#55677a)}' +
    '.auth-card label{display:grid;gap:4px;font-size:13px;color:var(--muted,#55677a)}' +
    '.auth-card input{border:1px solid var(--line,#d2dae2);border-radius:6px;padding:8px 10px;font:inherit;background:var(--bg,#f1f4f7);color:var(--ink,#131f2a)}' +
    '.auth-card button{border:0;border-radius:6px;padding:9px 12px;font:inherit;font-weight:600;cursor:pointer;background:var(--accent,#1a5ccf);color:var(--accent-ink,#fff)}' +
    '.auth-card .err{color:var(--high,#b92521);min-height:1.2em;font-size:13px}' +
    '.scanbtn{white-space:nowrap}.scanstat{font-size:12px;color:var(--muted,#55677a);max-width:22rem}' +
    '.linkbtn{background:none;border:0;color:var(--muted,#55677a);cursor:pointer;font:inherit;font-size:13px;text-decoration:underline;padding:0}';
  document.head.appendChild(css);

  function screen(html) {
    var d = document.getElementById('auth-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'auth-root' }));
    d.innerHTML = html ? '<div class="auth-wrap"><div class="auth-card">' + html + '</div></div>' : '';
    return d;
  }

  /* Team access: one shared team account. People enter the team code (its password)
     and their own name, which is shown on their decisions. */
  var NAME_KEY = 'risk_register_name';
  function getName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
  function setName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) {} }

  function signIn(needCode) {
    return new Promise(function (resolve) {
      var root = screen('<h1>Horizon Scanner</h1><p>' + (needCode ? 'Enter the team code you were given, and your name.' : 'Enter your name. It is shown on the decisions you make.') + '</p>' +
        '<form id="auth-form" style="display:grid;gap:12px">' +
        (needCode ? '<label>Team code<input id="auth-pass" type="password" autocomplete="current-password" required minlength="6"></label>' : '') +
        '<label>Your name<input id="auth-name" type="text" autocomplete="name" required maxlength="60" value="' + esc(getName()) + '"></label>' +
        '<div class="err" id="auth-err" role="alert"></div><button type="submit" id="auth-go">Open the register</button></form>');
      root.querySelector('#auth-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = root.querySelector('#auth-go'), err = root.querySelector('#auth-err');
        var name = root.querySelector('#auth-name').value.trim().replace(/\s+/g, ' ');
        if (!name) { err.textContent = 'Enter your name.'; return; }
        if (!needCode) { setName(name); screen(''); resolve(null); return; }
        btn.disabled = true; btn.textContent = 'Opening…'; err.textContent = '';
        sb.auth.signInWithPassword({ email: cfg.teamEmail, password: root.querySelector('#auth-pass').value })
          .then(function (r) {
            if (r.error) { err.textContent = 'That team code is not right. Check it and try again.'; btn.disabled = false; btn.textContent = 'Open the register'; return; }
            setName(name); screen(''); resolve(r.data.session);
          });
      });
    });
  }

  var ready = MISSING || !cfg.teamEmail
    ? Promise.resolve(null).then(function () { screen('<h1>Not set up yet</h1><p>This app is not connected to its database. Add the Supabase URL, key and team account to app/config.js.</p>'); return null; })
    : sb.auth.getSession().then(function (r) {
        var s = r.data && r.data.session;
        if (!s) return signIn(true);
        if (!getName()) return signIn(false).then(function () { return s; });
        return s;
      }).then(function (session) {
        var email = (session.user && session.user.email || '').toLowerCase();
        return sb.from('team').select('email,name').then(function (r) {
          var ok = (r.data || []).some(function (t) { return t.email.toLowerCase() === email; });
          me.team = ok; me.email = getName(); me.name = getName();
          if (!ok) {
            screen('<h1>No access</h1><p>The team account is not on the team list. Ask the register owner to check the setup.</p><button type="button" id="auth-out">Start again</button>');
            document.getElementById('auth-out').onclick = function () { sb.auth.signOut().then(function () { location.reload(); }); };
            return new Promise(function () {}); // stop here
          }
          return session;
        });
      });

  /* ---------- data cache with live updates ---------- */
  var cache = {};      // collection -> { id: data }
  var loaded = {};     // collection -> Promise
  var listeners = [];  // { col, id?, fn }
  var channel = null;

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function load(col) {
    if (loaded[col]) return loaded[col];
    loaded[col] = ready.then(function () {
      var out = {}, page = 0, size = 1000;
      function next() {
        return sb.from(TABLE).select('id,data').eq('collection', col).range(page * size, page * size + size - 1).then(function (r) {
          if (r.error) throw mapErr(r.error);
          r.data.forEach(function (row) { out[row.id] = row.data; });
          if (r.data.length === size) { page++; return next(); }
          cache[col] = out; return out;
        });
      }
      return next();
    });
    return loaded[col];
  }
  function live() {
    if (channel) return;
    channel = sb.channel('docs-changes').on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, function (p) {
      var row = p.new && p.new.collection ? p.new : p.old;
      if (!row || !row.collection || !cache[row.collection]) return;
      if (p.eventType === 'DELETE') delete cache[row.collection][row.id];
      else cache[row.collection][row.id] = p.new.data;
      emit(row.collection);
    }).subscribe();
  }
  function emit(col) { listeners.forEach(function (l) { if (l.col === col) l.fn(); }); }
  function mapErr(e) {
    var x = new Error(e && e.message || 'error');
    x.code = e && (e.code === '42501' || /row-level security|permission/i.test(e.message || '')) ? 'invalid_argument' : 'unavailable';
    return x;
  }
  function snap(col, ord, lim) {
    var m = cache[col] || {};
    var docs = Object.keys(m).map(function (k) { return { id: k, data: function () { return clone(m[k]); } }; });
    if (ord) docs.sort(function (a, b) { var x = m[a.id][ord.f] || '', y = m[b.id][ord.f] || ''; return (x < y ? -1 : x > y ? 1 : 0) * (ord.d === 'desc' ? -1 : 1); });
    if (lim) docs = docs.slice(0, lim);
    return { docs: docs };
  }
  function query(col, ord, lim) {
    return {
      orderBy: function (f, d) { return query(col, { f: f, d: d }, lim); },
      limit: function (n) { return query(col, ord, n); },
      onSnapshot: function (cb, onErr) {
        var l = { col: col, fn: function () { cb(snap(col, ord, lim)); } };
        listeners.push(l);
        load(col).then(function () { live(); l.fn(); }).catch(function (e) { if (onErr) onErr(e); });
        return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
      },
      add: function (d) {
        var id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        return write(col, id, d);
      }
    };
  }
  function write(col, id, data) {
    var row = { collection: col, id: id, data: data };
    // Log entries and scan requests are only ever added, never changed.
    var req = (col === 'log' || col === 'scan_requests') ? sb.from(TABLE).insert(row) : sb.from(TABLE).upsert(row);
    return req.then(function (r) {
      if (r.error) throw mapErr(r.error);
      if (cache[col]) { cache[col][id] = clone(data); emit(col); }
      return { id: id };
    });
  }
  function docRef(path) {
    var p = path.split('/'), col = p[0], id = p[1];
    return {
      set: function (d) { return write(col, id, clone(d)); },
      update: function (d) {
        return load(col).then(function () {
          return write(col, id, Object.assign({}, cache[col][id] || {}, clone(d)));
        });
      },
      delete: function () {
        return sb.from(TABLE).delete().eq('collection', col).eq('id', id).then(function (r) {
          if (r.error) throw mapErr(r.error);
          if (cache[col]) { delete cache[col][id]; emit(col); }
        });
      },
      onSnapshot: function (cb, onErr) {
        var l = { col: col, fn: function () { var v = (cache[col] || {})[id]; cb({ exists: !!v, data: function () { return clone(v); } }); } };
        listeners.push(l);
        load(col).then(function () { live(); l.fn(); }).catch(function (e) { if (onErr) onErr(e); });
      }
    };
  }

  /* ---------- user and downloads ---------- */
  function avatar(name) {
    var ini = (name || '?').replace(/@.*/, '').split(/[.\s_-]+/).filter(Boolean).slice(0, 2).map(function (s) { return s[0].toUpperCase(); }).join('') || '?';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='12' fill='#1a5ccf'/><text x='12' y='16' text-anchor='middle' font-size='10' fill='#fff' font-family='sans-serif'>" + ini + "</text></svg>");
  }
  var user = {
    id: function () { return ready.then(function () { return me.email; }); },
    me: function () { return ready.then(function () { return { name: me.name, avatarUrl: avatar(me.name) }; }); },
    can: function () { return ready.then(function () { return me.team; }); },
    profiles: function (ids) {
      var o = {};
      ids.forEach(function (i) { o[i] = { isMe: i === me.name, name: i === 'claude' ? 'System' : (i === 'analyst' ? 'An analyst' : String(i)) }; });
      return Promise.resolve(o);
    }
  };
  var downloads = {
    save: function (o) { var b = new Blob([o.data], { type: 'text/csv;charset=utf-8' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = o.filename; document.body.appendChild(a); a.click(); a.remove(); return Promise.resolve(); }
  };
  var db = { collection: function (n) { return query(n); }, doc: docRef };
  window.claude = { use: function (n) { return ready.then(function (s) { return s ? ({ db: db, user: user, downloads: downloads }[n] || null) : null; }); } };

  /* ---------- Run scan button and sign out ---------- */
  function fmtAgo(iso) {
    var m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }
  function scanControls() {
    var tools = document.querySelector('.tools'); if (!tools) return;
    if (cfg.scanVia === 'claude') {
      var info = document.createElement('span');
      info.className = 'chips';
      info.innerHTML = '<span class="scanstat">Daily scan at 08:35. For an extra scan, ask the register owner.</span><button type="button" class="linkbtn" id="sign-out">Not you?</button>';
      tools.insertBefore(info, tools.firstChild);
      info.querySelector('#sign-out').onclick = function () { setName(''); location.reload(); };
      return;
    }
    var box = document.createElement('span');
    box.className = 'chips';
    box.innerHTML = '<span class="scanstat" id="scan-stat" role="status"></span><button type="button" class="btn primary sm scanbtn" id="scan-run">Run scan now</button><button type="button" class="linkbtn" id="sign-out">Not you?</button>';
    tools.insertBefore(box, tools.firstChild);
    var btn = box.querySelector('#scan-run'), stat = box.querySelector('#scan-stat');
    box.querySelector('#sign-out').onclick = function () { setName(''); location.reload(); };
    function latest() {
      var m = cache.scan_requests || {}, best = null;
      Object.keys(m).forEach(function (k) { if (!best || (m[k].at || '') > (best.at || '')) best = m[k]; });
      return best;
    }
    function show() {
      var r = latest(), busy = false, t = '';
      if (r) {
        var age = (Date.now() - new Date(r.at).getTime()) / 60000;
        if (r.status === 'requested' && age < 45) { busy = true; t = 'Scan requested ' + fmtAgo(r.at) + '. It starts within about 10 minutes.'; }
        else if (r.status === 'running' && age < 60) { busy = true; t = 'Scanning… started ' + fmtAgo(r.started_at || r.at) + '.'; }
        else if (r.status === 'done') t = 'Last scan ' + fmtAgo(r.finished_at || r.at) + ': ' + (r.count || 0) + ' new signal' + (r.count === 1 ? '' : 's') + '.';
        else if (r.status === 'failed') t = 'Last scan failed: ' + (r.error || 'see GitHub Actions') + '.';
        else if (r.status === 'requested' || r.status === 'running') t = 'The last scan request did not finish. You can run it again.';
      }
      btn.disabled = busy; btn.textContent = busy ? 'Scan in progress' : 'Run scan now';
      stat.textContent = t;
    }
    btn.onclick = function () {
      btn.disabled = true;
      var at = new Date().toISOString();
      write('scan_requests', 'r' + at.replace(/[^0-9]/g, '').slice(0, 14), { at: at, by: me.email, status: 'requested' })
        .then(show).catch(function () { stat.textContent = 'Could not request a scan. Try again.'; btn.disabled = false; });
    };
    listeners.push({ col: 'scan_requests', fn: show });
    load('scan_requests').then(function () { live(); show(); });
    setInterval(show, 60000);
  }
  ready.then(function (s) { if (s) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanControls); else scanControls(); } });
})();
