/* Settings → Services → iBroadcast (item 443), a page of its own: signed out, Sign in on iBroadcast, which shows a link
 * and a code to approve Mandarin with there, and asks the server every two seconds whether it has been; signed in, the
 * account's name, whether it is Premium, the formats iBroadcast takes, its albums in the library on or off, Update
 * library now and what the library holds of it (item 444), and Sign out; then Upload (item 446): how the one under way
 * is going (asked every two seconds while it goes), or what the last one did, Upload now and Stop upload, and the files
 * left out or not sent, with why; and the upload on a schedule (item 447): its switch and hours, which can't overlap the
 * Library Scanner's (those said under them; a window that would is refused, in the server's words); and what it is
 * from and how hard it pushes (item 451): Upload from (All music or a drive; none at first), files at once, and whether
 * it goes on while music plays at home, or away from home, each with its own number at once. The app's page is its own (SettingsIBroadcast.kt), worded the same (core's
 * IBroadcastSettings.kt). */

/** What the page says of the account ([j]: GET /api/settings/ibroadcast). @param {any} j */
function ibroadcastWords(j) {
  const on = !!(j && j.connected), pending = !on && j && j.pending;
  return {
    on, pending,
    status: on ? "Signed in as " + ((j.user && j.user.name) || "your account")
      : pending ? (pending.error || "Waiting for Mandarin to be approved on iBroadcast…") : "",
    premium: !on ? "" : j.premium === true ? "Yes: your files play as they are" : j.premium === false ? "No: iBroadcast plays everything as 128 kbps MP3" : "iBroadcast didn't say",
    formats: on ? ((j.formats || []).map((/** @type {string} */ f) => f.toUpperCase()).join(", ") || "iBroadcast didn't say") : "",
    library: on ? ibroadcastLibraryWords(j.library || {}) : "",
    reading: !!(on && j.library && j.library.reading),
  };
}

/** What the library holds of iBroadcast ([l]: the state's library). @param {any} l */
function ibroadcastLibraryWords(l) {
  if (l.import === false) return "Off: your iBroadcast albums are not in the library. Switch on to show them.";
  if (l.reading) return "Reading your iBroadcast library…";
  if (typeof l.albums !== "number") return "Your iBroadcast library is read shortly after signing in.";
  const n = l.albums, here = l.also_here || 0;
  return n + " album" + (n === 1 ? "" : "s") + " in iBroadcast" + (here ? " · " + here + " of them here as files too, shown once" : "")
    + " · updated " + new Date(l.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** A size in bytes as the page says it: "512 KB", "3.4 MB", "1.2 GB". @param {number} b */
function ibroadcastSize(b) {
  return b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB";
}

/** The time left, in words: "about 2 h 5 min left", "about 12 min left", "under a minute left". @param {number} s */
function ibroadcastLeft(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? "about " + h + " h " + m + " min left" : m > 0 ? "about " + m + " min left" : "under a minute left";
}

/**
 * What the page says of the upload ([u]: the state's upload; [at]: a moment as the page writes a date): the line under
 * Upload, the progress under it, and the files left out or not sent, a line each.
 * @param {any} u @param {(ms: number) => string} at
 */
function ibroadcastUploadWords(u, at) {
  if (!u) return { running: false, status: "Nothing uploaded from here yet.", progress: "", problems: "" };
  const problems = (u.problems || []).map((/** @type {any} */ p) => String(p.file).split(/[\\/]/).pop() + ": " + p.why).join("\n");
  if (u.running) {
    if (!u.files_total && !u.files_done) return { running: true, status: "Looking at what iBroadcast has…", progress: "", problems };
    const parts = [u.files_done + " of " + u.files_total + " files", ibroadcastSize(u.bytes_done) + " of " + ibroadcastSize(u.bytes_total)];
    if (u.speed > 0) parts.push(ibroadcastSize(u.speed) + "/s");
    if (typeof u.eta === "number") parts.push(ibroadcastLeft(u.eta));
    const status = u.held ? (u.held_where === "away" ? "Paused while music plays away from home" : "Paused while music plays") : "Uploading " + (u.album || "…");
    return { running: true, status, progress: parts.join(" · "), problems };
  }
  const how = u.stopped ? "Stopped" : u.error ? "Ended: " + u.error : "Done";
  const said = [u.uploaded + " uploaded", u.already + " already in iBroadcast"];
  if (u.converted) said.push(u.converted + " made FLAC");
  if (u.skipped) said.push(u.skipped + " left out");
  if (u.failed) said.push(u.failed + " not sent");
  return { running: false, status: how + " · " + at(u.finished), progress: said.join(" · "), problems };
}

/** What the upload schedule's switch says (item 447). @param {boolean} on */
function ibroadcastScheduleNote(on) {
  return on ? "Uploads each day between these times, stopping at the end" : "Off: uploads only when you tap Upload now";
}

/** The Library Scanner's hours, said beside the upload window's ([h]: the state's scanner_hours). @param {any} h */
function ibroadcastScannerHours(h) {
  if (!h) return "";
  return h.on ? "The Library Scanner runs " + h.start + "–" + h.end + ": the upload window can't overlap it."
    : "The Library Scanner has no hours (its Schedule is off): give it hours in Library Scanner to upload on a schedule.";
}

/** What the page says under Upload from ([c]: the state's upload_settings): to choose, where nothing is. @param {any} c */
function ibroadcastFromNote(c) {
  return c && c.from ? "" : "Choose All music or a drive to upload from.";
}

(function initIBroadcast() {
  if (EMBED) return;   // not in the Shelf's frame (embed-flag.js)
  const $ = (/** @type {string} */ id) => document.getElementById(id);
  const signin = $("ib-signin"), form = $("ib-signin-form"), pendingBox = $("ib-pending"), link = /** @type {HTMLAnchorElement|null} */ ($("ib-auth-link"));
  const code = $("ib-auth-code"), cancel = $("ib-signin-cancel"), status = $("ib-status"), signed = $("ib-signed");
  const premium = $("ib-premium"), formats = $("ib-formats"), signout = $("ib-signout");
  const importBox = /** @type {HTMLInputElement|null} */ ($("ib-import")), libraryNow = $("ib-library-now"), libraryStatus = $("ib-library-status");
  const uploadBlock = $("ib-upload-block"), uploadNow = $("ib-upload-now"), uploadStop = $("ib-upload-stop");
  const uploadStatus = $("ib-upload-status"), uploadProgress = $("ib-upload-progress"), uploadProblems = $("ib-upload-problems");
  const schedBox = /** @type {HTMLInputElement|null} */ ($("ib-schedule")), schedNote = $("ib-schedule-note"), schedTimes = $("ib-schedule-times");
  const startBox = /** @type {HTMLInputElement|null} */ ($("ib-start")), endBox = /** @type {HTMLInputElement|null} */ ($("ib-end")), scannerHours = $("ib-scanner-hours");
  const fromBox = $("ib-from"), fromNote = $("ib-from-note"), homeBox = /** @type {HTMLInputElement|null} */ ($("ib-home")), awayBox = /** @type {HTMLInputElement|null} */ ($("ib-away"));
  const homeRow = $("ib-home-row"), awayRow = $("ib-away-row");
  /* A row of choices ([box]: buttons it is redrawn with, each [value, label]; [on] the one in force). */
  const choices = (/** @type {HTMLElement|null} */ box, /** @type {[string, string][]} */ list, /** @type {string} */ on, /** @type {string} */ key) => {
    if (!box) return;
    const esc = (/** @type {string} */ x) => x.replace(/[&<>"']/g, ch => "&#" + ch.charCodeAt(0) + ";");
    const html = list.map(([v, label]) => '<button type="button" class="seg-btn' + (v === on ? " is-on" : "") + '" data-parity="' + key + '" data-value="' + esc(v) + '">' + esc(label) + "</button>").join("");
    if (box.innerHTML !== html) box.innerHTML = html;
  };
  const counts = /** @type {[string, string][]} */ ([["1", "1"], ["2", "2"], ["3", "3"]]);
  const when = (/** @type {number} */ ms) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  if (!signin || !status) return;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let again;

  /** @param {any} j */
  function paint(j) {
    const w = ibroadcastWords(j);
    if (form) form.hidden = w.on;
    signin.hidden = !!w.pending;
    if (pendingBox) pendingBox.hidden = !w.pending;
    if (w.pending && link) { link.href = w.pending.url; link.textContent = w.pending.url.replace(/^https?:\/\//, ""); }
    if (w.pending && code) code.textContent = w.pending.code || "";
    if (signed) signed.hidden = !w.on;
    status.textContent = w.status;
    if (premium) premium.textContent = w.premium;
    if (formats) formats.textContent = w.formats;
    if (importBox && w.on) importBox.checked = !(j.library && j.library.import === false);
    if (libraryNow) libraryNow.classList.toggle("hidden", !(w.on && !(j.library && j.library.import === false)));
    if (libraryStatus) libraryStatus.textContent = w.library;
    const up = ibroadcastUploadWords(w.on ? j.upload : null, when);
    if (uploadBlock) uploadBlock.hidden = !w.on;
    if (uploadStatus) uploadStatus.textContent = up.status;
    if (uploadProgress) uploadProgress.textContent = up.progress;
    if (uploadProblems) uploadProblems.textContent = up.problems;
    if (uploadNow) uploadNow.classList.toggle("hidden", up.running);
    if (uploadStop) uploadStop.classList.toggle("hidden", !up.running);
    const sch = (w.on && j.schedule) || { on: false, start: "", end: "" };
    if (schedBox) schedBox.checked = !!sch.on;
    if (schedNote) schedNote.textContent = ibroadcastScheduleNote(!!sch.on);
    if (schedTimes) schedTimes.hidden = !sch.on;
    if (startBox && document.activeElement !== startBox) startBox.value = sch.start;
    if (endBox && document.activeElement !== endBox) endBox.value = sch.end;
    if (scannerHours) scannerHours.textContent = w.on ? ibroadcastScannerHours(j.scanner_hours) : "";
    const c = (w.on && j.upload_settings) || {};
    // Each written out, as npm run parity reads the keys here.
    choices(fromBox, /** @type {[string, string][]} */ ([["all", "All music"]]).concat((j.upload_sources || []).map((/** @type {any} */ x) => [x.path, x.name])), c.from || "", "settings-ibroadcast.from");
    if (fromNote) fromNote.textContent = w.on ? ibroadcastFromNote(c) : "";
    choices($("ib-at-once"), counts, String(c.at_once || 3), "settings-ibroadcast.at-once");
    choices($("ib-home-at-once"), counts, String(c.home_at_once || 3), "settings-ibroadcast.home-at-once");
    choices($("ib-away-at-once"), counts, String(c.away_at_once || 1), "settings-ibroadcast.away-at-once");
    if (homeBox) homeBox.checked = !!c.home;
    if (awayBox) awayBox.checked = !!c.away;
    if (homeRow) homeRow.hidden = !c.home;
    if (awayRow) awayRow.hidden = !c.away;
    clearTimeout(again);
    if ((w.pending && !w.pending.error) || w.reading || (w.on && up.running)) again = setTimeout(look, 2000);
  }
  async function look() {
    try { paint(await (await fetch("/api/settings/ibroadcast", { cache: "no-store" })).json()); } catch (e) { /* the page shows the last state */ }
  }
  /** @param {string} path @param {object} [body] */
  const post = (path, body = {}) => fetch("/api/settings/ibroadcast" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  signin.addEventListener("click", async () => {
    signin.setAttribute("disabled", "");
    try {
      const r = await post("/signin");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't start the sign-in");
      paint(j);
      if (j.pending && j.pending.url) window.open(j.pending.url, "_blank", "noopener");
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
    finally { signin.removeAttribute("disabled"); }
  });
  if (importBox) importBox.addEventListener("change", async () => {
    try {
      const r = await fetch("/api/settings/ibroadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ import: importBox.checked }) });
      paint(await r.json());
      // The walls and Home drawn again: the albums are in or out at once.
      if (typeof window.__libraryChanged === "function") window.__libraryChanged();
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
  });
  if (libraryNow) libraryNow.addEventListener("click", async () => {
    libraryNow.setAttribute("disabled", "");
    if (libraryStatus) libraryStatus.textContent = "Reading your iBroadcast library…";
    try {
      const r = await post("/library");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't read the iBroadcast library");
      paint(j);
      if (typeof window.__libraryChanged === "function") window.__libraryChanged();
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); look(); }
    finally { libraryNow.removeAttribute("disabled"); }
  });
  for (const [button, path] of /** @type {[HTMLElement|null, string][]} */ ([[uploadNow, "/upload"], [uploadStop, "/upload/stop"]])) {
    if (button) button.addEventListener("click", async () => {
      button.setAttribute("disabled", "");
      try {
        const r = await post(path);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Couldn't reach iBroadcast");
        paint(j);
      } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); look(); }
      finally { button.removeAttribute("disabled"); }
    });
  }
  /* The schedule changed ([patch]: on, start or end): kept, or refused in the server's words and put back. @param {object} patch */
  async function schedule(patch) {
    try {
      const r = await post("/schedule", patch);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't keep the schedule");
      paint(j);
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); look(); }
  }
  /* A choice of the upload's changed ([patch]): kept, or refused in the server's words. @param {object} patch */
  async function setChoice(patch) {
    try {
      const r = await post("/upload/settings", patch);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't keep that");
      paint(j);
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); look(); }
  }
  if (fromBox) fromBox.addEventListener("click", e => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-value]"));
    if (b) setChoice({ from: b.dataset.value });
  });
  for (const id of ["ib-at-once", "ib-home-at-once", "ib-away-at-once"]) {
    const box = $(id);
    if (box) box.addEventListener("click", e => {
      const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-value]"));
      if (b) setChoice({ [String(box.dataset.key)]: Number(b.dataset.value) });
    });
  }
  if (homeBox) homeBox.addEventListener("change", () => setChoice({ home: homeBox.checked }));
  if (awayBox) awayBox.addEventListener("change", () => setChoice({ away: awayBox.checked }));
  if (schedBox) schedBox.addEventListener("change", () => schedule({ on: schedBox.checked }));
  for (const [box, key] of /** @type {[HTMLInputElement|null, string][]} */ ([[startBox, "start"], [endBox, "end"]])) {
    if (box) box.addEventListener("change", () => { if (box.value) schedule({ [key]: box.value }); });
  }
  if (cancel) cancel.addEventListener("click", async () => { await post("/signin/cancel").catch(() => {}); look(); });
  if (signout) signout.addEventListener("click", async () => {
    signout.setAttribute("disabled", "");
    try { paint(await (await post("/signout")).json()); settingsToast("Signed out of iBroadcast", "ok"); }
    catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
    finally { signout.removeAttribute("disabled"); }
  });
  // Looked at as the page opens.
  document.querySelectorAll('.settings-nav-item[data-pane="ibroadcast"]').forEach(b => b.addEventListener("click", look));
  look();
})();
