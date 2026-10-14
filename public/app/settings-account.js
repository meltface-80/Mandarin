/* ------------------------------------------------------------------ */
/*  Settings → Account: signed-in devices, sign out, change password   */
/* ------------------------------------------------------------------ */
(function initAccount() {
  const listEl = document.getElementById("acct-devices");
  if (!listEl) return;
  const who = document.getElementById("acct-who");
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

  async function load() {
    try {
      const j = await (await fetch("/api/auth/devices", { cache: "no-store" })).json();
      who.textContent = "Signed in as " + (j.username || "?");
      listEl.innerHTML = "";
      for (const d of j.devices || []) {
        const row = document.createElement("div");
        row.className = "settings-row acct-device";
        const kind = d.kind === "android" ? "Android app" : "Browser";
        row.innerHTML = `<span class="settings-label"><span class="acct-name">${esc(d.name)}</span>` +
          `<span class="acct-sub">${esc(kind)} · ${d.current ? "this device" : esc(ago(d.last_seen))}</span></span>`;
        if (!d.current) {
          const b = document.createElement("button");
          b.type = "button"; b.className = "settings-update-btn"; b.textContent = "Sign out";
          b.addEventListener("click", async () => {
            b.disabled = true;
            try { await post("/api/auth/devices/revoke", { id: d.id }); row.remove(); toast(d.name + " signed out"); }
            catch (e) { b.disabled = false; toast(e.message, "error"); }
          });
          row.appendChild(b);
        }
        listEl.appendChild(row);
      }
    } catch (e) { who.textContent = "Couldn't load the account"; }
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
      const username = (who.textContent || "").replace(/^Signed in as /, "");
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
