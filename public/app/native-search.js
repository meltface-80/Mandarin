/* ------------------------------------------------------------------ */
/*  Android app only: the search drawn by the app itself (bug list item */
/*  61, a preview: Native Search in UI Settings; docs/specs/            */
/*  native-parity.md). The glass (the top bar's, which the row's Search */
/*  taps) opens the app's Search in place of the page's field, with the */
/*  UI Settings and the room (MusicdApp.openSearch); a search seeded     */
/*  elsewhere (__runSearch) opens it with its words. Offline the page's */
/*  own search stays: the app's asks the server, which isn't there.     */
/* ------------------------------------------------------------------ */
(function nativeSearch() {
  const app = window.MusicdApp;
  if (!app || typeof app.nativeSearch !== "function" || typeof app.openSearch !== "function") return;
  const on = () => { if (window.__musicdOffline) return false; try { return !!app.nativeSearch(); } catch (e) { return false; } };
  const open = (q) => app.openSearch(q || "", nativePrefsJson(), selectedZoneId || "");
  const glass = document.getElementById("search-open");
  // Ahead of the page's own listener on the glass (search.js), which then never opens the field.
  if (glass) glass.addEventListener("click", (e) => { if (!on()) return; e.stopImmediatePropagation(); e.preventDefault(); open(""); }, true);
  const seeded = window.__runSearch;
  if (typeof seeded === "function") window.__runSearch = (q) => { if (on()) open(q); else seeded(q); };
})();
