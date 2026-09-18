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

window.Backup = { saveBackupFile };
