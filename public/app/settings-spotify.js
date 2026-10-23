/* Settings → Services → Spotify (bug list item 142; server/Mandarin.Server/Spotify/SpotifyRoutes.cs): the Soloist
 * API key (never shown back, only whether one is set), the name the Spotify app shows, the room Spotify plays in,
 * Soloist's state, and Soloist itself downloaded from Spotify. */
const spotifyBlock    = document.getElementById("spotify-block");
const spotifyKey      = document.getElementById("spotify-key");
const spotifyName     = document.getElementById("spotify-name");
const spotifySave     = document.getElementById("spotify-save");
const spotifyRoom     = document.getElementById("spotify-room");
const spotifyStatus   = document.getElementById("spotify-status");
const spotifyDownload = document.getElementById("spotify-download");
const spotifyBuild    = document.getElementById("spotify-build");
let spotifyPoll = null;

/* What the status line says: the key, Soloist's state, and what the sound has proven. */
function spotifyStatusText(j) {
  if (!j.has_key) return "No Soloist API key yet: make one at developer.spotify.com/dashboard/soloist.";
  if (!j.pulseaudio) return "This server has no PulseAudio: Soloist can't play here.";
  if (!j.soloist || !j.soloist.version) return j.soloist && j.soloist.fetching ? "Downloading Soloist from Spotify…" : "Soloist isn't downloaded yet.";
  return j.status + (j.playback === "playing" && j.quality ? " · " + j.quality : "");
}

/* What the build line says: Soloist's version and when it runs out (Mandarin fetches a new one before then). */
function spotifyBuildText(s) {
  if (!s) return "";
  if (s.fetching) return "Downloading Soloist from Spotify…";
  if (s.error) return "Couldn't download Soloist: " + s.error;
  if (!s.version) return "";
  return "Soloist " + s.version.replace(/\s*\(\d{8}\)\s*$/, "") + (s.expires ? " · runs out " + new Date(s.expires + "T00:00:00").toLocaleDateString([], { dateStyle: "medium" }) : "");
}

function paintSpotify(j) {
  if (spotifyBlock) spotifyBlock.hidden = false;
  if (spotifyKey && document.activeElement !== spotifyKey) spotifyKey.placeholder = j.has_key ? "Soloist API key (set)" : "Soloist API key";
  if (spotifyName && document.activeElement !== spotifyName) spotifyName.value = j.device_name || "";
  if (spotifyRoom) spotifyRoom.dataset.want = j.room || "";
  if (spotifyRoom && spotifyRoom.options.length > 1) spotifyRoom.value = j.room || "";
  if (spotifyStatus) spotifyStatus.textContent = spotifyStatusText(j);
  if (spotifyDownload) {
    spotifyDownload.textContent = j.soloist && j.soloist.version ? "Update Soloist" : "Download Soloist";
    spotifyDownload.hidden = !j.has_key;
    spotifyDownload.disabled = !!(j.soloist && j.soloist.fetching);
  }
  if (spotifyBuild) spotifyBuild.textContent = spotifyBuildText(j.soloist);
  clearTimeout(spotifyPoll);
  if (j.soloist && j.soloist.fetching) spotifyPoll = setTimeout(loadSpotifyStatus, 2000);
}

/* The rooms Spotify can play in: every room but a phone (a phone would keep an endless stream in its cache). */
async function loadSpotifyRooms() {
  if (!spotifyRoom) return;
  try {
    const r = await fetch("/api/zones", { cache: "no-store" });
    const j = await r.json();
    const zones = Array.isArray(j.zones) ? j.zones.filter(z => !z.is_phone) : [];
    const want = spotifyRoom.dataset.want || "";
    spotifyRoom.textContent = "";
    spotifyRoom.appendChild(new Option("None", ""));
    for (const z of zones) spotifyRoom.appendChild(new Option(z.display_name, z.zone_id));
    if (want && !zones.some(z => z.zone_id === want)) spotifyRoom.appendChild(new Option("A room not here now", want));
    spotifyRoom.value = want;
  } catch (_) { /* the list as it was */ }
}

async function loadSpotifyStatus() {
  try {
    const r = await fetch("/api/settings/spotify", { cache: "no-store" });
    if (!r.ok) { if (spotifyBlock) spotifyBlock.hidden = true; return; }
    paintSpotify(await r.json());
  } catch (_) { /* the page shows the last state */ }
}

async function saveSpotify(body) {
  try {
    const r = await fetch("/api/settings/spotify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Couldn't save");
    paintSpotify(j);
    return true;
  } catch (e) { settingsToast(e.message, "error"); return false; }
}

if (spotifySave) spotifySave.addEventListener("click", async () => {
  const body = { device_name: spotifyName ? spotifyName.value.trim() : "" };
  if (spotifyKey && spotifyKey.value.trim()) body.api_key = spotifyKey.value.trim();
  spotifySave.disabled = true;
  if (await saveSpotify(body)) {
    if (spotifyKey) spotifyKey.value = "";
    settingsToast("Saved", "ok");
  }
  spotifySave.disabled = false;
});
if (spotifyRoom) spotifyRoom.addEventListener("change", () => saveSpotify({ room: spotifyRoom.value }));
if (spotifyDownload) spotifyDownload.addEventListener("click", async () => {
  spotifyDownload.disabled = true;
  if (spotifyBuild) spotifyBuild.textContent = "Downloading Soloist from Spotify…";
  try {
    const r = await fetch("/api/settings/spotify/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    paintSpotify(j);
    if (r.ok) settingsToast("Soloist is up to date", "ok");
    else settingsToast("Couldn't download Soloist", "error");
  } catch (e) { settingsToast(e.message, "error"); loadSpotifyStatus(); }
});

/* Settings opened: the state and the rooms asked again. */
function loadSpotify() { loadSpotifyStatus().then(loadSpotifyRooms); }
window.__spotifyStatus = loadSpotify;
loadSpotify();
