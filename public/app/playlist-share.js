/* The page's core (app.js until v1.0.5), 12 of 33: a playlist shared, and the Library's Sort sheet. */
// ----- Sharing a playlist -------------------------------------------------
// What leaves the app is a DESCRIPTION of the music, never audio and never
// anything else: the entries below are built field-by-field from the rows on
// screen. Nothing is forwarded wholesale from a server response, so an export
// cannot pick up a field it was never meant to carry.
//
// See docs/design/playlist-sharing.md.

// Ask the server to turn entries into a share blob, then show it.
//
// `caveats` is what the CLIENT knows and the server cannot: that collection
// stopped at the album cap, that a page failed part-way, or that the source
// playlist was already truncated before we saw it. The server's own
// `truncated` only ever describes the list it was handed, so relying on it
// alone meant every client-side limit went unreported — the exact shape of
// the v1.7.17 bug this feature was written to avoid repeating.
async function shareTracks(name, entries, btn, caveats) {
  if (!entries.length) { showToast("Nothing to share yet", "error"); return; }
  if (btn) btn.disabled = true;
  try {
    const r = await fetch("/api/share/encode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, tracks: entries })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || "Couldn't build the share file", "error"); return; }
    openShareSheet(name, j, caveats || {});
  } catch (e) {
    showToast("Couldn't reach the extension", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// The blob, plus the two ways to get it off this device. Everything the user
// is told here is a fact from the response — how many tracks went in, and
// what was left out — because a share file that quietly dropped half a
// playlist is worse than one that refused to build.
function openShareSheet(name, j, caveats) {
  const c = caveats || {};
  openLibSheet("Share " + name, (body) => {
    const n = j.track_count || 0;
    const sum = document.createElement("div");
    sum.className = "share-sum"; sum.dataset.parity = "playlist-share.sum";
    sum.textContent = `${n} track${n === 1 ? "" : "s"}`;
    body.appendChild(sum);

    // Every reason this file might be less than the whole playlist, each on
    // its own line. One run-on sentence buried the important half.
    const warnings = [];
    if (c.incomplete) {
      warnings.push("Reading stopped early because the server returned an error — " +
                    "this file is INCOMPLETE. Try again before sharing it.");
    }
    if (c.albumsCapped) {
      warnings.push(`Only the first ${SHARE_ALBUM_MAX} albums were read — ` +
                    "that's the limit for one go.");
    }
    if (c.sourceTruncated) {
      warnings.push("The playlist is longer than this app can read in one go, " +
                    "so the end of it isn't here.");
    }
    if (j.truncated) warnings.push("Stopped at the sharing limit of tracks.");
    if (j.skipped) {
      warnings.push(`${j.skipped} entr${j.skipped === 1 ? "y" : "ies"} had no title ` +
                    `and ${j.skipped === 1 ? "was" : "were"} left out.`);
    }
    // Above 40 KB a paste starts getting silently truncated by messaging
    // apps, which turns into a blob that decodes to nothing on the far end.
    if (j.bytes > 40000) {
      warnings.push(`This is ${Math.round(j.bytes / 1024)} KB — too big to paste ` +
                    "reliably. Use Download and send the file.");
    }
    for (const w of warnings) {
      const el = document.createElement("div");
      el.className = "share-warn"; el.dataset.parity = "playlist-share.warn";
      el.textContent = w;
      body.appendChild(el);
    }

    const note = document.createElement("div");
    note.className = "share-note"; note.dataset.parity = "playlist-share.note";
    note.textContent =
      "This describes the music, not the music itself. Whoever imports it " +
      "gets whatever their own library or streaming service can match.";
    body.appendChild(note);

    // readOnly rather than disabled: the text must stay selectable so a
    // long-press copy works where the Clipboard API doesn't.
    const ta = document.createElement("textarea");
    ta.className = "share-blob";
    ta.id = "share-blob"; ta.dataset.parity = "playlist-share.blob"; ta.setAttribute("aria-label", "The share file's text");
    ta.readOnly = true;
    ta.setAttribute("autocapitalize", "none");
    ta.setAttribute("autocorrect", "off");
    ta.spellcheck = false;
    ta.rows = 4;
    ta.value = j.blob || "";
    body.appendChild(ta);
  }, (foot, close) => {
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "action-btn primary"; copy.dataset.parity = "playlist-share.copy";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      // navigator.clipboard is a SECURE-CONTEXT api and this extension is
      // served over plain http on the LAN, so on most devices it simply does
      // not exist — the "modern" path was never once taken in practice, and
      // every user was silently pushed to hand-selecting the blob. That is
      // how a copy comes back short. execCommand still works on http, so it
      // is tried FIRST and the async API is the fallback, not the other way
      // round.
      const ta = document.getElementById("share-blob");
      if (ta) {
        ta.focus();
        ta.setSelectionRange(0, (j.blob || "").length);
        try {
          if (document.execCommand && document.execCommand("copy")) {
            showToast("Copied — paste it to whoever you're sharing with");
            return;
          }
        } catch (e) { /* falls through to the async API below */ }
      }
      try {
        await navigator.clipboard.writeText(j.blob || "");
        showToast("Copied — paste it to whoever you're sharing with");
      } catch (e) {
        // Both refused. The text is selected, so a manual copy still works —
        // say so rather than failing silently.
        showToast("Couldn't copy automatically — the text is selected, copy it by hand",
                  "error", TOAST_REPORT_MS);
      }
    });
    foot.appendChild(copy);

    const dl = document.createElement("button");
    dl.type = "button"; dl.className = "action-btn"; dl.dataset.parity = "playlist-share.download";
    dl.textContent = "Download";
    dl.addEventListener("click", () => {
      const safe = (name || "playlist").replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
      const blob = new Blob([j.blob || ""], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = safe + ".musicd";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can race the download on some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
    foot.appendChild(dl);

    const done = document.createElement("button");
    done.type = "button"; done.className = "action-btn"; done.dataset.parity = "playlist-share.done";
    done.textContent = "Done";
    done.addEventListener("click", close);
    foot.appendChild(done);
  });
}

// Roon ARC's sort popover, in this app's bottom-sheet language: a plain list
// of fields, and the SELECTED one carries an arrow. Tapping the selected row
// flips that arrow instead of re-selecting; tapping any other row switches to
// it at its own default direction. There is no separate direction row and no
// sentence to read — the arrow is the whole affordance.
function openLibSortSheet() {
  openLibSheet("Sort by", (body, close) => {
    const paint = () => {
      // Reversing in place replaces the row that was just activated — keep
      // focus on its replacement so the row can be pressed again without
      // tabbing back to it. Rows are rebuilt in a fixed order, so position
      // identifies the replacement.
      const rows = body.querySelectorAll(".lib-sort-row");
      const focused = Array.prototype.indexOf.call(rows, document.activeElement);
      body.innerHTML = "";
      for (const opt of LIB_SORT_OPTIONS) {
        const on = libView.sort === opt.id;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "lib-sort-row" + (on ? " is-on" : ""); row.dataset.parity = "library.sort-row";

        // The arrow occupies a fixed column on every row, filled only on the
        // selected one, so the labels stay on a single left edge.
        const arrow = document.createElement("span");
        arrow.className = "lib-sort-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = (on && libSortHasDir(opt.id))
          ? (libView.dir === "desc" ? "↓" : "↑") : "";
        row.appendChild(arrow);

        const text = document.createElement("span");
        text.className = "lib-sort-text";
        const main = document.createElement("span");
        main.className = "lib-sort-label";
        main.textContent = opt.label;
        text.appendChild(main);
        if (opt.note) {
          const sub = document.createElement("span");
          sub.className = "lib-sort-note";
          sub.textContent = opt.note;
          text.appendChild(sub);
        }
        row.appendChild(text);

        if (on && libSortHasDir(opt.id)) {
          row.setAttribute("aria-label", opt.label + " — " + libDirLabel() + ", tap to reverse");
        }
        row.addEventListener("click", () => {
          if (on) {
            // Already selected: this tap means "reverse", exactly as in ARC.
            // Random is the one row with nothing to reverse — re-tapping it
            // reshuffles instead, which is the only useful thing it can do.
            if (libSortHasDir(opt.id)) {
              libView.dir = libView.dir === "desc" ? "asc" : "desc";
            } else {
              libView.seed = libNextSeed(libView.seed);
              close();
            }
          } else {
            libView.sort = opt.id;
            libView.dir = libSortDefaultDir(opt.id);
            // Switching TO Random re-rolls: without this the first shuffle on
            // a fresh install always runs on the default seed, so "random"
            // gives every device the identical order until ⟳ is tapped.
            if (!libSortHasDir(opt.id)) libView.seed = libNextSeed(libView.seed);
            close();
          }
          // Repaint before applying so a reverse-in-place shows its new arrow
          // immediately; the wall reloads behind the open sheet.
          if (document.body.contains(body)) paint();
          applyLibView();
        });
        body.appendChild(row);
      }
      // Focus back on the row in the same place (v0.7.9: worked out above
      // and then never applied, so a keyboard user lost their place).
      if (focused >= 0) { const again = body.querySelectorAll(".lib-sort-row")[focused]; if (again) again.focus(); }
    };
    paint();
  });
}

// `editTarget` (a smart playlist) makes this sheet's "Save as…" an
// update-in-place. Passed in rather than held in a module variable: an
// abandoned edit — closing the sheet with X, the backdrop, or Show albums —
// would otherwise leave that variable set, and the NEXT save from the Focus
// bar would silently overwrite the playlist edited earlier.
// Album counts a dynamic playlist can be limited to. The ceiling is the
// play-time one: 400 albums is ~3,200 Roon calls and minutes of queueing.
const SMART_LIMITS = [25, 50, 100, 200, 400];
const SMART_LIMIT_DEFAULT = 100;   // matches smartLimitDefault() on the server

// What a new playlist is made OF, asked first because it changes what the
// playlist DOES rather than which albums it matches — and because it is the
// one choice that can't be inferred from the focus.
//
// Both modes run the same album query. "Albums" queues whole records in
// order; "Tracks" expands them and lists the tracks individually. The filter
// itself is always album-level: Roon's API publishes no track list without
// opening each album one at a time, so a genuinely track-level FILTER would
// mean indexing every track in the library — thousands of Roon calls, redone
// on every change — which is the traffic the snapshot exists to avoid. This
// is stated in the sheet rather than hidden, so the choice is understood.
const SMART_MODES = [
  { id: "albums", label: "Albums",
    note: "Queues whole albums, in their own running order." },
  { id: "tracks", label: "Tracks",
    note: "Lists the tracks from those albums, so you can play or queue them one at a time." }
];
const SMART_MODE_DEFAULT = "albums";   // matches smartModeDefault() on the server
// What order it comes out in — a separate axis from what it is made of.
const SMART_ORDERS = [
  { id: "album",  label: "Album order" },
  { id: "random", label: "Random" }
];
const SMART_ORDER_DEFAULT = "album";   // matches smartOrderDefault() on the server
