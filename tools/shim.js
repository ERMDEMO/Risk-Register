/* ===== Local data adapter =====
   The original page runs inside claude.ai and gets its database, user and download
   services from window.claude.use(...). This adapter provides the same interface,
   backed by the browser's localStorage and seeded with the register data, so the page
   runs anywhere. To connect a real backend (SharePoint via Microsoft Graph, Dataverse,
   Firebase, Supabase...), re-implement the five functions marked BACKEND below. */
(function () {
  var KEY = 'emerging_risk_register_' + (window.__SEED_VERSION__ || 'v1');
  var SEED = window.__SEED__ || { risks: {}, signals: {}, sources: {}, log: {}, meta: {} };
  var store = null;
  try { store = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!store) store = JSON.parse(JSON.stringify(SEED));
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }   // BACKEND 1: save
  var subs = [];
  function notify() { subs.forEach(function (fn) { fn(); }); }                                    // BACKEND 2: push changes
  function col(name) { return store[name] || (store[name] = {}); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function snap(name, ord, lim) {                                                                  // BACKEND 3: read a collection
    var m = col(name);
    var docs = Object.keys(m).map(function (k) { return { id: k, data: function () { return clone(m[k]); } }; });
    if (ord) docs.sort(function (a, b) { var x = m[a.id][ord.f] || '', y = m[b.id][ord.f] || ''; return (x < y ? -1 : x > y ? 1 : 0) * (ord.d === 'desc' ? -1 : 1); });
    if (lim) docs = docs.slice(0, lim);
    return { docs: docs };
  }
  function query(name, ord, lim) {
    return {
      orderBy: function (f, d) { return query(name, { f: f, d: d }, lim); },
      limit: function (n) { return query(name, ord, n); },
      onSnapshot: function (cb) { var fn = function () { cb(snap(name, ord, lim)); }; subs.push(fn); setTimeout(fn, 0); return function () { subs = subs.filter(function (x) { return x !== fn; }); }; },
      add: function (d) { var id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); col(name)[id] = clone(d); persist(); notify(); return Promise.resolve({ id: id }); }
    };
  }
  function docRef(path) {                                                                          // BACKEND 4: write a document
    var p = path.split('/'), name = p[0], id = p[1];
    return {
      set: function (d) { col(name)[id] = clone(d); persist(); notify(); return Promise.resolve(); },
      update: function (d) { col(name)[id] = Object.assign({}, col(name)[id] || {}, clone(d)); persist(); notify(); return Promise.resolve(); },
      delete: function () { delete col(name)[id]; persist(); notify(); return Promise.resolve(); },
      onSnapshot: function (cb) { var fn = function () { var v = col(name)[id]; cb({ exists: !!v, data: function () { return clone(v); } }); }; subs.push(fn); setTimeout(fn, 0); }
    };
  }
  var AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='12' fill='#1a5ccf'/><text x='12' y='16' text-anchor='middle' font-size='11' fill='#fff' font-family='sans-serif'>ME</text></svg>");
  var user = {                                                                                     // BACKEND 5: who is signed in
    id: function () { return Promise.resolve('local-user'); },
    me: function () { return Promise.resolve({ name: 'You', avatarUrl: AVATAR }); },
    can: function () { return Promise.resolve(window.__READ_ONLY__ ? false : true); },
    profiles: function (ids) { var o = {}; ids.forEach(function (i) { o[i] = { isMe: i === 'local-user', name: i === 'claude' ? 'System' : i === 'local-user' ? 'You' : 'A team member' }; }); return Promise.resolve(o); }
  };
  var downloads = { save: function (o) { var b = new Blob([o.data], { type: 'text/csv;charset=utf-8' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = o.filename; document.body.appendChild(a); a.click(); a.remove(); return Promise.resolve(); } };
  var db = { collection: function (n) { return query(n); }, doc: docRef };
  window.claude = { use: function (n) { return Promise.resolve({ db: db, user: user, downloads: downloads }[n] || null); } };
  window.resetRegisterData = function () { localStorage.removeItem(KEY); location.reload(); };
})();
