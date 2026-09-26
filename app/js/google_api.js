// Google side of the sync: sign-in (Google Identity Services, token flow — no
// backend, no client secret) and the transport sheets_db.js uses to talk to
// the Sheets / Drive REST APIs.
//
// Scope is `drive.file`: this app can only see files it created itself, never
// the rest of the operator's Drive. The spreadsheet is found again on another
// device by name (Drive files.list is limited to app-created files by that
// same scope), so every device lands on the same one.
(function () {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
  const REMEMBER_KEY = 'pf_google_signed_in';
  const SHEET_ID_KEY = 'pf_google_sheet_id';
  const TOKEN_KEY = 'pf_google_token';
  // A saved token must still have at least this long to live to be reused.
  const TOKEN_MIN_LIFE_MS = 5 * 60 * 1000;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: just re-login next time */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function authError(message) {
    const err = new Error(message);
    err.needsAuth = true;
    return err;
  }

  // ---- sign-in -------------------------------------------------------------
  let clientId = '';
  let tokenClient = null;
  let token = null;
  let expiresAt = 0;
  let inflight = null;
  // Set when a quiet (no-click) sign-in fails. On a phone the browser blocks that
  // popup, so every later write or refresh would try — and fail — again, flashing
  // a sign-in window each time. Until the operator signs in with a tap, requests
  // fail at once instead.
  let authBlocked = false;

  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('無法載入 Google 登入元件,請確認網路連線'));
      document.head.appendChild(s);
    });
  }

  // Google's access tokens last about an hour and there's no server here to
  // renew them, so a token is kept in this browser's localStorage until it
  // expires — reopening the app within the hour needs no sign-in. It only
  // grants the drive.file scope (files this app created) and lives on this
  // origin, on this device; signing out or a rejected token clears it.
  function saveToken() {
    store.set(TOKEN_KEY, JSON.stringify({ token, expiresAt }));
  }

  function restoreToken() {
    try {
      const saved = JSON.parse(store.get(TOKEN_KEY) || 'null');
      if (saved && saved.token && saved.expiresAt - Date.now() > TOKEN_MIN_LIFE_MS) {
        token = saved.token;
        expiresAt = saved.expiresAt;
        return;
      }
    } catch (e) { /* unreadable: treat as none */ }
    store.del(TOKEN_KEY);
  }

  function dropToken() {
    token = null;
    expiresAt = 0;
    store.del(TOKEN_KEY);
  }

  async function init(id) {
    clientId = id;
    restoreToken();
    await loadGis();
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {},
      error_callback: () => {},
    });
  }

  // prompt 'none' = never show UI (fails if Google needs the operator to act);
  // '' = show whatever is needed, which must come from a click or the browser
  // blocks the popup.
  function requestToken(prompt) {
    if (inflight) return inflight;
    inflight = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(authError('登入逾時')), prompt === 'none' ? 10000 : 120000);
      const done = (fn, v) => { clearTimeout(timer); fn(v); };
      tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          token = resp.access_token;
          expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          saveToken();
          authBlocked = false;
          store.set(REMEMBER_KEY, '1');
          done(resolve, token);
        } else {
          done(reject, authError((resp && resp.error_description) || (resp && resp.error) || '登入失敗'));
        }
      };
      tokenClient.error_callback = (err) => {
        done(reject, authError((err && (err.message || err.type)) || '登入失敗'));
      };
      try {
        tokenClient.requestAccessToken({ prompt });
      } catch (e) {
        done(reject, authError(e.message || '登入失敗'));
      }
    }).finally(() => { inflight = null; });
    return inflight;
  }

  const signIn = () => requestToken('');
  const trySilent = () => requestToken('none');

  async function getToken() {
    if (token && Date.now() < expiresAt - 60000) return token;
    if (authBlocked) throw authError('登入已過期,請按「重新登入」');
    try {
      return await trySilent();
    } catch (err) {
      authBlocked = true;
      throw err;
    }
  }

  function signOut() {
    if (token && window.google) {
      try { window.google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* best effort */ }
    }
    dropToken();
    store.del(REMEMBER_KEY);
    store.del(SHEET_ID_KEY);
  }

  // ---- REST ----------------------------------------------------------------
  async function call(method, url, body) {
    let authRetried = false;
    for (let attempt = 0; ; attempt++) {
      const t = await getToken();
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
        throw new Error('無法連線到 Google(網路中斷?)');
      }
      if (res.status === 401 && !authRetried) {
        authRetried = true;
        dropToken();
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        let message = `Google 服務錯誤 (${res.status})`;
        try {
          const j = await res.json();
          if (j && j.error && j.error.message) message += `:${j.error.message}`;
        } catch (e) { /* non-JSON body */ }
        const err = new Error(message);
        err.status = res.status;
        if (res.status === 401) err.needsAuth = true;
        throw err;
      }
      return res.status === 204 ? null : res.json();
    }
  }

  // ---- the spreadsheet -----------------------------------------------------
  let spreadsheetId = null;
  let tabs = {}; // title -> { sheetId, rowCount, colCount }

  const enc = encodeURIComponent;

  async function loadMeta() {
    const meta = await call('GET', `${SHEETS}/${spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties)`);
    tabs = {};
    for (const s of meta.sheets || []) {
      const p = s.properties;
      tabs[p.title] = {
        sheetId: p.sheetId,
        rowCount: p.gridProperties.rowCount,
        colCount: p.gridProperties.columnCount,
      };
    }
  }

  async function findExisting(name) {
    const q = `name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const j = await call('GET', `${DRIVE_FILES}?q=${enc(q)}&orderBy=createdTime&pageSize=10&fields=files(id,createdTime)`);
    return j.files && j.files.length ? j.files[0].id : null;
  }

  async function connect(name, wantedTabs) {
    spreadsheetId = null;
    const saved = store.get(SHEET_ID_KEY);
    if (saved) {
      spreadsheetId = saved;
      try {
        await loadMeta();
      } catch (e) {
        if (e.needsAuth || !(e.status === 403 || e.status === 404)) throw e;
        spreadsheetId = null; // belongs to another account / was deleted
      }
    }
    if (!spreadsheetId) {
      spreadsheetId = await findExisting(name);
      if (spreadsheetId) {
        await loadMeta();
      } else {
        const created = await call('POST', SHEETS, {
          properties: { title: name },
          sheets: wantedTabs.map((title) => ({
            properties: { title, gridProperties: { rowCount: 1000, columnCount: 30 } },
          })),
        });
        spreadsheetId = created.spreadsheetId;
        await loadMeta();
      }
    }
    store.set(SHEET_ID_KEY, spreadsheetId);
    const missing = wantedTabs.filter((t) => !tabs[t]);
    if (missing.length) {
      await call('POST', `${SHEETS}/${spreadsheetId}:batchUpdate`, {
        requests: missing.map((title) => ({
          addSheet: { properties: { title, gridProperties: { rowCount: 1000, columnCount: 30 } } },
        })),
      });
      await loadMeta();
    }
    return { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
  }

  // A values write past the tab's grid is rejected, so grow it first.
  async function ensureGrid(updates) {
    const need = {};
    for (const u of updates) {
      const m = /^'(.+)'!([A-Z]+)(\d+)$/.exec(u.range);
      if (!m || !tabs[m[1]]) continue;
      const rows = Number(m[3]) + u.values.length - 1;
      const cols = Math.max(...u.values.map((r) => r.length), 1);
      const n = need[m[1]] || (need[m[1]] = { rows: 0, cols: 0 });
      n.rows = Math.max(n.rows, rows);
      n.cols = Math.max(n.cols, cols);
    }
    const requests = [];
    for (const [title, n] of Object.entries(need)) {
      const t = tabs[title];
      if (n.rows > t.rowCount) {
        const add = n.rows - t.rowCount + 500;
        requests.push({ appendDimension: { sheetId: t.sheetId, dimension: 'ROWS', length: add } });
        t.rowCount += add;
      }
      if (n.cols > t.colCount) {
        const add = n.cols - t.colCount + 5;
        requests.push({ appendDimension: { sheetId: t.sheetId, dimension: 'COLUMNS', length: add } });
        t.colCount += add;
      }
    }
    if (requests.length) await call('POST', `${SHEETS}/${spreadsheetId}:batchUpdate`, { requests });
  }

  const transport = {
    connect,

    async batchGet(ranges) {
      const qs = ranges.map((r) => `ranges=${enc(r)}`).join('&');
      const j = await call('GET', `${SHEETS}/${spreadsheetId}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`);
      return (j.valueRanges || []).map((v) => v.values || []);
    },

    async batchUpdate(updates) {
      await ensureGrid(updates);
      await call('POST', `${SHEETS}/${spreadsheetId}/values:batchUpdate`, {
        valueInputOption: 'RAW',
        data: updates.map((u) => ({ range: u.range, majorDimension: 'ROWS', values: u.values })),
      });
    },

    async batchClear(ranges) {
      await call('POST', `${SHEETS}/${spreadsheetId}/values:batchClear`, { ranges });
    },

    // deletes: [{ tab, row }] (1-based). Highest row first within a tab so an
    // earlier delete doesn't shift the rows still to be removed.
    async deleteRows(deletes) {
      const sorted = deletes.slice().sort((a, b) => (a.tab === b.tab ? b.row - a.row : a.tab < b.tab ? -1 : 1));
      const requests = sorted.map((d) => ({
        deleteDimension: {
          range: { sheetId: tabs[d.tab].sheetId, dimension: 'ROWS', startIndex: d.row - 1, endIndex: d.row },
        },
      }));
      for (let i = 0; i < requests.length; i += 200) {
        await call('POST', `${SHEETS}/${spreadsheetId}:batchUpdate`, { requests: requests.slice(i, i + 200) });
      }
      sorted.forEach((d) => { tabs[d.tab].rowCount -= 1; });
    },
  };

  window.GoogleApi = {
    configured: () => !!(window.APP_CONFIG && window.APP_CONFIG.googleClientId),
    isRemembered: () => store.get(REMEMBER_KEY) === '1',
    init, signIn, trySilent, getToken, signOut, transport,
    hasValidToken: () => !!token && Date.now() < expiresAt - 60000,
    sheetUrl: () => (spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null),
  };
})();
