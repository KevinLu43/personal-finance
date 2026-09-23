// The only file that touches the browser's save/download APIs — a page
// cannot silently choose where a file lands on disk (that door is closed by
// browser security on purpose), so this does the closest thing available:
// hand the operator a native "save as" dialog when the browser supports one
// (Chrome/Edge's File System Access API), so they can navigate to the
// folder themselves and the browser then remembers it for next time.
// Everywhere that lacks the API falls back to a plain download, which lands
// in the browser's configured downloads folder instead.
async function saveBackupFile(dataObj, filename) {
  const json = JSON.stringify(dataObj, null, 2);

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON 備份檔', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return { ok: true, method: 'picker' };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, cancelled: true };
      throw err;
    }
  }

  // Fallback: a plain download. This lands wherever the browser is
  // configured to save downloads (usually the Downloads folder), not
  // wherever the operator actually wants it — there is no way to steer it
  // further than that without the picker API above.
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { ok: true, method: 'download' };
}

// The import counterpart: hands back a picked file's parsed JSON. Prefers
// the File System Access API's open picker (same browsers saveBackupFile's
// picker path targets); falls back to a plain <input type=file> — invisible,
// clicked programmatically — everywhere else, since that needs no special
// API and works even over a plain file:// open.
async function loadBackupFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON 備份檔', accept: { 'application/json': ['.json'] } }],
      });
      const file = await handle.getFile();
      return { ok: true, data: JSON.parse(await file.text()) };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, cancelled: true };
      throw err;
    }
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    // No 'cancel' event exists for <input type=file> — a picker the operator
    // dismisses without choosing anything just never fires 'change', so this
    // resolves as cancelled only via that absence, not a dedicated handler.
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) { resolve({ ok: false, cancelled: true }); return; }
      try {
        resolve({ ok: true, data: JSON.parse(await file.text()) });
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}

window.Backup = { saveBackupFile, loadBackupFile };
