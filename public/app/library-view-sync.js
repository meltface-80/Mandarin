/* The page's core, beside 7 of 33 (bug list item 52): the Library's view as the Android app's native wall hands it back. */
// The view as the Android app's native wall says it changed (native-handoff.js, item 52): the same query
// string this wall asks with, read back and kept, so this wall and Home's Library row follow.
function applyLibViewQuery(qs) {
  const p = new URLSearchParams(qs || "");
  const sort = p.get("sort"), dir = p.get("dir"), seed = parseInt(p.get("seed") || "", 10), played = p.get("played") || "any";
  if (LIB_SORT_OPTIONS.some(o => o.id === sort)) libView.sort = sort;
  libView.dir = dir === "desc" || dir === "asc" ? dir : libSortDefaultDir(libView.sort);
  if (Number.isFinite(seed) && seed > 0) libView.seed = seed;
  libView.played = LIB_PLAYED_OPTIONS.some(o => o.id === played) ? played : "any";
  for (const id of LIB_FACET_IDS) libView[id] = p.getAll(id).map(String);
  libView.prefix = "";
  saveLibView();
}
