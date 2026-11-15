/* The page's core: Edit album's Folders and copies (bug list item 424). */
// Two releases merged into one album — their files in two folders, or two copies in one folder — taken apart here.
// GET /api/album/edit's "split" says the album's folders where its tracks are in more than one (Split by folder), the
// ways its tracks fall into parts (Split…: by the version words in their titles, their format, or a repeated track
// number; each a row of its parts, and Split to confirm), and whether it is a part of a hand split (Join back). Look at
// this album again reads its folders now. After a split the editor shows the album kept, and Join back undoes it (just
// after Split by folder, with the albums it made). The words are the Android app's (core AlbumSplitEdit.kt).
const aeSplit = aeEl && {
  box: document.getElementById("ae-split"),
  folders: document.getElementById("ae-split-folders"),
  byFolder: document.getElementById("ae-split-folder"),
  open: document.getElementById("ae-split-open"),
  ways: document.getElementById("ae-split-ways"),
  join: document.getElementById("ae-split-join"),
  again: document.getElementById("ae-split-again"),
  status: document.getElementById("ae-split-status")
};

/** A way's parts as said: "SACD Version (7) · Remastered 2013 (6)". @param {any} w */
const aeSplitParts = w => (w.parts || []).map(/** @param {any} p */ p => p.name + " (" + p.tracks + ")").join(" · ");

/** The section drawn from the editor's view [d] ([made]: the albums Split by folder just made, for Join back). @param {any} d @param {number[] | null} [made] */
function aeSplitShow(d, made) {
  if (!aeSplit || !aeSplit.box || !aeState) return;
  const sp = d && d.split;
  aeState.splitMade = made || null;
  aeSplit.box.classList.toggle("hidden", !sp);
  if (!sp) return;
  const folders = sp.folders || [];
  aeSplit.folders.classList.toggle("hidden", folders.length < 2);
  aeSplit.folders.textContent = folders.length < 2 ? "" : "Its tracks are in " + folders.length + " folders: " +
    folders.map(/** @param {any} f */ f => f.folder + " (" + f.tracks + ")").join(" · ");
  aeSplit.byFolder.classList.toggle("hidden", folders.length < 2);
  aeSplit.open.classList.toggle("hidden", !(sp.ways || []).length);
  aeSplit.ways.classList.add("hidden");
  aeSplit.ways.innerHTML = "";
  aeSplit.join.classList.toggle("hidden", !(sp.part || (made && made.length)));
}

/** The section put away until the album's view says what it can do, as the editor opens on another album. */
function aeSplitClear() {
  if (!aeSplit || !aeSplit.box) return;
  aeSplit.box.classList.add("hidden");
  aeSplit.ways.classList.add("hidden");
  aeSplit.ways.innerHTML = "";
  aeSplit.status.textContent = "";
}

/** Split…: each way its tracks fall into parts, with Split to confirm it. */
function aeSplitWays() {
  if (!aeState || !aeState.data || !aeState.data.split) return;
  const box = aeSplit.ways;
  box.innerHTML = "";
  for (const w of aeState.data.split.ways || []) {
    const row = document.createElement("div");
    row.className = "ae-split-way";
    const words = document.createElement("div");
    words.className = "ae-split-words";
    words.setAttribute("data-parity", "album-edit.split-way");
    words.textContent = w.name + ": " + aeSplitParts(w);
    const go = document.createElement("button");
    go.type = "button"; go.className = "action-btn"; go.textContent = "Split";
    go.setAttribute("data-parity", "album-edit.split-go");
    go.addEventListener("click", () => aeSplitPost("/api/album/split", { by: w.by }, go, "Splitting…"));
    row.append(words, go);
    box.appendChild(row);
  }
  box.classList.toggle("hidden", !box.childElementCount);
}

/** One of the section's changes: [path] with [body] for this album, [btn] saying [busy] meanwhile; the editor then shows the album kept. @param {string} path @param {any} body @param {HTMLButtonElement} btn @param {string} busy */
async function aeSplitPost(path, body, btn, busy) {
  const mine = aeState;
  if (!mine) return;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = busy;
  aeSplit.status.textContent = ""; ae.err.textContent = "";
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ offset: mine.album.offset }, body)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (aeState !== mine) return;
    const albums = j.albums || [];
    const r2 = await fetch(`/api/album/edit?offset=${albums[0] || mine.album.offset}`);
    const d = await r2.json().catch(() => ({}));
    if (aeState !== mine || !r2.ok) return;
    mine.data = d;
    // The album kept is another than the one opened (Join back from the smaller part): the editor is that one's now.
    if (albums.length && albums[0] !== mine.album.offset) mine.album = Object.assign({}, mine.album, { offset: albums[0], image_key: d.image_key });
    const split = path === "/api/album/split";
    aeSplitShow(d, split && body.by === "folder" ? albums.slice(1) : null);
    aeSplit.status.textContent = split ? "Split into " + albums.length + " albums — each a version of the others. Join back puts them together again."
      : path === "/api/album/join" ? "Joined back into one album."
      : albums.length > 1 ? "Looked at again: its tracks are in " + albums.length + " albums now." : "Looked at again: nothing to change.";
    if (mine.album === currentAlbum) fetchAlbumDetail(currentAlbum, { version: true }).catch(() => {});
    showToast(split ? "Album split" : path === "/api/album/join" ? "Joined back" : "Album looked at again");
  } catch (e) {
    if (aeState === mine) aeSplit.status.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

if (aeSplit && aeSplit.box) {
  aeSplit.byFolder.addEventListener("click", () => aeSplitPost("/api/album/split", { by: "folder" }, aeSplit.byFolder, "Splitting…"));
  aeSplit.open.addEventListener("click", () => {
    if (aeSplit.ways.classList.contains("hidden")) aeSplitWays(); else aeSplit.ways.classList.add("hidden");
  });
  aeSplit.join.addEventListener("click", () => aeSplitPost("/api/album/join", aeState && aeState.splitMade && aeState.splitMade.length ? { with: aeState.splitMade } : {}, aeSplit.join, "Joining…"));
  aeSplit.again.addEventListener("click", () => aeSplitPost("/api/album/look-again", {}, aeSplit.again, "Looking…"));
}
