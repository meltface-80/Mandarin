/* Settings → Services → iBroadcast (item 443), a page of its own: signed out, Sign in on iBroadcast, which shows a link
 * and a code to approve Mandarin with there, and asks the server every two seconds whether it has been; signed in, the
 * account's name, whether it is Premium, the formats iBroadcast takes, and Sign out. The app's page is its own
 * (SettingsIBroadcast.kt), worded the same (core's IBroadcastSettings.kt). */

/** What the page says of the account ([j]: GET /api/settings/ibroadcast). @param {any} j */
function ibroadcastWords(j) {
  const on = !!(j && j.connected), pending = !on && j && j.pending;
  return {
    on, pending,
    status: on ? "Signed in as " + ((j.user && j.user.name) || "your account")
      : pending ? (pending.error || "Waiting for Mandarin to be approved on iBroadcast…") : "",
    premium: !on ? "" : j.premium === true ? "Yes: your files play as they are" : j.premium === false ? "No: iBroadcast plays everything as 128 kbps MP3" : "iBroadcast didn't say",
    formats: on ? ((j.formats || []).map((/** @type {string} */ f) => f.toUpperCase()).join(", ") || "iBroadcast didn't say") : "",
  };
}

(function initIBroadcast() {
  if (EMBED) return;   // not in the Shelf's frame (embed-flag.js)
  const $ = (/** @type {string} */ id) => document.getElementById(id);
  const signin = $("ib-signin"), form = $("ib-signin-form"), pendingBox = $("ib-pending"), link = /** @type {HTMLAnchorElement|null} */ ($("ib-auth-link"));
  const code = $("ib-auth-code"), cancel = $("ib-signin-cancel"), status = $("ib-status"), signed = $("ib-signed");
  const premium = $("ib-premium"), formats = $("ib-formats"), signout = $("ib-signout");
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
    clearTimeout(again);
    if (w.pending && !w.pending.error) again = setTimeout(look, 2000);
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
