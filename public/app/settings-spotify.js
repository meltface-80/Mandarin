/* Settings → Services → Spotify (item 497), a page of its own. Signed out: Sign in on Spotify opens Spotify's page to
 * approve Mandarin; Spotify then sends you to an address on this computer (http://127.0.0.1:43143/…) that doesn't
 * open, and its whole address is pasted here to finish (the Android app catches it by itself). Signed in: the account's
 * name, your saved albums in the library on or off, Update library now (asked every two seconds while it runs), and
 * Sign out. The app's page is its own (SettingsSpotify.kt), worded the same. */
(() => {
  const $ = (/** @type {string} */ id) => document.getElementById(id);
  const signin = $("spotify-signin"), form = $("spotify-signin-form"), pending = $("spotify-pending");
  const paste = /** @type {HTMLInputElement|null} */ ($("spotify-paste")), finish = $("spotify-finish"), cancel = $("spotify-signin-cancel");
  const signed = $("spotify-signed"), status = $("spotify-status");
  const importBox = /** @type {HTMLInputElement|null} */ ($("spotify-import")), importNow = $("spotify-import-now"), importSt = $("spotify-import-status");
  const signout = $("spotify-disconnect");
  if (!signin || !signed) return;
  let poll = 0, asked = 0;

  const post = (/** @type {string} */ sub, /** @type {object} */ body) =>
    fetch("/api/settings/spotify" + sub, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

  /** @param {any} j */
  function paint(j) {
    const on = !!(j && j.connected);
    const waiting = !on && !!(j && j.pending);
    if (form) form.hidden = on;
    signin.hidden = waiting;
    if (pending) pending.hidden = !waiting;
    signed.hidden = !on;
    if (status) status.textContent = on ? "Signed in as " + ((j.user && (j.user.name || j.user.login)) || "your account") : "";
    if (on && importBox) importBox.checked = j.import === true;
    if (on && importSt) {
      const li = j.last_import;
      if (importNow) importNow.classList.toggle("hidden", j.import !== true);
      importSt.textContent = j.import !== true ? "Off: your Spotify albums are not in the library. Switch on to show them."
        : j.importing ? "Bringing your Spotify albums into the library…"
        : li ? (li.albums + " Spotify album" + (li.albums === 1 ? "" : "s") + " in the library · updated " + new Date(li.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))
        : "The library is brought up to date shortly.";
    }
    clearTimeout(poll);
    if (on && j.importing) poll = window.setTimeout(look, 2000);
  }

  // A look is painted only when it is the latest asked: an older answer that comes late is dropped.
  async function look() {
    const mine = ++asked;
    try {
      const j = await (await fetch("/api/settings/spotify", { cache: "no-store" })).json();
      if (mine === asked) paint(j);
    } catch (e) { /* the page shows the last state */ }
  }

  signin.addEventListener("click", async () => {
    signin.setAttribute("disabled", "");
    try {
      const r = await post("/signin", {});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't start the sign-in");
      asked++;
      paint(j);
      if (paste) paste.value = "";
      window.open(j.url, "_blank", "noopener");
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
    finally { signin.removeAttribute("disabled"); }
  });
  if (finish) finish.addEventListener("click", async () => {
    const address = paste ? paste.value.trim() : "";
    if (!address) { settingsToast("Paste the address Spotify sent you to first", "error"); return; }
    finish.setAttribute("disabled", "");
    try {
      const r = await post("/signin/finish", { address });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't finish the sign-in");
      asked++;
      paint(j);
      settingsToast("Signed in to Spotify", "ok");
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
    finally { finish.removeAttribute("disabled"); }
  });
  if (cancel) cancel.addEventListener("click", async () => { await post("/signin/cancel", {}).catch(() => {}); look(); });
  if (importBox) importBox.addEventListener("change", async () => {
    try {
      const r = await post("", { import: importBox.checked });
      asked++;
      paint(await r.json());
      if (typeof window.__libraryChanged === "function") window.__libraryChanged();
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
  });
  if (importNow) importNow.addEventListener("click", async () => {
    importNow.setAttribute("disabled", "");
    if (importSt) importSt.textContent = "Bringing your Spotify albums into the library…";
    try {
      const r = await post("/import", {});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't update the library");
      settingsToast(j.result.albums + " Spotify albums in the library", "ok");
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
    finally { importNow.removeAttribute("disabled"); look(); }
  });
  if (signout) signout.addEventListener("click", async () => {
    signout.setAttribute("disabled", "");
    try { asked++; paint(await (await post("/signout", {})).json()); settingsToast("Signed out of Spotify", "ok"); }
    catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
    finally { signout.removeAttribute("disabled"); }
  });
  // Looked at as the page opens.
  document.querySelectorAll('.settings-nav-item[data-pane="spotify"]').forEach(b => b.addEventListener("click", look));
})();
