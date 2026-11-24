/* An artist's albums on the default service (item 522): after the library's on their page's Discography tab, the
 * albums of theirs that service has and the library doesn't (/api/artist-discography; Settings → Services → Default
 * service), under "More on <service>", as that service's browser draws its tiles (a tap opens it there). Asked once
 * the library's are up, so the page never waits on the service; nothing is drawn for no default service, none of
 * theirs, or the service not answering, and nothing once another artist or view is open. The app's is its own
 * (ArtistScreen.kt), the same. */
(() => {
  /**
   * @param {string} artistName
   * @param {number|null} actId
   * @param {HTMLElement} grid
   * @param {() => boolean} alive
   */
  async function show(artistName, actId, grid, alive) {
    let j;
    try {
      const url = "/api/artist-discography?artist=" + encodeURIComponent(artistName) + (actId != null ? "&artist_id=" + encodeURIComponent(String(actId)) : "");
      const r = await fetch(url);
      if (!r.ok) return;
      j = await r.json();
    } catch (_) { return; }   // the server not there a moment: the library's albums stand alone
    const browser = window.__serviceBrowsers && window.__serviceBrowsers[j.service];
    if (!alive() || !browser || !Array.isArray(j.albums) || !j.albums.length) return;
    const frag = document.createDocumentFragment();
    const hdr = document.createElement("div");
    hdr.className = "artist-section-header artist-disc"; hdr.dataset.parity = "artist.section";
    hdr.textContent = "More on " + j.name;
    frag.appendChild(hdr);
    for (const a of j.albums) {
      const tile = browser.tile(a);
      tile.classList.add("artist-disc");
      frag.appendChild(tile);
    }
    // Right after the library's own albums: before what they appear on (or the phone's), else before the page's foot.
    const heads = [...grid.querySelectorAll(":scope > .artist-section-header")];
    const own = heads.findIndex(h => h.textContent === "Albums");
    const next = own >= 0 ? heads[own + 1] : heads[0];
    grid.insertBefore(frag, next || grid.querySelector(":scope > .artist-tail"));
  }
  window.__artistDiscography = show;
})();
