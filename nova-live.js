/* ===========================================================
   NOVA workspace, live data layer (Supabase)
   -----------------------------------------------------------
   Presents exactly the same functions as the demo layer, so no
   page had to be rewritten.

   How it works: on sign in we load everything this person is
   allowed to see into memory once. Reads come from that cache,
   which keeps the pages instant. Writes go to Supabase and
   update the cache at the same moment, so the screen never
   waits for the network.

   Requires supabase-js and nova-config.js loaded before it.
   =========================================================== */

var NOVA = (function () {
  var cfg = window.NOVA_CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

  var me = null;          /* signed in profile */
  var previewOf = null;   /* admin looking at a client */
  var C = { clients: [], jobs: [], messages: [], files: [], actions: [],
            invoices: [], access: [], scope: [], seen: [] };

  /* ---------------- shared helpers ---------------- */
  var LANES = {
    finance:    { label: 'Books and finance', color: '#10B981', soft: 'rgba(16,185,129,.13)',  glyph: '◉' },
    data:       { label: 'Data and reporting',color: '#3B82F6', soft: 'rgba(59,130,246,.13)',  glyph: '◈' },
    automation: { label: 'Automation',        color: '#A855F7', soft: 'rgba(168,85,247,.13)',  glyph: '◐' },
    web:        { label: 'Software and web',  color: '#E8572A', soft: 'rgba(232,87,42,.13)',   glyph: '✧' },
    marketing:  { label: 'Marketing',         color: '#F59E0B', soft: 'rgba(245,158,11,.14)',  glyph: '●' },
    other:      { label: 'Other',             color: '#6B7280', soft: 'rgba(107,114,128,.14)', glyph: '◆' }
  };
  function greeting(d) { var h = (d || new Date()).getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function timeAgo(iso) {
    if (!iso) return '';
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
    if (!iso) return 'no date';
    var days = Math.ceil((new Date(iso) - Date.now()) / 86400000);
    if (days < 0) return Math.abs(days) + (Math.abs(days) === 1 ? ' day overdue' : ' days overdue');
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days + ' days';
  }
  function money(n) { return '$' + Number(n || 0).toLocaleString(); }
  function kindOf(name) {
    var e = (String(name).split('.').pop() || '').toLowerCase();
    if (['xlsx','xls','csv','tsv'].indexOf(e) > -1) return 'XLS';
    if (e === 'pdf') return 'PDF';
    if (['mp4','mov','webm','avi','mkv'].indexOf(e) > -1) return 'VID';
    if (['png','jpg','jpeg','gif','webp','svg','heic'].indexOf(e) > -1) return 'IMG';
    if (['doc','docx','txt','md','rtf'].indexOf(e) > -1) return 'DOC';
    if (['zip','rar','7z'].indexOf(e) > -1) return 'ZIP';
    return 'FILE';
  }
  function prettySize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function NOW() { return new Date().toISOString(); }
  function daysAhead(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); }
  function warn(where, error) { if (error) console.error('NOVA ' + where + ':', error.message || error); }

  /* the client id whose data the pages should be showing */
  function scope() { return previewOf || (me && me.client_id) || null; }
  function isAdmin() { return !!(me && me.role === 'admin'); }

  /* ---------------- loading ---------------- */
  function loadAll() {
    return Promise.all([
      sb.from('clients').select('*').order('created_at'),
      sb.from('jobs').select('*').order('created_at'),
      sb.from('messages').select('*').order('created_at'),
      sb.from('files').select('*').order('created_at', { ascending: false }),
      sb.from('actions').select('*').order('due'),
      sb.from('invoices').select('*').order('created_at', { ascending: false }),
      sb.from('access_grants').select('*').order('created_at'),
      sb.from('scope_items').select('*').order('created_at'),
      sb.from('seen_markers').select('*')
    ]).then(function (r) {
      r.forEach(function (x, i) { warn('load ' + i, x.error); });
      C.clients  = r[0].data || [];
      C.jobs     = r[1].data || [];
      C.messages = r[2].data || [];
      C.files    = r[3].data || [];
      C.actions  = r[4].data || [];
      C.invoices = r[5].data || [];
      C.access   = r[6].data || [];
      C.scope    = r[7].data || [];
      C.seen     = r[8].data || [];
    });
  }
  function refresh(table, key) {
    return sb.from(table).select('*').then(function (r) { if (!r.error) C[key] = r.data || []; });
  }

  function loadProfile() {
    return sb.auth.getUser().then(function (u) {
      if (!u.data || !u.data.user) { me = null; return null; }
      var uid = u.data.user.id;
      return sb.from('profiles').select('*').eq('id', uid).maybeSingle().then(function (p) {
        if (p.error || !p.data) { me = null; return null; }
        me = p.data; me.email = u.data.user.email;
        return me;
      });
    });
  }


  /* Create the account, or if the email already has one, sign into it with
     the password they just typed. This is what makes an invitation link
     survive being clicked twice, or a client who already has a workspace
     being invited to a second one. */
  function ensureSession(email, password) {
    var e = String(email).trim();
    return sb.auth.signUp({ email: e, password: password }).then(function (r) {
      if (!r.error) {
        if (r.data && r.data.session) return { ok: true, created: true };
        /* no session means email confirmation is switched on in Supabase */
        return sb.auth.signInWithPassword({ email: e, password: password }).then(function (s2) {
          if (!s2.error) return { ok: true, created: true };
          return { ok: false, error: 'Your account was created. Please confirm your email address, then open this link again.' };
        });
      }
      var m = (r.error.message || '').toLowerCase();
      var exists = m.indexOf('already') > -1 || m.indexOf('registered') > -1 || r.error.status === 422;
      if (!exists) return { ok: false, error: r.error.message };

      return sb.auth.signInWithPassword({ email: e, password: password }).then(function (s2) {
        if (!s2.error) return { ok: true, created: false };
        return { ok: false, needsSignIn: true,
          error: 'This email already has a NOVA account. Sign in with your existing password, or use Forgot password to reset it.' };
      });
    });
  }


  /* ---------------- live updates ----------------
     Subscribes to changes and merges them into the cache, then
     tells the page. Row level security still applies, so a client
     is only ever sent rows belonging to their own workspace. */
  var handlers = [];
  var channel = null;

  function mergeRow(table, row) {
    var key = { messages: 'messages', actions: 'actions', files: 'files',
                invoices: 'invoices', jobs: 'jobs', access_grants: 'access' }[table];
    if (!key) return;
    var list = C[key];
    var at = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === row.id) { at = i; break; } }
    if (at > -1) list[at] = row; else list.push(row);
  }

  /* Realtime is the fast path. Polling is the guarantee. If the socket is
     blocked, a network is unfriendly, or replication is not switched on,
     the poll still finds anything new within a few seconds. */
  var seenIds = {};
  var polling = null;

  function noteExisting() {
    ['messages','actions','files','invoices','jobs','access'].forEach(function (k) {
      C[k].forEach(function (r) { seenIds[k + ':' + r.id] = r.status || r.progress || 1; });
    });
  }

  function emit(table, key, row, isNew) {
    handlers.forEach(function (h) {
      try { h({ table: table, event: isNew ? 'INSERT' : 'UPDATE', row: row }); } catch (e) { console.error(e); }
    });
  }

  function poll() {
    return loadAll().then(function () {
      var map = { messages: 'messages', actions: 'actions', files: 'files',
                  invoices: 'invoices', jobs: 'jobs', access_grants: 'access' };
      Object.keys(map).forEach(function (table) {
        var key = map[table];
        C[key].forEach(function (row) {
          var id = key + ':' + row.id;
          var stamp = row.status || row.progress || 1;
          var known = seenIds[id];
          if (known === undefined) { seenIds[id] = stamp; emit(table, key, row, true); }
          else if (known !== stamp) { seenIds[id] = stamp; emit(table, key, row, false); }
        });
      });
    });
  }

  function startPolling() {
    if (polling) return;
    noteExisting();
    polling = setInterval(function () {
      if (document.hidden && Date.now() % 60000 > 20000) return;  /* ease off when nobody is looking */
      poll();
    }, 12000);
  }

  function startListening() {
    startPolling();
    if (channel || !me) return;
    channel = sb.channel('nova-changes');
    ['messages', 'actions', 'files', 'invoices', 'jobs', 'access_grants'].forEach(function (t) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, function (payload) {
        var row = payload.new || payload.old;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          var key = { messages: 'messages', actions: 'actions', files: 'files',
                      invoices: 'invoices', jobs: 'jobs', access_grants: 'access' }[t];
          if (key) C[key] = C[key].filter(function (x) { return x.id !== row.id; });
        } else {
          mergeRow(t, row);
          var key = { messages: 'messages', actions: 'actions', files: 'files',
                      invoices: 'invoices', jobs: 'jobs', access_grants: 'access' }[t];
          if (key) seenIds[key + ':' + row.id] = row.status || row.progress || 1;
        }
        handlers.forEach(function (h) {
          try { h({ table: t, event: payload.eventType, row: row }); } catch (e) { console.error(e); }
        });
      });
    });
    channel.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        console.log('NOVA: live updates connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('NOVA: live updates unavailable, falling back to checking every few seconds');
      }
    });
  }

  /* ---------------- session shape the pages expect ---------------- */
  function sessionObject() {
    if (!me) return null;
    var cid = scope();
    var c = C.clients.filter(function (x) { return x.id === cid; })[0];
    if (previewOf) {
      return { username: me.id, role: 'client', firstName: (c && c.contact ? c.contact.split(' ')[0] : 'there'),
               clientId: previewOf, company: c ? c.company : '', preview: true };
    }
    return { username: me.id, role: me.role, firstName: me.first_name || 'there',
             clientId: me.client_id, company: c ? c.company : null };
  }

  /* ---------------- seen markers ---------------- */
  function seenAt(userId, clientId, section) {
    var row = C.seen.filter(function (s) {
      return s.user_id === userId && s.client_id === clientId && s.section === section; })[0];
    return row ? row.seen_at : '1970-01-01T00:00:00.000Z';
  }
  function markSeen(_username, clientId, section) {
    if (!me || previewOf) return;
    var now = NOW();
    var hit = false;
    C.seen.forEach(function (s) {
      if (s.user_id === me.id && s.client_id === clientId && s.section === section) { s.seen_at = now; hit = true; }
    });
    if (!hit) C.seen.push({ user_id: me.id, client_id: clientId, section: section, seen_at: now });
    sb.from('seen_markers').upsert({ user_id: me.id, client_id: clientId, section: section, seen_at: now })
      .then(function (r) { warn('markSeen', r.error); });
  }
  function newerThan(list, iso, filterFn) {
    return list.filter(function (x) {
      return new Date(x.created_at) > new Date(iso) && (!filterFn || filterFn(x));
    }).length;
  }

  /* ---------------- shape converters ----------------
     The pages were written against the demo field names, so we
     translate here rather than touching every page.           */
  function job(r) {
    return { id: r.id, clientId: r.client_id, name: r.name, lane: r.lane, stage: r.stage,
             progress: r.progress, next: r.next_step, priority: r.priority, at: r.created_at };
  }
  function msg(r) {
    return { id: r.id, clientId: r.client_id, jobId: r.job_id, from: r.sender,
             author: r.author, body: r.body, at: r.created_at };
  }
  function file(r) {
    return { id: r.id, clientId: r.client_id, jobId: r.job_id, name: r.name, kind: r.kind,
             tag: r.tag, by: r.uploaded_by, size: r.size_label, path: r.path, at: r.created_at };
  }
  function action(r) {
    return { id: r.id, clientId: r.client_id, jobId: r.job_id, type: r.type, title: r.title,
             detail: r.detail, due: r.due, status: r.status, response: r.response,
             resolvedAt: r.resolved_at, at: r.created_at };
  }
  function invoice(r) {
    return { id: r.id, clientId: r.client_id, number: r.number, period: r.period, amount: Number(r.amount),
             due: r.due, status: r.status, payLink: r.pay_link, fileId: r.path ? r.id : null,
             path: r.path, issued: r.created_at, at: r.created_at };
  }
  function grant(r) {
    return { id: r.id, clientId: r.client_id, tool: r.tool, level: r.level, status: r.status, at: r.created_at };
  }
  function client(r) {
    return { id: r.id, company: r.company, contact: r.contact, email: r.email, plan: r.plan,
             rate: Number(r.rate || 0), since: r.created_at, siteLink: r.site_link || '', selfSignup: r.self_signup };
  }

  return {
    MODE: 'live', LANES: LANES,
    greeting: greeting, timeAgo: timeAgo, dueIn: dueIn, money: money,
    kindOf: kindOf, prettySize: prettySize,
    lane: function (k) { return LANES[k] || LANES.other; },

    /* ---------- session ---------- */
    ready: function () {
      return loadProfile().then(function (p) {
        if (!p) return null;
        var pv = sessionStorage.getItem('nova_preview');
        if (pv && p.role === 'admin') previewOf = pv;
        return loadAll().then(function () { startListening(); });
      });
    },
    getSession: sessionObject,
    requireAuth: function (role) {
      var s = sessionObject();
      if (!s) { location.href = 'login.html'; return null; }
      if (role && s.role !== role) { location.href = s.role === 'admin' ? 'admin.html' : 'workspace.html'; return null; }
      return s;
    },
    signIn: function (email, password) {
      return sb.auth.signInWithPassword({ email: String(email).trim(), password: password })
        .then(function (r) {
          if (r.error) return { ok: false, error: 'That email and password do not match.' };
          return loadProfile().then(function (p) {
            if (!p) return { ok: false, error: 'This account has no workspace attached yet. Contact NOVA.' };
            return loadAll().then(function () { return { ok: true, user: sessionObject() }; });
          });
        });
    },
    signOut: function () { sb.auth.signOut().then(function () { location.href = 'login.html'; }); },
    resetPassword: function (email) {
      return sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: cfg.SITE_URL + '/login.html' });
    },

    /* ---------- invitations ---------- */
    createClient: function (company, contact, email, plan, rate, firstName) {
      var token = crypto.randomUUID().replace(/-/g, '');
      return sb.from('clients').insert({ company: company, contact: contact, email: email,
        plan: plan || 'Not set yet', rate: Number(rate) || 0 }).select().single()
        .then(function (r) {
          if (r.error) throw r.error;
          C.clients.push(r.data);
          return sb.from('invites').insert({ token: token, client_id: r.data.id,
            first_name: firstName, email: email, expires_at: daysAhead(7) })
            .then(function (i) {
              if (i.error) throw i.error;
              return { clientId: r.data.id, token: token, link: cfg.SITE_URL + '/login.html?invite=' + token };
            });
        });
    },
    getInvite: function (token) {
      return sb.from('invites').select('*, clients(company)').eq('token', token).maybeSingle()
        .then(function (r) {
          if (r.error || !r.data) return { ok: false, error: 'This invitation link is not valid.' };
          if (r.data.used) return { ok: false, error: 'This invitation has already been used. Sign in instead.' };
          if (new Date(r.data.expires_at) < Date.now()) return { ok: false, error: 'This invitation has expired. Ask NOVA for a new one.' };
          return { ok: true, invite: { username: r.data.email, firstName: r.data.first_name, email: r.data.email },
                   company: r.data.clients ? r.data.clients.company : '' };
        });
    },
    acceptInvite: function (token, password, email) {
      if (String(password).length < 8) return Promise.resolve({ ok: false, error: 'Use at least 8 characters.' });
      return ensureSession(email, password).then(function (s) {
        if (!s.ok) return s;
        return sb.rpc('redeem_invite', { p_token: token }).then(function (x) {
          if (x.error) return { ok: false, error: x.error.message };
          return loadProfile().then(loadAll).then(function () { return { ok: true, user: sessionObject() }; });
        });
      });
    },
    reissueInvite: function (clientId, _u, firstName, email) {
      var token = crypto.randomUUID().replace(/-/g, '');
      return sb.from('invites').insert({ token: token, client_id: clientId, first_name: firstName,
        email: email, expires_at: daysAhead(7) })
        .then(function () { return { token: token, link: cfg.SITE_URL + '/login.html?invite=' + token }; });
    },
    getInvitesFor: function (clientId) { return []; },

    /* ---------- open sign up ---------- */
    signupLink: function () {
      return sb.from('signup_codes').select('code').eq('active', true).limit(1).maybeSingle()
        .then(function (r) { return cfg.SITE_URL + '/login.html?join=' + (r.data ? r.data.code : ''); });
    },
    checkSignupCode: function (code) {
      return sb.from('signup_codes').select('code').eq('code', code).eq('active', true).maybeSingle()
        .then(function (r) { return !!(r.data); });
    },
    rotateSignupCode: function () {
      var code = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      return sb.from('signup_codes').update({ active: false }).eq('active', true)
        .then(function () { return sb.from('signup_codes').insert({ code: code, active: true }); })
        .then(function () { return code; });
    },
    signUp: function (code, info) {
      if (String(info.password).length < 8) return Promise.resolve({ ok: false, error: 'Use at least 8 characters for the password.' });
      return ensureSession(info.email, info.password).then(function (s) {
        if (!s.ok) return s;
        return sb.rpc('redeem_signup', { p_code: code, p_company: info.company,
          p_contact: info.contact, p_email: info.email, p_first: info.firstName }).then(function (x) {
          if (x.error) return { ok: false, error: x.error.message, existing: true };
          return loadProfile().then(loadAll).then(function () { return { ok: true, user: sessionObject() }; });
        });
      });
    },

    /* ---------- reads, all from the cache ---------- */
    getClients: function () {
      var uid = me ? me.id : '';
      return C.clients.map(function (r) {
        var c = client(r);
        var jobs = C.jobs.filter(function (j) { return j.client_id === c.id; });
        var msgs = C.messages.filter(function (m) { return m.client_id === c.id; });
        var acts = C.actions.filter(function (a) { return a.client_id === c.id; });
        var fls  = C.files.filter(function (f) { return f.client_id === c.id; });
        var newMsgs  = newerThan(msgs, seenAt(uid, c.id, 'messages'), function (m) { return m.sender === 'client'; });
        var newFiles = newerThan(fls,  seenAt(uid, c.id, 'files'),    function (f) { return f.uploaded_by === 'client'; });
        var replied  = acts.filter(function (a) {
          return a.status === 'answered' && new Date(a.resolved_at || a.created_at) > new Date(seenAt(uid, c.id, 'asks')); }).length;
        var overdue = C.invoices.filter(function (i) {
          return i.client_id === c.id && i.status !== 'paid' && new Date(i.due) < Date.now(); }).length;
        var last = msgs.concat(fls).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
        c.jobCount = jobs.length; c.newMsgs = newMsgs; c.newFiles = newFiles; c.replied = replied;
        c.overdue = overdue; c.openActions = acts.filter(function (a) { return a.status === 'open'; }).length;
        c.totalNew = newMsgs + newFiles + replied;
        c.hasAccount = true;   /* they exist in auth, or the invite is still open */
        c.lastActivity = last ? last.created_at : c.since;
        return c;
      });
    },
    getClient: function (id) { var r = C.clients.filter(function (c) { return c.id === id; })[0]; return r ? client(r) : null; },
    updateClient: function (id, patch) {
      var row = {};
      if ('siteLink' in patch) row.site_link = patch.siteLink;
      if ('plan' in patch) row.plan = patch.plan;
      if ('rate' in patch) row.rate = patch.rate;
      C.clients.forEach(function (c) { if (c.id === id) { for (var k in row) c[k] = row[k]; } });
      return sb.from('clients').update(row).eq('id', id).then(function (r) { warn('updateClient', r.error); });
    },

    getJobs: function (cid) { return C.jobs.filter(function (j) { return j.client_id === cid; }).map(job); },
    getJob: function (id) { var r = C.jobs.filter(function (j) { return j.id === id; })[0]; return r ? job(r) : null; },
    addJob: function (cid, name, lane, stage, next) {
      var row = { client_id: cid, name: name, lane: lane || 'other', stage: stage || 'Getting started',
                  progress: 0, next_step: next || 'Kick off', priority: 'normal' };
      return sb.from('jobs').insert(row).select().single().then(function (r) {
        if (r.error) { warn('addJob', r.error); return; } C.jobs.push(r.data);
      });
    },
    updateJob: function (id, patch) {
      var row = {};
      if ('progress' in patch) row.progress = patch.progress;
      if ('next' in patch) row.next_step = patch.next;
      if ('lane' in patch) row.lane = patch.lane;
      if ('priority' in patch) row.priority = patch.priority;
      if ('stage' in patch) row.stage = patch.stage;
      C.jobs.forEach(function (j) { if (j.id === id) { for (var k in row) j[k] = row[k]; } });
      return sb.from('jobs').update(row).eq('id', id).then(function (r) { warn('updateJob', r.error); });
    },
    removeJob: function (id) {
      C.jobs = C.jobs.filter(function (j) { return j.id !== id; });
      return sb.from('jobs').delete().eq('id', id).then(function (r) { warn('removeJob', r.error); });
    },

    getMessages: function (cid, jid) {
      return C.messages.filter(function (m) { return m.client_id === cid && (!jid || m.job_id === jid); })
        .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); }).map(msg);
    },
    sendMessage: function (cid, jid, from, author, body) {
      var row = { client_id: cid, job_id: jid || null, sender: from, author: author, body: body };
      var optimistic = Object.assign({ id: 'tmp' + Math.random(), created_at: NOW() }, row);
      C.messages.push(optimistic);
      return sb.from('messages').insert(row).select().single().then(function (r) {
        if (r.error) { warn('sendMessage', r.error); return; }
        C.messages = C.messages.filter(function (m) { return m.id !== optimistic.id; });
        C.messages.push(r.data);
      });
    },

    getFiles: function (cid, jid, tag) {
      return C.files.filter(function (f) {
        return f.client_id === cid && (!jid || f.job_id === jid) && (!tag || f.tag === tag);
      }).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); }).map(file);
    },
    addFile: function (cid, jid, f, by, tag) {
      var path = cid + '/' + Date.now() + '-' + f.name.replace(/[^\w.\-]/g, '_');
      return sb.storage.from('client-files').upload(path, f).then(function (up) {
        if (up.error) { warn('upload', up.error); throw up.error; }
        return sb.from('files').insert({ client_id: cid, job_id: jid || null, name: f.name,
          kind: kindOf(f.name), tag: tag || (by === 'nova' ? 'deliverable' : 'input'),
          uploaded_by: by, size_label: prettySize(f.size), path: path }).select().single();
      }).then(function (r) { if (!r.error) C.files.unshift(r.data); return r.data ? r.data.id : null; });
    },
    fileURL: function (id) {
      var r = C.files.filter(function (f) { return f.id === id; })[0]
           || C.invoices.filter(function (i) { return i.id === id; })[0];
      if (!r || !r.path) return Promise.resolve(null);
      return sb.storage.from('client-files').createSignedUrl(r.path, 300)
        .then(function (x) { return x.data ? x.data.signedUrl : null; });
    },

    getActions: function (cid, openOnly) {
      return C.actions.filter(function (a) { return a.client_id === cid && (!openOnly || a.status === 'open'); })
        .sort(function (a, b) { return new Date(a.due) - new Date(b.due); }).map(action);
    },
    addAction: function (cid, jid, type, title, detail, due) {
      var row = { client_id: cid, job_id: jid || null, type: type, title: title,
                  detail: detail, due: due || daysAhead(3), status: 'open' };
      return sb.from('actions').insert(row).select().single().then(function (r) {
        if (r.error) { warn('addAction', r.error); return; } C.actions.push(r.data);
      });
    },
    resolveAction: function (id, response, status) {
      var row = { status: status || 'answered', response: response || '', resolved_at: NOW() };
      C.actions.forEach(function (a) { if (a.id === id) { for (var k in row) a[k] = row[k]; } });
      return sb.from('actions').update(row).eq('id', id).then(function (r) { warn('resolveAction', r.error); });
    },
    closeAction: function (id) {
      C.actions.forEach(function (a) { if (a.id === id) a.status = 'closed'; });
      return sb.from('actions').update({ status: 'closed' }).eq('id', id).then(function (r) { warn('closeAction', r.error); });
    },

    getInvoices: function (cid) {
      return C.invoices.filter(function (i) { return !cid || i.client_id === cid; })
        .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); }).map(invoice);
    },
    addInvoice: function (cid, number, period, amount, due, payLink, f) {
      var doUpload = f
        ? sb.storage.from('client-files').upload(cid + '/invoice-' + Date.now() + '-' + f.name.replace(/[^\w.\-]/g, '_'), f)
            .then(function (u) { return u.error ? null : u.data.path; })
        : Promise.resolve(null);
      return doUpload.then(function (path) {
        return sb.from('invoices').insert({ client_id: cid, number: number, period: period,
          amount: Number(amount), due: due, pay_link: payLink || '', path: path }).select().single();
      }).then(function (r) { if (!r.error) C.invoices.unshift(r.data); warn('addInvoice', r.error); });
    },
    setInvoiceStatus: function (id, s) {
      C.invoices.forEach(function (i) { if (i.id === id) i.status = s; });
      return sb.from('invoices').update({ status: s }).eq('id', id).then(function (r) { warn('invoiceStatus', r.error); });
    },

    getAccess: function (cid) { return C.access.filter(function (a) { return a.client_id === cid; }).map(grant); },
    addAccess: function (cid, tool, level) {
      return sb.from('access_grants').insert({ client_id: cid, tool: tool, level: level, status: 'requested' })
        .select().single().then(function (r) {
          if (!r.error) C.access.push(r.data);
          return sb.from('actions').insert({ client_id: cid, type: 'access',
            title: 'Give NOVA access to ' + tool,
            detail: 'We need ' + level + ' in ' + tool + '. Invite us by email from inside ' + tool +
                    '. We never ask for your password, and you can remove our access in one click at any time.',
            due: daysAhead(3), status: 'open' }).select().single();
        }).then(function (r) { if (r && !r.error) C.actions.push(r.data); });
    },
    setAccessStatus: function (id, s) {
      C.access.forEach(function (a) { if (a.id === id) a.status = s; });
      return sb.from('access_grants').update({ status: s }).eq('id', id).then(function (r) { warn('accessStatus', r.error); });
    },

    getScope: function (cid) {
      var rows = C.scope.filter(function (s) { return s.client_id === cid; });
      return { included: rows.filter(function (r) { return r.included; }).map(function (r) { return r.text; }),
               excluded: rows.filter(function (r) { return !r.included; }).map(function (r) { return r.text; }) };
    },
    setScope: function (cid, included, excluded) {
      C.scope = C.scope.filter(function (s) { return s.client_id !== cid; });
      var rows = included.map(function (t) { return { client_id: cid, included: true, text: t }; })
        .concat(excluded.map(function (t) { return { client_id: cid, included: false, text: t }; }));
      rows.forEach(function (r) { C.scope.push(Object.assign({ id: 'tmp' + Math.random(), created_at: NOW() }, r)); });
      return sb.from('scope_items').delete().eq('client_id', cid).then(function () {
        return rows.length ? sb.from('scope_items').insert(rows) : null;
      }).then(function () { return refresh('scope_items', 'scope'); });
    },

    /* ---------- notification counts ---------- */
    clientCounts: function (_u, cid) {
      var uid = me ? me.id : '';
      return {
        messages: newerThan(C.messages.filter(function (m) { return m.client_id === cid; }), seenAt(uid, cid, 'messages'), function (m) { return m.sender === 'nova'; }),
        files:    newerThan(C.files.filter(function (f) { return f.client_id === cid; }), seenAt(uid, cid, 'files'), function (f) { return f.uploaded_by === 'nova'; }),
        billing:  newerThan(C.invoices.filter(function (i) { return i.client_id === cid && i.status !== 'paid'; }), seenAt(uid, cid, 'billing')),
        plan:     newerThan(C.access.filter(function (a) { return a.client_id === cid && a.status === 'requested'; }), seenAt(uid, cid, 'plan'))
      };
    },
    adminCounts: function (cid) {
      var uid = me ? me.id : '';
      return {
        messages: newerThan(C.messages.filter(function (m) { return m.client_id === cid; }), seenAt(uid, cid, 'messages'), function (m) { return m.sender === 'client'; }),
        files:    newerThan(C.files.filter(function (f) { return f.client_id === cid; }), seenAt(uid, cid, 'files'), function (f) { return f.uploaded_by === 'client'; }),
        asks:     C.actions.filter(function (a) { return a.client_id === cid && a.status === 'answered' && new Date(a.resolved_at || a.created_at) > new Date(seenAt(uid, cid, 'asks')); }).length
      };
    },
    markSeen: markSeen,

    /* ---------- preview ---------- */
    startPreview: function (clientId) {
      sessionStorage.setItem('nova_preview', clientId);
      location.href = 'workspace.html';
    },
    endPreview: function () { sessionStorage.removeItem('nova_preview'); location.href = 'admin.html'; },
    _restorePreview: function () {
      var p = sessionStorage.getItem('nova_preview');
      if (p && isAdmin()) previewOf = p;
    },

    onChange: function (fn) { handlers.push(fn); return function () { handlers = handlers.filter(function (h) { return h !== fn; }); }; },
    isPreview: function () { return !!previewOf; },
    reload: function () { return poll(); },
    resetDemo: function () { location.href = 'login.html'; }
  };
})();
