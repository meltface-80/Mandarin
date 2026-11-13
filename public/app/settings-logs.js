/* Settings → Setup → Logs, in a browser (logs, item 389): Mandarin keeps its logs always (the server's, every Mandarin
   Bridge's, this page's and the apps', in the server's Logs folder). Here they are downloaded as one zip, and the
   server's newest lines read, narrowed by level and by what they hold. The Android app has its own Logging page, which
   saves the same logs, so the row is the browser's alone. */
(() => {
  const pane = document.querySelector('.settings-pane[data-pane="logs"]');
  const row = document.getElementById("settings-logs-row");
  if (!pane || !row) return;
  // In the Android app, its own Setup → Logging holds them (MusicdApp is the app's bridge to the page).
  if (!window.MusicdApp) row.classList.remove("hidden");
  const about = document.getElementById("logs-about");
  const out = document.getElementById("logs-lines");
  const level = document.getElementById("logs-level");
  const filter = document.getElementById("logs-filter");
  const SHOWN = 400;
  let text = "";
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const mb = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const show = () => {
    const want = level.value, has = filter.value.trim().toLowerCase();
    const levels = want === "ERROR" ? ["ERROR"] : want === "WARN" ? ["WARN", "ERROR"] : null;
    const lines = text.split("\n").filter(l => l && !l.startsWith("#"))
      .filter(l => !levels || levels.some(v => l.includes(" UTC  " + v)))
      .filter(l => !has || l.toLowerCase().includes(has));
    out.innerHTML = lines.slice(-SHOWN).map(l => {
      const m = / UTC {2}(WARN|ERROR)/.exec(l);
      return m ? `<span class="lv-${m[1]}">${esc(l)}</span>` : esc(l);
    }).join("\n") || "No lines here.";
    out.scrollTop = out.scrollHeight;
  };
  const load = async () => {
    out.textContent = "Reading…";
    try {
      const [st, log] = await Promise.all([fetch("/api/diagnostics").then(r => r.json()), fetch("/api/diagnostics/log").then(r => r.text())]);
      text = log;
      if (st && typeof st.bytes === "number") about.textContent = `Mandarin keeps a log always: the server's (${mb(st.bytes)} now), every Mandarin Bridge's, this page's and the apps'. Nothing in them is sent anywhere unless you send it. Shown here: the server's newest lines.`;
      show();
    } catch (e) {
      out.textContent = "The log couldn't be read.";
    }
  };
  level.addEventListener("change", show);
  filter.addEventListener("input", show);
  row.addEventListener("click", load);
})();
