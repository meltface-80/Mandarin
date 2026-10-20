/* The page's core (app.js until v1.0.5), 11 of 33: a shared playlist imported, and tracks added to a playlist. */
// ----- Importing a shared playlist ----------------------------------------
// The other half of Share. Paste the blob, and every entry is matched against
// THIS library — the shared file names music, it does not carry it, so what
// you end up with is whatever your own library can answer for.
function openImportSheet() {
  openLibSheet("Import a playlist", (body) => {
    const note = document.createElement("div");
    note.className = "share-note"; note.dataset.parity = "playlist-import.note";
    note.textContent =
      "Paste a playlist someone shared with you. It describes the music, so " +
      "you'll get the tracks your own library can match — the rest are listed " +
      "so you know what's missing.";
    body.appendChild(note);

    const ta = document.createElement("textarea");
    ta.className = "share-blob";
    ta.id = "import-blob"; ta.dataset.parity = "playlist-import.blob";
    ta.setAttribute("aria-label", "Shared playlist");
    ta.rows = 4;
    ta.placeholder = "MDRP1:…";
    // iOS autocorrect treats MDRP1 as a word it doesn't know and lowercases
    // it on paste, which broke the marker while leaving the payload intact.
    // The payload itself is base64url and case-SENSITIVE, so this must be
    // off — a "correction" anywhere in it would be unrecoverable.
    ta.setAttribute("autocapitalize", "none");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocomplete", "off");
    ta.spellcheck = false;
    body.appendChild(ta);

    // A downloaded .musicd file is the other half of Share's Download, and
    // on a phone it is far more reliable than a clipboard: the blob is long
    // enough that a hand-selection can silently come back short.
    const pick = document.createElement("label");
    pick.className = "action-btn import-file"; pick.dataset.parity = "playlist-import.file";
    pick.textContent = "Choose a file…";
    const file = document.createElement("input");
    file.type = "file";
    // .musicd is what Share writes; text/plain covers a file renamed or
    // re-saved by a mail client, and iOS is inconsistent about extensions it
    // does not recognise.
    file.accept = ".musicd,text/plain";
    file.className = "visually-hidden";
    file.id = "import-file";
    file.setAttribute("aria-label", "Choose a file…");
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        ta.value = String(reader.result || "");
        const out = document.getElementById("import-result");
        if (out) out.textContent = `Loaded ${f.name} — press Import.`;
      };
      reader.onerror = () => {
        const out = document.getElementById("import-result");
        if (out) out.textContent = "Couldn't read that file.";
      };
      reader.readAsText(f);
    });
    pick.appendChild(file);
    body.appendChild(pick);

    const out = document.createElement("div");
    out.className = "import-result";
    out.id = "import-result"; out.dataset.parity = "playlist-import.result";
    body.appendChild(out);
  }, (foot, close) => {
    const go = document.createElement("button");
    go.type = "button"; go.className = "action-btn primary"; go.dataset.parity = "playlist-import.import";
    go.textContent = "Import";
    go.addEventListener("click", () => runImport(go));
    foot.appendChild(go);

    const done = document.createElement("button");
    done.type = "button"; done.className = "action-btn"; done.dataset.parity = "playlist-import.done";
    done.textContent = "Close";
    done.addEventListener("click", close);
    foot.appendChild(done);
  });
}

async function runImport(btn) {
  const ta = document.getElementById("import-blob");
  const out = document.getElementById("import-result");
  const blob = ta ? ta.value.trim() : "";
  if (!blob) { showToast("Paste the playlist first", "error"); return; }
  btn.disabled = true;
  if (out) out.textContent = "Matching against your library…";
  try {
    const j = await postImport(blob, false);
    if (!j.ok) {
      if (out) out.textContent = j.error || "Couldn't read that playlist";
      return;
    }
    renderImportResult(out, j, btn);

    // Anything names alone couldn't place gets a second pass that reads what
    // is actually ON the library's albums. It runs automatically because the
    // alternative is asking the user to do a manual search, which is the
    // thing this is meant to replace — but it runs SECOND, so the fast
    // answer is on screen while it works.
    if (j.deep_available) {
      // Saving DURING the second pass would create a playlist from the
      // smaller set, and the second render then replaces the "Saved" state
      // on a detached node — so a second tap makes a second playlist with
      // the same name (the server creates by name, it never finds one).
      // Nothing to save until the count is final.
      const save = out.querySelector(".import-save");
      if (save) { save.disabled = true; save.textContent = "Searching your library…"; }
      const note = document.createElement("div");
      note.className = "share-sum share-sub-note"; note.dataset.parity = "playlist-import.searching";
      note.textContent = `Looking inside your albums for the other ${j.missing.length}…`;
      out.appendChild(note);
      const deep = await postImport(blob, true);
      if (deep.ok) {
        renderImportResult(out, deep, btn);
      } else {
        note.textContent = "Couldn't finish the deeper search — the matches above still stand.";
        if (save) { save.disabled = false; save.textContent = `Save ${(j.resolved || []).length} tracks as a playlist`; }
      }
    }
  } catch (e) {
    if (out) out.textContent = "Couldn't reach the extension";
  } finally {
    btn.disabled = false;
  }
}

// Returns the parsed body with `ok` reflecting the HTTP status, so callers
// never have to hold both.
async function postImport(blob, deep) {
  const r = await fetch("/api/share/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blob, deep: !!deep })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: j.error };
  return j;
}

// The resolution report. Showing what did NOT match is the point: every tool
// in this space quietly substitutes the wrong version, and a count that only
// celebrates the hits is how you stop trusting it.
function renderImportResult(out, j, btn) {
  if (!out) return;
  out.textContent = "";
  const n = (j.resolved || []).length;
  const miss = j.missing || [];

  const head = document.createElement("div");
  head.className = "share-sum"; head.dataset.parity = "playlist-import.sum";
  head.textContent = `${n} of ${j.total} track${j.total === 1 ? "" : "s"} found in your library`;
  out.appendChild(head);

  if (j.truncated) {
    const w = document.createElement("div");
    w.className = "share-warn"; w.dataset.parity = "playlist-import.warn";
    w.textContent = "That playlist is longer than one import can take — the end of it was left out.";
    out.appendChild(w);
  }

  if (miss.length) {
    const w = document.createElement("div");
    w.className = "share-warn"; w.dataset.parity = "playlist-import.warn";
    w.textContent = `${miss.length} couldn't be matched:`;
    out.appendChild(w);
    const ul = document.createElement("ul");
    ul.className = "import-missing"; ul.dataset.parity = "playlist-import.missing";
    // Bounded: a 500-track import that matched nothing would otherwise
    // render 500 rows into a bottom sheet.
    for (const m of miss.slice(0, 25)) {
      const li = document.createElement("li");
      li.textContent = [m.title, m.artist, m.album].filter(Boolean).join(" · ");
      ul.appendChild(li);
    }
    if (miss.length > 25) {
      const li = document.createElement("li");
      li.textContent = `…and ${miss.length - 25} more`;
      ul.appendChild(li);
    }
    out.appendChild(ul);
  }

  // Tracks found under an album the share did not name. Shown, not hidden:
  // this is a SUBSTITUTION, and the whole reason the import report exists is
  // that quietly swapping one record for another is what makes these tools
  // untrustworthy. Two servers indexing the same files group compilations
  // differently, so this is the normal case rather than an odd one.
  const sub = j.substituted || [];
  if (sub.length) {
    const w = document.createElement("div");
    w.className = "share-sum share-sub-note"; w.dataset.parity = "playlist-import.sub-note";
    w.textContent = `${sub.length} found on a different album than the playlist named:`;
    out.appendChild(w);
    const ul = document.createElement("ul");
    ul.className = "import-missing import-substituted"; ul.dataset.parity = "playlist-import.substituted";
    for (const m of sub.slice(0, 25)) {
      const li = document.createElement("li");
      li.textContent = [m.title, m.artist].filter(Boolean).join(" · ") +
                       " — " + (m.found_album || "your library");
      ul.appendChild(li);
    }
    if (sub.length > 25) {
      const li = document.createElement("li");
      li.textContent = `…and ${sub.length - 25} more`;
      ul.appendChild(li);
    }
    out.appendChild(ul);
  }

  if (!n) {
    const w = document.createElement("div");
    w.className = "share-warn"; w.dataset.parity = "playlist-import.warn";
    w.textContent = "Nothing here matched, so there's nothing to save.";
    out.appendChild(w);
    return;
  }

  const save = document.createElement("button");
  save.type = "button"; save.className = "action-btn primary import-save"; save.dataset.parity = "playlist-import.save";
  save.textContent = `Save ${n} track${n === 1 ? "" : "s"} as a playlist`;
  save.addEventListener("click", async () => {
    const name = await askName("Name this playlist", j.name || "Shared playlist");
    if (name === null) return;
    const trimmed = String(name).trim();
    if (!trimmed) { showToast("Give it a name", "error"); return; }
    save.disabled = true;
    const okAdd = await addToUserPlaylist({ name: trimmed }, j.resolved);
    save.disabled = false;
    if (okAdd) {
      save.textContent = "Saved";
      save.disabled = true;
    }
  });
  out.appendChild(save);
}

// Whichever selection is live, cleared once it has been filed somewhere.
function clearAfterAdd() {
  if (trackSelectMode) exitTrackSelectMode();
  if (albumSelectMode) exitAlbumSelectMode();
}

// Shared by import and by "Add to playlist". `target` is {id} for an existing
// playlist or {name} to create one. Exactly one of `tracks`/`albums` is set —
// albums go to the route that reads their tracklists off the Core.
async function addToUserPlaylist(target, tracks, albums) {
  const url = albums ? "/api/user-playlists/add-albums" : "/api/user-playlists/add";
  const payload = albums
    ? { id: target.id, name: target.name, albums }
    : { id: target.id, name: target.name, tracks };
  if (albums) showToast(`Reading ${albums.length} album${albums.length === 1 ? "" : "s"}…`);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || "Couldn't save that", "error"); return false; }
    let msg = `Added ${j.added} track${j.added === 1 ? "" : "s"}`;
    if (Number.isFinite(j.albums_read)) {
      msg += ` from ${j.albums_read} album${j.albums_read === 1 ? "" : "s"}`;
    }
    msg += ` to "${j.name}"`;
    if (j.full)    msg += " — the playlist is now full";
    if (j.skipped) msg += `; ${j.skipped} couldn't be stored` + (j.reason ? ` (${j.reason})` : "");
    // Named, not counted: knowing WHICH album Roon wouldn't open is the only
    // way to do anything about it.
    if (j.albums_failed && j.albums_failed.length) {
      msg += `; couldn't read ${j.albums_failed.join(", ")}`;
    }
    showToast(msg, (j.albums_failed && j.albums_failed.length) ? "error" : null,
              TOAST_REPORT_MS);
    if (window.__playlistsChanged) window.__playlistsChanged();
    return true;
  } catch (e) {
    showToast("Couldn't reach the extension", "error");
    return false;
  }
}

window.__openImportSheet = openImportSheet;
