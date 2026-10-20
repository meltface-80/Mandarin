/* ------------------------------------------------------------------ */
/*  Android app only: Settings → Setup → Downloads (v1.0.4).           */
/*  A settings pane like the others — same header, back chevron, rows, */
/*  switches and theme — with the app supplying the data and applying  */
/*  the settings (MusicdDownloads). Browsers never get the tile.       */
/* ------------------------------------------------------------------ */
(function androidDownloadsPane() {
  const dl = window.MusicdDownloads;
  const nav = document.querySelector('.settings-view[data-pane="setup"] .settings-nav');
  const sheet = document.querySelector("#settings-overlay .settings-sheet");
  if (!dl || !nav || !sheet) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const size = (b) => b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + " GB" : Math.round(b / (1 << 20)) + " MB";
  const json = (f, fallback) => { try { return JSON.parse(f()) || fallback; } catch (e) { return fallback; } };
  const has = (name) => typeof dl[name] === "function";

  // The tile, in Setup before Away from home (v1.0.4; once before Wall Display, in the Settings list).
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "settings-nav-item"; tile.setAttribute("data-parity", "settings-setup.item");
  tile.innerHTML = '<span class="settings-nav-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/></svg></span>' +
    '<span class="settings-nav-txt"><span class="settings-nav-title">Downloads</span></span>';
  nav.insertBefore(tile, nav.querySelector('.settings-nav-item[data-pane="away"]'));

  // An app from before this pane existed: its own screen, as it was.
  if (!has("settings")) { tile.addEventListener("click", () => dl.open()); return; }
  tile.setAttribute("data-pane", "downloads");

  const pane = document.createElement("div");
  pane.className = "settings-view settings-pane hidden";
  // A page of Setup's: Back goes there, as its other pages' do.
  for (const [k, v] of [["data-view", "pane"], ["data-pane", "downloads"], ["data-parent", "setup"]]) pane.setAttribute(k, v);
  sheet.appendChild(pane);

  const caret = '<svg class="settings-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  const select = (key, options, value) =>
    '<div class="settings-select-wrap"><select class="settings-select" data-dl-set="' + key + '">' +
    options.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? " selected" : "") + ">" + esc(o[1]) + "</option>").join("") +
    "</select>" + caret + "</div>";
  const toggle = (key, on) =>
    '<label class="switch"><input type="checkbox" data-dl-set="' + key + '"' + (on ? " checked" : "") + '>' +
    '<span class="switch-track"><span class="switch-thumb"></span></span></label>';
  const row = (label, control) => '<div class="settings-row"><span class="settings-label">' + label + "</span>" + control + "</div>";

  const covers = new Map();   // album id → image key, from the server
  async function fetchCovers(ids) {
    const missing = ids.filter(id => !covers.has(id));
    if (!missing.length) return;
    try {
      const r = await fetch("/api/download/albums", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: missing }) });
      const j = await r.json();
      for (const a of (j && j.albums) || []) covers.set(a.id, a.exists ? a.album : null);
      render();
    } catch (e) { /* covers are a nicety */ }
  }

  function stateLine(d) {
    const q = d.quality === "opus" ? "Opus 256" : "Original";
    const auto = d.auto ? " · automatic" : "";
    if (d.state === "done") return d.total + " tracks · " + size(d.bytes || 0) + " · " + q + auto;
    if (d.state === "away") return "On a card that isn’t in · " + d.total + " tracks · " + size(d.bytes || 0);
    if (d.state === "downloading") return "Downloading " + (d.done || 0) + " of " + (d.total || "?") + " · " + q;
    if (d.state === "waiting") return "Waiting for the network · " + (d.done || 0) + " of " + (d.total || "?");
    if (d.state === "failed") return "Couldn’t download: " + (d.error || "unknown");
    return "Waiting to start · " + q;
  }

  // Two screens in this pane: the settings, with the albums behind one
  // "Downloads" folder row — so ten albums or a hundred never push the
  // settings out of view — and the albums themselves ("albums"), where they
  // can be removed one at a time, several at once (Select), or all.
  let view = "settings";
  let selecting = false;
  const chosen = new Set();
  const backSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  const binSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
  const ask = (text) => window.__confirmDialog ? window.__confirmDialog(text) : Promise.resolve(window.confirm(text));

  // Removed without the app asking again: the page has just asked (Yes/No).
  // An app from before removeMany asks for each album itself.
  function removeAlbums(ids) {
    if (!ids.length) return;
    if (has("removeMany")) { try { dl.removeMany(JSON.stringify(ids)); } catch (e) { /* an app without this call (older than the page): nothing to do */ } }
    else for (const id of ids) { try { dl.remove(id); } catch (e) { /* an app without this call (older than the page): nothing to do */ } }
    for (const id of ids) chosen.delete(id);
  }

  function albumRows(list) {
    return list.map(d => {
      const al = covers.get(d.id);
      const art = al && al.image_key ? '<img src="/api/image/' + encodeURIComponent(al.image_key) + '?size=160" alt="" loading="lazy">' : "";
      const on = chosen.has(d.id);
      return '<div class="dl-row' + (selecting ? " is-selecting" : "") + (on ? " is-chosen" : "") + '" data-id="' + d.id + '">' +
        (selecting
          ? '<button type="button" class="dl-check" data-dl-choose="' + d.id + '" role="checkbox" aria-checked="' + on + '" aria-label="Select ' + esc(d.title) + '"><span class="dl-checkbox">' +
            (on ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"/></svg>' : "") + "</span></button>"
          : "") +
        '<button type="button" class="dl-open" ' + (selecting ? 'data-dl-choose="' + d.id + '"' : 'data-dl-open="' + d.id + '"') + '><span class="dl-art">' + art + "</span>" +
        '<span class="dl-text"><span class="dl-title">' + esc(d.title) + '</span><span class="dl-artist">' + esc(d.artist) + "</span>" +
        '<span class="dl-state">' + esc(stateLine(d)) + "</span></span></button>" +
        (selecting || d.state === "away" ? "" :
          (d.state === "done" ? '<button type="button" class="dl-btn" data-dl-play="' + d.id + '" aria-label="Play on this phone">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg></button>' : "") +
          '<button type="button" class="dl-btn" data-dl-remove="' + d.id + '" aria-label="Remove from this phone">' + binSvg + "</button>") +
        "</div>";
    }).join("");
  }

  function renderAlbums(s, list) {
    const done = list.filter(d => d.state === "done").length;
    for (const id of [...chosen]) if (!list.some(d => d.id === id)) chosen.delete(id);
    if (!list.length) selecting = false;
    const n = chosen.size;
    pane.innerHTML =
      '<div class="settings-pane-head">' +
        '<button class="settings-back" type="button" data-dl-back aria-label="Back to Downloads">' + backSvg + "</button>" +
        "<h2>Downloads</h2></div>" +
      '<p class="settings-pane-desc">' + done + (done === 1 ? " album" : " albums") + " on this phone · " + size(s.used || 0) + "</p>" +
      (list.length
        ? '<div class="dl-toolbar">' +
            (selecting
              ? '<button type="button" class="settings-update-btn" data-dl-select-all>' + (n === list.length ? "Select none" : "Select all") + "</button>" +
                '<button type="button" class="settings-update-btn" data-dl-select-done>Done</button>'
              : '<button type="button" class="settings-update-btn" data-dl-select>Select</button>' +
                '<button type="button" class="settings-update-btn dl-danger" data-dl-clear-all>Clear all</button>') +
          "</div>" +
          '<div class="settings-block dl-list">' + albumRows(list) + "</div>" +
          (selecting
            ? '<div class="dl-selbar"><span>' + (n ? n + " selected" : "Tap albums to select them") + "</span>" +
              '<button type="button" class="settings-update-btn dl-danger" data-dl-delete-chosen' + (n ? "" : " disabled") + ">Remove" + (n ? " " + n : "") + "</button></div>"
            : "")
        : '<div class="settings-note">Nothing here yet. On an album’s page, choose ⋯ → Download to this phone.</div>');
    fetchCovers(list.map(d => d.id));
  }

  function render() {
    const s = json(() => dl.settings(), {});
    const list = json(() => dl.all(), []);
    if (view === "albums") return renderAlbums(s, list);
    const done = list.filter(d => d.state === "done").length;
    const going = list.length - done;
    const places = s.places || [];
    const folderSub = list.length
      ? done + (done === 1 ? " album" : " albums") + " · " + size(s.used || 0) + (going ? " · " + going + " on the way" : "")
      : "Nothing downloaded yet";

    pane.innerHTML =
      '<div class="settings-pane-head">' +
        '<button class="settings-back" type="button" data-settings-back aria-label="Back to settings">' + backSvg +
        "</button><h2>Downloads</h2></div>" +
      '<p class="settings-pane-desc">' + done + (done === 1 ? " album" : " albums") + " · " + size(s.used || 0) + " used</p>" +

      '<div class="settings-block">' +
        '<button type="button" class="dl-folder" data-dl-folder>' +
          '<span class="dl-folder-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>' +
          '<span class="dl-folder-txt"><span class="dl-folder-title">Downloads</span><span class="dl-folder-sub">' + esc(folderSub) + "</span></span>" +
          '<svg class="dl-folder-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>' +
        "</button>" +
      "</div>" +
      '<div class="settings-divider"></div>' +

      ("offlineMode" in s ?
        '<div class="settings-block">' +
          row("Offline mode", toggle("offlineMode", s.offlineMode)) +
          '<div class="settings-note">' + (s.offlineMode
            ? "On. Only the music on this phone shows — its music folder and downloads — and the app doesn’t use the server, even when it can be reached."
            : "Off. The server’s library shows whenever it can be reached; with no connection, only the music on this phone.") + "</div>" +
        "</div>" +
        '<div class="settings-divider"></div>' : "") +

      '<div class="settings-block"><div class="settings-subhead">Downloading</div>' +
        row("Quality" + settingsInfo("Original is the files as they are (formats a phone can’t play become lossless FLAC). Opus 256 is about a quarter of the size of a CD-quality FLAC, less against hi-res. You can choose each time."),
          select("quality", [["original", "Original"], ["opus", "Opus 256 kbps"]], s.quality)) +
        row("Save to" + settingsInfo("Phone storage and the SD card here are the app’s own: no permission needed, but uninstalling the app deletes what’s there (updates don’t). A folder of your own outlives the app: a fresh install pointed at the same folder finds the albums again."), select("location", places.map(p => [p.id, p.label + " · " + size(p.free || 0) + " free"]), s.location)) +
        downloadFolderRow(s) +
        folderPlaceNote(s, places) +
        row("Size limit", select("limitGb", [0, 8, 16, 32, 64, 128, 256].map(g => [g, g ? g + " GB" : "No limit"]), s.limitGb)) +
        row("Wi-Fi only", toggle("wifiOnly", s.wifiOnly)) +
      "</div>" +
      '<div class="settings-divider"></div>' +

      ("awayQuality" in s ?
        '<div class="settings-block"><div class="settings-subhead">Playing away from home</div>' +
          row("Stream as" + settingsInfo("Albums not on the phone, over mobile data or other Wi-Fi. Opus 256 is made by the server as it plays, about a quarter of the data of a CD-quality FLAC; Original sends the files as they are."),
            select("awayQuality", [["opus", "Opus 256 kbps"], ["original", "Original"]], s.awayQuality)) +
          '<div class="settings-note">At home it’s always the original.</div>' +
        "</div>" +
        '<div class="settings-divider"></div>' : "") +

      ("cacheWifi" in s && s.cacheChoices ?
        '<div class="settings-block"><div class="settings-subhead">Cached ahead' + settingsInfo("Playing on this phone: the next tracks in the queue are kept on the phone ahead of time, so they play without the network — through a dead spot, or on mobile data without using any. On mobile data " + s.cacheMobile + " tracks is about " + Math.round(s.cacheMobile * 9) + " MB as Opus 256. Tracks stay until the space is needed, so one played again is already here.") + "</div>" +
          row("On Wi-Fi", select("cacheWifi", s.cacheChoices.wifi.map(n => [n, n + " tracks"]), s.cacheWifi)) +
          row("On mobile data", select("cacheMobile", s.cacheChoices.mobile.map(n => [n, n + " tracks"]), s.cacheMobile)) +
          row("Cache size", select("cacheGb", s.cacheChoices.gb.map(g => [g, g + " GB"]), s.cacheGb)) +
          '<div class="settings-row"><span class="settings-label dl-cache-status" id="dl-cache-status">…</span>' +
            '<button type="button" class="settings-update-btn" data-dl-clear-cache>Clear cache</button></div>' +
        "</div>" +
        '<div class="settings-divider"></div>' : "") +

      '<div class="settings-block"><div class="settings-subhead">Automatic downloads' + settingsInfo("Kept on the phone by themselves, in the quality above, and removed again when they drop off the list. Albums you download yourself are never removed.") + "</div>" +
        row("Today’s Smart Picks", toggle("autoPicks", s.autoPicks)) +
        row("Album of the day", toggle("autoAotd", s.autoAotd)) +
        row("Recently added", select("autoRecent", [0, 5, 10, 20, 30].map(n => [n, n ? "The newest " + n : "Off"]), s.autoRecent)) +
        '<div class="settings-note">Removed again when they drop off the list.</div>' +
      "</div>";

    paintCacheStatus();
  }

  // The download folder (v0.5.41): a folder of your own, chosen here on its
  // own — nothing to do with the music on the phone.
  function downloadFolderRow(s) {
    const f = s.folder || { access: "none" };
    if (!has("chooseDownloadFolder")) return "";
    if (!f.chosen) {
      return '<div class="settings-row"><span class="settings-label">Download folder</span>' +
        '<button type="button" class="settings-update-btn" data-dl-choose-folder>Choose</button></div>' +
        '<div class="settings-note">A folder of your own on the phone or an SD card, as a third place to save to. Albums there outlive the app.</div>';
    }
    return '<div class="settings-row"><span class="settings-label">Download folder: ' + esc(f.name || "chosen") + '</span>' +
      '<span><button type="button" class="settings-update-btn" data-dl-choose-folder>Change</button> ' +
      '<button type="button" class="settings-update-btn" data-dl-forget-folder>Forget</button></span></div>';
  }

  // What stands between the download folder and downloads landing in it,
  // and the move of what is elsewhere.
  function folderPlaceNote(s, places) {
    const f = s.folder || { access: "none" };
    let html = "";
    if (f.access === "needed") {
      html += '<div class="settings-row"><span class="settings-label">Save into “' + esc(f.name || "the download folder") + '”</span>' +
        '<button type="button" class="settings-update-btn" data-dl-allow>Allow</button></div>' +
        '<div class="settings-note">Android asks for the app to be allowed all files access first — tap Allow, switch it on, and come back.</div>';
    } else if (f.access === "unmapped") {
      html += '<div class="settings-note">The download folder you chose is on a drive the app can’t write plain files to (a cloud drive, say). Downloads can’t go there; choose a folder on the phone or its SD card.</div>';
    } else if (f.access === "away") {
      html += '<div class="settings-note">The download folder isn’t reachable right now (its card out?). Downloads go to the place above until it is back.</div>';
    }
    const mv = s.moving;
    if (mv) {
      html += '<div class="settings-note">' + (mv.error ? "Moving stopped: " + esc(mv.error) + " (" + mv.done + " of " + mv.total + " moved)"
        : "Moving " + (mv.done + 1 > mv.total ? mv.total : mv.done + 1) + " of " + mv.total + "…") + "</div>";
    } else if (s.elsewhere > 0 && places.length > 1) {
      html += '<div class="settings-row"><span class="settings-label">' + s.elsewhere + (s.elsewhere === 1 ? " album is" : " albums are") + ' saved elsewhere</span>' +
        '<button type="button" class="settings-update-btn" data-dl-move>Move all here</button></div>' +
        '<div class="settings-note">Copied album by album, then removed from where they were. Stopped partway, nothing is lost: each album is whole at one end or the other.</div>';
    }
    return html;
  }

  window.__renderLocalFolder = () => { if (window.__renderMusicFoldersPane) window.__renderMusicFoldersPane(); };

  // Music files on the phone (Stage 5), now on the Music Folders page (v0.5.41): the block's HTML, shared.
  window.__localFolderBlock = function localFolderBlock() {
    let info;
    try { const v = dl.localFolder(); info = v && v !== "null" ? JSON.parse(v) : null; } catch (e) { info = null; }
    let html = '<div class="settings-block" data-local-block><div class="settings-subhead" data-parity="settings-folders.local-title">Music on this phone' + settingsInfo("Music bought on this phone (a Qobuz purchase, say) in a folder of your choosing. Mandarin reads its tags and covers, shows it on Home as “Music on device”, and plays it here through the phone’s DSP. The folder is read again by itself when it changes, when the app comes back, and every few minutes. Forget stops Mandarin reading it; nothing in it is touched.", "settings-folders.info") + "</div>";
    if (!info) {
      html += '<div class="settings-row"><span class="settings-label" data-parity="settings-folders.local-none">No folder chosen</span>' +
        '<button type="button" class="settings-update-btn" data-parity="settings-folders.local-choose" data-local-choose>Choose a folder</button></div>' +
        '<div class="settings-note" data-parity="settings-folders.local-note">Music already on the phone, in a folder you choose.</div>';
    } else {
      const when = info.scanned_at ? new Date(info.scanned_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "never";
      const sub = info.scanning ? "Reading the folder…"
        : !info.available ? "Not reachable right now — its card may be out"
        : info.albums + (info.albums === 1 ? " album" : " albums") + " · " + info.tracks + (info.tracks === 1 ? " track" : " tracks") + " · read " + when;
      html += '<div class="dl-folder" data-parity="settings-folders.local-folder" style="cursor:default"><span class="dl-folder-ico" data-parity="settings-folders.icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>' +
        '<span class="dl-folder-txt"><span class="dl-folder-title" data-parity="settings-folders.local-name">' + esc(info.name) + '</span><span class="dl-folder-sub" data-parity="settings-folders.local-state">' + esc(sub) + "</span></span></div>" +
        (info.error ? '<div class="settings-note away-error" data-parity="settings-folders.local-error">' + esc(info.error) + "</div>" : "") +
        '<div class="dl-toolbar" style="justify-content:flex-start;margin-top:10px">' +
          '<button type="button" class="settings-update-btn" data-parity="settings-folders.local-rescan" data-local-rescan' + (info.scanning ? " disabled" : "") + ">Read again</button>" +
          '<button type="button" class="settings-update-btn" data-parity="settings-folders.local-choose" data-local-choose>Change folder</button>' +
          '<button type="button" class="settings-update-btn" data-parity="settings-folders.local-forget" data-local-forget>Forget</button></div>';
    }
    return html + "</div>";
  };

  // "12 of 20 ahead on the phone · 1.2 GB used", kept current while the pane is open.
  function paintCacheStatus() {
    const el = pane.querySelector("#dl-cache-status");
    if (!el || !has("cacheStatus")) return;
    const c = json(() => dl.cacheStatus(), {});
    const ahead = c.wanted ? c.ahead + " of " + c.wanted + " ahead on the phone" + (c.metered ? " (mobile data)" : "") : "Nothing queued";
    el.textContent = ahead + " · " + size(c.used || 0) + " used";
  }
  setInterval(() => { if (!pane.classList.contains("hidden")) paintCacheStatus(); }, 3000);

  pane.addEventListener("change", (e) => {
    const el = e.target.closest("[data-dl-set]");
    if (!el) return;
    const value = el.type === "checkbox" ? String(el.checked) : el.value;
    try { dl.set(el.getAttribute("data-dl-set"), value); } catch (err) { /* old app */ }
    render();
  });
  pane.addEventListener("click", async (e) => {
    const list = () => json(() => dl.all(), []);
    const titleOf = id => (list().find(d => d.id === id) || {}).title || "this album";
    if (e.target.closest("[data-dl-allow]")) { try { dl.allowAllFiles(); } catch (x) { /* an app without this call (older than the page): nothing to do */ } return; }
    if (e.target.closest("[data-dl-move]")) {
      if (!(await ask("Move every downloaded album to the place chosen under Save to?"))) return;
      try { dl.moveDownloads(); } catch (x) { /* an app without this call (older than the page): nothing to do */ }
      render(); return;
    }
    if (e.target.closest("[data-dl-choose-folder]")) { try { dl.chooseDownloadFolder(); } catch (x) { /* an app without this call (older than the page): nothing to do */ } return; }
    if (e.target.closest("[data-dl-forget-folder]")) {
      if (!(await ask("Forget the download folder?\n\nDownloads go to phone storage from now on. Albums already in the folder stay there, and aren’t shown until it is chosen again."))) return;
      try { dl.forgetDownloadFolder(); } catch (x) { /* an app without this call (older than the page): nothing to do */ }
      render(); return;
    }
    if (e.target.closest("[data-dl-folder]")) { view = "albums"; selecting = false; chosen.clear(); render(); pane.scrollTop = 0; return; }
    if (e.target.closest("[data-dl-back]")) { view = "settings"; selecting = false; chosen.clear(); render(); return; }
    if (e.target.closest("[data-dl-select]")) { selecting = true; chosen.clear(); render(); return; }
    if (e.target.closest("[data-dl-select-done]")) { selecting = false; chosen.clear(); render(); return; }
    if (e.target.closest("[data-dl-select-all]")) {
      const all = list().map(d => d.id);
      if (chosen.size === all.length) chosen.clear(); else all.forEach(id => chosen.add(id));
      render(); return;
    }
    const pick = e.target.closest("[data-dl-choose]");
    if (pick) {
      const id = Number(pick.getAttribute("data-dl-choose"));
      if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
      render(); return;
    }
    if (e.target.closest("[data-dl-delete-chosen]")) {
      const ids = [...chosen];
      if (!ids.length) return;
      const one = ids.length === 1;
      if (!(await ask("Remove " + (one ? "“" + titleOf(ids[0]) + "”" : ids.length + " albums") + " from this phone?\n\n" +
                      (one ? "It stays" : "They stay") + " in your library on the server."))) return;
      removeAlbums(ids);
      selecting = false;
      render(); return;
    }
    if (e.target.closest("[data-dl-clear-all]")) {
      const ids = list().map(d => d.id);
      if (!ids.length) return;
      if (!(await ask("Remove all " + ids.length + (ids.length === 1 ? " album" : " albums") + " from this phone?\n\n" +
                      "Everything downloaded goes (downloads under way are stopped). They stay in your library on the server."))) return;
      removeAlbums(ids);
      render(); return;
    }
    const play = e.target.closest("[data-dl-play]");
    if (play) { try { dl.play(Number(play.getAttribute("data-dl-play"))); } catch (err) { /* an app without this call (older than the page): nothing to do */ } return; }
    const rm = e.target.closest("[data-dl-remove]");
    if (rm) {
      const id = Number(rm.getAttribute("data-dl-remove"));
      if (has("removeMany")) {
        if (await ask("Remove “" + titleOf(id) + "” from this phone?\n\nIt stays in your library on the server.")) { removeAlbums([id]); render(); }
      } else dl.remove(id);   // an older app asks itself
      return;
    }
    if (e.target.closest("[data-dl-clear-cache]")) {
      try { dl.clearCache(); } catch (err) { /* an app without this call (older than the page): nothing to do */ }
      paintCacheStatus();
      return;
    }
    const open = e.target.closest("[data-dl-open]");
    if (open) {
      const al = covers.get(Number(open.getAttribute("data-dl-open")));
      if (al && window.__openAlbum) {
        const closer = document.querySelector("#settings-overlay [data-settings-close]");
        if (closer) closer.click();
        window.__openAlbum(al, { source: "home", filter: null });
      }
    }
  });
  tile.addEventListener("click", () => { view = "settings"; selecting = false; chosen.clear(); render(); });   // before the sheet shows the pane

  // The phone's Back: out of selecting, then from the albums to the settings.
  const settingsBack = window.__musicdBack;
  window.__musicdBack = () => {
    if (!pane.classList.contains("hidden") && view === "albums") {
      if (selecting) { selecting = false; chosen.clear(); } else view = "settings";
      render();
      return true;
    }
    return settingsBack ? settingsBack() : false;
  };

  // Downloads moving on (the app calls this) redraw the pane while it's open.
  const previous = window.__musicdDownloadsChanged;
  window.__musicdDownloadsChanged = () => {
    if (previous) previous();
    if (!pane.classList.contains("hidden")) render();
  };
})();
