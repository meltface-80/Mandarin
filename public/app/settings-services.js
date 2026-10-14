/* The Settings sheet (app/settings.js), 2 of 4: Wall display, Qobuz and Tidal. */
// ----- Wall display (/display): toggle + rotation interval -----
const displayToggle    = document.getElementById("display-toggle");
const displaySeconds   = document.getElementById("display-seconds");
const displaySecsValue = document.getElementById("display-seconds-value");

async function loadDisplaySettings() {
  try {
    const r = await fetch("/api/settings/display");
    const j = await r.json();
    if (displayToggle) displayToggle.checked = !!j.enabled;
    if (displaySeconds && Number.isFinite(parseInt(j.seconds, 10))) {
      displaySeconds.value = j.seconds;
      if (displaySecsValue) displaySecsValue.textContent = j.seconds + "s";
    }
  } catch (_) { /* display-only status — if the fetch fails, the sheet just shows defaults */ }
}

async function saveDisplaySettings() {
  try {
    const r = await fetch("/api/settings/display", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: displayToggle ? displayToggle.checked : false,
        seconds: displaySeconds ? parseInt(displaySeconds.value, 10) : 10
      })
    });
    const j = await r.json();
    if (!j.ok) settingsToast("Display settings didn't persist — check the data volume", "error");
  } catch (e) {
    settingsToast("Failed: " + e.message, "error");
  }
}

if (displayToggle) displayToggle.addEventListener("change", saveDisplaySettings);
if (displaySeconds) {
  // Live value while dragging; persist on release.
  displaySeconds.addEventListener("input", () => {
    if (displaySecsValue) displaySecsValue.textContent = displaySeconds.value + "s";
  });
  displaySeconds.addEventListener("change", saveDisplaySettings);
}
const lfdInput  = document.getElementById("label-folder-depth-input");
const lfdSave   = document.getElementById("label-folder-depth-save");
const lfdStatus = document.getElementById("label-folder-depth-status");

async function loadLabelFolderDepth() {
  try {
    const r = await fetch("/api/settings/label-folder-depth");
    const j = await r.json();
    if (lfdInput && document.activeElement !== lfdInput) lfdInput.value = j.depth || 0;
    if (lfdStatus) lfdStatus.textContent = j.depth ? ("Using folder depth " + j.depth) : "Off — using file label tags";
  } catch (_) { /* display-only status — stale on failure is fine */ }
}

if (lfdSave) {
  lfdSave.addEventListener("click", async () => {
    const depth = parseInt(lfdInput ? lfdInput.value : "0", 10) || 0;
    lfdSave.disabled = true;
    try {
      const r = await fetch("/api/settings/label-folder-depth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth })
      });
      const j = await r.json();
      if (j.ok) {
        settingsToast(j.rescanning ? "Saved — re-scanning labels…" : "Saved", "ok");
        loadLabelFolderDepth();
      } else {
        settingsToast(j.error || "Failed to save", "error");
      }
    } catch (e) {
      settingsToast("Failed: " + e.message, "error");
    } finally {
      lfdSave.disabled = false;
    }
  });
}

// ----- Qobuz (v0.6.23): Settings → Services -------------------------------
const qobuzUser       = document.getElementById("qobuz-username");
const qobuzPass       = document.getElementById("qobuz-password");
const qobuzSignin     = document.getElementById("qobuz-signin");
const qobuzForm       = document.getElementById("qobuz-signin-form");
const qobuzSigned     = document.getElementById("qobuz-signed");
const qobuzQuality    = document.getElementById("qobuz-quality");
const qobuzImport     = document.getElementById("qobuz-import");
const qobuzImportNow  = document.getElementById("qobuz-import-now");
const qobuzImportSt   = document.getElementById("qobuz-import-status");
const qobuzDisconnect = document.getElementById("qobuz-disconnect");
const qobuzStatus     = document.getElementById("qobuz-status");
const qobuzTopbarBtn  = document.getElementById("qobuz-toggle");
const qobuzMenuItem   = document.getElementById("menu-item-qobuz");

function paintQobuz(j) {
  const on = !!j.connected;
  if (qobuzForm) qobuzForm.hidden = on;
  if (qobuzSigned) qobuzSigned.hidden = !on;
  if (qobuzStatus) qobuzStatus.textContent = on
    ? ("Signed in as " + (j.user && (j.user.name || j.user.login) || "") + (j.subscription ? " · " + j.subscription : "") +
       (j.hires ? " · Hi-Res" : j.lossless ? " · CD quality" : ""))
    : "Not signed in.";
  if (qobuzQuality && on) qobuzQuality.value = j.quality || "hires192";
  if (qobuzImport && on) qobuzImport.checked = j.import !== false;
  if (qobuzImportSt && on) {
    const li = j.last_import;
    // Off (v0.7.10): none of the service's albums in the library, and
    // nothing to update until it is on again.
    if (qobuzImportNow) qobuzImportNow.classList.toggle("hidden", j.import === false);
    qobuzImportSt.textContent = j.import === false ? "Off: your Qobuz albums and playlists are not in the library. Switch on to show them."
      : j.importing ? "Bringing your Qobuz favourites and purchases into the library…"
      : li ? (li.albums + " Qobuz album" + (li.albums === 1 ? "" : "s") + " in the library · updated " + new Date(li.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) +
             (li.failed ? " · " + li.failed + " couldn't be read" : ""))
      : (j.import !== false ? "The library is brought up to date shortly after signing in." : "Only what you play from the Qobuz browser is known here.");
  }
  // The browser's button and the menu's entry: only with an account to browse with.
  if (qobuzTopbarBtn) qobuzTopbarBtn.classList.toggle("hidden", !on);
  if (qobuzMenuItem)  qobuzMenuItem.classList.toggle("hidden", !on);
}
async function loadQobuzStatus() {
  try {
    const r = await fetch("/api/settings/qobuz", { cache: "no-store" });
    paintQobuz(await r.json());
  } catch (_) { /* display-only status — stale on failure is fine */ }
}
window.__qobuzStatus = loadQobuzStatus;

if (qobuzSignin) {
  const go = async () => {
    const username = qobuzUser ? qobuzUser.value.trim() : "", password = qobuzPass ? qobuzPass.value : "";
    if (!username || !password) { settingsToast("Your Qobuz email and password", "error"); return; }
    qobuzSignin.disabled = true;
    if (qobuzStatus) qobuzStatus.textContent = "Signing in…";
    try {
      const r = await fetch("/api/settings/qobuz/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || "Couldn't sign in");
      if (qobuzPass) qobuzPass.value = "";
      settingsToast("Signed in to Qobuz", "ok");
      paintQobuz(j);
      // The import's progress, while it runs.
      const tick = setInterval(async () => { await loadQobuzStatus(); if (!(await (await fetch("/api/settings/qobuz")).json()).importing) clearInterval(tick); }, 4000);
    } catch (e) {
      if (qobuzStatus) qobuzStatus.textContent = "";
      settingsToast(e.message, "error");
    } finally { qobuzSignin.disabled = false; }
  };
  qobuzSignin.addEventListener("click", go);
  if (qobuzPass) qobuzPass.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}
if (qobuzQuality) qobuzQuality.addEventListener("change", async () => {
  try {
    const r = await fetch("/api/settings/qobuz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quality: qobuzQuality.value }) });
    paintQobuz(await r.json());
  } catch (e) { settingsToast(e.message, "error"); }
});
if (qobuzImport) qobuzImport.addEventListener("change", async () => {
  try {
    const r = await fetch("/api/settings/qobuz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ import: qobuzImport.checked }) });
    paintQobuz(await r.json());
    // The walls, Home and Playlists drawn again: the albums are in or out at once.
    if (typeof window.__libraryChanged === "function") window.__libraryChanged();
  } catch (e) { settingsToast(e.message, "error"); }
});
if (qobuzImportNow) qobuzImportNow.addEventListener("click", async () => {
  qobuzImportNow.disabled = true;
  if (qobuzImportSt) qobuzImportSt.textContent = "Bringing your Qobuz favourites and purchases into the library…";
  try {
    const r = await fetch("/api/settings/qobuz/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || "Couldn't update");
    settingsToast(j.result.albums + " Qobuz albums in the library", "ok");
    loadQobuzStatus();
  } catch (e) { settingsToast(e.message, "error"); loadQobuzStatus(); }
  finally { qobuzImportNow.disabled = false; }
});
if (qobuzDisconnect) {
  qobuzDisconnect.addEventListener("click", async () => {
    qobuzDisconnect.disabled = true;
    try {
      await fetch("/api/settings/qobuz/signout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      settingsToast("Signed out of Qobuz", "ok");
      loadQobuzStatus();
    } catch (e) { settingsToast("Failed: " + e.message, "error"); }
    finally { qobuzDisconnect.disabled = false; }
  });
}
loadQobuzStatus();

// ----- Tidal (v0.6.24): Settings → Services -------------------------------
// Signed in on tidal.com: Mandarin shows a link and a code, and asks the
// server every two seconds whether the sign-in has landed.
const tidalSignin     = document.getElementById("tidal-signin");
const tidalForm       = document.getElementById("tidal-signin-form");
const tidalPending    = document.getElementById("tidal-pending");
const tidalAuthLink   = document.getElementById("tidal-auth-link");
const tidalAuthCode   = document.getElementById("tidal-auth-code");
const tidalCancel     = document.getElementById("tidal-signin-cancel");
const tidalSigned     = document.getElementById("tidal-signed");
const tidalQuality    = document.getElementById("tidal-quality");
const tidalImport     = document.getElementById("tidal-import");
const tidalImportNow  = document.getElementById("tidal-import-now");
const tidalImportSt   = document.getElementById("tidal-import-status");
const tidalDisconnect = document.getElementById("tidal-disconnect");
const tidalStatus     = document.getElementById("tidal-status");
const tidalTopbarBtn  = document.getElementById("tidal-toggle");
const tidalMenuItem   = document.getElementById("menu-item-tidal");
let tidalPoll = null;

function paintTidal(j) {
  const on = !!(j && j.connected);
  const pending = !on && j && j.pending;
  if (tidalForm) tidalForm.hidden = on;
  if (tidalSignin) tidalSignin.hidden = !!pending;
  if (tidalPending) tidalPending.hidden = !pending;
  if (pending) {
    if (tidalAuthLink) { tidalAuthLink.href = pending.url; tidalAuthLink.textContent = pending.url.replace(/^https?:\/\//, ""); }
    if (tidalAuthCode) tidalAuthCode.textContent = pending.code || "";
  }
  if (tidalSigned) tidalSigned.hidden = !on;
  if (tidalStatus) tidalStatus.textContent = on
    ? ("Signed in as " + ((j.user && (j.user.name || j.user.login)) || "your account") + (j.subscription ? " · " + j.subscription.replace(/_/g, " ").toLowerCase() : "") + (j.hires ? " · Hi-Res" : j.lossless ? " · CD quality" : ""))
    : pending ? (pending.error ? pending.error : "Waiting for the sign-in on tidal.com…") : "";
  if (tidalQuality && on) tidalQuality.value = j.quality || "hires";
  if (tidalImport && on) tidalImport.checked = j.import !== false;
  if (tidalImportSt && on) {
    const li = j.last_import;
    // Off (v0.7.10): none of the service's albums in the library, and
    // nothing to update until it is on again.
    if (tidalImportNow) tidalImportNow.classList.toggle("hidden", j.import === false);
    tidalImportSt.textContent = j.import === false ? "Off: your Tidal albums and playlists are not in the library. Switch on to show them."
      : j.importing ? "Bringing your Tidal favourites into the library…"
      : li ? (li.albums + " Tidal album" + (li.albums === 1 ? "" : "s") + " in the library · updated " + new Date(li.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) +
        (li.playlists ? " · " + li.playlists + " playlist" + (li.playlists === 1 ? "" : "s") : ""))
      : (j.import !== false ? "The library is brought up to date shortly after signing in." : "Only what you play from the Tidal browser is known here.");
  }
  if (tidalTopbarBtn) tidalTopbarBtn.classList.toggle("hidden", !on);
  if (tidalMenuItem)  tidalMenuItem.classList.toggle("hidden", !on);
  // While a sign-in is pending, or an import runs, look again shortly.
  const again = (pending && !pending.error) || (on && j.importing);
  clearTimeout(tidalPoll);
  if (again) tidalPoll = setTimeout(loadTidalStatus, 2000);
}
async function loadTidalStatus() {
  try {
    const r = await fetch("/api/settings/tidal", { cache: "no-store" });
    paintTidal(await r.json());
  } catch (e) { /* the page shows the last state */ }
}
window.__tidalStatus = loadTidalStatus;
if (tidalSignin) tidalSignin.addEventListener("click", async () => {
  tidalSignin.disabled = true;
  try {
    const r = await fetch("/api/settings/tidal/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Couldn't start the sign-in");
    paintTidal(j);
    if (j.pending && j.pending.url) window.open(j.pending.url, "_blank", "noopener");
  } catch (e) { settingsToast(e.message, "error"); }
  finally { tidalSignin.disabled = false; }
});
if (tidalCancel) tidalCancel.addEventListener("click", async () => {
  await fetch("/api/settings/tidal/signin/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  loadTidalStatus();
});
if (tidalQuality) tidalQuality.addEventListener("change", async () => {
  try {
    const r = await fetch("/api/settings/tidal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quality: tidalQuality.value }) });
    paintTidal(await r.json());
  } catch (e) { settingsToast(e.message, "error"); }
});
if (tidalImport) tidalImport.addEventListener("change", async () => {
  try {
    const r = await fetch("/api/settings/tidal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ import: tidalImport.checked }) });
    paintTidal(await r.json());
    // The walls, Home and Playlists drawn again: the albums are in or out at once.
    if (typeof window.__libraryChanged === "function") window.__libraryChanged();
  } catch (e) { settingsToast(e.message, "error"); }
});
if (tidalImportNow) tidalImportNow.addEventListener("click", async () => {
  tidalImportNow.disabled = true;
  if (tidalImportSt) tidalImportSt.textContent = "Bringing your Tidal favourites into the library…";
  try {
    const r = await fetch("/api/settings/tidal/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Couldn't update the library");
    settingsToast(j.result.albums + " Tidal albums in the library", "ok");
    loadTidalStatus();
  } catch (e) { settingsToast(e.message, "error"); loadTidalStatus(); }
  finally { tidalImportNow.disabled = false; }
});
if (tidalDisconnect) tidalDisconnect.addEventListener("click", async () => {
  tidalDisconnect.disabled = true;
  try {
    await fetch("/api/settings/tidal/signout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    settingsToast("Signed out of Tidal", "ok");
    loadTidalStatus();
  } catch (e) { settingsToast(e.message, "error"); }
  finally { tidalDisconnect.disabled = false; }
});
loadTidalStatus();
