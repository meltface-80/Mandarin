// Mandarin OS's system page (server.py serves it and does what it asks). Read every ten seconds; a change asks for the
// shared folder's password, kept in this tab for ten minutes so a run of changes asks once.
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let st = null, pass = "", passAt = 0, logWhich = "mandarin", logText = "";

  const tab = (name) => {
    document.querySelectorAll("nav button").forEach((b) => {
      b.classList.toggle("on", b.dataset.tab === name);
      // On a phone the tabs scroll: the one chosen is brought into sight.
      if (b.dataset.tab === name && b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== name));
    if (name === "support") loadLog();
    try { localStorage.setItem("mos-tab", name); } catch (e) { /* none kept */ }
  };
  document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => tab(b.dataset.tab)));

  const banner = (text, bad) => {
    const b = $("banner");
    b.textContent = text || "";
    b.classList.toggle("hidden", !text);
    b.classList.toggle("bad", !!bad);
  };

  // The password (and, for an erase, the word), asked in a dialog; null if cancelled.
  const ask = (title, text, erase) => new Promise((resolve) => {
    const d = $("ask");
    $("ask-title").textContent = title;
    $("ask-text").textContent = text;
    $("ask-err").textContent = "";
    $("ask-extra-label").classList.toggle("hidden", !erase);
    $("ask-extra").value = "";
    $("ask-pass").value = Date.now() - passAt < 600000 ? pass : "";
    d.onclose = () => resolve(d.returnValue === "go" ? { password: $("ask-pass").value, erase: $("ask-extra").value } : null);
    d.showModal();
  });

  async function act(path, body, title, text, opts) {
    const a = await ask(title, text, opts && opts.erase);
    if (!a) return null;
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ password: a.password, erase: a.erase }, body)) })
      .then(async (res) => ({ status: res.status, j: await res.json().catch(() => ({})) }))
      .catch(() => ({ status: 0, j: { error: "The box didn't answer" } }));
    if (r.status === 200) { pass = a.password; passAt = Date.now(); }
    banner(r.j.said || r.j.error || (r.status === 200 ? "Done." : "That didn't work."), r.status !== 200);
    setTimeout(load, 1500);
    return r;
  }

  const ago = (seconds) => {
    const s = Math.floor(Number(seconds) || 0), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    const n = (x, one) => x + " " + one + (x === 1 ? "" : "s");
    return (d ? n(d, "day") + ", " : "") + (h ? n(h, "hour") + ", " : "") + n(m, "minute");
  };
  // A timer that is active is waiting for its time, not running.
  const state = (s, unit) => s === "active" ? '<span class="state ok">✓ ' + (/\.timer$/.test(unit || "") ? "Scheduled" : "Running") + "</span>"
    : s === "not installed" ? '<span class="state">Not installed</span>'
    : s === "inactive" ? '<span class="state warn">Stopped</span>' : '<span class="state bad">' + esc(s) + "</span>";
  const count = (n, one, many) => (n || 0).toLocaleString() + " " + ((n || 0) === 1 ? one : many);
  const row = (title, sub, right) => '<div class="row"><div><b>' + title + "</b><small>" + (sub || "") + "</small></div>" + (right || "") + "</div>";
  const bar = (pct) => '<div class="bar"><i style="width:' + Math.min(100, pct || 0) + '%"></i></div>';

  function render() {
    const m = st.mandarin, o = st.os, n = st.network;
    $("ver").textContent = "Version " + o.version;
    const mandarinUrl = location.protocol + "//" + location.hostname + ":" + (m.port || 3500);
    $("mandarin-link").href = mandarinUrl;
    $("mandarin-link").textContent = mandarinUrl;
    const busy = m.busy && m.busy.any ? " · " + [m.busy.playing ? m.busy.playing + " playing" : "", m.busy.scanning ? "scanning" : "", m.busy.making ? "making" : ""].filter(Boolean).join(", ") : "";
    const usb = st.usb, ro = usb.filter((u) => u.read_only);
    $("status-rows").innerHTML =
      row("Mandarin", m.answering ? "Version " + esc(m.version) + " · " + count(m.albums, "album", "albums") + " · " + count(m.rooms, "room", "rooms") + esc(busy) : "Not answering", m.answering ? '<span class="state ok">✓ Running</span>' : '<span class="state bad">Not answering</span>') +
      row("Operating system", "Mandarin OS " + esc(o.version) + " · running " + ago(o.uptime) + (o.last_upkeep ? " · upkeep " + esc(o.last_upkeep) : ""), o.last_upkeep ? '<span class="state ok">✓ Up to date</span>' : '<span class="state ok">✓ Running</span>') +
      row("Storage", st.data ? "Mandarin's data · " + esc(st.data.free) + " free of " + esc(st.data.size) : "", st.data ? '<span class="state ok">✓ Ready</span>' : '<span class="state bad">No data partition</span>') +
      row("USB drives", usb.length ? usb.map((u) => esc(u.name) + (u.space ? " · " + esc(u.space.size) : "")).join(", ") : "None plugged in", ro.length ? '<span class="state warn">⚠ ' + ro.length + " read-only</span>" : usb.length ? '<span class="state ok">✓ Mounted</span>' : "") +
      row("Network", esc(n.address) + (n.link ? " · " + esc(n.link) : "") + " · " + esc((n.mode || "").toUpperCase()), n.address ? '<span class="state ok">✓ Connected</span>' : '<span class="state bad">No address</span>');
    $("services").innerHTML = st.services.map((s) => row(esc(s.name), esc(s.unit), state(s.state, s.unit))).join("");
    $("share-link").textContent = st.share.path;
    $("share-user").textContent = st.share.user ? "User " + st.share.user + ", with the password chosen at install" : "";
    // Storage.
    $("data-row").innerHTML = st.data ? row("Mandarin's data", esc(st.data.free) + " free of " + esc(st.data.size) + bar(st.data.used_pct), "") : row("Mandarin's data", "No data partition", "");
    // A Linux drive from another computer keeps that computer's owners: copied from, not changed, until made ours (item 399).
    const owner = (u) => u.changing === "changing" ? " · its files being made the shared folder's…" : u.changing ? " · its files couldn't all be made the shared folder's: " + esc(u.changing.replace(/^failed: /, ""))
      : u.others ? " · its files are another computer's: the shared folder copies from it, but can't move, rename or delete on it" : "";
    $("usb").innerHTML = usb.length ? usb.map((u) => row(esc(u.name), esc(u.fs) + (u.space ? " · " + esc(u.space.free) + " free of " + esc(u.space.size) : "") + (u.read_only ? " · read-only: " + esc(u.why) : "") + owner(u),
      (u.read_only ? '<span class="state warn">Read only</span> ' : "") + (u.others && u.changing !== "changing" ? '<button data-own="' + esc(u.name) + '">Make them the shared folder\'s</button> ' : "") +
      '<button data-eject="' + esc(u.name) + '">Eject</button>')).join("") : row("None plugged in", "A USB drive appears here a few seconds after it is plugged in.", "");
    const i = st.internal;
    $("internal").innerHTML = i.mounted && i.space ? row("Storage/Internal", esc(i.space.free) + " free of " + esc(i.space.size) + bar(i.space.used_pct), '<span class="state ok">✓ Ready</span>')
      : i.disks.length ? i.disks.map((d) => row(esc(d.model) + " (" + esc(d.size) + ")", esc(d.disk) + " · not yet formatted for Mandarin OS", '<button class="danger" data-format="' + esc(d.disk) + '">Format</button>')).join("")
      : row("None", "This computer has no other internal disk.", "");
    // Network.
    $("net-now").innerHTML = row("Ethernet", esc(n.device) + (n.link ? " · " + esc(n.link) : ""), n.address ? '<span class="state ok">✓ Connected</span>' : '<span class="state bad">Not connected</span>') +
      row("Address", esc(n.address) + " · " + esc((n.mode || "").toUpperCase()), "") + row("Gateway", esc(n.gateway), "") + row("DNS", esc(n.dns), "") +
      (n.pending_undo ? row("Not kept yet", "This change is undone in two minutes unless you keep it from its new address.", '<button id="net-keep" class="primary">Keep it</button>') : "");
    if (!document.activeElement || !document.activeElement.closest("#static-fields")) setMode(n.mode === "static" ? "static" : "dhcp", n);
    // Settings.
    const b = st.services.find((s) => s.unit === "mandarin-bridge.service");
    $("bridge").innerHTML = row("Mandarin Bridge", b && b.state !== "not installed" ? "Installed on this computer: a USB DAC plugged in here plays through it, switched on in Mandarin's Settings → Audio Devices." : "Not installed. A USB DAC plugged into this computer plays through Mandarin Bridge: install it to play to one.",
      b && b.state !== "not installed" ? '<button data-bridge="remove">Remove</button>' : '<button data-bridge="install">Install</button>');
    $("upkeep").textContent = "Debian's security updates, every week while nothing plays, then a check that everything works. " + (o.last_upkeep ? "Last: " + o.last_upkeep + "." : "Not run yet.");
  }

  let mode = "dhcp";
  function setMode(m, n) {
    mode = m;
    $("net-dhcp").classList.toggle("on", m === "dhcp");
    $("net-static").classList.toggle("on", m === "static");
    $("static-fields").classList.toggle("hidden", m !== "static");
    if (n && m === "static" && !$("net-address").value) {
      $("net-address").value = n.address || "";
      $("net-gateway").value = n.gateway || "";
      $("net-dns").value = (n.dns || "").trim().split(" ")[0] || "";
    }
  }
  $("net-dhcp").addEventListener("click", () => setMode("dhcp"));
  $("net-static").addEventListener("click", () => setMode("static", st && st.network));
  $("net-save").addEventListener("click", async () => {
    const body = mode === "static" ? { mode, address: $("net-address").value.trim(), gateway: $("net-gateway").value.trim(), dns: $("net-dns").value.trim() } : { mode };
    const r = await act("/api/network", body, "Change the network", "The box takes its new address in a moment. Open this page there and keep it within two minutes, or it goes back.");
    if (r && r.status === 200 && r.j.new_address) banner("Open http://" + r.j.new_address + "/ within two minutes and keep the change there, or it goes back.");
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.id === "net-keep") act("/api/network/keep", {}, "Keep this network", "It stays as it is now.");
    else if (t.dataset.own) act("/api/usb/own", { name: t.dataset.own }, "Make " + t.dataset.own + "'s files the shared folder's",
      "Its files become the shared folder's user's, so moving, renaming and deleting on it work. Mandarin reads them as before. Only this drive is changed; a big one takes a few minutes.");
    else if (t.dataset.eject) act("/api/usb/eject", { name: t.dataset.eject }, "Eject " + t.dataset.eject, "It can be unplugged once ejected.");
    else if (t.dataset.format) act("/api/internal/format", { disk: t.dataset.format }, "Format " + t.dataset.format, "EVERYTHING ON THIS DISK IS ERASED. It becomes Storage/Internal.", { erase: true });
    else if (t.dataset.bridge) act("/api/bridge", { action: t.dataset.bridge }, t.dataset.bridge === "install" ? "Install Mandarin Bridge" : "Remove Mandarin Bridge", "");
    else if (t.dataset.mandarin) act("/api/mandarin", { action: t.dataset.mandarin }, t.dataset.mandarin === "reinstall" ? "Reinstall Mandarin" : "Reset Mandarin",
      t.dataset.mandarin === "reinstall" ? "Put back from its latest release; your library and settings kept." : "Mandarin starts as new; what it kept is set aside in its Backups folder.");
    else if (t.dataset.power) { $("power-menu").classList.add("hidden"); act("/api/power", { action: t.dataset.power }, t.textContent, ""); }
    else if (t.dataset.log) { logWhich = t.dataset.log; document.querySelectorAll("#log-pick button").forEach((b) => b.classList.toggle("on", b === t)); loadLog(); }
  });
  $("power-btn").addEventListener("click", (e) => { e.stopPropagation(); $("power-menu").classList.toggle("hidden"); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".power")) $("power-menu").classList.add("hidden"); });

  async function loadLog() {
    $("log-lines").textContent = "Reading…";
    logText = await fetch("/api/logs/" + logWhich).then((r) => r.text()).catch(() => "The log couldn't be read.");
    showLog();
  }
  function showLog() {
    const has = $("log-filter").value.trim().toLowerCase();
    const lines = logText.split("\n").filter((l) => l && (!has || l.toLowerCase().includes(has))).slice(-600);
    $("log-lines").innerHTML = lines.map((l) => { const m = /\b(WARN|ERROR)\b/.exec(l); return m ? '<span class="' + m[1] + '">' + esc(l) + "</span>" : esc(l); }).join("\n") || "No lines here.";
    $("log-lines").scrollTop = $("log-lines").scrollHeight;
  }
  $("log-filter").addEventListener("input", showLog);

  $("diag-run").addEventListener("click", async () => {
    $("diag").innerHTML = '<p class="note">Testing…</p>';
    const d = await fetch("/api/diagnostics").then((r) => r.json()).catch(() => null);
    $("diag").innerHTML = d ? d.map((s) => row(esc(s.step), esc(s.detail), s.ok ? '<span class="state ok">✓ OK</span>' : '<span class="state bad">✗ Not working</span>')).join("") : '<p class="note">The box didn\'t answer.</p>';
  });

  // Two reads in a row not answered say so (one can be a phone waking the tab); the next answered takes it away again,
  // and only it: what an action said stays (item 399: it stayed up for good after one missed read).
  const NOT_ANSWERING = "The box isn't answering: is it on?";
  let missed = 0;
  async function load() {
    let got;
    try { got = await fetch("/api/state").then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))); }
    catch (e) { if (++missed === 2) banner(NOT_ANSWERING, true); return; }
    if ($("banner").textContent === NOT_ANSWERING) banner("");
    missed = 0;
    st = got;
    render();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  try { const t = localStorage.getItem("mos-tab"); if (t && $(t)) tab(t); } catch (e) { /* the first tab */ }
  load();
  setInterval(load, 10000);
})();
