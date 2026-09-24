// Google Sheets storage backend — the same interface as db.js's IndexedDB one
// (getAll / put / putAll / remove / clear / countAll), so store.js and every
// screen work unchanged whichever is behind `window.Db`.
//
// How it works:
//  - Each store is one tab of a spreadsheet. Row 1 is a header of field names
//    (column A is always `id`); every record is one row. Scalars are plain
//    cells; arrays/objects are JSON text; null is an empty cell. See
//    encodeCell/decodeCell for the exact rules.
//  - Everything is loaded into memory once (connect / refresh) and reads come
//    from that cache, so screens stay as fast as they were on IndexedDB.
//  - Writes update the cache immediately and are sent to Google in the
//    background, debounced and batched (a few API calls per burst, well
//    inside Google's per-minute quota). A failed write is kept and retried.
//  - Rows are located by id at flush time (never by a remembered row number),
//    so sorting the sheet by hand or another device appending rows can't make
//    a write land on the wrong record.
//
// The network is behind a small `transport` object (see google_api.js for the
// real one) so this file is pure logic and testable with an in-memory fake.
(function () {
  const STORES = [
    'accounts', 'categories', 'labels', 'transactions', 'transactionLabels',
    'investments', 'recurringTransactions', 'pledges', 'settings',
  ];
  const CHECK_TAB = '_check'; // scratch tab for the first-connection type check
  const MAX_COLS = 'ZZ';

  // ---- cell encoding ----------------------------------------------------
  // Strings are stored as-is, except ones that would be mistaken for our own
  // markers (or an empty string, which would read back as null) — those get
  // a `str:` prefix. Non-scalars become `json:` + JSON text.
  function encodeCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') {
      return v === '' || v.startsWith('json:') || v.startsWith('str:') ? 'str:' + v : v;
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : '';
    if (typeof v === 'boolean') return v;
    return 'json:' + JSON.stringify(v);
  }

  function decodeCell(c) {
    if (c === undefined || c === null || c === '') return null;
    if (typeof c === 'string') {
      if (c.startsWith('str:')) return c.slice(4);
      if (c.startsWith('json:')) {
        try { return JSON.parse(c.slice(5)); } catch (err) { return c; }
      }
    }
    return c;
  }

  function recordToRow(record, header) {
    return header.map((col) => encodeCell(record[col]));
  }

  function rowToRecord(row, header) {
    const record = {};
    header.forEach((col, i) => {
      if (col !== '' && col != null) record[col] = decodeCell(row[i]);
    });
    return record;
  }

  const q = (tab) => `'${tab}'`;

  function create({ transport, name = '個人財務資料', debounceMs = 400 }) {
    const cache = {};
    STORES.forEach((s) => { cache[s] = new Map(); });
    let pending = emptyPending();
    let flushing = null;
    let timer = null;
    let retryTimer = null;
    let retryDelay = 5000;
    let status = { state: 'idle', message: '' };
    const listeners = new Set();
    let info = null;

    function emptyPending() {
      const p = { upserts: {}, removes: {}, clears: new Set() };
      STORES.forEach((s) => { p.upserts[s] = new Map(); p.removes[s] = new Set(); });
      return p;
    }

    function hasPending() {
      if (pending.clears.size) return true;
      return STORES.some((s) => pending.upserts[s].size || pending.removes[s].size);
    }

    function setStatus(state, err) {
      status = {
        state,
        message: err ? err.message || String(err) : '',
        needsAuth: !!(err && err.needsAuth),
      };
      listeners.forEach((cb) => { try { cb(status); } catch (e) { /* a listener must not break syncing */ } });
    }

    function assertStore(store) {
      if (!cache[store]) throw new Error(`Unknown store: ${store}`);
    }

    // ---- reading ---------------------------------------------------------
    async function loadAll() {
      const got = await transport.batchGet(STORES.map((s) => `${q(s)}!A1:${MAX_COLS}`));
      STORES.forEach((s, i) => {
        const rows = got[i] || [];
        const header = (rows[0] || []).map((c) => (c == null ? '' : String(c)));
        const map = new Map();
        if (header.length && header[0] !== 'id') {
          throw new Error(`工作表「${s}」第一欄應該是 id,請不要更動表頭`);
        }
        for (let r = 1; r < rows.length; r++) {
          const record = rowToRecord(rows[r] || [], header);
          if (record.id === null || record.id === undefined) continue;
          record.id = String(record.id);
          map.set(record.id, record);
        }
        cache[s] = map;
      });
    }

    // ---- writing ---------------------------------------------------------
    async function applySnapshot(snap) {
      const stores = STORES.filter((s) => snap.clears.has(s) || snap.upserts[s].size || snap.removes[s].size);
      if (!stores.length) return;

      if (snap.clears.size) {
        await transport.batchClear([...snap.clears].map((s) => `${q(s)}!A2:${MAX_COLS}`));
      }

      const ranges = [];
      stores.forEach((s) => ranges.push(`${q(s)}!1:1`, `${q(s)}!A:A`));
      const got = await transport.batchGet(ranges);

      const updates = [];
      const deletes = [];
      stores.forEach((s, i) => {
        const headerRow = ((got[2 * i] || [])[0] || []).map((c) => (c == null ? '' : String(c)));
        const idCol = got[2 * i + 1] || [];
        let header = headerRow.length ? headerRow.slice() : ['id'];
        if (header[0] !== 'id') throw new Error(`工作表「${s}」第一欄應該是 id,請不要更動表頭`);

        const upserts = [...snap.upserts[s].values()];
        for (const rec of upserts) {
          for (const key of Object.keys(rec)) {
            if (!header.includes(key)) header.push(key);
          }
        }
        if (header.length !== headerRow.length) {
          updates.push({ range: `${q(s)}!A1`, values: [header] });
        }

        const rowOf = new Map();
        for (let k = 1; k < idCol.length; k++) {
          const id = idCol[k] && idCol[k][0];
          if (id !== undefined && id !== null && id !== '') rowOf.set(String(id), k + 1);
        }
        let nextRow = Math.max(idCol.length, 1) + 1;
        const fresh = [];
        for (const rec of upserts) {
          const row = rowOf.get(rec.id);
          if (row) updates.push({ range: `${q(s)}!A${row}`, values: [recordToRow(rec, header)] });
          else fresh.push(recordToRow(rec, header));
        }
        if (fresh.length) {
          updates.push({ range: `${q(s)}!A${nextRow}`, values: fresh });
          nextRow += fresh.length;
        }
        for (const id of snap.removes[s]) {
          const row = rowOf.get(id);
          if (row) deletes.push({ tab: s, row });
        }
      });

      if (updates.length) await transport.batchUpdate(updates);
      // Deletes go last, highest row first (the transport handles order), so
      // the row numbers worked out above are still right for every update.
      if (deletes.length) await transport.deleteRows(deletes);
    }

    // What a failed flush didn't get written goes back into `pending`, unless
    // something newer has already superseded it.
    function mergeBack(snap) {
      STORES.forEach((s) => {
        for (const [id, rec] of snap.upserts[s]) {
          if (pending.removes[s].has(id) || pending.upserts[s].has(id)) continue;
          pending.upserts[s].set(id, rec);
        }
        for (const id of snap.removes[s]) {
          if (pending.upserts[s].has(id)) continue;
          pending.removes[s].add(id);
        }
      });
      snap.clears.forEach((s) => pending.clears.add(s));
    }

    async function runFlush() {
      while (hasPending()) {
        const snap = pending;
        pending = emptyPending();
        setStatus('syncing');
        try {
          await applySnapshot(snap);
        } catch (err) {
          mergeBack(snap);
          setStatus('error', err);
          scheduleRetry(err);
          throw err;
        }
      }
      retryDelay = 5000;
      setStatus('idle');
    }

    function scheduleRetry(err) {
      clearTimeout(retryTimer);
      if (err && err.needsAuth) return; // waits for the operator to reconnect
      retryTimer = setTimeout(() => { flush().catch(() => {}); }, retryDelay);
      retryDelay = Math.min(retryDelay * 3, 120000);
    }

    async function flush() {
      clearTimeout(timer);
      timer = null;
      if (flushing) {
        try { await flushing; } catch (e) { /* surfaced by the run that owned it */ }
      }
      if (!hasPending()) return;
      flushing = runFlush().finally(() => { flushing = null; });
      return flushing;
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { flush().catch(() => {}); }, debounceMs);
    }

    // ---- the Db interface -------------------------------------------------
    async function getAll(store) {
      assertStore(store);
      return [...cache[store].values()].map((r) => structuredClone(r));
    }

    async function put(store, value) {
      assertStore(store);
      if (value === null || typeof value !== 'object' || value.id === undefined || value.id === null || value.id === '') {
        throw new Error('put needs a record with an id');
      }
      // structuredClone rejects what IndexedDB would (a Vue proxy, a function)
      // so a bug like that still shows up the same way in both backends.
      const record = structuredClone(value);
      record.id = String(record.id);
      cache[store].set(record.id, record);
      pending.upserts[store].set(record.id, record);
      pending.removes[store].delete(record.id);
      schedule();
      return value;
    }

    async function putAll(store, values) {
      for (const value of values) await put(store, value);
    }

    async function remove(store, id) {
      assertStore(store);
      const key = String(id);
      cache[store].delete(key);
      pending.upserts[store].delete(key);
      pending.removes[store].add(key);
      schedule();
    }

    async function clear(store) {
      assertStore(store);
      cache[store] = new Map();
      pending.upserts[store] = new Map();
      pending.removes[store] = new Set();
      pending.clears.add(store);
      schedule();
    }

    async function countAll(store) {
      assertStore(store);
      return cache[store].size;
    }

    // ---- connection -------------------------------------------------------
    // Writes a row of awkward values, reads it back and compares. Google's
    // "RAW" input is supposed to keep text as text (dates, numeric-looking
    // tickers…); if it ever didn't, every date in the app would silently turn
    // into a number, so this refuses to sync rather than risk that.
    async function verifyRoundTrip() {
      const probe = {
        id: 'probe', s: '2330', d: '2026-09-24', n: 1.5, i: -7, b: true, f: false,
        e: '', z: null, j: ['a', 'b'], o: { k: 1 }, t: 'json:x', u: '中文 測試',
      };
      const header = Object.keys(probe);
      await transport.batchUpdate([
        { range: `${q(CHECK_TAB)}!A1`, values: [header] },
        { range: `${q(CHECK_TAB)}!A2`, values: [header.map((k) => encodeCell(probe[k]))] },
      ]);
      const [rows] = await transport.batchGet([`${q(CHECK_TAB)}!A1:${MAX_COLS}`]);
      await transport.batchClear([`${q(CHECK_TAB)}!A1:${MAX_COLS}`]);
      const back = rowToRecord((rows && rows[1]) || [], ((rows && rows[0]) || []).map(String));
      const bad = header.filter((k) => JSON.stringify(back[k]) !== JSON.stringify(probe[k] === undefined ? null : probe[k]));
      if (bad.length) {
        throw new Error(`Google 試算表回傳的資料和寫入的不一致(欄位:${bad.join('、')}),為避免資料損壞已停止同步`);
      }
    }

    async function connect({ verify = false } = {}) {
      info = await transport.connect(name, [...STORES, CHECK_TAB]);
      if (verify) await verifyRoundTrip();
      await loadAll();
      setStatus('idle');
      return info;
    }

    // Sends anything still queued, then re-reads the sheet — how a second
    // device's changes show up here.
    async function refresh() {
      await flush();
      await loadAll();
    }

    function resume() {
      retryDelay = 5000;
      return flush();
    }

    function onStatus(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }

    return {
      STORES,
      getAll, put, putAll, remove, clear, countAll,
      connect, refresh, flush, resume, hasPending, onStatus,
      isDirty: () => hasPending() || !!flushing,
      getStatus: () => status,
      get spreadsheetId() { return info && info.spreadsheetId; },
    };
  }

  window.SheetsDb = { create, encodeCell, decodeCell, STORES };
})();
