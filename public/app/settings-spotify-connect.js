/* Settings → Services → Spotify → Spotify Connect (item 501): Mandarin as a speaker in the Spotify app, through Spotify's
 * Soloist on the server. The Soloist API key (never shown back), the name the Spotify app shows, the room Spotify plays
 * in, Download / Update Soloist; what Soloist says, what plays and how the room is sent it; Soloist's build and when it
 * runs out. Asked every two seconds while Soloist is being downloaded or Spotify plays, else every thirty while the
 * page is open. The app's page is its own (SettingsSpotify.kt, SpotifyConnect.kt), worded the same. */
(() => {
  const $ = (/** @type {string} */ id) => document.getElementById(id);
  const box = $("spotify-connect"), status = $("spotify-connect-status"), sound = $("spotify-connect-sound");
  const key = /** @type {HTMLInputElement|null} */ ($("spotify-connect-key")), name = /** @type {HTMLInputElement|null} */ ($("spotify-connect-name"));
  const save = $("spotify-connect-save"), download = $("spotify-connect-download"), build = $("spotify-connect-build");
  const room = /** @type {HTMLSelectElement|null} */ ($("spotify-connect-room"));
  if (!box || !status || !key || !name || !save || !download || !room) return;
  const URL_ = "/api/settings/spotify-connect";
  let poll = 0, asked = 0, nameTyped = false;

  const post = (/** @type {string} */ sub, /** @type {object} */ body) =>
    fetch(URL_ + sub, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

  /** What the line under the title says (SpotifyConnect.kt says it the same). @param {any} j */
  function said(j) {
    if (!j.has_key) return "Add your Soloist API key to show Mandarin in the Spotify app.";
    if (!j.pulseaudio) return "Needs PulseAudio for Soloist's sound: update Mandarin OS (0.1.13 or later).";
    const t = j.track;
    if (t && (j.playback === "playing" || j.playback === "paused") && j.active)
      return (j.playback === "playing" ? "Playing " : "Paused: ") + t.title + (t.artists ? " — " + t.artists : "");
    const s = String(j.status || "");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** @param {any} j */
  function paint(j) {
    status.textContent = said(j);
    const playing = j.active && (j.playback === "playing" || j.playback === "paused");
    if (sound) { sound.hidden = !playing; sound.textContent = playing ? j.quality + " · sent " + j.sent : ""; }
    key.placeholder = j.has_key ? "Key saved · paste a new one to replace it" : "Soloist API key";
    if (!nameTyped && document.activeElement !== name) name.value = j.device_name || "";
    const sol = j.soloist || {};
    download.classList.toggle("hidden", !j.has_key);
    download.textContent = sol.fetching ? "Downloading…" : sol.version ? "Update Soloist" : "Download Soloist";
    download.toggleAttribute("disabled", !!sol.fetching);
    if (build) build.textContent = sol.error ? "Couldn't download Soloist: " + sol.error
      : sol.version ? sol.version + (sol.expires ? " · runs out " + new Date(sol.expires + "T00:00:00").toLocaleDateString([], { dateStyle: "medium" }) : "")
      : "";
    const rooms = Array.isArray(j.rooms) ? j.rooms : [];
    const want = [{ id: "", name: "Choose a room", sound: "" }].concat(rooms);
    if (room.options.length !== want.length || want.some((r, i) => room.options[i].value !== r.id)) {
      room.textContent = "";
      for (const r of want) {
        const o = document.createElement("option");
        o.value = r.id;
        o.textContent = r.name + (r.sound ? " · " + r.sound : "");
        room.appendChild(o);
      }
    }
    room.value = j.room || "";
    clearTimeout(poll);
    if (!box.closest(".hidden")) poll = window.setTimeout(look, sol.fetching || playing ? 2000 : 30000);
  }

  // A look is painted only when it is the latest asked: an older answer that comes late is dropped.
  async function look() {
    const mine = ++asked;
    try {
      const j = await (await fetch(URL_, { cache: "no-store" })).json();
      if (mine === asked) paint(j);
    } catch (e) { /* the page shows the last state */ }
  }

  /** @param {string} sub @param {object} body @param {string} ok */
  async function change(sub, body, ok) {
    try {
      const r = await post(sub, body);
      const j = await r.json();
      asked++;
      paint(j);
      if (!r.ok) throw new Error((j.soloist && j.soloist.error) || j.error || "Couldn't save");
      if (ok) settingsToast(ok, "ok");
    } catch (e) { settingsToast(/** @type {Error} */ (e).message, "error"); }
  }

  name.addEventListener("input", () => { nameTyped = true; });
  save.addEventListener("click", async () => {
    /** @type {Record<string, string>} */
    const body = { device_name: name.value.trim() };
    if (key.value.trim()) body.api_key = key.value.trim();
    save.setAttribute("disabled", "");
    await change("", body, body.api_key ? "Key saved: Soloist is starting" : "Saved");
    key.value = "";
    nameTyped = false;
    save.removeAttribute("disabled");
  });
  room.addEventListener("change", () => change("", { room: room.value }, room.value ? "Spotify plays in " + room.options[room.selectedIndex].text.split(" · ")[0] : ""));
  download.addEventListener("click", () => { download.setAttribute("disabled", ""); download.textContent = "Downloading…"; change("/download", {}, "Soloist downloaded"); });
  document.querySelectorAll('.settings-nav-item[data-pane="spotify"]').forEach(b => b.addEventListener("click", look));
})();
