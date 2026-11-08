/* An album's versions (item 345): the tile says how many there are; the album's page lists them, each saying what tells
   it apart ("2015 Remaster · 24/96", "Original · 16/44.1"), one tap opening it; and makes the one open the main
   version, the one the lists show (POST /api/album/versions/main). */

/** The tile's line under the artist, "2 versions"; null for an album of one. @param {any} a */
function versionsMark(a) {
  if (!(a && a.versions > 1)) return null;
  const el = document.createElement("div");
  el.className = "album-versions";
  el.textContent = a.versions + " versions";
  return el;
}

/** The album page's versions, under its head ([headEnd]), from its answer [j]; gone where it has none. @param {any} j @param {any} headEnd */
function renderVersions(j, headEnd) {
  let el = document.getElementById("modal-versions");
  const list = j && Array.isArray(j.versions) ? j.versions : [];
  if (list.length < 2 || !headEnd || !headEnd.parentNode) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "modal-versions";
    el.className = "modal-versions"; el.dataset.parity = "album.versions";
  }
  const anchor = document.getElementById("modal-box-note") || document.getElementById("modal-names-note") || headEnd;
  anchor.parentNode.insertBefore(el, anchor.nextSibling);
  el.innerHTML = "";
  const head = document.createElement("div");
  head.className = "modal-versions-head";
  head.textContent = list.length + " versions";
  el.appendChild(head);
  const row = document.createElement("div");
  row.className = "modal-versions-list";
  for (const v of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "modal-version" + (v.current ? " is-current" : ""); b.dataset.parity = "album.version";
    b.textContent = (v.label || v.title) + (v.main ? " · Main" : "");
    b.setAttribute("aria-pressed", v.current ? "true" : "false");
    if (!v.current) b.addEventListener("click", () => openAlbum(v, { source: "home", filter: null }));
    row.appendChild(b);
  }
  el.appendChild(row);
  const cur = list.find(v => v.current);
  if (!cur || cur.main) return;
  const make = document.createElement("button");
  make.type = "button";
  make.className = "modal-version-main"; make.dataset.parity = "album.version-main";
  make.textContent = "Make this the main version";
  make.addEventListener("click", async () => {
    make.disabled = true; make.textContent = "Saving…";
    try {
      const r = await fetch("/api/album/versions/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offset: cur.offset }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      make.textContent = "The main version";
    } catch (e) {
      make.disabled = false; make.textContent = "Couldn't save that — try again";
    }
  });
  el.appendChild(make);
}
