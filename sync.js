/* Sync layer: one small API over Firebase Realtime Database (live game) or a
   local adapter (test mode: localStorage + BroadcastChannel, same browser only).
   API: set(path, value) · update(path, patch) · remove(path) · get(path)
        watch(path, cb) -> unsubscribe · onConnected(cb) · ts() server timestamp · kind */
(function () {
  'use strict';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function createFirebase(cfg) {
    var v = '10.14.1';
    await loadScript('https://www.gstatic.com/firebasejs/' + v + '/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/' + v + '/firebase-database-compat.js');
    var app = firebase.initializeApp(cfg);
    var db = firebase.database(app);
    return {
      kind: 'firebase',
      ts: function () { return firebase.database.ServerValue.TIMESTAMP; },
      set: function (p, val) { return db.ref(p).set(val); },
      update: function (p, patch) { return db.ref(p).update(patch); },
      remove: function (p) { return db.ref(p).remove(); },
      get: function (p) { return db.ref(p).once('value').then(function (s) { return s.val(); }); },
      watch: function (p, cb) {
        var r = db.ref(p);
        var h = r.on('value', function (s) { cb(s.val()); }, function (e) { console.error('watch error', p, e); });
        return function () { r.off('value', h); };
      },
      onConnected: function (cb) {
        db.ref('.info/connected').on('value', function (s) { cb(s.val() === true); });
      }
    };
  }

  function createLocal() {
    var KEY = 'fredy80-localdb';
    var bc = ('BroadcastChannel' in window) ? new BroadcastChannel('fredy80-sync') : null;
    var watchers = [];
    function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
    function write(tree) { try { localStorage.setItem(KEY, JSON.stringify(tree)); } catch (e) {} notify(); if (bc) bc.postMessage('changed'); }
    function segs(p) { return String(p || '').split('/').filter(Boolean); }
    function getAt(tree, p) {
      var s = segs(p), o = tree;
      for (var i = 0; i < s.length; i++) { if (o === null || typeof o !== 'object') return undefined; o = o[s[i]]; }
      return o;
    }
    function setAt(tree, p, v) {
      var s = segs(p);
      if (!s.length) return (v === null || v === undefined) ? {} : v;
      var o = tree;
      for (var i = 0; i < s.length - 1; i++) {
        if (o[s[i]] === null || typeof o[s[i]] !== 'object') o[s[i]] = {};
        o = o[s[i]];
      }
      if (v === null || v === undefined) delete o[s[s.length - 1]]; else o[s[s.length - 1]] = v;
      return prune(tree);
    }
    function prune(o) { // drop empty objects like Firebase does
      if (o === null || typeof o !== 'object') return o;
      Object.keys(o).forEach(function (k) { var v = prune(o[k]); if (v === null || v === undefined || (typeof v === 'object' && !Object.keys(v).length)) delete o[k]; else o[k] = v; });
      return o;
    }
    function resolve(v) { // server timestamp sentinel -> now
      if (v && typeof v === 'object') {
        if (v['.sv'] === 'timestamp') return Date.now();
        Object.keys(v).forEach(function (k) { v[k] = resolve(v[k]); });
      }
      return v;
    }
    function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
    function notify() {
      var tree = read();
      watchers.slice().forEach(function (w) {
        var val = getAt(tree, w.path); if (val === undefined) val = null;
        var j = JSON.stringify(val);
        if (j !== w.last) { w.last = j; w.cb(val); }
      });
    }
    if (bc) bc.onmessage = notify;
    window.addEventListener('storage', function (e) { if (!e.key || e.key === KEY) notify(); });
    var delay = function () { return new Promise(function (r) { setTimeout(r, 30); }); }; // a little latency, like a network
    return {
      kind: 'local',
      ts: function () { return { '.sv': 'timestamp' }; },
      set: async function (p, val) { await delay(); write(setAt(read(), p, resolve(clone(val)))); },
      update: async function (p, patch) { await delay(); var t = read(); Object.keys(patch).forEach(function (k) { t = setAt(t, (p ? p + '/' : '') + k, resolve(clone(patch[k]))); }); write(t); },
      remove: async function (p) { await delay(); write(setAt(read(), p, null)); },
      get: async function (p) { var v = getAt(read(), p); return v === undefined ? null : v; },
      watch: function (p, cb) {
        var w = { path: p, cb: cb, last: undefined };
        watchers.push(w);
        setTimeout(function () { var v = getAt(read(), p); if (v === undefined) v = null; w.last = JSON.stringify(v); cb(v); }, 0);
        return function () { var i = watchers.indexOf(w); if (i >= 0) watchers.splice(i, 1); };
      },
      onConnected: function (cb) { setTimeout(function () { cb(true); }, 0); }
    };
  }

  window.createSync = function (cfg) {
    if (cfg && cfg.firebase && (cfg.firebase.databaseURL || cfg.firebase.projectId)) return createFirebase(cfg.firebase);
    return Promise.resolve(createLocal());
  };
})();
