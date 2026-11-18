/* Settings → Services → iBroadcast → Upload bandwidth (item 479), a page of its own: the home's upload speed as its
 * internet provider gives it (Mbps, typed), the share of it the upload to iBroadcast may use (25, 50, 75 or 100 %),
 * what that lets it use and leaves, the fastest an upload has sent from here, and No limit. iBroadcast's page says it on
 * the row that opens this one (ibroadcastBandwidthSaid). The app's page is its own (SettingsIBroadcastBandwidth.kt),
 * worded the same (core's IBroadcastBandwidth.kt). */

/** A number as the page writes it: whole from 10 up, else to a tenth ("81", "2.5"). @param {number} n */
function ibroadcastNumber(n) {
  return n >= 10 || n === Math.floor(n) ? String(Math.round(n)) : n.toFixed(1);
}

/** A speed in bytes a second as the page says it, in Mbps as internet providers do: "98 Mbps". @param {number} b */
function ibroadcastMbps(b) {
  return ibroadcastNumber(b * 8 / 1e6) + " Mbps";
}

/** What iBroadcast's page says on the row that opens this one ([s]: the state's upload_speed). @param {any} s */
function ibroadcastBandwidthSaid(s) {
  return s && s.speed_mbps && s.limit_mbps ? "Up to " + ibroadcastNumber(s.limit_mbps) + " Mbps" : "No limit";
}

/** Under the speed: as the provider gives it, and the fastest an upload has sent. @param {any} s */
function ibroadcastSpeedNote(s) {
  return "As your internet provider gives it: your plan's upload, or a speed test's."
    + (s && s.fastest_mbps ? " The fastest an upload has sent from here: " + ibroadcastNumber(s.fastest_mbps) + " Mbps." : "");
}

/** What the upload may use, and what it leaves. @param {any} s */
function ibroadcastLimitWords(s) {
  if (!s || !s.speed_mbps || !s.limit_mbps) return "No limit: uploads use as much of your upload as they can. Enter your upload speed to set one.";
  const up = ibroadcastNumber(s.limit_mbps) + " Mbps";
  return s.percent >= 100 ? "Uploads use up to " + up + ": all of your upload."
    : "Uploads use up to " + up + ", leaving " + ibroadcastNumber(s.speed_mbps - s.limit_mbps) + " Mbps for everything else.";
}

/** What is typed in the speed's box as the server takes it: a number, or null (blank: no limit); undefined where it isn't one. @param {string} text */
function ibroadcastTyped(text) {
  const t = String(text).trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) && n > 0 ? n : undefined;
}

(function initIBroadcastBandwidth() {
  if (EMBED) return;   // not in the Shelf's frame (embed-flag.js)
  const $ = (/** @type {string} */ id) => document.getElementById(id);
  const speed = /** @type {HTMLInputElement|null} */ ($("ibb-speed")), speedNote = $("ibb-speed-note"), shares = $("ibb-share"), limit = $("ibb-limit"), clear = $("ibb-clear");
  if (!speed || !shares) return;

  /** @param {any} j */
  function paint(j) {
    const s = (j && j.upload_speed) || {};
    if (document.activeElement !== speed) speed.value = s.speed_mbps ? ibroadcastNumber(s.speed_mbps) : "";
    if (speedNote) speedNote.textContent = ibroadcastSpeedNote(s);
    const on = String(s.percent || 100);
    // Each written out, as npm run parity reads the keys here.
    const html = [["25", "25%"], ["50", "50%"], ["75", "75%"], ["100", "100%"]].map(([v, label]) =>
      '<button type="button" class="seg-btn' + (v === on ? " is-on" : "") + '" data-parity="settings-ibroadcast-bandwidth.share" data-value="' + v + '">' + label + "</button>").join("");
    if (shares.innerHTML !== html) shares.innerHTML = html;
    if (limit) limit.textContent = ibroadcastLimitWords(s);
    if (clear) clear.classList.toggle("hidden", !s.speed_mbps);
    const row = $("ib-bandwidth-said");
    if (row) row.textContent = ibroadcastBandwidthSaid(s);
  }
  async function look() {
    try { paint(await (await fetch("/api/settings/ibroadcast", { cache: "no-store" })).json()); } catch (e) { /* the page shows the last state */ }
  }
  /* A change ([patch]: speed_mbps or percent): kept, or refused in the server's words. @param {object} patch */
  async function save(patch) {
    try {
      const r = await fetch("/api/settings/ibroadcast/upload/speed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't keep that");
      paint(j);
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); look(); }
  }
  speed.addEventListener("change", () => {
    const n = ibroadcastTyped(speed.value);
    if (n === undefined) { settingsToast("Enter your upload speed in Mbps, such as 100", "error"); look(); return; }
    save({ speed_mbps: n });
  });
  speed.addEventListener("keydown", e => { if (e.key === "Enter") speed.blur(); });
  shares.addEventListener("click", e => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-value]"));
    if (b) save({ percent: Number(b.dataset.value) });
  });
  if (clear) clear.addEventListener("click", () => save({ speed_mbps: null }));
  // Looked at as the page, or iBroadcast's, opens.
  document.querySelectorAll('.settings-nav-item[data-pane="ibroadcast-bandwidth"], .settings-nav-item[data-pane="ibroadcast"]').forEach(b => b.addEventListener("click", look));
  look();
})();
