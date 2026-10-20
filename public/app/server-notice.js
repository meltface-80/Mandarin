/* ------------------------------------------------------------------ */
/*  MusicD Server: say why the screen is empty                        */
/*  A fresh install with no music found, or no Sonos rooms found,     */
/*  otherwise just looks blank. This names the cause and the fix,     */
/*  and goes away once there are albums and rooms.                    */
/* ------------------------------------------------------------------ */
(function serverNotice() {
  const main = document.querySelector("main");
  if (!main) return;
  const el = document.createElement("div");
  el.className = "status-banner server-notice hidden";
  el.id = "server-notice"; el.dataset.parity = "home.notice";
  el.setAttribute("role", "status");
  main.insertBefore(el, main.firstChild);

  function say(text, isError) {
    el.textContent = text;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
  }

  // A music folder that has gone (a -v left off a new container, a drive not
  // mounted): its albums are kept, and this says which, with the way to put it
  // back — or to forget it, if it's gone for good.
  function sayMissing(dirs) {
    el.innerHTML = "";
    el.classList.add("error");
    el.classList.remove("hidden");
    const n = d => (d.tracks || 0).toLocaleString();
    for (const d of dirs) {
      const p = document.createElement("div");
      const name = "“" + d.name + "”";
      let button = "Forget " + name;
      if (d.reason === "unreadable") {
        p.textContent = "Part of the music folder " + name + " couldn't be read (a share that dropped, a disk that stalled?) — its " + n(d) +
          " tracks are kept as they were, and it's read again next scan.";
        button = null;
      } else if (d.reason === "vanished") {
        p.textContent = "Most of " + name + " was gone at once — " + n(d) + " tracks. They're kept, in case it's a drive or share only half there. " +
          "Deleted them yourself? Then remove them from the library:";
        button = "Remove the missing ones";
      } else {
        p.textContent = "The music folder " + name + (d.missing ? " isn't there" : " is empty") + " — its " + n(d) +
          " tracks are kept, not removed. Mount the drive or share again (or add its -v line back to the container) and they're back as they were. Gone for good? Forget it:";
      }
      el.appendChild(p);
      if (!button) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "settings-update-btn server-notice-btn"; b.dataset.parity = "home.notice-button";
      b.textContent = button;
      const q = d.reason === "vanished"
        ? "Remove the tracks in " + name + " whose files are gone? Only those leave the library; anything still there stays."
        : "Forget " + name + "? Its " + n(d) + " tracks and their albums leave the library (they come back with a rescan if the folder does).";
      // The question goes with the button, so the Android app can ask it itself over its own Home (bug list item 96):
      // asked by the page there, it was asked unseen, and the folder never forgotten. Answered there, it isn't asked twice.
      b.dataset.ask = q;
      b.addEventListener("click", async () => {
        const answered = b.dataset.confirmed === "1";
        delete b.dataset.confirmed;
        if (!answered && !(await (window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q))))) return;
        b.disabled = true;
        try {
          const r = await fetch("/api/library/forget-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir: d.dir }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
          if (window.__showToast) window.__showToast("Removed " + (j.removed || 0).toLocaleString() + " tracks from " + name);
          check();
        } catch (e) { b.disabled = false; if (window.__showToast) window.__showToast(e.message, "error"); }
      });
      el.appendChild(b);
    }
  }

  // Offline: no notice across the page, a symbol in the top bar between the
  // menu and the search instead. A tap on it says what the matter is, one of:
  //   "mode"        the Android app's Offline mode is on;
  //   "app"         the app is answering for a server it can't reach;
  //   "unreachable" this page can't reach the server at all (a browser).
  const offBtn = document.getElementById("offline-btn");
  const offOv = document.getElementById("offline-overlay");
  let offState = null;   // null (online), or { kind }
  function paintOffline(state) {
    offState = state;
    if (!offBtn) return;
    offBtn.classList.toggle("hidden", !state);
    offBtn.setAttribute("aria-label", !state ? "Offline — tap for more"
      : state.kind === "mode" ? "Offline mode is on — tap for more" : "Mandarin can't be reached — tap for more");
    if (!state) closeOffline();
  }
  const OFFLINE_WHY = {
    mode: ["You switched Offline mode on, so Mandarin is showing only the music on this phone: the albums you downloaded and the phone’s own music.",
           "Switch it off to see the server’s library again."],
    app: ["This phone can’t reach the Mandarin server, so the app is showing the music on this phone: the albums you downloaded and the phone’s own music.",
          "It keeps trying, and the server’s library comes back by itself as soon as the server answers.",
          "If it doesn’t: check the server is running, and that this phone is on the same network as it — or, away from home, that it can reach the server through Tailscale."],
    unreachable: ["This device can’t reach the Mandarin server. What’s on the screen stays, but nothing new can be loaded or played until the server answers.",
                  "It keeps trying every few seconds, and this goes away by itself as soon as the server answers.",
                  "If it doesn’t: check the server is running (with Docker, that its container is up), and that this device is on the same network as it — or, away from home, that it can reach the server through Tailscale."]
  };
  function openOffline() {
    if (!offOv || !offState) return;
    const title = document.getElementById("offline-title");
    const text = document.getElementById("offline-text");
    const sw = document.getElementById("offline-switch");
    const lines = OFFLINE_WHY[offState.kind] || OFFLINE_WHY.unreachable;
    title.textContent = offState.kind === "mode" ? "Offline mode is on" : "Mandarin can’t be reached";
    text.textContent = "";
    for (const line of lines) { const p = document.createElement("p"); p.textContent = line; text.appendChild(p); }
    // Offline mode is the app's own switch, which it alone can turn off.
    let canSwitch = false;
    try { canSwitch = offState.kind === "mode" && !!window.MusicdDownloads && typeof window.MusicdDownloads.set === "function"; } catch (e) { /* no app */ }
    sw.classList.toggle("hidden", !canSwitch);
    // The app unable to reach the server: it looks for it now, rather than at its next look (item 110).
    let canRetry = false;
    try { canRetry = offState.kind === "app" && !!window.MusicdApp && typeof window.MusicdApp.lookForServer === "function"; } catch (e) { /* no app */ }
    document.getElementById("offline-retry").classList.toggle("hidden", !canRetry);
    offOv.classList.remove("hidden");
    try { document.getElementById("offline-close").focus({ preventScroll: true }); } catch (e) { /* focus is a courtesy */ }
  }
  function closeOffline() { if (offOv) offOv.classList.add("hidden"); }
  if (offBtn) offBtn.addEventListener("click", openOffline);
  if (offOv) {
    document.getElementById("offline-close").addEventListener("click", closeOffline);
    offOv.querySelector(".confirm-backdrop").addEventListener("click", closeOffline);
    document.getElementById("offline-retry").addEventListener("click", () => {
      try { window.MusicdApp.lookForServer(); } catch (e) { /* no app */ }
      closeOffline();
    });
    // The app reloads the page onto the server's library when it changes.
    document.getElementById("offline-switch").addEventListener("click", () => {
      try { window.MusicdDownloads.set("offlineMode", "false"); } catch (e) { /* no app */ }
      closeOffline();
    });
    // Ahead of the page's other Escape handlers: one Escape closes this alone.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || offOv.classList.contains("hidden")) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      closeOffline();
    }, true);
  }

  // One timer for the next look, so a look made early (below, or after a
  // folder is forgotten) replaces the one waiting rather than starting a
  // second round of them.
  let checkTimer = null;
  function later(ms) { clearTimeout(checkTimer); checkTimer = setTimeout(check, ms); }

  // A request of the page's own that found no server at all: look now,
  // rather than at the next minute's look, so the offline symbol comes in
  // seconds (the page asks for what is playing every few). One that was
  // cancelled on purpose (AbortError) is not that.
  {
    const real = window.fetch;
    let soon = false;
    window.fetch = function (input, init) {
      return real.apply(this, arguments).catch((e) => {
        try {
          const u = new URL(typeof input === "string" ? input : (input && input.url) || "", location.href);
          if (e && e.name !== "AbortError" && u.origin === location.origin && u.pathname.startsWith("/api/") &&
              u.pathname !== "/api/status" && !unreachable && !soon) {
            soon = true;
            setTimeout(() => { soon = false; if (!unreachable) check(); }, 0);
          }
        } catch (x) { /* not a URL: nothing to look at */ }
        throw e;
      });
    };
  }

  let unreachable = 0;
  // One look at a time (v0.8.36): before, a look that hung was joined by
  // another at each failed request, and none of them looked again after.
  let looking = null;
  function check() {
    return looking || (looking = checkNow().finally(() => { looking = null; }));
  }
  async function checkNow() {
    clearTimeout(checkTimer);
    let j;
    try {
      // No answer in 8 s counts as none.
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const t = ctl && setTimeout(() => ctl.abort(), 8000);
      const r = await fetch("/api/status", { cache: "no-store", signal: ctl ? ctl.signal : undefined });
      clearTimeout(t);
      j = await r.json();
    } catch (e) {
      // An update restarting the server, or a moment's blip: say nothing.
      // Only a server that stays away for ~15 seconds outside an update is
      // news, and that is the top bar's offline symbol, not a notice.
      unreachable++;
      el.classList.add("hidden");
      if (!window.__musicdUpdating && unreachable >= 3) paintOffline({ kind: "unreachable" });
      later(5000);
      return;
    }
    unreachable = 0;
    const scan = j.scan || {};
    const last = scan.last || {};
    const albums = j.index_count || 0;
    const rooms = (j.sonos && j.sonos.rooms) || 0;
    const dir = (j.music_dirs && j.music_dirs.join(", ")) || j.music_dir || "/music";
    // The first scan finished after the page drew an empty Home: reload once
    // so every row fills, rather than leaving "No albums" on screen.
    if (albums && el.dataset.wasEmpty === "1") { location.reload(); return; }
    let msg = null, err = false;
    paintOffline(j.offline ? { kind: j.offline_mode ? "mode" : "app" } : null);
    if (j.offline) {
      // The Android app answering for the server (no connection, or offline
      // mode): said by the top bar's offline symbol, not a notice.
    } else if (j.data_persistent === false) {
      msg = "Your library, album edits and play history are stored inside the container and will be lost " +
            "when it's replaced. Add  -v musicd-server-data:/app/data  to the docker run command.";
      err = true;
    } else if (!albums) {
      if (j.music_dir_exists === false || last.status === "no-music") {
        msg = "No music folder at " + dir + ". Add your library in Settings → Music folders — or to the docker run command " +
              "with  -v /path/to/your/Music:" + (j.music_dir || "/music") + ":ro  and start it again.";
        err = true;
      } else if (scan.running) {
        msg = "Scanning your music folder… " + (scan.files_seen || 0).toLocaleString() +
              " files so far. Albums appear when the first pass finishes.";
      } else if (last.status) {
        msg = "No audio files were found in " + dir + ". Check the -v …:" + dir + ":ro mount points at your " +
              "music, and that the container can read it" +
              (last.errors ? " (" + last.errors + " files couldn't be read)" : "") + ".";
        err = true;
      } else {
        msg = "Starting up — reading your music folder…";
      }
    } else if (Array.isArray(last.offline_dirs) && last.offline_dirs.length && !j.away) {
      sayMissing(last.offline_dirs);
      later(30000);
      if (!albums) el.dataset.wasEmpty = "1";
      return;
    } else if (!rooms && !(j.sonos && j.sonos.searching) && !j.away) {
      // Not while the server is still looking (the first minute after a start
      // or an update): the rooms are usually back within seconds.
      msg = "No Sonos rooms found yet. The container needs --network host on the same network as your " +
            "speakers — or set -e SONOS_HOSTS=<a speaker's IP>." +
            (j.sonos && j.sonos.error ? " (" + j.sonos.error + ")" : "");
      err = true;
    }
    if (msg) {
      say(msg, err);
      later(scan.running ? 3000 : 8000);
    } else {
      el.classList.add("hidden");
      later(60000);
    }
    if (!albums) el.dataset.wasEmpty = "1";
  }
  check();
})();
