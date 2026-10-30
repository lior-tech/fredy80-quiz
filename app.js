/* Fredy 80 quiz. One page, three roles:
   - player (default): join with a name, answer the question the host has opened, see the reveal and the ranking
   - host (#host): opens questions, reveals answers, gives bonus points, shows the ranking
   - screen (#screen): read-only big view for a TV
   Shared state lives in the sync layer (sync.js) under games/<gameId>:
   state {phase, q, startedAt, correct} · players/{pid} {name, joinedAt} · answers/qNN/{pid} {c, t} · results/qNN {c, s} · bonus/{pid} n */
(async function () {
  'use strict';
  var CFG = window.QUIZ_CONFIG || {};
  var QS = window.QUIZ_QUESTIONS || [];
  var N = QS.length;
  // apply the encoded answer key (see questions.js) to questions that have no explicit correct index
  (function () {
    try {
      var k = window.QUIZ_KEY ? atob(window.QUIZ_KEY).split('').reverse().join('') : '';
      for (var i = 0; i < QS.length && i < k.length; i++) { var n = parseInt(k.charAt(i), 10); if (n >= 1 && n <= 4 && (QS[i].correct === null || QS[i].correct === undefined)) QS[i].correct = n - 1; }
    } catch (e) {}
  })();
  var ROOT = 'games/' + (CFG.gameId || 'fredy80');
  var LETTERS = ['א', 'ב', 'ג', 'ד'];
  var TITLE = CFG.title || 'חידון פרדי 80';
  var app = document.getElementById('app');
  var hash = (location.hash || '').toLowerCase();
  var mode = hash.indexOf('host') >= 0 ? 'host' : hash.indexOf('screen') >= 0 ? 'screen' : hash.indexOf('board') >= 0 ? 'board' : 'player';
  document.documentElement.dataset.mode = mode;
  window.addEventListener('hashchange', function () { location.reload(); });

  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var SS = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  };
  function qk(q) { return 'q' + String(q).padStart(2, '0'); }
  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    for (var i = 2; i < arguments.length; i++) {
      var k = arguments[i];
      if (k === null || k === undefined || k === false) continue;
      e.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
    return e;
  }
  function btn(label, cls, onClick) { var b = el('button', cls, label); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; }
  function img(src, cls) { var i = el('img', cls); i.src = src; i.alt = ''; i.decoding = 'async'; return i; }

  // identity of this phone
  // ?as=x gives a tab its own identity, for testing several players in one browser
  var idSuffix = (new URLSearchParams(location.search).get('as') || '').replace(/[^a-z0-9]/gi, '').slice(0, 12);
  var PID_KEY = 'fredy80-pid' + (idSuffix ? '-' + idSuffix : ''), NAME_KEY = 'fredy80-name' + (idSuffix ? '-' + idSuffix : '');
  var me = { pid: LS.get(PID_KEY), name: LS.get(NAME_KEY) || '' };
  if (!me.pid) { me.pid = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); LS.set(PID_KEY, me.pid); }

  app.replaceChildren(el('div', 'splash', el('div', 'spinner'), el('p', null, 'טוען את המשחק...')));
  var sync;
  try { sync = await window.createSync(CFG); }
  catch (e) {
    console.error(e);
    app.replaceChildren(el('div', 'splash error', el('p', null, 'לא הצלחנו להתחבר לשרת המשחק.'), el('p', 'note', 'בדקו את החיבור לאינטרנט ורעננו את הדף.')));
    return;
  }
  var LOCAL = sync.kind === 'local';

  var G = {}, loaded = false, connected = false;
  var current = { key: null, view: null };
  var hostAuthed = !CFG.hostPin || SS.get('fredy80-host') === '1';
  var ui = { hostPick: null };

  function state() { return G.state || { phase: 'lobby', q: 0 }; }
  function players() { return G.players || {}; }
  function answersFor(q) { return (G.answers || {})[qk(q)] || {}; }
  function result(q) { return (G.results || {})[qk(q)] || null; }
  function inQ(s) { return s.phase === 'question' || s.phase === 'reveal'; }
  function playerCount() { return Object.keys(players()).length; }
  function answeredCount(q) { var P = players(); return Object.keys(answersFor(q)).filter(function (pid) { return !!P[pid]; }).length; }
  function preload(q) { if (q >= 0 && q < N) { var i = new Image(); i.src = QS[q].img; } }
  function joinLink() { return location.origin + location.pathname; }
  function qIndex(s) { var q = Number(s.q) || 0; return Math.min(Math.max(q, 0), N - 1); }

  // ranking: one point per correct answer plus bonus points; ties share a rank, faster total time orders the list
  function computeRows() {
    var P = players(), R = G.results || {}, ANS = G.answers || {}, B = G.bonus || {};
    var rows = Object.keys(P).map(function (pid) {
      var correct = 0, time = 0;
      Object.keys(R).forEach(function (k) {
        var r = R[k]; var a = ANS[k] && ANS[k][pid];
        if (a && a.c === r.c) { correct++; if (typeof a.t === 'number' && typeof r.s === 'number') time += Math.max(0, a.t - r.s); }
      });
      var bonus = Number(B[pid]) || 0;
      return { pid: pid, name: String(P[pid].name || ''), correct: correct, bonus: bonus, score: correct + bonus, time: time };
    });
    rows.sort(function (a, b) { return b.score - a.score || a.time - b.time || a.name.localeCompare(b.name, 'he'); });
    var rank = 0, prev = null;
    rows.forEach(function (r, i) { if (!prev || r.score !== prev.score) rank = i + 1; r.rank = rank; prev = r; });
    return rows;
  }

  // ---------- actions ----------
  var A = {
    join: function (name) {
      name = String(name || '').trim().slice(0, 24);
      if (!name) return Promise.resolve();
      me.name = name; LS.set(NAME_KEY, name);
      return sync.set(ROOT + '/players/' + me.pid, { name: name, joinedAt: sync.ts() });
    },
    leave: function () { return sync.remove(ROOT + '/players/' + me.pid); },
    answer: function (i) {
      var s = state(); if (s.phase !== 'question') return Promise.resolve();
      return sync.set(ROOT + '/answers/' + qk(qIndex(s)) + '/' + me.pid, { c: i, t: sync.ts() });
    },
    open: function (q) {
      if (q < 0 || q >= N) return Promise.resolve();
      var r = result(q);
      if (r) return sync.update(ROOT, { state: { phase: 'reveal', q: q, startedAt: (typeof r.s === 'number' ? r.s : null), correct: r.c } });
      return sync.update(ROOT, { state: { phase: 'question', q: q, startedAt: sync.ts(), correct: null } });
    },
    reveal: function (i) {
      var s = state(); if (i === null || i === undefined) return Promise.resolve();
      var q = qIndex(s); var patch = {};
      patch['state/phase'] = 'reveal'; patch['state/correct'] = i;
      patch['results/' + qk(q)] = { c: i, s: (typeof s.startedAt === 'number' ? s.startedAt : null) };
      return sync.update(ROOT, patch);
    },
    next: function () { var s = state(); var q = qIndex(s); if (q + 1 >= N) return A.final(); return A.open(q + 1); },
    prev: function () { var q = qIndex(state()); if (q > 0) return A.open(q - 1); return Promise.resolve(); },
    board: function () { var s = state(); var patch = { 'state/phase': 'board' }; if (inQ(s) && result(qIndex(s))) patch['state/boardDone'] = qIndex(s); return sync.update(ROOT, patch); },
    back: function () { return A.open(qIndex(state())); },
    final: function () { return sync.update(ROOT, { 'state/phase': 'final' }); },
    lobby: function () { return sync.update(ROOT, { 'state/phase': 'lobby' }); },
    start: function () { var s = state(); return (G.results && Object.keys(G.results).length) ? A.open(qIndex(s)) : A.open(0); },
    bonus: function (pid, d) { var cur = Number((G.bonus || {})[pid]) || 0; var v = Math.max(0, cur + d); return sync.set(ROOT + '/bonus/' + pid, v || null); },
    removePlayer: function (pid) { return sync.remove(ROOT + '/players/' + pid); },
    resetScores: function () { return sync.update(ROOT, { answers: null, results: null, bonus: null, state: { phase: 'lobby', q: 0 } }); },
    resetAll: function () { return sync.set(ROOT, { state: { phase: 'lobby', q: 0 } }); }
  };

  // ---------- shared pieces ----------
  function connDot() { var d = el('span', 'dot'); return { el: d, update: function () { d.classList.toggle('on', connected); d.title = connected ? 'מחובר' : 'מנותק'; } }; }

  function topbar() {
    var dot = connDot(); var qn = el('div', 'qnum'); var score = el('span', 'score'); var name = el('span', 'pname');
    var e = el('header', 'top', el('div', 'brand', dot.el, TITLE), qn, el('div', 'me', name, score));
    function update() {
      var s = state(); dot.update();
      qn.textContent = inQ(s) ? ('שאלה ' + (qIndex(s) + 1) + ' מתוך ' + N) : '';
      name.textContent = me.name;
      var row = computeRows().filter(function (r) { return r.pid === me.pid; })[0];
      score.textContent = row ? row.score : 0;
    }
    return { el: e, update: update };
  }

  function winnerLine(rows) {
    var top = rows.filter(function (r) { return r.rank === 1; });
    if (!top.length) return el('div', 'winner');
    var names = top.map(function (r) { return r.name || 'ללא שם'; });
    var label = names.length > 1 ? names.slice(0, -1).join(', ') + ' ו' + names[names.length - 1] : names[0];
    return el('div', 'winner', el('p', 'eyebrow', names.length > 1 ? 'במקום הראשון, בשוויון' : 'במקום הראשון'), el('div', 'winner-name', label), el('div', 'winner-pts', top[0].score + ' נקודות'));
  }

  function leaderboard(rows, opts) {
    opts = opts || {};
    var ol = el('ol', 'board' + (opts.cols ? ' cols' : ''));
    rows.slice(0, opts.limit || rows.length).forEach(function (r) {
      ol.append(el('li', 'row' + (r.pid === opts.me ? ' me' : '') + (r.rank <= 3 ? ' top' : ''),
        el('span', 'rank', r.rank), el('span', 'name', r.name || 'ללא שם'), el('span', 'pts', r.score)));
    });
    if (!rows.length) ol.append(el('li', 'empty', 'עדיין אין משתתפים'));
    return ol;
  }

  function renderPodium(box, rows) {
    var top3 = rows.filter(function (r) { return r.rank <= 3; }).slice(0, 3);
    box.replaceChildren.apply(box, top3.map(function (r) {
      return el('div', 'pod rank' + r.rank, el('div', 'medal', r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'),
        el('div', 'pname', r.name || 'ללא שם'), el('div', 'pts', r.score + ' נקודות'));
    }));
  }

  // option rows with counts and bars (host and TV). opts: names, onPick
  function optionList(q, opts) {
    opts = opts || {};
    var Q = QS[q];
    var rows = Q.options.map(function (t, i) {
      var r = el('div', 'opt dist', el('span', 'letter', LETTERS[i]), el('span', 'txt', t), el('span', 'tag'), el('span', 'count'), el('span', 'bar'), opts.names ? el('span', 'who') : null);
      if (opts.onPick) { r.classList.add('pickable'); r.setAttribute('role', 'button'); r.tabIndex = 0; r.addEventListener('click', function () { opts.onPick(i); }); r.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onPick(i); } }); }
      return r;
    });
    var box = el('div', 'options', ...rows);
    function update(o) {
      o = o || {};
      var s = state(); var P = players(); var ans = answersFor(q);
      var revealed = s.phase === 'reveal' && qIndex(s) === q; var correct = revealed ? s.correct : null;
      var counts = [0, 0, 0, 0], names = [[], [], [], []];
      Object.keys(ans).forEach(function (pid) { if (!P[pid]) return; var c = ans[pid].c; if (c >= 0 && c < 4) { counts[c]++; names[c].push(P[pid].name || ''); } });
      var total = counts.reduce(function (a, b) { return a + b; }, 0) || 1;
      var showCounts = revealed || !!o.liveCounts;
      rows.forEach(function (r, i) {
        r.classList.toggle('correct', revealed && correct === i);
        r.classList.toggle('key', !revealed && o.key === i);
        r.classList.toggle('picked', !revealed && o.pick === i);
        r.querySelector('.tag').textContent = revealed && correct === i ? 'התשובה הנכונה' : (!revealed && o.key === i ? '✓ נכונה' : '');
        r.querySelector('.bar').style.width = showCounts ? (counts[i] / total * 100) + '%' : '0%';
        r.querySelector('.count').textContent = showCounts ? counts[i] : '';
        var who = r.querySelector('.who'); if (who) who.textContent = showCounts ? names[i].join(', ') : '';
      });
    }
    return { el: box, update: update };
  }

  function lightbox(src) {
    var ov = el('div', 'lightbox', img(src), el('div', 'lb-hint', 'לחיצה סוגרת'));
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', close); document.addEventListener('keydown', onKey);
    document.body.append(ov);
  }

  function confetti() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = el('canvas', 'confetti'); document.body.append(c);
    var ctx = c.getContext('2d'); var W = c.width = innerWidth, H = c.height = innerHeight;
    var colors = ['#e8b84a', '#ffd97a', '#6fb6ff', '#43d17e', '#ff6b6b', '#f4efe4'];
    var parts = []; for (var i = 0; i < 160; i++) parts.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, r: 5 + Math.random() * 7, c: colors[(Math.random() * colors.length) | 0], vx: -1 + Math.random() * 2, vy: 2 + Math.random() * 3, a: Math.random() * Math.PI, va: -0.1 + Math.random() * 0.2 });
    var t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p) { p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); ctx.restore(); });
      if (t - t0 < 5000) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  function confirmTwice(b, fn) {
    if (b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = b.dataset.label; b.classList.remove('armed'); fn(); return; }
    b.dataset.label = b.textContent; b.dataset.armed = '1'; b.classList.add('armed'); b.textContent = 'בטוחים? לחצו שוב לאישור';
    setTimeout(function () { if (b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = b.dataset.label; b.classList.remove('armed'); } }, 4000);
  }

  function qrInto(box, text, tries) {
    tries = tries || 0;
    if (typeof window.qrcode !== 'function') { if (tries < 30) setTimeout(function () { qrInto(box, text, tries + 1); }, 400); else box.replaceChildren(el('p', 'link', text)); return; }
    try { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
    catch (e) { box.replaceChildren(el('p', 'link', text)); }
  }

  // ---------- player views ----------
  function viewJoin() {
    var input = el('input', 'name-input'); input.type = 'text'; input.id = 'join-name'; input.placeholder = 'השם שלכם'; input.maxLength = 24; input.value = me.name || ''; input.autocomplete = 'off'; input.setAttribute('enterkeyhint', 'go');
    var err = el('p', 'err');
    var go = btn('הצטרפות למשחק', 'primary big', submit);
    async function submit() {
      var v = input.value.trim();
      if (!v) { err.textContent = 'כתבו שם כדי להצטרף'; input.focus(); return; }
      go.disabled = true; err.textContent = '';
      try { await A.join(v); } catch (e) { console.error(e); err.textContent = 'לא הצלחנו להצטרף. נסו שוב.'; go.disabled = false; }
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    var label = el('label', 'lbl', 'איך קוראים לכם?'); label.htmlFor = 'join-name';
    var root = el('div', 'screen join',
      el('div', 'hero', img('img/cover.jpg'), el('div', 'hero-text', el('p', 'eyebrow', 'יום הולדת 80'), el('h1', 'title', 'חידון פרדי'), el('p', 'sub', 'באהבה מכל משפחת זך'))),
      el('main', 'join-form', label, input, go, err,
        LOCAL ? el('p', 'note', 'מצב בדיקה מקומי: הסנכרון עובד רק בין לשוניות בדפדפן הזה.') : null,
        el('p', 'note', 'אחרי ההצטרפות השאלות יופיעו כאן כשהמנחה מתקדם. אין צורך לרענן.')));
    return { el: root, update: function () {} };
  }

  function viewLobby() {
    var top = topbar(); var list = el('div', 'chips'); var count = el('p', 'count');
    var change = btn('לא אני, שינוי שם', 'link-btn', function () { A.leave(); });
    var root = el('div', 'screen lobby', top.el, el('main', 'lobby-main',
      el('div', 'wait', el('div', 'pulse'), el('h1', null, 'ממתינים שהמנחה יתחיל'), el('p', null, 'נרשמתם בשם ', el('b', null, me.name), '. ', change)),
      count, list));
    function update() {
      top.update();
      var names = Object.keys(players()).map(function (pid) { return players()[pid].name || ''; });
      count.textContent = names.length <= 1 ? 'אתם הראשונים כאן' : names.length + ' משתתפים כבר כאן';
      list.replaceChildren.apply(list, names.map(function (n) { return el('span', 'chip', n); }));
    }
    return { el: root, update: update };
  }

  function viewQuestion() {
    var q = qIndex(state()); var Q = QS[q];
    var top = topbar();
    var fig = el('figure', 'photo' + (Q.h > Q.w ? ' portrait' : ''), img(Q.img)); fig.addEventListener('click', function () { lightbox(Q.img); });
    var verdict = el('div', 'verdict'); verdict.hidden = true;
    var opts = Q.options.map(function (t, i) {
      var b = el('button', 'opt', el('span', 'letter', LETTERS[i]), el('span', 'txt', t), el('span', 'tag')); b.type = 'button';
      b.addEventListener('click', function () { if (state().phase !== 'question') return; A.answer(i); });
      return b;
    });
    var status = el('div', 'status');
    var root = el('div', 'screen player-q', top.el, el('main', 'q', fig, el('h1', 'qtext', Q.q), Q.note ? el('p', 'qnote', Q.note) : null, verdict, el('div', 'options', ...opts), status));
    function update() {
      var s = state(); top.update();
      var mine = answersFor(q)[me.pid]; var myC = mine ? mine.c : null;
      var revealed = s.phase === 'reveal'; var correct = revealed ? s.correct : null;
      opts.forEach(function (b, i) {
        b.classList.toggle('selected', myC === i && !revealed);
        b.classList.toggle('correct', revealed && correct === i);
        b.classList.toggle('wrong', revealed && myC === i && correct !== i);
        b.disabled = revealed;
        b.querySelector('.tag').textContent = revealed && correct === i ? 'התשובה הנכונה' : (!revealed && myC === i ? 'הבחירה שלכם' : '');
      });
      var count = answeredCount(q), total = playerCount();
      if (!revealed) {
        verdict.hidden = true;
        status.textContent = myC === null ? 'בחרו תשובה' : 'התשובה נשמרה (' + LETTERS[myC] + '). אפשר לשנות עד שהמנחה חושף. ' + count + ' מתוך ' + total + ' ענו';
      } else {
        verdict.hidden = false;
        verdict.className = 'verdict ' + (myC === null ? 'none' : myC === correct ? 'ok' : 'bad');
        verdict.textContent = myC === null ? 'לא עניתם על השאלה הזו' : myC === correct ? 'נכון! נקודה נוספה' : 'לא נכון הפעם';
        status.textContent = count + ' מתוך ' + total + ' ענו';
      }
    }
    return { el: root, update: update };
  }

  function viewBoard() {
    var top = topbar(); var mine = el('p', 'mine big'); var sub = el('p', 'sub');
    var root = el('div', 'screen board-screen', top.el, el('main', null, el('div', 'wait', el('div', 'pulse'), el('h1', null, 'טבלת הניקוד על המסך הגדול'), sub), mine));
    function update() {
      top.update(); var rows = computeRows(); var n = Object.keys(G.results || {}).length;
      sub.textContent = 'אחרי ' + n + ' שאלות. ממשיכים עוד רגע.';
      var r = rows.filter(function (x) { return x.pid === me.pid; })[0];
      mine.textContent = r ? 'יש לכם ' + r.score + ' נקודות, מקום ' + r.rank + ' מתוך ' + rows.length : '';
    }
    return { el: root, update: update };
  }

  function viewFinal() {
    var top = topbar(); var podium = el('div', 'podium'); var box = el('div', 'board-wrap'); var mine = el('p', 'mine'); var win = el('div', 'winner-wrap'); var shot = false;
    var root = el('div', 'screen final', top.el, el('main', null, el('p', 'eyebrow', 'סיום המשחק'), el('h1', 'h', 'התוצאות הסופיות'), win, podium, mine, box,
      el('figure', 'photo outro-fig', img('img/outro.jpg')), el('p', 'bye', 'עד לפעם הבאה, ביום הולדת 90')));
    function update() {
      top.update(); var rows = computeRows(); win.replaceChildren(winnerLine(rows)); renderPodium(podium, rows); box.replaceChildren(leaderboard(rows, { me: me.pid }));
      var r = rows.filter(function (x) { return x.pid === me.pid; })[0];
      mine.textContent = r ? 'סיימתם במקום ' + r.rank + ' עם ' + r.score + ' נקודות מתוך ' + Object.keys(G.results || {}).length + ' שאלות' : '';
      if (!shot) { shot = true; confetti(); }
    }
    return { el: root, update: update };
  }

  // ---------- host ----------
  function viewHostPin() {
    var input = el('input', 'name-input'); input.type = 'password'; input.id = 'host-pin'; input.inputMode = 'numeric'; input.placeholder = 'קוד מנחה'; input.autocomplete = 'off';
    var err = el('p', 'err');
    var go = btn('כניסה למסך המנחה', 'primary big', function () {
      if (input.value.trim() === String(CFG.hostPin)) { hostAuthed = true; SS.set('fredy80-host', '1'); render(); } else { err.textContent = 'קוד שגוי'; }
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });
    var label = el('label', 'lbl', 'קוד מנחה'); label.htmlFor = 'host-pin';
    var root = el('div', 'screen pin', el('main', 'join-form', el('h1', 'title', 'מסך המנחה'), label, input, go, err));
    return { el: root, update: function () {} };
  }

  function viewHost() {
    var q = qIndex(state()); var Q = QS[q]; ui.hostPick = null;
    var dot = connDot(); var phaseLbl = el('div', 'phase');
    var header = el('header', 'top host-top', el('div', 'brand', dot.el, TITLE, el('span', 'badge', 'מנחה'), LOCAL ? el('span', 'badge warn', 'מצב בדיקה') : null), phaseLbl);

    // lobby panel: link + QR
    var qrBox = el('div', 'qr'); var link = el('a', 'link', joinLink()); link.href = joinLink(); link.target = '_blank'; link.rel = 'noopener';
    var copyB = btn('העתקת הקישור', 'ghost small', async function () { try { await navigator.clipboard.writeText(joinLink()); copyB.textContent = 'הועתק'; setTimeout(function () { copyB.textContent = 'העתקת הקישור'; }, 1500); } catch (e) {} });
    var lobbyPanel = el('section', 'panel lobby-panel', el('h2', null, 'הצטרפות למשחק'), el('p', 'sub', 'שלחו את הקישור בוואטסאפ, או שהמשתתפים סורקים את הקוד'), qrBox, link, el('div', 'row', copyB),
      el('p', 'sub', 'למסך גדול (טלוויזיה): פתחו את אותה כתובת עם ‎#screen בסופה.'));
    qrInto(qrBox, joinLink());

    // question panel
    var fig = el('figure', 'photo small', img(Q.img)); fig.addEventListener('click', function () { lightbox(Q.img); });
    var dist = optionList(q, { names: true, onPick: onPick });
    var hint = el('p', 'hint'); var answered = el('span', 'answered');
    var qPanel = el('section', 'panel q-panel', el('div', 'qhead', el('span', 'qnum', 'שאלה ' + (q + 1) + ' מתוך ' + N), answered), fig, el('h2', 'qtext', Q.q), Q.note ? el('p', 'qnote', Q.note) : null, dist.el, hint);

    // board panel
    var boardWrap = el('div', 'board-wrap'); var boardTitle = el('h2', null, 'התוצאות הסופיות');
    var boardPanel = el('section', 'panel board-panel', boardTitle, boardWrap);
    var tvPanel = el('section', 'panel tv-note', el('h2', null, 'טבלת הניקוד מוצגת עכשיו על המסך הגדול'), el('p', 'sub', 'כשסיימתם לדבר על התוצאות, לחצו על הכפתור הראשי כדי להמשיך.'));

    // controls
    var primary = btn('', 'primary big', onPrimary); primary.id = 'btn-primary';
    var forceB = btn('חשוף בכל זאת, בלי לחכות', 'ghost', function () { var k = ui.hostPick !== null ? ui.hostPick : (Q.correct === undefined ? null : Q.correct); if (k !== null) A.reveal(k); }); forceB.id = 'btn-force-reveal';
    var prevB = btn('השאלה הקודמת', 'ghost', function () { A.prev(); }); prevB.id = 'btn-prev';
    var skipB = btn('דלג לשאלה הבאה', 'ghost', function () { A.next(); }); skipB.id = 'btn-skip';
    var boardB = btn('הצג טבלת ניקוד', 'ghost', function () { A.board(); }); boardB.id = 'btn-board';
    var backB = btn('חזרה לשאלה', 'ghost', function () { A.back(); }); backB.id = 'btn-back';
    var finalB = btn('סיום המשחק', 'ghost', function () { confirmTwice(finalB, function () { A.final(); }); }); finalB.id = 'btn-final';
    var lobbyB = btn('חזרה ללובי', 'ghost', function () { A.lobby(); }); lobbyB.id = 'btn-lobby';
    var jump = el('select', 'jump'); jump.id = 'jump';
    var opt0 = el('option', null, 'קפיצה לשאלה...'); opt0.value = ''; jump.append(opt0);
    QS.forEach(function (qq, i) { var o = el('option', null, (i + 1) + '. ' + (qq.q.length > 44 ? qq.q.slice(0, 44) + '…' : qq.q)); o.value = String(i); jump.append(o); });
    jump.addEventListener('change', function () { if (jump.value !== '') A.open(Number(jump.value)); });
    var resetScoresB = btn('איפוס ניקוד (המשתתפים נשארים)', 'danger', function () { confirmTwice(resetScoresB, function () { A.resetScores(); }); }); resetScoresB.id = 'btn-reset-scores';
    var resetAllB = btn('איפוס מלא (גם המשתתפים נמחקים)', 'danger', function () { confirmTwice(resetAllB, function () { A.resetAll(); }); }); resetAllB.id = 'btn-reset-all';
    var plist = el('ul', 'plist'); var pcount = el('span', 'pcount'); var liByPid = {};
    var controls = el('aside', 'controls',
      el('div', 'primary-wrap', primary, forceB),
      el('div', 'row', prevB, skipB, boardB, backB, finalB, lobbyB),
      jump,
      el('h3', null, 'משתתפים ', pcount), el('p', 'sub', 'האות ליד השם היא התשובה שנבחרה. הכפתורים + ו− נותנים או מורידים נקודת בונוס, למשל לשאלת הבונוס.'), plist,
      el('details', 'danger-zone', el('summary', null, 'איפוס'), resetScoresB, resetAllB));
    var root = el('div', 'screen host', header, el('div', 'host-grid', el('section', 'preview', lobbyPanel, qPanel, tvPanel, boardPanel), controls));

    function onPick(i) {
      var s = state();
      if (s.phase === 'question') { ui.hostPick = (ui.hostPick === i) ? null : i; update(); }
      else if (s.phase === 'reveal' && i !== s.correct) A.reveal(i);
    }
    function onPrimary() {
      var s = state();
      if (s.phase === 'lobby') A.start();
      else if (s.phase === 'question') { var i = ui.hostPick !== null ? ui.hostPick : Q.correct; if (i !== null && i !== undefined) A.reveal(i); }
      else if (s.phase === 'reveal') { if (q + 1 >= N) A.final(); else if ((q + 1) % 5 === 0 && s.boardDone !== q) A.board(); else A.next(); }
      else if (s.phase === 'board') { if (result(q)) { if (q + 1 < N) A.open(q + 1); else A.final(); } else A.back(); }
      else if (s.phase === 'final') A.board();
    }
    function playerRow(r, s, ans) {
      var li = liByPid[r.pid];
      if (!li) {
        li = el('li', null, el('span', 'st'), el('span', 'name'), el('span', 'pts'), btn('+', 'mini', function () { A.bonus(r.pid, 1); }), btn('−', 'mini', function () { A.bonus(r.pid, -1); }));
        var rm = btn('הסר', 'mini danger'); rm.addEventListener('click', function () { confirmTwice(rm, function () { A.removePlayer(r.pid); }); }); li.append(rm);
        liByPid[r.pid] = li;
      }
      var a = ans[r.pid]; var st = li.querySelector('.st');
      st.textContent = inQ(s) ? (a ? LETTERS[a.c] : '·') : ''; st.classList.toggle('yes', inQ(s) && !!a);
      li.querySelector('.name').textContent = r.name || 'ללא שם';
      li.querySelector('.pts').textContent = r.score + (r.bonus ? ' (בונוס ' + r.bonus + ')' : '');
      return li;
    }
    function update() {
      var s = state(); dot.update();
      var n = playerCount(); var ac = answeredCount(q);
      lobbyPanel.hidden = s.phase !== 'lobby'; qPanel.hidden = !inQ(s); tvPanel.hidden = s.phase !== 'board'; boardPanel.hidden = s.phase !== 'final';
      var P = players(); var ansNow = answersFor(q); var missing = Object.keys(P).filter(function (pid) { return !ansNow[pid]; }).map(function (pid) { return P[pid].name || 'ללא שם'; });
      var labels = { lobby: 'לובי: ממתינים למשתתפים', question: 'שאלה פתוחה: המשתתפים עונים', reveal: 'התשובה נחשפה: אפשר לדבר על השאלה', board: 'טבלת הניקוד מוצגת לכולם', final: 'המשחק הסתיים, התוצאות מוצגות לכולם' };
      phaseLbl.textContent = labels[s.phase] || '';
      answered.textContent = ac + ' מתוך ' + n + ' ענו';
      var key = ui.hostPick !== null ? ui.hostPick : (Q.correct === undefined ? null : Q.correct);
      dist.update({ liveCounts: true, key: s.phase === 'question' ? key : null, pick: ui.hostPick });
      if (s.phase === 'question') hint.textContent = (key === null ? 'לשאלה הזו עוד אין תשובה מוגדרת. לחצו על התשובה הנכונה ואז על "חשוף תשובה". ' : 'התשובה הנכונה כבר מסומנת ב-✓ ורק אתם רואים אותה. לשינוי לפני החשיפה, לחצו על תשובה אחרת. ') + (missing.length ? 'עדיין לא ענו: ' + missing.slice(0, 8).join(', ') + (missing.length > 8 ? ' ועוד ' + (missing.length - 8) : '') + '.' : '');
      else if (s.phase === 'reveal') hint.textContent = 'טעות בחשיפה? לחיצה על תשובה אחרת מתקנת אותה לכולם.';
      else hint.textContent = '';
      if (s.phase === 'lobby') { primary.textContent = (G.results && Object.keys(G.results).length) ? 'המשך משחק' : (n ? 'התחל משחק (' + n + ' משתתפים)' : 'התחל משחק'); primary.disabled = false; }
      else if (s.phase === 'question') {
        if (key === null) { primary.textContent = 'סמנו תשובה נכונה כדי לחשוף'; primary.disabled = true; }
        else if (missing.length) { primary.textContent = 'ממתינים ל-' + missing.length + (missing.length === 1 ? ' משתתף שעוד לא ענה' : ' משתתפים שעוד לא ענו'); primary.disabled = true; }
        else { primary.textContent = 'חשוף תשובה (' + LETTERS[key] + ')'; primary.disabled = false; }
      }
      else if (s.phase === 'reveal') { primary.textContent = q + 1 >= N ? 'סיום המשחק והצגת התוצאות' : (((q + 1) % 5 === 0 && s.boardDone !== q) ? 'הצג טבלת ניקוד על המסך' : 'השאלה הבאה (' + (q + 2) + ')'); primary.disabled = false; }
      else if (s.phase === 'board') { primary.textContent = result(q) ? (q + 1 < N ? 'המשך לשאלה ' + (q + 2) : 'סיום המשחק והצגת התוצאות') : 'חזרה לשאלה ' + (q + 1); primary.disabled = false; }
      else { primary.textContent = 'הצג טבלת ניקוד'; primary.disabled = false; }
      forceB.hidden = !(s.phase === 'question' && key !== null && missing.length > 0);
      prevB.hidden = !inQ(s) || q === 0; skipB.hidden = s.phase !== 'question'; boardB.hidden = !inQ(s);
      backB.hidden = !(s.phase === 'board' || s.phase === 'final'); finalB.hidden = s.phase === 'final' || s.phase === 'lobby'; lobbyB.hidden = s.phase === 'lobby';
      jump.value = inQ(s) ? String(q) : '';
      var rows = computeRows(); pcount.textContent = '(' + n + ')';
      if (!boardPanel.hidden) boardWrap.replaceChildren(winnerLine(rows), leaderboard(rows, {}));
      var ans = answersFor(q);
      var items = rows.map(function (r) { return playerRow(r, s, ans); });
      Object.keys(liByPid).forEach(function (pid) { if (!players()[pid]) delete liByPid[pid]; });
      if (!items.length) items = [el('li', 'empty', 'עדיין אף אחד לא הצטרף')];
      plist.replaceChildren.apply(plist, items);
    }
    return { el: root, update: update };
  }

  // ---------- TV screen ----------
  function viewScreenLobby() {
    var qrBox = el('div', 'qr big'); var chips = el('div', 'chips'); var count = el('p', 'count');
    var root = el('div', 'screen tv tv-lobby',
      el('div', 'tv-hero', img('img/cover.jpg'), el('div', 'hero-text', el('p', 'eyebrow', 'יום הולדת 80'), el('h1', 'title', 'חידון פרדי'), el('p', 'sub', 'באהבה מכל משפחת זך'))),
      el('div', 'tv-join', el('h2', null, 'סרקו כדי להצטרף'), qrBox, el('p', 'link', joinLink()), count, chips));
    qrInto(qrBox, joinLink());
    function update() {
      var names = Object.keys(players()).map(function (pid) { return players()[pid].name || ''; });
      count.textContent = names.length ? names.length + ' הצטרפו' : 'ממתינים למשתתפים...';
      chips.replaceChildren.apply(chips, names.map(function (n) { return el('span', 'chip', n); }));
    }
    return { el: root, update: update };
  }

  function viewScreenQuestion() {
    var q = qIndex(state()); var Q = QS[q];
    var dist = optionList(q, { names: true }); var answered = el('div', 'answered big');
    var root = el('div', 'screen tv tv-q', el('figure', 'photo tv-photo', img(Q.img)),
      el('div', 'tv-text', el('div', 'qnum', 'שאלה ' + (q + 1) + ' מתוך ' + N), el('h1', 'qtext', Q.q), Q.note ? el('p', 'qnote', Q.note) : null, dist.el, answered));
    function update() { dist.update({}); answered.textContent = answeredCount(q) + ' מתוך ' + playerCount() + ' ענו'; }
    return { el: root, update: update };
  }

  function viewScreenBoard() {
    var h = el('h1', 'h'); var sub = el('p', 'sub'); var win = el('div', 'winner-wrap'); var podium = el('div', 'podium'); var box = el('div', 'board-wrap'); var shot = false;
    var root = el('div', 'screen tv tv-board', el('main', null, h, sub, win, podium, box));
    function update() {
      var s = state(); var rows = computeRows(); var nres = Object.keys(G.results || {}).length;
      h.textContent = s.phase === 'final' ? 'סיום המשחק' : 'טבלת הניקוד';
      sub.textContent = s.phase === 'final' ? 'התוצאות הסופיות אחרי ' + nres + ' שאלות' : 'אחרי ' + nres + ' שאלות, ' + rows.length + ' משתתפים';
      podium.hidden = s.phase !== 'final'; win.hidden = s.phase !== 'final';
      if (s.phase === 'final') { win.replaceChildren(winnerLine(rows)); renderPodium(podium, rows); if (!shot) { shot = true; confetti(); } }
      box.replaceChildren(leaderboard(rows, { cols: true }));
    }
    return { el: root, update: update };
  }

  // ---------- live ranking page (#board): read-only, everyone, always up to date ----------
  function viewBoardLive() {
    var dot = connDot(); var sub = el('p', 'sub'); var box = el('div', 'board-wrap'); var now = el('p', 'now');
    var root = el('div', 'screen tv tv-board board-live', el('main', null, el('div', 'board-head', el('h1', 'h', 'טבלת הניקוד'), el('div', 'brand', dot.el, TITLE)), sub, now, box));
    function update() {
      var s = state(); dot.update(); var rows = computeRows(); var nres = Object.keys(G.results || {}).length;
      sub.textContent = rows.length + ' משתתפים, אחרי ' + nres + ' שאלות';
      now.textContent = s.phase === 'lobby' ? 'ממתינים שהמנחה יתחיל' : inQ(s) ? ('שאלה ' + (qIndex(s) + 1) + ' מתוך ' + N + (s.phase === 'reveal' ? ', התשובה נחשפה' : ', ' + answeredCount(qIndex(s)) + ' מתוך ' + playerCount() + ' ענו')) : s.phase === 'final' ? 'המשחק הסתיים' : '';
      box.replaceChildren(leaderboard(rows, {}));
    }
    return { el: root, update: update };
  }

  // ---------- render ----------
  function render() {
    if (!loaded) return;
    var s = state(); var key, make;
    if (mode === 'host') {
      if (!hostAuthed) { key = 'hostpin'; make = viewHostPin; }
      else { key = 'host:' + qIndex(s); make = viewHost; }
    } else if (mode === 'board') {
      key = 'board-live'; make = viewBoardLive;
    } else if (mode === 'screen') {
      if (s.phase === 'lobby') { key = 'screen:lobby'; make = viewScreenLobby; }
      else if (inQ(s)) { key = 'screen:q:' + qIndex(s); make = viewScreenQuestion; }
      else { key = 'screen:' + s.phase; make = viewScreenBoard; }
    } else {
      if (!players()[me.pid]) { key = 'join'; make = viewJoin; }
      else if (s.phase === 'lobby') { key = 'lobby'; make = viewLobby; }
      else if (inQ(s)) { key = 'q:' + qIndex(s); make = viewQuestion; }
      else if (s.phase === 'board') { key = 'board'; make = viewBoard; }
      else { key = 'final'; make = viewFinal; }
    }
    if (current.key !== key) { var v = make(); app.replaceChildren(v.el); current = { key: key, view: v }; window.scrollTo(0, 0); }
    if (current.view.update) current.view.update();
    if (inQ(s)) preload(qIndex(s) + 1);
  }

  // TV screen: real fullscreen (hides the browser bars), toggled by a button or the F key; cursor and button hide when idle
  if (mode === 'screen' || mode === 'board') {
    function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
    function toggleFullscreen() {
      var d = document, root = d.documentElement;
      if (isFull()) { if (d.exitFullscreen) d.exitFullscreen(); else if (d.webkitExitFullscreen) d.webkitExitFullscreen(); return; }
      try {
        var p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : (root.webkitRequestFullscreen ? root.webkitRequestFullscreen() : null);
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    var fsBtn = btn('מסך מלא', 'fs-btn', toggleFullscreen); fsBtn.id = 'btn-fullscreen'; fsBtn.title = 'מסך מלא (מקש F, יציאה עם Esc)';
    var fsHint = el('div', 'fs-hint', 'לחצו בכל מקום על המסך כדי לעבור למסך מלא'); fsHint.id = 'fs-hint';
    document.body.append(fsBtn, fsHint);
    // any click on the TV page enters fullscreen (the page has nothing else to click)
    document.addEventListener('click', function (e) { if (!isFull() && !fsBtn.contains(e.target)) toggleFullscreen(); });
    function onFs() { var on = isFull(); fsBtn.textContent = on ? 'יציאה ממסך מלא' : 'מסך מלא'; fsHint.hidden = on; document.documentElement.classList.toggle('is-fullscreen', on); }
    document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
    document.addEventListener('keydown', function (e) { if ((e.key === 'f' || e.key === 'F' || e.key === 'כ') && !e.metaKey && !e.ctrlKey && !e.altKey) toggleFullscreen(); });
    var idleT;
    function wake() { document.documentElement.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(function () { document.documentElement.classList.add('idle'); }, 3000); }
    ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, wake, { passive: true }); });
    wake();
  }

  sync.onConnected(function (c) { connected = c; if (current.view && current.view.update) current.view.update(); });
  sync.watch(ROOT, function (v) { G = v || {}; loaded = true; render(); });
})();
