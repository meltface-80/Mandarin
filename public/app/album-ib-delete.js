/* Delete from iBroadcast (bug list item 527): iBroadcast's albums picked on a wall deleted at iBroadcast itself, not only
 * from Mandarin, from the select menu (it is there only where every album picked is iBroadcast's). Asked twice: what it
 * does, then "Are you sure?". No to either: nothing deleted, the selection let go and the library as it was. Yes to both:
 * the server deletes them at iBroadcast (IBroadcastDeleteRoutes.cs) and the walls are drawn again without them. The
 * app's is its own (WallSelect.kt), worded the same. */

/** The first question, for [n] albums. @param {number} n */
function ibDeleteWarning(n) {
  const them = n === 1 ? "this album" : `these ${n} albums`;
  return `Delete ${them} from iBroadcast? ${n === 1 ? "It is" : "They are"} deleted from your iBroadcast account, not only from Mandarin, and can't be brought back from Mandarin.`;
}
const IB_DELETE_SURE = "Are you sure? This can't be undone.";

async function deleteFromIBroadcast() {
  const picked = albumSelected.slice();
  if (!picked.length) return;
  const ask = (/** @type {string} */ q) => window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(window.confirm(q));
  // No, to either: unselected, the library as it was.
  if (!(await ask(ibDeleteWarning(picked.length))) || !(await ask(IB_DELETE_SURE))) { exitAlbumSelectMode(); return; }
  try {
    const r = await fetch("/api/ibroadcast/delete-albums", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offsets: picked.map(a => a.offset) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    showToast(`Deleted ${j.albums} album${j.albums === 1 ? "" : "s"} from iBroadcast` + (j.note ? ". " + j.note : ""), j.note ? "error" : "ok");
    exitAlbumSelectMode();
    if (window.__libraryChanged) window.__libraryChanged();
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), "error");
  }
}
