/* ------------------------------------------------------------------ */
/*  Settings → Account: ask for a sign-in or not (item 161), signed-in */
/*  devices, sign out, change password                                 */
/* ------------------------------------------------------------------ */
(function initAccount() {
  const listEl = document.getElementById("acct-devices");
  if (!listEl) return;
  // Who is signed in: asked for again by Change password (the line that said it is gone, item 101).
  let username = "";
  const toast = (m, k) => { if (window.__showToast) window.__showToast(m, k); };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 2) return "active now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 48) return h + (h === 1 ? " hour ago" : " hours ago");
    return Math.round(h / 24) + " days ago";
  }
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }

  // Ask for a sign-in (item 161): off, the home network and the tailnet come straight in.
  const ask = document.getElementById("acct-ask"), askNote = document.getElementById("acct-ask-note");
  let hasAccount = true;
  function showAsk(open) {
    ask.checked = !open;
    askNote.textContent = open
      ? "Off: anything on your home network or your Tailscale network uses Mandarin without signing in — a TV showing the shelf or the wall, say. Anywhere else still can't. " +
        (hasAccount ? "Switch it on to ask for the username and password again." : "Switching it on makes the account first.")
      : "Every device signs in with the username and password. Switch it off to use Mandarin on a TV or a wall display without typing them: anything on your home network or your Tailscale network then comes straight in.";
    document.getElementById("acct-signout").classList.toggle("hidden", open);
    document.getElementById("acct-pw-block").classList.toggle("hidden", !hasAccount);
    document.getElementById("acct-pw-divider").classList.toggle("hidden", !hasAccount);
  }
  async function loadAsk() {
    try {
      const s = await (await fetch("/api/auth/status", { cache: "no-store" })).json();
      hasAccount = !s.setup_required;
      showAsk(!!s.open);
    } catch (e) { /* as it was */ }
  }
  ask.addEventListener("change", async () => {
    const open = !ask.checked;
    if (!open && !hasAccount) { location.href = "/login?create=1&next=" + encodeURIComponent(location.pathname); return; }
    try { await post("/api/auth/open", { open }); showAsk(open); toast(open ? "Sign-in off at home and on your tailnet" : "Sign-in asked for again"); }
    catch (e) { ask.checked = open; toast(e.message, "error"); }
  });

  async function load() {
    loadAsk();
    try {
      const j = await (await fetch("/api/auth/devices", { cache: "no-store" })).json();
      username = j.username || "";
      listEl.innerHTML = "";
      for (const d of j.devices || []) {
        const row = document.createElement("div");
        row.className = "settings-row acct-device"; row.setAttribute("data-parity", "settings-account.device");
        const kind = d.kind === "android" ? "Android app" : "Browser";
        row.innerHTML = `<span class="settings-label"><span class="acct-name">${esc(d.name)}</span>` +
          `<span class="acct-sub">${esc(kind)} · ${d.current ? "this device" : esc(ago(d.last_seen))}</span></span>`;
        if (!d.current) {
          const b = document.createElement("button");
          b.type = "button"; b.className = "settings-update-btn"; b.textContent = "Sign out"; b.setAttribute("data-parity", "settings-account.revoke");
          b.addEventListener("click", async () => {
            b.disabled = true;
            try { await post("/api/auth/devices/revoke", { id: d.id }); row.remove(); toast(d.name + " signed out"); }
            catch (e) { b.disabled = false; toast(e.message, "error"); }
          });
          row.appendChild(b);
        }
        listEl.appendChild(row);
      }
    } catch (e) { /* the devices stay as they were */ }
  }

  document.querySelectorAll('[data-pane="account"].settings-nav-item').forEach(b => b.addEventListener("click", load));

  document.getElementById("acct-signout").addEventListener("click", async () => {
    try { await post("/api/auth/logout"); } catch (e) { /* signed out either way */ }
    location.replace("/login");
  });

  const st = document.getElementById("acct-pw-status");
  document.getElementById("acct-pw").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    const cur = document.getElementById("acct-cur").value, n1 = document.getElementById("acct-new").value, n2 = document.getElementById("acct-new2").value;
    if (!cur) { st.textContent = "Enter your current password."; return; }
    if (n1.length < 8) { st.textContent = "Use at least 8 characters for the new password."; return; }
    if (n1 !== n2) { st.textContent = "The two new passwords don't match."; return; }
    btn.disabled = true; st.textContent = "Checking…";
    await new Promise(r => setTimeout(r, 30));
    try {
      const ch = await post("/api/auth/challenge", { username });
      const start = MusicdSrp.clientStart();
      const proof = MusicdSrp.clientProof(username, cur, ch.salt, ch.iterations, start, ch.B);
      const r = await post("/api/auth/verify", { id: ch.id, A: start.A, M1: proof.M1, purpose: "reauth" });
      if (r.M2 !== proof.expectM2) throw new Error("The server couldn't prove it's yours.");
      const v = MusicdSrp.makeVerifier(username, n1, MusicdSrp.ITERATIONS);
      await post("/api/auth/password", { salt: v.salt, verifier: v.verifier, iterations: MusicdSrp.ITERATIONS });
      ["acct-cur", "acct-new", "acct-new2"].forEach(id => { document.getElementById(id).value = ""; });
      st.textContent = "Password changed.";
    } catch (e) {
      st.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });
})();
