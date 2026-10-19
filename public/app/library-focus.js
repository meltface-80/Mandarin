/* The page's core (app.js until v1.0.5), 13 of 33: the Library's Focus sheet. */
async function openLibFocusSheet(editTarget) {
  // Snapshot BEFORE the edited view is applied, so abandoning the sheet can
  // put the user's own Library view back exactly as it was.
  const viewBefore = editTarget ? currentLibViewSnapshot() : null;
  // Lives outside the view: two playlists can share a query and differ here,
  // which is also why the server applies it by slicing rather than inside
  // libraryView(), whose cache is keyed on the query alone.
  let editLimit = (editTarget && editTarget.limit) || 100;
  // Same reasoning as the limit: two playlists can share a query and differ
  // in what order it comes out in, so this lives beside the view rather than
  // inside it.
  let editOrder = (editTarget && editTarget.order) || SMART_ORDER_DEFAULT;
  if (editTarget) applyViewToLibView(editTarget.view);
  // The Library's view as the sheet found it: Show albums or Clear all that
  // leave it so (nothing chosen, or nothing to clear) close the sheet over
  // the wall as it was, where it was scrolled to (v1.0.7). Applying it anyway
  // loaded the wall afresh from its first album, the user's place lost.
  const openedWith = JSON.stringify(currentLibViewSnapshot());
  const showIfChanged = () => {
    if (!editTarget && JSON.stringify(currentLibViewSnapshot()) === openedWith) return;
    applyLibView();
  };
  let committed = false;
  // Re-read every time the sheet opens. Caching these for the life of the
  // page meant a rescan changed the library and the Focus sheet went on
  // reporting the old counts until a full reload — which reads as the rescan
  // having done nothing.
  try {
    const r = await fetch("/api/library/facets", { cache: "no-store" });
    if (r.ok) libFacets = await r.json();
  } catch (e) { /* offline — keep whatever we last had rather than blanking */ }
  // The server decides the vocabulary — it drops "Record label" when Labels
  // is switched off — so the count badge follows what it publishes rather
  // than a list hardcoded here.
  if (libFacets && Array.isArray(libFacets.facets)) {
    const ids = libFacets.facets.map(x => x && x.id).filter(Boolean);
    if (ids.length) libAvailableFacets = ids;
  }
  const f = libFacets || { facets: [], coverage: {} };
  // Which sections are expanded. Held across repaints (a chip tap rebuilds
  // the body) but NOT across openings: a sheet that reopens half-collapsed
  // hides filters that are still on.
  const openSections = {};
  openLibSheet("Focus", (body) => {
    // One collapsible category. Roon's own Focus is a row of scrolling
    // columns; on a phone that becomes a vertical stack, and with ten
    // categories — some of them hundreds of labels long — every one expanded
    // is a sheet nobody can find the bottom of. Collapsed by default unless
    // something in it is selected, so what's ON is always visible.
    // `openByDefault` is for sections that aren't filters at all — the
    // playlist's own Order and size. They have no "active count" to open
    // them, and collapsing the two controls this screen exists to set would
    // hide them behind a tap for no gain.
    const section = (id, label, activeCount, openByDefault) => {
      // Default open when something in here is ON, and REMEMBER that, because
      // a chip tap repaints the whole body: clearing the last filter in a
      // category would otherwise drop its active count to zero and collapse
      // the section under the user's finger, taking the other chips with it.
      // Once open, a section stays open until the header is tapped or the
      // sheet is closed.
      if (openSections[id] === undefined && (activeCount > 0 || openByDefault)) {
        openSections[id] = true;
      }
      const expanded = openSections[id] === undefined ? false : openSections[id];
      const s = document.createElement("div");
      s.className = "lib-sheet-section" + (expanded ? " is-open" : "");

      const head = document.createElement("button");
      head.type = "button";
      head.className = "lib-sheet-section-head"; head.dataset.parity = "library.focus-section";
      head.setAttribute("aria-expanded", expanded ? "true" : "false");
      const t = document.createElement("span");
      t.className = "lib-sheet-section-label";
      t.textContent = label;
      head.appendChild(t);
      if (activeCount) {
        const n = document.createElement("span");
        n.className = "lib-sheet-section-count";
        n.textContent = String(activeCount);
        head.appendChild(n);
      }
      const car = document.createElement("span");
      car.className = "lib-sheet-section-caret";
      car.setAttribute("aria-hidden", "true");
      car.textContent = expanded ? "⌃" : "⌄";
      head.appendChild(car);
      head.addEventListener("click", () => {
        openSections[id] = !expanded;
        renderFocusBody();
      });
      s.appendChild(head);
      body.appendChild(s);
      if (!expanded) return null;   // collapsed: no body to fill
      const wrap = document.createElement("div");
      wrap.className = "lib-chips";
      s.appendChild(wrap);
      return { section: s, chips: wrap };
    };
    // state: "on" (included) | "not" (excluded) | "off".
    const chip = (host, label, state, onTap) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "lib-chip" + (state === "on" ? " is-on" : state === "not" ? " is-not" : "");
      c.dataset.parity = "library.focus-chip";
      c.textContent = label;
      if (state === "not") c.setAttribute("aria-label", "Excluding " + label);
      c.addEventListener("click", () => { onTap(); renderFocusBody(); });
      host.appendChild(c);
    };
    const note = (host, text) => {
      const n = document.createElement("div");
      n.className = "lib-facet-note"; n.dataset.parity = "library.focus-note";
      n.textContent = text;
      host.appendChild(n);
    };
    // Why a facet's chips don't add up to the library. Every one of these
    // comes from somewhere other than Roon — the browse API publishes none of
    // it — so the number is stated rather than left to be noticed.
    const COVERAGE_NOTE = {
      decade: "Release years come from your file tags (ORIGINALDATE, then DATE) " +
              "and from MusicBrainz. Undated albums aren't in any decade.",
      genre:  "Genres are read from your files' GENRE tags. " +
              "An album with no genre tag won't appear here.",
      label:  "Labels are collected during the label scan, which runs in the background " +
              "and fills in over time.",
      format: "Read from your own files.",
      added:  "Date added is when the files arrived in your music folder, as Mandarin could work " +
              "out for itself — file timestamps, and albums appearing between scans."
    };
    // Format, Sample rate, Bit depth and Channels all come from the same file
    // scan and all carry the same caveat; saying it four times is noise.
    const COVERAGE_OF = { rate: "format", bits: "format", chan: "format" };

    const renderFocusBody = () => {
      body.innerHTML = "";

      // The playlist's OWN properties lead, ahead of every filter. Order and
      // size are decisions about the playlist rather than about which albums
      // match, and burying them under ten collapsed facets meant scrolling
      // past the whole sheet to reach the two controls this screen exists to
      // set. Open by default for the same reason.
      if (editTarget) {
        const ord = section("order", "Order", 0, true);
        if (ord) {
          for (const o of SMART_ORDERS) {
            chip(ord.chips, o.label, editOrder === o.id ? "on" : "off",
                 () => { editOrder = o.id; });
          }
          note(ord.section,
            (editTarget.mode === "tracks"
              ? "Album order plays each record straight through, in the sort you " +
                "chose. Random shuffles the albums AND the tracks inside them."
              : "Album order queues the albums in the sort you chose. Random " +
                "shuffles which albums, and what order they play in.") +
            " The shuffle is fixed per playlist, so it stays put while you scroll " +
            "rather than reshuffling under you.");
        }

        const lim = section("limit", "Playlist size", 0, true);
        if (lim) {
          for (const n of SMART_LIMITS) {
            chip(lim.chips, String(n), editLimit === n ? "on" : "off", () => { editLimit = n; });
          }
          note(lim.section,
            "How many albums this playlist actually plays. A query can match your " +
            "whole library, but a Sonos queue holds 1,000 tracks — 400 albums " +
            "is thousands of tracks and takes minutes.");
        }
      }

      // Listening first — it is the one facet that is always available,
      // because it runs on this extension's own play history rather than on
      // anything harvested.
      const played = libView.played !== "any" ? 1 : 0;
      const ls = section("played", "Listening", played);
      if (ls) {
        for (const p of LIB_PLAYED_OPTIONS) {
          chip(ls.chips, p.label, libView.played === p.id ? "on" : "off",
               () => { libView.played = p.id; });
        }
        if (!f.hasPlays) {
          note(ls.section, "Mandarin hasn't seen anything play yet, so these use an " +
                           "empty history — everything counts as never played.");
        }
      }

      for (const facet of (f.facets || [])) {
        const sel = libView[facet.id];
        if (!Array.isArray(sel)) continue;   // a facet this client doesn't know
        const s = section(facet.id, facet.label, sel.length);
        if (!s) continue;
        for (const v of facet.values) {
          chip(s.chips, v.label + " (" + v.count + ")",
               facetState(sel, v.value), () => facetCycle(sel, v.value));
        }
        // Anything SELECTED that the server didn't send back gets a chip of
        // its own. Genre and Label are truncated to the commonest values, so a
        // saved playlist — or a filter set before the library changed — can
        // easily name one that isn't in the list. Without this the filter is
        // active, invisible, and clearable only by Clear all, which would
        // take every other filter with it.
        const listed = facet.values.map(v => v.value);
        for (const raw of sel) {
          const value = raw.charAt(0) === "!" ? raw.slice(1) : raw;
          if (listed.includes(value)) continue;
          chip(s.chips, value, facetState(sel, value), () => facetCycle(sel, value));
        }
        if (facet.total_values > facet.values.length) {
          note(s.section, "Showing the " + facet.values.length + " most common of " +
                          facet.total_values.toLocaleString() + ".");
        }
        const covId = COVERAGE_OF[facet.id] || facet.id;
        const have = f.coverage && f.coverage[covId];
        if (COVERAGE_NOTE[covId] && Number.isFinite(have) && f.total && have < f.total) {
          note(s.section, have.toLocaleString() + " of " + f.total.toLocaleString() +
                          " albums. " + COVERAGE_NOTE[covId]);
        }
        if (facet.id === "source" && f.sources_derived) {
          // Say WHERE the number came from. Matching file tags against Roon's
          // own metadata is lossy — Roon rewrites titles for albums it
          // identifies — so when nothing else can claim an album, counting by
          // elimination is both exact and honest, and the user should know
          // that's the reasoning rather than assume every file was matched.
          note(s.section, "Every album in your library came from your own files.");
        }
      }

      const foot = document.createElement("div");
      foot.className = "lib-sheet-note"; foot.dataset.parity = "library.focus-help";
      foot.textContent =
        "Tap a filter once to include it, again to exclude it, once more to clear it. " +
        "Everything here is read from your files' own tags.";
      body.appendChild(foot);
    };
    renderFocusBody();
  }, (foot, close) => {
    const clear = document.createElement("button");
    clear.type = "button"; clear.className = "action-btn"; clear.dataset.parity = "library.focus-clear";
    clear.textContent = "Clear all";
    clear.addEventListener("click", () => {
      committed = true;
      Object.assign(libView, libEmptyFacets());
      libView.played = "any";
      close(); showIfChanged();
    });
    const save = document.createElement("button");
    save.type = "button"; save.className = "action-btn"; save.dataset.parity = "library.focus-save";
    save.textContent = "Save as…";
    save.addEventListener("click", () => {
      committed = true;
      close();
      // Carry the chosen size into the save — the sheet is the only place it
      // can be set, so it has to travel with the thing being saved. `mode`
      // rides along on editTarget from the create sheet (or from the record
      // being edited); Save-as from the Library bar has no editTarget and
      // takes the server default.
      saveSmartPlaylistPrompt(editTarget
        ? Object.assign({}, editTarget, { limit: editLimit, order: editOrder })
        : null);
    });
    const show = document.createElement("button");
    show.type = "button"; show.className = "action-btn primary"; show.dataset.parity = "library.focus-show";
    show.textContent = "Show albums";
    show.addEventListener("click", () => { committed = true; close(); showIfChanged(); });
    foot.appendChild(clear); foot.appendChild(save); foot.appendChild(show);
  }, () => {
    // Abandoned (X or backdrop) while editing a saved playlist — put the
    // user's own Library view back. Never persisted in the first place, so
    // there is nothing on disk to undo.
    if (editTarget && !committed && viewBefore) applyViewToLibView(viewBefore);
  });
}
