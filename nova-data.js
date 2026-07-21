/* ===========================================================
   NOVA workspace data layer
   -----------------------------------------------------------
   MODE 'demo' keeps everything in this browser so you can build
   and test the whole flow with no backend. MODE 'live' is the
   Supabase swap, and only this file changes.

   Passwords are salted and hashed with SHA-256 even in demo, so
   nothing readable is ever stored. Note honestly: hashing in a
   browser is not real security. Real security arrives with the
   backend. See WORKSPACE_SETUP.md.
   =========================================================== */

var NOVA = (function () {
  var MODE = 'demo';
  var KEY = 'nova_workspace_v3';
  var SKEY = 'nova_session_v1';

  /* ---------------- file blobs ---------------- */
  var IDB = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var r = indexedDB.open('nova_files', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('blobs'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return dbp;
    }
    return {
      put: function (id, blob) {
        return open().then(function (db) {
          return new Promise(function (res, rej) {
            var tx = db.transaction('blobs', 'readwrite');
            tx.objectStore('blobs').put(blob, id);
            tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
          });
        });
      },
      get: function (id) {
        return open().then(function (db) {
          return new Promise(function (res, rej) {
            var tx = db.transaction('blobs', 'readonly');
            var q = tx.objectStore('blobs').get(id);
            q.onsuccess = function () { res(q.result || null); };
            q.onerror = function () { rej(q.error); };
          });
        });
      }
    };
  })();

  /* ---------------- password hashing ---------------- */
  function randomHex(n) {
    var a = new Uint8Array(n); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function hash(password, salt) {
    var data = new TextEncoder().encode(salt + '|' + password);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }
  function daysAhead(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 9); }
  /* monotonic clock: two events in the same millisecond still get distinct,
     increasing timestamps, so nothing is ever missed by a seen-marker */
  var _last = 0;
  var NOW = function () {
    var t = Date.now();
    if (t <= _last) t = _last + 1;
    _last = t;
    return new Date(t).toISOString();
  };

  /* ---------------- lane styling ---------------- */
  var LANES = {
    finance:    { label: 'Books and finance', color: '#10B981', soft: 'rgba(16,185,129,.13)',  glyph: '◉' },
    data:       { label: 'Data and reporting',color: '#3B82F6', soft: 'rgba(59,130,246,.13)',  glyph: '◈' },
    automation: { label: 'Automation',        color: '#A855F7', soft: 'rgba(168,85,247,.13)',  glyph: '◐' },
    web:        { label: 'Software and web',  color: '#E8572A', soft: 'rgba(232,87,42,.13)',   glyph: '✧' },
    marketing:  { label: 'Marketing',         color: '#F59E0B', soft: 'rgba(245,158,11,.14)',  glyph: '●' },
    other:      { label: 'Other',             color: '#6B7280', soft: 'rgba(107,114,128,.14)', glyph: '◆' }
  };

  /* ---------------- seed ---------------- */
  function seed() {
    return {
      users: [],  /* filled by ensureSeedUsers, because hashing is async */
      clients: [
        { id: 'emberoak', company: 'Ember & Oak Candle Co.', contact: 'Sarah Lindqvist', email: 'sarah@emberoak.com', plan: 'Numbers, plus one', rate: 800, since: daysAgo(48), siteLink: '' },
        { id: 'summit',   company: 'Summit Mobile Detailing', contact: 'Marcus Reyes',   email: 'marcus@summitdetail.com', plan: 'Your numbers', rate: 350, since: daysAgo(20), siteLink: '' }
      ],
      jobs: [
        { id: 'j1', clientId: 'emberoak', name: 'Sales dashboard', lane: 'data',    stage: 'Reconciliation',  progress: 68,  next: 'Reconciliation review, Thursday', priority: 'attention', at: daysAgo(20) },
        { id: 'j2', clientId: 'emberoak', name: 'Bookkeeping',     lane: 'finance', stage: 'June closed',     progress: 100, next: 'July closes on the 10th',        priority: 'normal',    at: daysAgo(46) },
        { id: 'j3', clientId: 'emberoak', name: 'Website upkeep',  lane: 'web',     stage: 'Monthly updates', progress: 40,  next: 'Autumn range goes live Friday',  priority: 'normal',    at: daysAgo(12) },
        { id: 'j4', clientId: 'summit',   clientName: 'Summit', name: 'Books catch-up', lane: 'finance', stage: 'March complete', progress: 45, next: 'April and May next week', priority: 'normal', at: daysAgo(18) }
      ],
      messages: [
        { id: 'm1', clientId: 'emberoak', jobId: 'j1', from: 'nova', author: 'NOVA', body: 'June is fully reconciled. Every channel now agrees with its own report to within 0.4 percent, and the gaps that remain are all settlement timing.', at: daysAgo(1) },
        { id: 'm2', clientId: 'emberoak', jobId: 'j2', from: 'nova', author: 'NOVA', body: 'June is closed. Profit is up 9 percent on May, and the biggest single change was shipping, which I have broken out in the summary.', at: daysAgo(3) },
        { id: 'm3', clientId: 'summit',   jobId: 'j4', from: 'nova', author: 'NOVA', body: 'March is reconciled to the penny. I have started a question list for the few transactions I could not place.', at: daysAgo(2) }
      ],
      files: [
        { id: 'f1', clientId: 'emberoak', jobId: 'j1', name: 'June_reconciliation.xlsx', kind: 'XLS', tag: 'deliverable', by: 'nova', at: daysAgo(1), size: '84 KB' },
        { id: 'f2', clientId: 'emberoak', jobId: 'j2', name: 'June_profit_summary.pdf',  kind: 'PDF', tag: 'report',      by: 'nova', at: daysAgo(3), size: '210 KB' },
        { id: 'f3', clientId: 'emberoak', jobId: 'j2', name: 'June_walkthrough.mp4',     kind: 'VID', tag: 'walkthrough', by: 'nova', at: daysAgo(3), size: '18 MB' },
        { id: 'f4', clientId: 'summit',   jobId: 'j4', name: 'March_reconciliation.xlsx',kind: 'XLS', tag: 'deliverable', by: 'nova', at: daysAgo(2), size: '61 KB' }
      ],
      actions: [
        { id: 'a1', clientId: 'emberoak', jobId: 'j1', type: 'question', title: 'Three Amazon codes have no match',
          detail: 'B08K3T9L2, B07YYQ4M1 and B09WW2XZ8 do not match anything on the website. Are they discontinued, or listed under a different name?',
          due: daysAhead(2), status: 'open', at: daysAgo(1) },
        { id: 'a2', clientId: 'emberoak', jobId: 'j3', type: 'approval', title: 'Autumn range page, ready for your approval',
          detail: 'The page is built and staged with the new photography. Approve and it goes live Friday morning.',
          due: daysAhead(3), status: 'open', at: daysAgo(0) }
      ],
      invoices: [
        { id: 'i1', clientId: 'emberoak', number: 'NOVA-0012', period: 'June 2026', amount: 800, issued: daysAgo(20), due: daysAgo(6), status: 'paid', payLink: '' },
        { id: 'i2', clientId: 'emberoak', number: 'NOVA-0018', period: 'July 2026', amount: 800, issued: daysAgo(2), due: daysAhead(9), status: 'due', payLink: '' },
        { id: 'i3', clientId: 'summit',   number: 'NOVA-0019', period: 'July 2026', amount: 350, issued: daysAgo(2), due: daysAhead(9), status: 'due', payLink: '' }
      ],
      access: [
        { id: 'x1', clientId: 'emberoak', tool: 'Shopify',    level: 'Orders, products, analytics', status: 'granted', at: daysAgo(40) },
        { id: 'x2', clientId: 'emberoak', tool: 'Amazon',     level: 'Reports, view only',          status: 'granted', at: daysAgo(40) },
        { id: 'x3', clientId: 'emberoak', tool: 'QuickBooks', level: 'Accountant seat',             status: 'granted', at: daysAgo(38) },
        { id: 'x5', clientId: 'summit',   tool: 'QuickBooks', level: 'Accountant seat',             status: 'granted', at: daysAgo(18) }
      ],
      scope: [
        { clientId: 'emberoak', included: ['Bookkeeping kept current, monthly close by the 10th','Live dashboard of sales, cash and margin','Written monthly summary and a recorded walkthrough','One further job: website upkeep'], excluded: ['Tax filing','Payroll','Paid advertising','Forecasting'] },
        { clientId: 'summit',   included: ['Bookkeeping kept current, monthly close by the 10th','Live dashboard of sales, cash and margin','Written monthly summary and a recorded walkthrough'], excluded: ['Tax filing','Payroll','Invoice chasing'] }
      ],
      invites: [],
      /* seen[username][clientId][section] = iso timestamp */
      seen: {}
    };
  }

  function db() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) { var s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s; }
      return JSON.parse(raw);
    } catch (e) { return seed(); }
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { console.warn(e); } }

  /* create the three demo accounts the first time, hashed */
  function ensureSeedUsers() {
    var d = db();
    if (d.users && d.users.length) return Promise.resolve();
    var defs = [
      { username: 'temi',   password: 'nova', role: 'admin',  firstName: 'Temi',   clientId: null },
      { username: 'sarah',  password: 'nova', role: 'client', firstName: 'Sarah',  clientId: 'emberoak' },
      { username: 'marcus', password: 'nova', role: 'client', firstName: 'Marcus', clientId: 'summit' }
    ];
    return Promise.all(defs.map(function (u) {
      var salt = randomHex(8);
      return hash(u.password, salt).then(function (h) {
        return { username: u.username, salt: salt, hash: h, role: u.role, firstName: u.firstName, clientId: u.clientId, createdAt: NOW() };
      });
    })).then(function (users) { var x = db(); x.users = users; save(x); });
  }

  function setSession(u) { localStorage.setItem(SKEY, JSON.stringify(u)); }
  function getSession() { var r = localStorage.getItem(SKEY); return r ? JSON.parse(r) : null; }
  function clearSession() { localStorage.removeItem(SKEY); }

  function greeting(d) { var h = (d || new Date()).getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function timeAgo(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    var d = Math.floor(s / 86400);
    if (d === 1) return 'Yesterday';
    if (d < 7) return d + ' days ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function dueIn(iso) {
    var days = Math.ceil((new Date(iso) - Date.now()) / 86400000);
    if (days < 0) return Math.abs(days) + (Math.abs(days) === 1 ? ' day overdue' : ' days overdue');
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days + ' days';
  }
  function money(n) { return '$' + Number(n).toLocaleString(); }
  function kindOf(name) {
    var e = (name.split('.').pop() || '').toLowerCase();
    if (['xlsx','xls','csv','tsv'].indexOf(e) > -1) return 'XLS';
    if (e === 'pdf') return 'PDF';
    if (['mp4','mov','webm','avi','mkv'].indexOf(e) > -1) return 'VID';
    if (['png','jpg','jpeg','gif','webp','svg','heic'].indexOf(e) > -1) return 'IMG';
    if (['doc','docx','txt','md','rtf'].indexOf(e) > -1) return 'DOC';
    if (['zip','rar','7z'].indexOf(e) > -1) return 'ZIP';
    return 'FILE';
  }
  function prettySize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function requireAuth(role) {
    var u = getSession();
    if (!u) { location.href = 'login.html'; return null; }
    if (role && u.role !== role) { location.href = u.role === 'admin' ? 'admin.html' : 'workspace.html'; return null; }
    return u;
  }

  /* ---------------- seen tracking, drives every dot ---------------- */
  function seenAt(username, clientId, section) {
    var d = db();
    return (((d.seen || {})[username] || {})[clientId] || {})[section] || '1970-01-01T00:00:00.000Z';
  }
  function markSeen(username, clientId, section) {
    var d = db();
    d.seen = d.seen || {}; d.seen[username] = d.seen[username] || {};
    d.seen[username][clientId] = d.seen[username][clientId] || {};
    d.seen[username][clientId][section] = NOW();
    save(d);
  }
  function newerThan(list, iso, filterFn) {
    return list.filter(function (x) {
      return new Date(x.at) > new Date(iso) && (!filterFn || filterFn(x));
    }).length;
  }

  return {
    MODE: MODE, LANES: LANES,
    greeting: greeting, timeAgo: timeAgo, dueIn: dueIn, money: money, kindOf: kindOf, prettySize: prettySize,
    getSession: getSession, requireAuth: requireAuth, ready: ensureSeedUsers,
    lane: function (k) { return LANES[k] || LANES.other; },

    signIn: function (username, password) {
      return ensureSeedUsers().then(function () {
        var d = db();
        var u = d.users.filter(function (x) { return x.username.toLowerCase() === String(username).trim().toLowerCase(); })[0];
        if (!u) return { ok: false, error: 'That username and password do not match.' };
        return hash(password, u.salt).then(function (h) {
          if (h !== u.hash) return { ok: false, error: 'That username and password do not match.' };
          var c = u.clientId ? d.clients.filter(function (x) { return x.id === u.clientId; })[0] : null;
          var s = { username: u.username, role: u.role, firstName: u.firstName, clientId: u.clientId, company: c ? c.company : null };
          setSession(s);
          return { ok: true, user: s };
        });
      });
    },
    signOut: function () { clearSession(); location.href = 'login.html'; },

    /* ---------- invites and account creation ---------- */
    createClient: function (company, contact, email, plan, rate, firstName, username) {
      var d = db();
      var id = company.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14) + Math.random().toString(36).slice(2, 5);
      d.clients.push({ id: id, company: company, contact: contact, email: email, plan: plan, rate: Number(rate) || 0, since: NOW(), siteLink: '' });
      d.scope.push({ clientId: id, included: [], excluded: [] });
      var token = randomHex(16);
      d.invites.push({ token: token, clientId: id, username: username, firstName: firstName, email: email,
        expires: daysAhead(7), used: false, at: NOW() });
      save(d);
      return { clientId: id, token: token, link: location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html?invite=' + token };
    },
    getInvite: function (token) {
      var d = db();
      var i = d.invites.filter(function (x) { return x.token === token; })[0];
      if (!i) return { ok: false, error: 'This invitation link is not valid.' };
      if (i.used) return { ok: false, error: 'This invitation has already been used. Sign in instead.' };
      if (new Date(i.expires) < Date.now()) return { ok: false, error: 'This invitation has expired. Ask NOVA for a new one.' };
      var c = d.clients.filter(function (x) { return x.id === i.clientId; })[0];
      return { ok: true, invite: i, company: c ? c.company : '' };
    },
    acceptInvite: function (token, password) {
      var d = db();
      var i = d.invites.filter(function (x) { return x.token === token; })[0];
      if (!i || i.used) return Promise.resolve({ ok: false, error: 'This invitation is no longer valid.' });
      if (String(password).length < 8) return Promise.resolve({ ok: false, error: 'Use at least 8 characters.' });
      var salt = randomHex(8);
      return hash(password, salt).then(function (h) {
        var x = db();
        x.users.push({ username: i.username, salt: salt, hash: h, role: 'client', firstName: i.firstName, clientId: i.clientId, createdAt: NOW() });
        x.invites.forEach(function (v) { if (v.token === token) v.used = true; });
        save(x);
        var c = x.clients.filter(function (y) { return y.id === i.clientId; })[0];
        var s = { username: i.username, role: 'client', firstName: i.firstName, clientId: i.clientId, company: c ? c.company : null };
        setSession(s);
        return { ok: true, user: s };
      });
    },
    reissueInvite: function (clientId, username, firstName, email) {
      var d = db();
      var token = randomHex(16);
      d.invites.push({ token: token, clientId: clientId, username: username, firstName: firstName, email: email, expires: daysAhead(7), used: false, at: NOW() });
      save(d);
      return { token: token, link: location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html?invite=' + token };
    },
    getInvitesFor: function (clientId) { return db().invites.filter(function (i) { return i.clientId === clientId; }); },

    /* ---------- reads ---------- */
    getClients: function () {
      var d = db(), admin = 'temi';
      return d.clients.map(function (c) {
        var jobs = d.jobs.filter(function (j) { return j.clientId === c.id; });
        var msgs = d.messages.filter(function (m) { return m.clientId === c.id; });
        var acts = d.actions.filter(function (a) { return a.clientId === c.id; });
        var files = d.files.filter(function (f) { return f.clientId === c.id; });
        var sM = seenAt(admin, c.id, 'messages'), sF = seenAt(admin, c.id, 'files'), sA = seenAt(admin, c.id, 'asks');
        var newMsgs = newerThan(msgs, sM, function (m) { return m.from === 'client'; });
        var newFiles = newerThan(files, sF, function (f) { return f.by === 'client'; });
        var replied = acts.filter(function (a) { return a.status === 'answered' && new Date(a.resolvedAt || a.at) > new Date(sA); }).length;
        var overdue = d.invoices.filter(function (i) { return i.clientId === c.id && i.status !== 'paid' && new Date(i.due) < Date.now(); }).length;
        var last = msgs.concat(files).sort(function (a, b) { return new Date(b.at) - new Date(a.at); })[0];
        var hasAccount = d.users.some(function (u) { return u.clientId === c.id; });
        return {
          id: c.id, company: c.company, contact: c.contact, email: c.email, plan: c.plan, rate: c.rate, since: c.since,
          jobCount: jobs.length, newMsgs: newMsgs, newFiles: newFiles, replied: replied, overdue: overdue,
          openActions: acts.filter(function (a) { return a.status === 'open'; }).length,
          totalNew: newMsgs + newFiles + replied,
          hasAccount: hasAccount,
          lastActivity: last ? last.at : c.since
        };
      });
    },
    getClient: function (id) { return db().clients.filter(function (c) { return c.id === id; })[0] || null; },
    updateClient: function (id, patch) { var d = db(); d.clients.forEach(function (c) { if (c.id === id) { for (var k in patch) c[k] = patch[k]; } }); save(d); },
    getJobs: function (cid) { return db().jobs.filter(function (j) { return j.clientId === cid; }); },
    getJob: function (id) { return db().jobs.filter(function (j) { return j.id === id; })[0] || null; },
    addJob: function (cid, name, lane, stage, next) {
      var d = db();
      d.jobs.push({ id: uid('j'), clientId: cid, name: name, lane: lane || 'other', stage: stage || 'Getting started',
        progress: 0, next: next || 'Kick off', priority: 'normal', at: NOW() });
      save(d);
    },
    updateJob: function (id, patch) { var d = db(); d.jobs.forEach(function (j) { if (j.id === id) { for (var k in patch) j[k] = patch[k]; } }); save(d); },
    removeJob: function (id) { var d = db(); d.jobs = d.jobs.filter(function (j) { return j.id !== id; }); save(d); },

    getMessages: function (cid, jid) {
      return db().messages.filter(function (m) { return m.clientId === cid && (!jid || m.jobId === jid); })
        .sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    },
    sendMessage: function (cid, jid, from, author, body) {
      var d = db();
      d.messages.push({ id: uid('m'), clientId: cid, jobId: jid || null, from: from, author: author, body: body, at: NOW() });
      save(d);
    },

    getFiles: function (cid, jid, tag) {
      return db().files.filter(function (f) { return f.clientId === cid && (!jid || f.jobId === jid) && (!tag || f.tag === tag); })
        .sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    },
    addFile: function (cid, jid, file, by, tag) {
      var id = uid('f'), d = db();
      d.files.push({ id: id, clientId: cid, jobId: jid || null, name: file.name, kind: kindOf(file.name),
        tag: tag || (by === 'nova' ? 'deliverable' : 'input'), by: by, at: NOW(), size: prettySize(file.size) });
      save(d);
      return IDB.put(id, file).then(function () { return id; });
    },
    fileURL: function (id) { return IDB.get(id).then(function (b) { return b ? URL.createObjectURL(b) : null; }); },

    getActions: function (cid, openOnly) {
      return db().actions.filter(function (a) { return a.clientId === cid && (!openOnly || a.status === 'open'); })
        .sort(function (a, b) { return new Date(a.due) - new Date(b.due); });
    },
    addAction: function (cid, jid, type, title, detail, due) {
      var d = db();
      d.actions.push({ id: uid('a'), clientId: cid, jobId: jid || null, type: type, title: title, detail: detail,
        due: due || daysAhead(3), status: 'open', at: NOW() });
      save(d);
    },
    resolveAction: function (id, response, status) {
      var d = db();
      d.actions.forEach(function (a) { if (a.id === id) { a.status = status || 'answered'; a.response = response || ''; a.resolvedAt = NOW(); } });
      save(d);
    },
    closeAction: function (id) { var d = db(); d.actions.forEach(function (a) { if (a.id === id) a.status = 'closed'; }); save(d); },

    getInvoices: function (cid) {
      return db().invoices.filter(function (i) { return !cid || i.clientId === cid; })
        .sort(function (a, b) { return new Date(b.issued) - new Date(a.issued); });
    },
    addInvoice: function (cid, number, period, amount, due, payLink, file) {
      var d = db(), inv = { id: uid('i'), clientId: cid, number: number, period: period, amount: Number(amount),
        issued: NOW(), at: NOW(), due: due, status: 'due', payLink: payLink || '' };
      if (file) inv.fileId = uid('f');
      d.invoices.push(inv); save(d);
      return file ? IDB.put(inv.fileId, file) : Promise.resolve();
    },
    setInvoiceStatus: function (id, s) { var d = db(); d.invoices.forEach(function (i) { if (i.id === id) { i.status = s; i.at = NOW(); } }); save(d); },

    getAccess: function (cid) { return db().access.filter(function (a) { return a.clientId === cid; }); },
    addAccess: function (cid, tool, level) {
      var d = db();
      d.access.push({ id: uid('x'), clientId: cid, tool: tool, level: level, status: 'requested', at: NOW() });
      d.actions.push({ id: uid('a'), clientId: cid, jobId: null, type: 'access', title: 'Give NOVA access to ' + tool,
        detail: 'We need ' + level + ' in ' + tool + '. Invite us by email from inside ' + tool + '. We never ask for your password, and you can remove our access in one click at any time.',
        due: daysAhead(3), status: 'open', at: NOW() });
      save(d);
    },
    setAccessStatus: function (id, s) { var d = db(); d.access.forEach(function (a) { if (a.id === id) { a.status = s; a.at = NOW(); } }); save(d); },
    getScope: function (cid) { return db().scope.filter(function (s) { return s.clientId === cid; })[0] || { included: [], excluded: [] }; },
    setScope: function (cid, included, excluded) {
      var d = db(), found = false;
      d.scope.forEach(function (s) { if (s.clientId === cid) { s.included = included; s.excluded = excluded; found = true; } });
      if (!found) d.scope.push({ clientId: cid, included: included, excluded: excluded });
      save(d);
    },

    /* ---------------- notification counts ---------------- */
    clientCounts: function (username, cid) {
      var d = db();
      return {
        messages: newerThan(d.messages.filter(function (m) { return m.clientId === cid; }), seenAt(username, cid, 'messages'), function (m) { return m.from === 'nova'; }),
        files: newerThan(d.files.filter(function (f) { return f.clientId === cid; }), seenAt(username, cid, 'files'), function (f) { return f.by === 'nova'; }),
        billing: newerThan(d.invoices.filter(function (i) { return i.clientId === cid && i.status !== 'paid'; }), seenAt(username, cid, 'billing')),
        plan: newerThan(d.access.filter(function (a) { return a.clientId === cid && a.status === 'requested'; }), seenAt(username, cid, 'plan'))
      };
    },
    adminCounts: function (cid) {
      var d = db(), u = 'temi';
      return {
        messages: newerThan(d.messages.filter(function (m) { return m.clientId === cid; }), seenAt(u, cid, 'messages'), function (m) { return m.from === 'client'; }),
        files: newerThan(d.files.filter(function (f) { return f.clientId === cid; }), seenAt(u, cid, 'files'), function (f) { return f.by === 'client'; }),
        asks: d.actions.filter(function (a) { return a.clientId === cid && a.status === 'answered' && new Date(a.resolvedAt || a.at) > new Date(seenAt(u, cid, 'asks')); }).length
      };
    },
    markSeen: markSeen,

    /* ---------- open signup link ---------- */
    getSignupCode: function () {
      var d = db();
      if (!d.signupCode) { d.signupCode = randomHex(10); save(d); }
      return d.signupCode;
    },
    rotateSignupCode: function () { var d = db(); d.signupCode = randomHex(10); save(d); return d.signupCode; },
    signupLink: function () {
      var d = db();
      if (!d.signupCode) { d.signupCode = randomHex(10); save(d); }
      return location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html?join=' + d.signupCode;
    },
    checkSignupCode: function (code) { var d = db(); return !!code && code === d.signupCode; },
    signUp: function (code, info) {
      var d = db();
      if (!this.checkSignupCode(code)) return Promise.resolve({ ok: false, error: 'This sign up link is no longer valid. Ask NOVA for a new one.' });
      if (String(info.password).length < 8) return Promise.resolve({ ok: false, error: 'Use at least 8 characters for the password.' });
      var uname = String(info.username).trim().toLowerCase();
      if (!uname) return Promise.resolve({ ok: false, error: 'Choose a username.' });
      if (d.users.some(function (u) { return u.username.toLowerCase() === uname; }))
        return Promise.resolve({ ok: false, error: 'That username is taken. Try another.' });

      var id = String(info.company).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14) + Math.random().toString(36).slice(2, 5);
      var salt = randomHex(8);
      return hash(info.password, salt).then(function (h) {
        var x = db();
        x.clients.push({ id: id, company: info.company, contact: info.contact, email: info.email,
          plan: 'Not set yet', rate: 0, since: NOW(), siteLink: '', selfSignup: true });
        x.scope.push({ clientId: id, included: [], excluded: [] });
        x.users.push({ username: uname, salt: salt, hash: h, role: 'client',
          firstName: info.firstName || String(info.contact).split(' ')[0], clientId: id, createdAt: NOW() });
        x.messages.push({ id: uid('m'), clientId: id, jobId: null, from: 'nova', author: 'NOVA',
          body: 'Welcome to NOVA. Tell us what you need handled and we will come back within one business day with a written plan and a price.',
          at: NOW() });
        save(x);
        var s = { username: uname, role: 'client', firstName: info.firstName || String(info.contact).split(' ')[0], clientId: id, company: info.company };
        setSession(s);
        return { ok: true, user: s };
      });
    },

    /* ---------- see a client's workspace exactly as they do ---------- */
    startPreview: function (clientId) {
      var d = db(), c = d.clients.filter(function (x) { return x.id === clientId; })[0];
      var u = d.users.filter(function (x) { return x.clientId === clientId; })[0];
      var admin = getSession();
      setSession({ username: u ? u.username : 'preview', role: 'client',
        firstName: u ? u.firstName : (c.contact || 'there').split(' ')[0],
        clientId: clientId, company: c ? c.company : '', preview: true,
        returnTo: admin ? admin.username : 'temi' });
      location.href = 'workspace.html';
    },
    endPreview: function () {
      var d = db(), a = d.users.filter(function (u) { return u.role === 'admin'; })[0];
      setSession({ username: a.username, role: 'admin', firstName: a.firstName, clientId: null, company: null });
      location.href = 'admin.html';
    },

    resetDemo: function () { localStorage.removeItem(KEY); clearSession(); location.href = 'login.html'; }
  };
})();
