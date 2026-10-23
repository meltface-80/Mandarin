/* Settings → Services → Spotify, your library (bug list item 143; server/Mandarin.Server/Services/SpotifyAccounts.cs):
 * signing in with your own Spotify app's Client ID (the page to approve Mandarin on opens; the address Spotify then
 * sends the browser to, which won't open, pasted here), who is signed in, the favourites in the library on or off,
 * Update library now and Sign out; and the stream quality Soloist asks Spotify for (item 145). Drawn from the state settings-spotify.js reads (its account). */
const spotifyClient    = document.getElementById("spotify-client");
const spotifySignin    = document.getElementById("spotify-signin");
const spotifyForm      = document.getElementById("spotify-signin-form");
const spotifyPending   = document.getElementById("spotify-pending");
const spotifyPaste     = document.getElementById("spotify-paste");
const spotifyFinish    = document.getElementById("spotify-finish");
const spotifyCancel    = document.getElementById("spotify-cancel");
const spotifyAccount   = document.getElementById("spotify-account");
const spotifySigned    = document.getElementById("spotify-signed");
const spotifyImport    = document.getElementById("spotify-import");
const spotifyImportNow = document.getElementById("spotify-import-now");
const spotifyImportSt  = document.getElementById("spotify-import-status");
const spotifySignout   = document.getElementById("spotify-signout");
const spotifyQuality   = document.getElementById("spotify-quality");
let spotifyAccountPoll = null;

/* What is said of the library: off, being brought in, or how many albums and when. */
function spotifyImportText(a) {
  if (a.import === false) return "Off: your Spotify albums and playlists are not in the library. Switch on to show them.";
  if (a.importing) return "Bringing your Spotify saved albums into the library…";
  const li = a.last_import;
  if (!li) return "The library is brought up to date shortly after switching on.";
  return li.albums + " Spotify album" + (li.albums === 1 ? "" : "s") + " in the library · updated " +
    new Date(li.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function paintSpotifyAccount(a) {
  if (!a) return;
  const on = !!a.connected;
  if (spotifyForm) spotifyForm.hidden = on;
  if (spotifySigned) spotifySigned.hidden = !on;
  if (spotifyPending) spotifyPending.hidden = on || !a.pending;
  if (spotifyClient && document.activeElement !== spotifyClient && a.client_id) spotifyClient.value = a.client_id;
  if (spotifyAccount) spotifyAccount.textContent = on
    ? "Signed in as " + ((a.user && (a.user.name || a.user.login)) || "your account")
    : a.pending ? "Waiting for Spotify's answer…" : "Not signed in.";
  if (spotifyImport && on) spotifyImport.checked = a.import !== false;
  // Stream quality (item 145): the account's, signed in or not (Soloist plays without the library's sign-in).
  if (spotifyQuality && a.quality && document.activeElement !== spotifyQuality) spotifyQuality.value = a.quality;
  if (spotifyImportNow) spotifyImportNow.classList.toggle("hidden", a.import === false);
  if (spotifyImportSt && on) spotifyImportSt.textContent = spotifyImportText(a);
  clearTimeout(spotifyAccountPoll);
  if (on && a.importing && typeof loadSpotifyStatus === "function") spotifyAccountPoll = setTimeout(loadSpotifyStatus, 4000);
}

async function spotifyPost(path, body) {
  const r = await fetch("/api/settings/spotify" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "Spotify didn't answer");
  return j;
}

if (spotifySignin) spotifySignin.addEventListener("click", async () => {
  spotifySignin.disabled = true;
  try {
    const a = await spotifyPost("/signin", { client_id: spotifyClient ? spotifyClient.value.trim() : "" });
    paintSpotifyAccount(a);
    if (a.pending && a.pending.url) window.open(a.pending.url, "_blank", "noopener");
  } catch (e) { settingsToast(e.message, "error"); }
  finally { spotifySignin.disabled = false; }
});
if (spotifyFinish) spotifyFinish.addEventListener("click", async () => {
  const url = spotifyPaste ? spotifyPaste.value.trim() : "";
  if (!url) { settingsToast("Paste the address Spotify sent your browser to", "error"); return; }
  spotifyFinish.disabled = true;
  try {
    paintSpotifyAccount(await spotifyPost("/signin/code", { url }));
    if (spotifyPaste) spotifyPaste.value = "";
    settingsToast("Signed in to Spotify", "ok");
  } catch (e) { settingsToast(e.message, "error"); }
  finally { spotifyFinish.disabled = false; }
});
if (spotifyCancel) spotifyCancel.addEventListener("click", async () => {
  try { paintSpotifyAccount(await spotifyPost("/signin/cancel")); } catch (e) { settingsToast(e.message, "error"); }
});
if (spotifyImport) spotifyImport.addEventListener("change", async () => {
  try {
    const j = await spotifyPost("", { import: spotifyImport.checked });
    paintSpotifyAccount(j);
    // The walls, Home and Playlists drawn again: the albums are in or out at once.
    if (typeof window.__libraryChanged === "function") window.__libraryChanged();
  } catch (e) { settingsToast(e.message, "error"); }
});
if (spotifyImportNow) spotifyImportNow.addEventListener("click", async () => {
  spotifyImportNow.disabled = true;
  if (spotifyImportSt) spotifyImportSt.textContent = "Bringing your Spotify saved albums into the library…";
  try {
    const j = await spotifyPost("/import");
    settingsToast(j.result.albums + " Spotify albums in the library", "ok");
  } catch (e) { settingsToast(e.message, "error"); }
  finally { spotifyImportNow.disabled = false; if (typeof loadSpotifyStatus === "function") loadSpotifyStatus(); }
});
if (spotifyQuality) spotifyQuality.addEventListener("change", async () => {
  try {
    paintSpotifyAccount(await spotifyPost("", { quality: spotifyQuality.value }));
    settingsToast("Soloist starts again to take it up", "ok");
  } catch (e) { settingsToast(e.message, "error"); }
});
if (spotifySignout) spotifySignout.addEventListener("click", async () => {
  spotifySignout.disabled = true;
  try { paintSpotifyAccount(await spotifyPost("/signout")); settingsToast("Signed out of Spotify", "ok"); }
  catch (e) { settingsToast(e.message, "error"); }
  finally { spotifySignout.disabled = false; }
});
