/* ------------------------------------------------------------------ */
/*  Power (v0.6.12): the button in the side menu's top-right corner    */
/*  Restart and Shut down. Restart stops the server and starts it      */
/*  again; Shut down stops it until it's started again. A screen over  */
/*  the page says what's happening, and reloads the page when the      */
/*  server answers again.                                              */
/* ------------------------------------------------------------------ */
(() => {
  const openBtn    = document.getElementById("power-open");
  const pop        = document.getElementById("power-pop");
  const restartBtn = document.getElementById("power-restart");
  const shutBtn    = document.getElementById("power-shutdown");
  const shutNote   = document.getElementById("power-shutdown-note");
  if (!openBtn || !pop || !restartBtn || !shutBtn) return;
  const ask = (q) => window.__confirmDialog ? window.__confirmDialog(q) : Promise.resolve(confirm(q));
  const toast = (m, kind) => { if (window.__showToast) window.__showToast(m, kind); };
  let info = null;

  const START_AGAIN = {
    icon: "To start it again, double-click Mandarin on the Mac's desktop. It also starts when you log in.",
    manual: "To start it again, start it the way it was started.",
    docker: ""
  };

  async function load() {
    try {
      const r = await fetch("/api/system/power", { cache: "no-store" });
      if (!r.ok) return;
      info = await r.json();
    } catch (e) { return; }
    shutBtn.classList.toggle("hidden", !info.shutdown);
    shutNote.textContent = info.shutdown ? ""
      : "In Docker: docker stop musicd-server, then docker start musicd-server.";
    shutNote.classList.toggle("hidden", !shutNote.textContent);
  }

  const close = () => { pop.classList.add("hidden"); openBtn.setAttribute("aria-expanded", "false"); };
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = pop.classList.contains("hidden");
    if (!opening) { close(); return; }
    pop.classList.remove("hidden");
    openBtn.setAttribute("aria-expanded", "true");
    load();
  });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target) && e.target !== openBtn) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // The screen over everything while the server is away.
  function cover(title, text) {
    let el = document.getElementById("power-cover");
    if (!el) {
      el = document.createElement("div");
      el.id = "power-cover";
      el.className = "power-cover";
      el.setAttribute("role", "alertdialog");
      el.innerHTML = '<div class="power-card"><div class="power-title" data-parity="power-cover.title"></div><p class="power-text" data-parity="power-cover.text"></p></div>';
      document.body.appendChild(el);
    }
    el.querySelector(".power-title").textContent = title;
    el.querySelector(".power-text").textContent = text;
  }

  // Reload once the server has gone away and answered again.
  function reloadWhenBack(everyMs) {
    let wasDown = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok && wasDown) { location.reload(); return; }
        if (!r.ok) wasDown = true;
      } catch (e) { wasDown = true; }
      setTimeout(tick, everyMs);
    };
    setTimeout(tick, everyMs);
  }

  async function post(url) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "The server said no");
    return j;
  }

  // The side menu goes first, so the question and the screen aren't under it.
  const closeMenu = () => { const c = document.querySelector(".menu-backdrop[data-menu-close]"); if (c) c.click(); };

  // For Backup & restore: the same screen while the server restarts.
  window.__serverAwayScreen = (title, text, everyMs) => { cover(title, text); reloadWhenBack(everyMs || 1000); };

  restartBtn.addEventListener("click", async () => {
    close(); closeMenu();
    if (!(await ask("Restart Mandarin? Music playing from Mandarin stops, and it's back in a few seconds."))) return;
    try {
      await post("/api/system/restart");
      cover("Restarting Mandarin…", "This page reloads when it's back.");
      reloadWhenBack(1000);
    } catch (e) { toast(e.message, "error"); }
  });

  shutBtn.addEventListener("click", async () => {
    close(); closeMenu();
    if (!info) await load();
    const again = (info && START_AGAIN[info.start_again]) || "";
    if (!(await ask("Shut down Mandarin? Music playing from Mandarin stops. " + again))) return;
    try {
      const j = await post("/api/system/shutdown");
      cover("Mandarin is shut down", START_AGAIN[j.start_again] || again);
      // Started again (the icon, a login): this page comes back by itself.
      reloadWhenBack(5000);
    } catch (e) { toast(e.message, "error"); }
  });
})();
