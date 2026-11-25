/* Merge albums (bug list item 512): two albums or more of your own files picked on a wall, made
 * one from the select menu: the server puts the first volume or disc first, whichever was picked first (each title's
 * number: "Volume One", "Disc 2", "Motion II"), and calls it by what the titles share. A merged album picked alone
 * offers Unmerge, each album its own again. Kept by the server (AlbumMergeRoutes.cs), so a scan keeps to it. */

// The menu's Merge albums and Unmerge, in it only where they can be done (before Clear selection).
const MERGE_ITEMS = {
  merge: { label: "Merge albums", parity: "library.select-merge wall.select-merge artist.select-merge" },
  unmerge: { label: "Unmerge", parity: "library.select-unmerge wall.select-unmerge artist.select-unmerge" },
};
function mergeMenuShown(kind, n) {
  if (!selMenu) return;
  const server = kind === "albums" ? albumSelected.filter(a => !isPhoneAlbum(a)) : [];
  // Your own files' albums alone: a streamed album isn't merged.
  const own = server.every(a => !a.source || a.source === "local");
  const want = { merge: kind === "albums" && n >= 2 && server.length === n && own,
    unmerge: kind === "albums" && n === 1 && server.length === 1 && !!server[0].merged };
  for (const act of Object.keys(MERGE_ITEMS)) {
    const had = selMenu.querySelector('[data-sel-act="' + act + '"]');
    if (!want[act]) { if (had) had.remove(); continue; }
    if (had) continue;
    const b = document.createElement("button");
    b.className = "sel-menu-item"; b.type = "button";
    b.setAttribute("role", "menuitem"); b.dataset.selAct = act; b.dataset.parity = MERGE_ITEMS[act].parity;
    b.textContent = MERGE_ITEMS[act].label;
    selMenu.insertBefore(b, selMenu.querySelector('[data-sel-act="clear"]'));
  }
}

// Merge albums, or Unmerge: asked of the server, the walls read again.
async function mergeAlbums(act) {
  const picked = albumSelected.slice();
  if (!picked.length) return;
  const body = act === "merge" ? { offsets: picked.map(a => a.offset) } : { offset: picked[0].offset };
  try {
    const r = await fetch("/api/albums/" + act, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    showToast(act === "merge" ? `Merged ${picked.length} albums into “${j.title}”` : `“${picked[0].title}” unmerged`);
    exitAlbumSelectMode();
    if (window.__libraryChanged) window.__libraryChanged();
  } catch (e) {
    showToast(e.message, "error");
  }
}
