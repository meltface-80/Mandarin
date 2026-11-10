/* An artist's page in tabs (artist-about.js draws who they are over them). */
// As an album's page has its tabs (album-tabs.js), an artist's has three under
// their picture, facts, genres and Play: Overview, Discography and About, the
// one open showing and the rest waiting (style.css hides them by the grid's
// data-artist-tab). Overview: their albums in a row that scrolls sideways,
// See all opening Discography, then similar artists and albums
// (artist-foot.js), the row Home's (.home-carousel) and its tiles the album
// tiles of the grid and of Home, badges and all. Discography: every album of theirs, those they appear on,
// their bands' and those they are credited on, the grid as before. About: the
// biography, asked for only when the tab is first opened, and a band's members
// or a person's bands. Every artist's page the same, whatever is known of them.
// The words are the Android app's (ArtistTabs.kt).
(function artistTabs() {
  "use strict";
  const w = /** @type {any} */ (window);
  const TABS = [["overview", "Overview"], ["discography", "Discography"], ["about", "About"]];

  /** A section's small heading. @param {string} text */
  function header(text) {
    const hdr = document.createElement("div");
    hdr.className = "artist-section-header"; hdr.dataset.parity = "artist.section"; hdr.textContent = text;
    return hdr;
  }

  /**
   * The tabs' row and the two panes of their own (Overview's albums, About), put after [head] in [grid]; the grid's
   * album tiles are Discography's. [onTab] is told each tab opened, the first time and after.
   * @param {HTMLElement} grid @param {HTMLElement} head @param {(tab: string) => void} onTab
   */
  function renderArtistTabs(grid, head, onTab) {
    const row = document.createElement("div");
    row.className = "artist-tabs"; row.setAttribute("role", "tablist");
    const overview = document.createElement("div");
    overview.className = "artist-overview";
    const about = document.createElement("div");
    about.className = "artist-about";
    const albums = document.createElement("div");
    albums.className = "artist-stints artist-overview-albums hidden";
    overview.appendChild(albums);
    /** @param {string} t */
    function setTab(t) {
      grid.dataset.artistTab = t;
      for (const el of row.children) {
        const b = /** @type {HTMLElement} */ (el), on = b.dataset.artistTab === t;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", String(on));
      }
      onTab(t);
    }
    for (const [t, label] of TABS) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "artist-tab"; b.dataset.parity = "artist.tab"; b.dataset.artistTab = t;
      b.setAttribute("role", "tab"); b.textContent = label;
      b.addEventListener("click", () => setTab(t));
      row.appendChild(b);
    }
    head.after(row, overview, about);
    /** Overview's row: [list] (their albums, else those they appear on), under "Albums" with See all. @param {any[]} list */
    function showAlbums(list) {
      if (!list.length) { albums.replaceChildren(); albums.classList.add("hidden"); return; }
      const top = document.createElement("div");
      top.className = "artist-overview-head";
      const all = document.createElement("button");
      all.type = "button"; all.className = "artist-see-all"; all.dataset.parity = "artist.see-all"; all.textContent = "See all";
      all.addEventListener("click", () => { setTab("discography"); row.scrollIntoView({ block: "start", behavior: "smooth" }); });
      top.append(header("Albums"), all);
      // Home's row of the grid's own tiles: the same cover, badges, title and artist as Discography's; a tap opens one,
      // selecting is Discography's (as the app's row).
      const cards = document.createElement("div");
      cards.className = "home-carousel home-carousel-1row artist-overview-row";
      cards.append(...list.map(al => w.__keyArtistTile(buildAlbumTile(al, null, { selectable: false }))));
      albums.replaceChildren(top, cards);
      albums.classList.remove("hidden");
    }
    setTab("overview");
    return { setTab, showAlbums, about };
  }

  w.__renderArtistTabs = renderArtistTabs;
})();
