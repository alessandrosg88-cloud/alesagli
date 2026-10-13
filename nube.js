// nube.js — conexión con Google Firebase (Authentication + Cloud Firestore) por su API REST.
// No carga nada de terceros: solo habla con los servidores de Google.
// Ofrece la misma forma de uso que tenía el cliente de Supabase ({ data, error }),
// así el resto de la app apenas cambia.
// Migración: la primera vez que alguien entra con una cuenta antigua de Supabase,
// se crea su cuenta en Firebase con el mismo correo y contraseña y se copian sus datos.
(function () {
  'use strict';

  function NubeError(message, code) { var e = new Error(message); e.code = code || message; return e; }

  // Mensajes con el mismo texto que daba Supabase, para que la app los siga traduciendo igual.
  var MENSAJES = {
    INVALID_LOGIN_CREDENTIALS: 'Invalid login credentials',
    EMAIL_NOT_FOUND: 'Invalid login credentials',
    INVALID_PASSWORD: 'Invalid login credentials',
    EMAIL_EXISTS: 'User already registered',
    WEAK_PASSWORD: 'Password should be at least 6 characters',
    INVALID_EMAIL: 'Email address is invalid',
    MISSING_EMAIL: 'Email address is invalid',
    MISSING_PASSWORD: 'Invalid login credentials',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Email rate limit exceeded',
    USER_DISABLED: 'Esta cuenta está desactivada.',
    CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'Por seguridad, cierra sesión, vuelve a entrar y repite el cambio.',
    NETWORK: 'Sin conexión. Revisa tu internet e inténtalo de nuevo.'
  };
  function authErr(e) { var c = (e && e.code) || ''; return { message: MENSAJES[c] || (e && e.message) || 'Error', code: c }; }

  function decodeJwt(t) {
    try {
      var p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(atob(p).split('').map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')));
    } catch (e) { return {}; }
  }
  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  // ---------- valores de Firestore <-> JSON ----------
  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return isFinite(v) && Number.isInteger(v) && Math.abs(v) < 9e15 ? { integerValue: String(v) } : { doubleValue: isFinite(v) ? v : 0 };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    if (typeof v === 'object') { var f = {}; for (var k in v) if (v[k] !== undefined) f[k] = enc(v[k]); return { mapValue: { fields: f } }; }
    return { stringValue: String(v) };
  }
  function dec(v) {
    if (!v) return null;
    if ('nullValue' in v) return null;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('stringValue' in v) return v.stringValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return decFields(v.mapValue.fields);
    return null;
  }
  function decFields(f) { var o = {}; for (var k in (f || {})) o[k] = dec(f[k]); return o; }
  // Las columnas «data» (JSON libre) se guardan como texto en «data_json», porque
  // Firestore no admite listas dentro de listas.
  function encRow(row) {
    var f = {};
    for (var k in row) {
      if (row[k] === undefined) continue;
      if (k === 'data') f.data_json = { stringValue: JSON.stringify(row[k]) };
      else f[k] = enc(row[k]);
    }
    return f;
  }
  function decRow(doc) {
    var o = decFields(doc.fields);
    if ('data_json' in o) { try { o.data = JSON.parse(o.data_json); } catch (e) { o.data = null; } delete o.data_json; }
    if (!('id' in o) && doc.name) o.id = doc.name.split('/').pop();
    return o;
  }
  function maskOf(fields) { return Object.keys(fields).map(function (k) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : '`' + k.replace(/`/g, '\\`') + '`'; }); }

  window.crearNube = function (cfg) {
    var KEY = cfg.apiKey;
    var AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:';
    var TOKEN = 'https://securetoken.googleapis.com/v1/token?key=' + KEY;
    var ROOT = 'projects/' + cfg.projectId + '/databases/(default)/documents';
    var FS = 'https://firestore.googleapis.com/v1/' + ROOT;
    var SKEY = cfg.storageKey;
    var SINGLE = cfg.single || [];   // tablas con una sola fila por persona
    var tok = null;                   // { idToken, refreshToken, exp, uid, email, authTime }
    var user = null;                  // { id, email, user_metadata, last_sign_in_at }
    var listeners = [];
    var initDone = false;
    var refreshing = null;

    // ---------- red ----------
    async function post(url, body, form) {
      var r;
      try {
        r = await fetch(url, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: form ? body : JSON.stringify(body) });
      } catch (e) { throw NubeError('Failed to fetch', 'NETWORK'); }
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) { var m = (j.error && j.error.message) || ('HTTP ' + r.status); throw NubeError(m, String(m).split(/[ :]/)[0]); }
      return j;
    }
    async function fsReq(method, path, body, query) {
      var t = await getToken();
      var url = FS + (path ? (path.charAt(0) === ':' ? path : '/' + path) : '') + (query ? '?' + query : '');
      var r;
      try {
        r = await fetch(url, { method: method, headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      } catch (e) { throw NubeError('Failed to fetch', 'NETWORK'); }
      if (r.status === 404 && method === 'GET') return null;
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        var err = Array.isArray(j) ? j[0] && j[0].error : j.error;
        throw NubeError((err && err.message) || ('HTTP ' + r.status), (err && err.status) || String(r.status));
      }
      return j;
    }

    // ---------- tokens y sesión ----------
    function readSaved() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } }
    function save() {
      try {
        if (tok) localStorage.setItem(SKEY, JSON.stringify({ refreshToken: tok.refreshToken, uid: tok.uid, email: tok.email, meta: user ? user.user_metadata : {}, authTime: tok.authTime }));
        else localStorage.removeItem(SKEY);
      } catch (e) {}
    }
    function setTokens(idToken, refreshToken) {
      var p = decodeJwt(idToken);
      tok = { idToken: idToken, refreshToken: refreshToken, exp: (p.exp || 0) * 1000, uid: p.user_id || p.sub, email: p.email || '', authTime: (p.auth_time || 0) * 1000 };
    }
    async function refresh() {
      if (!tok) throw NubeError('Not signed in', 'NO_SESSION');
      if (!refreshing) {
        refreshing = (async function () {
          try {
            var j = await post(TOKEN, 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(tok.refreshToken), true);
            setTokens(j.id_token, j.refresh_token);
            save();
          } catch (e) {
            if (e.code !== 'NETWORK') { tok = null; user = null; save(); emit('SIGNED_OUT'); }
            throw e;
          } finally { refreshing = null; }
        })();
      }
      return refreshing;
    }
    async function getToken() {
      if (!tok) throw NubeError('Not signed in', 'NO_SESSION');
      if (!tok.idToken || Date.now() > tok.exp - 60000) await refresh();
      return tok.idToken;
    }
    function session() { return user ? { user: user, access_token: tok && tok.idToken } : null; }
    function emit(ev) {
      var s = session();
      listeners.slice().forEach(function (cb) { try { cb(ev, s); } catch (e) { console.error(e); } });
    }
    function metaFrom(doc) {
      var m = {};
      var f = (doc && doc.fields) || {};
      for (var k in f) if (k.indexOf('m_') === 0) { try { m[k.slice(2)] = JSON.parse(dec(f[k])); } catch (e) {} }
      return m;
    }
    // Carga los datos de la cuenta (preferencias guardadas) y comprueba si se cerró sesión en todos los dispositivos.
    async function loadUser() {
      var doc = await fsReq('GET', 'users/' + tok.uid);
      var revokedAt = doc && doc.fields && doc.fields.revokedAt ? dec(doc.fields.revokedAt) : 0;
      if (revokedAt && tok.authTime && revokedAt > tok.authTime) { tok = null; user = null; save(); throw NubeError('Session revoked', 'REVOKED'); }
      user = { id: tok.uid, email: tok.email, user_metadata: metaFrom(doc), last_sign_in_at: tok.authTime ? new Date(tok.authTime).toISOString() : null };
      save();
      return doc;
    }
    async function startSession(idToken, refreshToken, email, password, legacySession) {
      setTokens(idToken, refreshToken);
      save();
      if (cfg.legacy && password) await maybeMigrate(email, password, legacySession);
      try { await loadUser(); }
      catch (e) {
        if (e.code === 'REVOKED') throw e;
        user = { id: tok.uid, email: tok.email, user_metadata: (readSaved() || {}).meta || {}, last_sign_in_at: tok.authTime ? new Date(tok.authTime).toISOString() : null };
      }
    }

    var ready = (async function init() {
      var saved = readSaved();
      if (saved && saved.refreshToken) {
        tok = { idToken: null, refreshToken: saved.refreshToken, exp: 0, uid: saved.uid, email: saved.email, authTime: saved.authTime || 0 };
        try { await refresh(); await loadUser(); }
        catch (e) {
          if (e.code === 'NETWORK' && tok) {
            // Sin conexión: seguimos con la sesión guardada; la app usará su copia local.
            user = { id: saved.uid, email: saved.email, user_metadata: saved.meta || {}, last_sign_in_at: saved.authTime ? new Date(saved.authTime).toISOString() : null };
          } else { tok = null; user = null; save(); }
        }
      }
      initDone = true;
      emit('INITIAL_SESSION');
    })();

    // ---------- migración desde Supabase (solo una vez por cuenta) ----------
    var L = cfg.legacy;
    async function legacyFetch(method, path, body, token) {
      var r;
      try {
        r = await fetch(L.url + path, { method: method, headers: { 'apikey': L.key, 'Authorization': 'Bearer ' + (token || L.key), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      } catch (e) { throw NubeError('Failed to fetch', 'NETWORK'); }
      var j = await r.json().catch(function () { return null; });
      if (!r.ok) throw NubeError((j && (j.msg || j.message || j.error_description)) || ('HTTP ' + r.status), r.status >= 500 ? 'NETWORK' : 'LEGACY_' + r.status);
      return j;
    }
    async function legacyLogin(email, password) {
      return legacyFetch('POST', '/auth/v1/token?grant_type=password', { email: email, password: password });
    }
    async function maybeMigrate(email, password, s) {
      var doc;
      try { doc = await fsReq('GET', 'users/' + tok.uid); } catch (e) { return; }
      if (doc && doc.fields && doc.fields.migrado) return;
      try { s = s || await legacyLogin(email, password); }
      catch (e) {
        if (e.code === 'NETWORK') return;   // se reintentará la próxima vez
        try { await api.mergeDoc('users/' + tok.uid, { migrado: 'sin-cuenta-antigua', email: tok.email }); } catch (e2) {}
        return;
      }
      try {
        var ctx = {
          legacyUser: s.user,
          get: function (path) { return legacyFetch('GET', '/rest/v1/' + path, null, s.access_token); }
        };
        await L.importar(api, ctx);
        if (s.user && s.user.user_metadata) {
          var m = Object.assign({}, s.user.user_metadata);
          ['email', 'email_verified', 'phone_verified', 'sub'].forEach(function (k) { delete m[k]; });
          if (Object.keys(m).length) await setMeta(m);
        }
        await api.mergeDoc('users/' + tok.uid, { migrado: new Date().toISOString(), email: tok.email });
      } catch (e) { console.warn('No se pudieron copiar los datos antiguos; se reintentará al volver a entrar.', e); }
      legacyFetch('POST', '/auth/v1/logout?scope=local', {}, s.access_token).catch(function () {});
    }

    async function setMeta(data) {
      var f = {};
      for (var k in data) f['m_' + k] = JSON.stringify(data[k] === undefined ? null : data[k]);
      await api.mergeDoc('users/' + tok.uid, f);
      if (user) for (var k2 in data) user.user_metadata[k2] = data[k2];
      save();
    }

    // ---------- Firestore: utilidades ----------
    var api = {
      uid: function () { return tok && tok.uid; },
      email: function () { return tok && tok.email; },
      name: function (path) { return ROOT + '/' + path; },
      randomId: randomId,
      enc: enc, dec: dec, encRow: encRow, decRow: decRow,
      getRaw: function (path) { return fsReq('GET', path); },
      getDoc: async function (path) { var d = await fsReq('GET', path); return d ? decRow(d) : null; },
      setDoc: function (path, row) { return fsReq('PATCH', path, { fields: encRow(row) }); },
      mergeDoc: function (path, row) {
        var f = encRow(row);
        return fsReq('PATCH', path, { fields: f }, maskOf(f).map(function (m) { return 'updateMask.fieldPaths=' + encodeURIComponent(m); }).join('&'));
      },
      delDoc: function (path) { return fsReq('DELETE', path); },
      listDocs: async function (coll) {
        var out = [], pageToken = '';
        do {
          var j = await fsReq('GET', coll, null, 'pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
          ((j && j.documents) || []).forEach(function (d) { out.push(decRow(d)); });
          pageToken = j && j.nextPageToken;
        } while (pageToken);
        return out;
      },
      commit: function (writes) { return fsReq('POST', ':commit', { writes: writes }); },
      runQuery: async function (structuredQuery) {
        var j = await fsReq('POST', ':runQuery', { structuredQuery: structuredQuery });
        return (j || []).filter(function (x) { return x.document; }).map(function (x) { return x.document; });
      },
      // Sustituye todos los documentos de una colección por «rows» (conservando sus id).
      replaceList: async function (coll, rows) {
        var old = await api.listDocs(coll);
        var writes = old.map(function (d) { return { delete: ROOT + '/' + coll + '/' + d.id }; });
        rows.forEach(function (r) { var id = String(r.id || randomId()); writes.push({ update: { name: ROOT + '/' + coll + '/' + id, fields: encRow(Object.assign({}, r, { id: id })) } }); });
        for (var i = 0; i < writes.length; i += 400) await api.commit(writes.slice(i, i + 400));
      }
    };

    // ---------- consultas al estilo Supabase: sb.from('tabla')... ----------
    function Q(table) { this.t = table; this.op = 'select'; this.f = {}; this.ret = false; this.one = null; }
    Q.prototype.select = function () { if (this.op !== 'select') this.ret = true; return this; };
    Q.prototype.eq = function (k, v) { this.f[k] = v; return this; };
    Q.prototype.order = function () { return this; };
    Q.prototype.maybeSingle = function () { this.one = 'maybe'; return this; };
    Q.prototype.single = function () { this.one = 'single'; return this; };
    Q.prototype.insert = function (rows) { this.op = 'insert'; this.rows = rows; return this; };
    Q.prototype.upsert = function (rows) { this.op = 'upsert'; this.rows = rows; return this; };
    Q.prototype.update = function (vals) { this.op = 'update'; this.vals = vals; return this; };
    Q.prototype.delete = function () { this.op = 'delete'; return this; };
    Q.prototype.then = function (res, rej) {
      var q = this;
      return run(q).then(function (data) { return { data: data, error: null }; }, function (e) { return { data: null, error: { message: e.message, code: e.code } }; }).then(res, rej);
    };
    async function run(q) {
      var uid = api.uid();
      if (!uid) throw NubeError('Not signed in', 'NO_SESSION');
      if (q.f.user_id !== undefined && q.f.user_id !== uid) throw NubeError('Permission denied', 'PERMISSION_DENIED');
      if (SINGLE.indexOf(q.t) >= 0) {
        var path = 'users/' + uid + '/tablas/' + q.t;
        if (q.op === 'select') { var d = await api.getDoc(path); return q.one ? d : (d ? [d] : []); }
        if (q.op === 'insert' || q.op === 'upsert') { var row = Array.isArray(q.rows) ? q.rows[0] : q.rows; await api.mergeDoc(path, Object.assign({}, row, { user_id: uid })); return q.ret ? row : null; }
        if (q.op === 'update') { await api.mergeDoc(path, q.vals); return null; }
        if (q.op === 'delete') { await api.delDoc(path); return null; }
      }
      var coll = 'users/' + uid + '/' + q.t;
      if (q.op === 'select') {
        var rows;
        if (q.f.id !== undefined) { var one = await api.getDoc(coll + '/' + q.f.id); rows = one ? [one] : []; }
        else rows = await api.listDocs(coll);
        rows.sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
        return q.one ? (rows[0] || null) : rows;
      }
      if (q.op === 'insert' || q.op === 'upsert') {
        var list = Array.isArray(q.rows) ? q.rows : [q.rows];
        var base = Date.now();
        var made = list.map(function (r, i) { return Object.assign({ created_at: new Date(base + i).toISOString() }, r, { id: String(r.id || randomId()), user_id: uid }); });
        await api.commit(made.map(function (r) { return { update: { name: api.name(coll + '/' + r.id), fields: encRow(r) } }; }));
        if (!q.ret) return null;
        return (q.one || !Array.isArray(q.rows)) ? made[0] : made;
      }
      var targets = q.f.id !== undefined ? [String(q.f.id)] : (await api.listDocs(coll)).map(function (r) { return r.id; });
      if (!targets.length) return null;
      if (q.op === 'update') {
        var f = encRow(q.vals);
        try {
          await api.commit(targets.map(function (id) { return { update: { name: api.name(coll + '/' + id), fields: f }, updateMask: { fieldPaths: maskOf(f) }, currentDocument: { exists: true } }; }));
        } catch (e) { if (e.code !== 'NOT_FOUND') throw e; }
        return null;
      }
      if (q.op === 'delete') {
        await api.commit(targets.map(function (id) { return { delete: api.name(coll + '/' + id) }; }));
        return null;
      }
      return null;
    }

    // ---------- autenticación al estilo Supabase: sb.auth... ----------
    var auth = {
      getSession: async function () { await ready; return { data: { session: session() }, error: null }; },
      onAuthStateChange: function (cb) {
        listeners.push(cb);
        if (initDone) setTimeout(function () { cb('INITIAL_SESSION', session()); }, 0);
        return { data: { subscription: { unsubscribe: function () { listeners = listeners.filter(function (x) { return x !== cb; }); } } } };
      },
      signInWithPassword: async function (o) {
        var email = String(o.email || '').trim(), password = o.password || '';
        try {
          var r;
          try { r = await post(AUTH + 'signInWithPassword?key=' + KEY, { email: email, password: password, returnSecureToken: true }); }
          catch (e) {
            if (!(L && /INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(e.code))) throw e;
            // ¿Cuenta antigua de Supabase? Si la contraseña es correcta allí, creamos la cuenta en Firebase.
            var s;
            try { s = await legacyLogin(email, password); } catch (e2) { throw e2.code === 'NETWORK' ? e2 : e; }
            try { r = await post(AUTH + 'signUp?key=' + KEY, { email: email, password: password, returnSecureToken: true }); }
            catch (e3) { throw e3.code === 'EMAIL_EXISTS' ? e : e3; }
            await startSession(r.idToken, r.refreshToken, email, password, s);
            emit('SIGNED_IN');
            return { data: { user: user, session: session() }, error: null };
          }
          await startSession(r.idToken, r.refreshToken, email, password);
          emit('SIGNED_IN');
          return { data: { user: user, session: session() }, error: null };
        } catch (e) { return { data: { user: null, session: null }, error: authErr(e) }; }
      },
      signUp: async function (o) {
        var email = String(o.email || '').trim(), password = o.password || '';
        try {
          var r = await post(AUTH + 'signUp?key=' + KEY, { email: email, password: password, returnSecureToken: true });
          await startSession(r.idToken, r.refreshToken, email, password);
          emit('SIGNED_IN');
          return { data: { user: user, session: session() }, error: null };
        } catch (e) { return { data: { user: null, session: null }, error: authErr(e) }; }
      },
      signOut: async function (o) {
        if (o && o.scope === 'global' && tok) { try { await api.mergeDoc('users/' + tok.uid, { revokedAt: Date.now() }); } catch (e) {} }
        tok = null; user = null; save();
        emit('SIGNED_OUT');
        return { error: null };
      },
      updateUser: async function (o) {
        try {
          if (o.password) {
            var t = await getToken();
            var r = await post(AUTH + 'update?key=' + KEY, { idToken: t, password: o.password, returnSecureToken: true });
            if (r.idToken) { setTokens(r.idToken, r.refreshToken); save(); }
          }
          if (o.data) await setMeta(o.data);
          return { data: { user: user }, error: null };
        } catch (e) { return { data: { user: user }, error: authErr(e) }; }
      },
      resetPasswordForEmail: async function (email) {
        try { await post(AUTH + 'sendOobCode?key=' + KEY, { requestType: 'PASSWORD_RESET', email: String(email || '').trim() }); }
        catch (e) { if (e.code !== 'EMAIL_NOT_FOUND') return { data: null, error: authErr(e) }; }
        return { data: {}, error: null };
      },
      // Borra la cuenta de Firebase de la persona con sesión iniciada.
      deleteUser: async function () {
        try { var t = await getToken(); await post(AUTH + 'delete?key=' + KEY, { idToken: t }); tok = null; user = null; save(); return { error: null }; }
        catch (e) { return { error: authErr(e) }; }
      }
    };

    return { auth: auth, from: function (t) { return new Q(t); }, fs: api };
  };
})();
