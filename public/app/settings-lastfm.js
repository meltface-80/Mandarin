/* Scrobbling to Last.fm, in Settings → API Keys (Extras/LastfmAccount.cs, Playback/Scrobbles.cs on the server). */
// Under the Last.fm key and its shared secret: what scrobbling is (the account
// connected, a sign-in waiting, plays waiting to go, what went wrong) and its
// one button. Connect to Last.fm asks the server for Last.fm's page to approve
// Mandarin on and opens it beside this one; the server finishes the sign-in
// once it is approved, asked every 3 s while this pane is open (ten minutes at
// most). Disconnect stops it. The words are the app's (Scrobbling.kt).
const scrobbleBtn = document.getElementById("lastfm-scrobble-btn");
const scrobbleStatus = document.getElementById("lastfm-scrobble-status");
let scrobbleWatch = 0;

/** What the block says of [j], /api/lastfm/scrobbling's answer (Scrobbling.kt's line). @param {any} j */
function scrobbleLine(j) {
  const said = j.error ? " " + String(j.error).replace(/\.+$/, "") + "." : "";
  if (j.connected) return "Scrobbling as " + (j.name || "your account") + ": every room, Bridge and this phone." +
    (j.queued > 0 ? " " + j.queued + " waiting to send." : "") + said;
  if (j.pending) return "Allow Mandarin on Last.fm, then come back here." + said;
  if (j.error) return said.trim();
  if (!(j.key_set && j.secret_set)) return "Save the Last.fm key and shared secret above, then connect.";
  return "Not connected.";
}

/** The block as the server has it now; true once connected. @returns {Promise<boolean>} */
async function loadScrobbling() {
  if (!scrobbleBtn || !scrobbleStatus) return false;
  try {
    const j = await (await fetch("/api/lastfm/scrobbling")).json();
    scrobbleStatus.textContent = scrobbleLine(j);
    scrobbleBtn.textContent = j.connected ? "Disconnect" : "Connect to Last.fm";
    scrobbleBtn.dataset.connected = j.connected ? "1" : "";
    scrobbleBtn.disabled = !j.connected && !(j.key_set && j.secret_set);
    return !!j.connected;
  } catch (_) { return false; /* display-only: the line stays as it was */ }
}

/* Asked every 3 s, ten minutes at most, while the owner approves on Last.fm and Settings is open. */
function watchScrobbling() {
  const mine = ++scrobbleWatch;
  const until = Date.now() + 10 * 60 * 1000;
  const tick = async () => {
    if (mine !== scrobbleWatch || Date.now() > until) return;
    const open = !!(scrobbleBtn && scrobbleBtn.getClientRects().length);
    if (open && await loadScrobbling()) { settingsToast("Last.fm connected: scrobbling", "ok"); return; }
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

if (scrobbleBtn) scrobbleBtn.addEventListener("click", async () => {
  scrobbleBtn.disabled = true;
  try {
    if (scrobbleBtn.dataset.connected) {
      await fetch("/api/lastfm/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      settingsToast("Last.fm disconnected: nothing more is scrobbled", "ok");
    } else {
      // Opened at once, in the tap, so no blocker takes it for a pop-up; its address once the server has it.
      const page = window.open("about:blank", "_blank");
      const r = await fetch("/api/lastfm/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) { if (page) page.close(); settingsToast(j.error || "Couldn't reach Last.fm", "error"); }
      else {
        if (page) page.location.href = j.url; else window.location.href = j.url;
        watchScrobbling();
      }
    }
  } catch (e) {
    settingsToast("Failed: " + (e && e.message ? e.message : "no answer"), "error");
  } finally {
    await loadScrobbling();
  }
});
