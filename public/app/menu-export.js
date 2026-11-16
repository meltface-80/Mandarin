/* The side menu's Export (item 436): the library's own files as a CSV for Mandarin Migration, which adds them to a
 * Qobuz account (musicd-migrate's docs/library-csv.md). One row per track of every album of files on the server; a
 * service's albums never. Saved as the server names it, then a toast says how many albums and tracks went in, and how
 * many albums carry a barcode (the strongest evidence a Qobuz match has). */

/** "albums=12; tracks=140; barcodes=9" (X-Mandarin-Export) as numbers; each 0 where it isn't said. @param {string|null} said */
function exportCounts(said) {
  const n = (/** @type {string} */ k) => { const m = new RegExp("(?:^|;)\\s*" + k + "=(\\d+)").exec(said || ""); return m ? Number(m[1]) : 0; };
  return { albums: n("albums"), tracks: n("tracks"), barcodes: n("barcodes") };
}

/** What the toast says of an export done. @param {{albums:number,tracks:number,barcodes:number}} c @param {string} name */
function exportDoneText(c, name) {
  const num = (/** @type {number} */ v) => v.toLocaleString();
  return "Exported " + num(c.albums) + (c.albums === 1 ? " album" : " albums") + " (" + num(c.barcodes) + " with a barcode), "
    + num(c.tracks) + (c.tracks === 1 ? " track" : " tracks") + ": " + name;
}

async function exportLibrary() {
  const toast = window.__showToast || (() => {});
  toast("Exporting your library…");
  try {
    const r = await fetch("/api/export/library.csv");
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast("Export failed: " + (j.error || "the server said " + r.status), "error");
      return;
    }
    const name = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || "mandarin-library.csv";
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(exportDoneText(exportCounts(r.headers.get("X-Mandarin-Export")), name));
  } catch (e) {
    toast("Export failed: the server couldn't be reached", "error");
  }
}
window.__exportLibrary = exportLibrary;
