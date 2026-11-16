/* Settings → Services → iBroadcast (item 443), a page of its own: signed out, Sign in on iBroadcast, which shows a link
 * and a code to approve Mandarin with there, and asks the server every two seconds whether it has been; signed in, the
 * account's name, whether it is Premium, the formats iBroadcast takes, its albums in the library on or off, Update
 * library now and what the library holds of it (item 444), and Sign out; then Upload (item 446): how the one under way
 * is going (asked every two seconds while it goes), or what the last one did, Upload now and Stop upload, and the files
 * left out or not sent, with why. The app's page is its own (SettingsIBroadcast.kt), worded the same (core's
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
    return { running: true, status: u.held ? "Paused while music plays" : "Uploading " + (u.album || "…"), progress: parts.join(" · "), problems };
  }
  const how = u.stopped ? "Stopped" : u.error ? "Ended: " + u.error : "Done";
  const said = [u.uploaded + " uploaded", u.already + " already in iBroadcast"];
  if (u.converted) said.push(u.converted + " made FLAC");
  if (u.skipped) said.push(u.skipped + " left out");
  if (u.failed) said.push(u.failed + " not sent");
  return { running: false, status: how + " · " + at(u.finished), progress: said.join(" · "), problems };
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
    clearTimeout(again);
    if ((w.pending && !w.pending.error) || w.reading || (w.on && up.running)) again = setTimeout(look, 2000);
  }
  async function look() {
    try { paint(await (await fetch("/api/settings/ibroadcast", { cache: "no-store" })).json()); } catch (e) { /* the page shows the last state */ }
  }
  /** @param {string} path */
  const post = path => fetch("/api/settings/ibroadcast" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

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
