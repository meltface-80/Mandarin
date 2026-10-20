/* ------------------------------------------------------------------ */
/*  Settings → Away from home: Tailscale built into the server.        */
/*  Sign in once and the server is on your tailnet by itself.          */
/* ------------------------------------------------------------------ */
/* global settingsInfo */   /* app.js: an ⓘ and its help */
(function initAwayPane() {
  const body = document.getElementById("away-pane-body");
  const pane = document.querySelector('.settings-pane[data-pane="away"]');
  const navItem = document.querySelector('.settings-nav-item[data-pane="away"]');
  if (!body || !pane || !navItem) return;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let st = null, busy = false, err = "";

  async function load() {
    try {
      const r = await fetch("/api/tailscale", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      st = await r.json();
    } catch (e) { st = null; }
    render();
  }

  async function act(what, payload) {
    if (busy) return;
    busy = true; err = ""; render();
    try {
      const r = await fetch("/api/tailscale/" + what, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      st = j;
      if (what === "login" && j.auth_url) window.open(j.auth_url, "_blank", "noopener");
    } catch (e) { err = e.message; }
    busy = false; render();
  }

  function line(label, value) {
    return '<div class="settings-row"><span class="settings-label" data-parity="settings-away.name">' + label + '</span><span class="away-value" data-parity="settings-away.value">' + value + "</span></div>";
  }

  function render() {
    if (!st) { body.innerHTML = '<div class="settings-note" data-parity="settings-away.note">Couldn’t ask the server.</div>'; return; }
    if (!st.available) {
      body.innerHTML = '<div class="settings-note" data-parity="settings-away.note">Tailscale can’t be built in here — it runs in the Docker image (Linux, x64 or ARM64). Tailscale on the machine the server runs on works as before.</div>';
      return;
    }
    const toggle = '<label class="switch" data-parity="settings-away.enabled"><input type="checkbox" aria-label="Built-in Tailscale" data-away-enable' + (st.enabled ? " checked" : "") + (busy ? " disabled" : "") + '>' +
      '<span class="switch-track"><span class="switch-thumb"></span></span></label>';
    let html = '<div class="settings-row"><span class="settings-label" data-parity="settings-away.name">Built-in Tailscale</span>' + toggle + "</div>";
    const state = !st.enabled ? "off" : st.state;
    const words = {
      off: "Off",
      Stopped: "Starting…",
      Downloading: "Getting Tailscale…",
      Starting: "Starting…",
      NoState: "Starting…",
      NeedsLogin: "Not signed in yet",
      NeedsMachineAuth: "Waiting for approval in the Tailscale admin console",
      Running: st.serving ? "Connected" : "Connecting…"
    };
    html += line("Status", esc(words[state] || state));
    // The engine says Running but the tailnet doesn't see it, or Tailscale
    // warns (v0.7.2): said here, while the server rebinds and restarts it.
    if (state === "Running" && (st.online === false || (st.health && st.health.length))) {
      html += '<div class="settings-note away-error" data-parity="settings-away.error">' + esc(st.online === false ? "Running, but not online on the tailnet — the server is rebinding it, then starting it afresh" : "Tailscale warns: " + st.health.join("; ")) + "</div>";
    }
    if (state === "Running") {
      if (st.dns_name) html += line("Name", esc(st.dns_name));
      if (st.address) html += line("Address", esc(st.address.replace(/^http:\/\//, "")));
      html += '<div class="settings-row"><span class="settings-label"></span><button type="button" class="settings-update-btn" data-parity="settings-away.signout" data-away-act="logout"' + (busy ? " disabled" : "") + ">Sign out of Tailscale</button></div>";
      html += '<div class="settings-note" data-parity="settings-away.note">On your tailnet as “' + esc(st.hostname) + '”' + settingsInfo("The Mandarin app on your Android phone uses it by itself away from home (after being home once, to learn the address); sign the phone in to Tailscale " + (window.MusicdApp ? "under This phone below" : "in the app, under Settings → Setup → Away from home") + ". Anything else with Tailscale — an iPhone, a laptop — opens " + (st.address || "the address above") + ".", "settings-away.info") + "</div>";
    } else if (st.enabled) {
      const link = st.auth_url
        ? '<a class="settings-update-btn" data-parity="settings-away.signin" href="' + esc(st.auth_url) + '" target="_blank" rel="noopener">Sign in to Tailscale</a>'
        : '<button type="button" class="settings-update-btn" data-parity="settings-away.signin" data-away-act="login"' + (busy ? " disabled" : "") + ">Sign in to Tailscale</button>";
      html += '<div class="settings-row"><span class="settings-label"></span>' + link + "</div>";
      html += '<div class="settings-note" data-parity="settings-away.note">Sign in with the same account as your phone.' + settingsInfo("Opens Tailscale’s sign-in page. The server then joins your tailnet as “" + st.hostname + "” — nothing else to install. Free for personal use.", "settings-away.info") + "</div>";
    }
    if (err || st.error) html += '<div class="settings-note away-error" data-parity="settings-away.error">' + esc(err || st.error) + "</div>";
    body.innerHTML = html;
  }

  body.addEventListener("change", (e) => {
    const t = e.target.closest("[data-away-enable]");
    if (t) act("enable", { on: t.checked });
  });
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-away-act]");
    if (b) act(b.getAttribute("data-away-act"));
  });
  navItem.addEventListener("click", load);
  // While it's open: signing in happens in another tab, so look now and then.
  setInterval(() => { if (!pane.classList.contains("hidden") && !busy) load(); }, 3000);
})();
