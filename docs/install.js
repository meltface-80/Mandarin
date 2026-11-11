// install.js — the Docker command builder on install.html: the music folders, time zone, port and the rest, made
// into a docker run or a docker-compose.yml to copy.
(function () {
  "use strict";
  var tab = "run";
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function q(s) { return /^[A-Za-z0-9_\/.:,+-]+$/.test(s) ? s : "'" + String(s).replace(/'/g, "'\\''") + "'"; }

  // ---- music folders: one or more host paths, each mounted under /music ----
  var DEFAULT_FOLDER = "/mnt/dietpi_userdata/Music";

  function folderInputs() {
    return Array.prototype.slice.call(document.querySelectorAll("#b-folder-list input"));
  }

  // Where each host folder appears inside the container. One folder IS
  // /music; several each get a subfolder named after the last part of the
  // host path, made safe for a path and numbered when two share a name.
  function mounts() {
    var paths = folderInputs().map(function (el) { return el.value.trim(); }).filter(Boolean);
    if (!paths.length) paths = ["/your/path/to/Music"];
    if (paths.length === 1) return [{ src: paths[0], dst: "/music" }];
    var used = {};
    return paths.map(function (p, i) {
      var base = p.replace(/\/+$/, "").split("/").pop() || "";
      base = base.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "").replace(/^[.-]+/, "") || ("Music" + (i + 1));
      var name = base, n = 2;
      while (used[name.toLowerCase()]) name = base + "-" + n++;
      used[name.toLowerCase()] = true;
      return { src: p, dst: "/music/" + name };
    });
  }

  function addFolder(value, focus) {
    var row = document.createElement("div");
    row.className = "frow";
    var input = document.createElement("input");
    input.spellcheck = false;
    input.placeholder = "/mnt/…/Music";
    input.value = value || "";
    input.setAttribute("aria-label", "Music folder");
    input.addEventListener("input", build);
    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "rm";
    rm.textContent = "\u00d7";
    rm.setAttribute("aria-label", "Remove this folder");
    rm.addEventListener("click", function () { row.remove(); build(); });
    var to = document.createElement("div");
    to.className = "to";
    row.appendChild(input); row.appendChild(rm); row.appendChild(to);
    $("b-folder-list").appendChild(row);
    if (focus) input.focus();
    build();
  }

  function paintFolders(ms) {
    var rows = document.querySelectorAll("#b-folder-list .frow");
    var only = rows.length === 1;
    var k = 0;
    for (var i = 0; i < rows.length; i++) {
      var input = rows[i].querySelector("input");
      rows[i].querySelector("button.rm").hidden = only;
      var to = rows[i].querySelector(".to");
      if (input.value.trim() && ms[k]) { to.innerHTML = "in the container: <b>" + esc(ms[k].dst) + "</b>"; k++; }
      else to.textContent = "";
    }
  }

  function build() {
    var ms = mounts();
    paintFolders(ms);
    var tz = $("b-tz").value.trim() || "Europe/London";
    var port = ($("b-port").value.trim().match(/^\d{2,5}$/) || ["3500"])[0];
    var sonos = $("b-sonos").value.trim();
    var pack = $("b-pack").value.trim();
    var ports = document.querySelectorAll(".port");
    for (var i = 0; i < ports.length; i++) ports[i].textContent = port;
    var K = function (t) { return '<span class="k">' + t + "</span>"; };
    var C = function (t) { return '<span class="c">' + t + "</span>"; };
    var out;
    if (tab === "run") {
      out = C("# Replace any existing container (the data volume is kept)") + "\n" +
        "docker stop musicd-server 2&gt;/dev/null\ndocker rm musicd-server 2&gt;/dev/null\n" +
        "docker pull ghcr.io/meltface-80/musicd-server:latest\n\n" +
        "docker run -d \\\n" +
        "  " + K("--name") + " musicd-server \\\n" +
        "  " + K("--network") + " host \\\n" +
        "  " + K("--restart") + " unless-stopped \\\n" +
        "  " + K("-e") + " TZ=" + esc(q(tz)) + " \\\n" +
        (port !== "3500" ? "  " + K("-e") + " PORT=" + port + " \\\n" : "") +
        (sonos ? "  " + K("-e") + " SONOS_HOSTS=" + esc(q(sonos)) + " \\\n" : "") +
        "  " + K("-v") + " musicd-server-data:/app/data \\\n" +
        ms.map(function (m) { return "  " + K("-v") + " " + esc(q(m.src + ":" + m.dst + ":ro,rslave")) + " \\\n"; }).join("") +
        (pack ? "  " + K("-v") + " " + esc(q(pack + ":/packs")) + " \\\n" : "") +
        "  ghcr.io/meltface-80/musicd-server:latest";
    } else {
      out = C("# docker-compose.yml — then: docker compose up -d") + "\n" +
        "services:\n  musicd-server:\n    image: ghcr.io/meltface-80/musicd-server:latest\n" +
        "    container_name: musicd-server\n    restart: unless-stopped\n    network_mode: host\n" +
        "    environment:\n      TZ: " + esc(tz) + "\n" +
        (port !== "3500" ? '      PORT: "' + port + '"\n' : "") +
        (sonos ? '      SONOS_HOSTS: "' + esc(sonos) + '"\n' : "") +
        "    volumes:\n      - musicd-server-data:/app/data\n" +
        ms.map(function (m) { return '      - "' + esc(m.src.replace(/"/g, '\\"')) + ":" + m.dst + ':ro,rslave"\n'; }).join("") +
        (pack ? '      - "' + esc(pack.replace(/"/g, '\\"')) + ':/packs"\n' : "") + "\n" +
        "volumes:\n  musicd-server-data:\n    name: musicd-server-data";
    }
    $("cmd").innerHTML = out;
  }

  ["b-tz", "b-port", "b-sonos", "b-pack"].forEach(function (id) { $(id).addEventListener("input", build); });
  $("b-add").addEventListener("click", function () { addFolder("", true); });
  addFolder(DEFAULT_FOLDER, false);
  var tabs = document.querySelectorAll(".tabs button");
  for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener("click", function (e) {
    tab = e.currentTarget.getAttribute("data-tab");
    for (var j = 0; j < tabs.length; j++) tabs[j].classList.toggle("on", tabs[j] === e.currentTarget);
    build();
  });
  build();

  var btn = $("copy");
  btn.addEventListener("click", function () {
    var text = $("cmd").innerText;
    function done() {
      btn.textContent = "Copied \u2713"; btn.classList.add("done");
      setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* no clipboard: the text can be selected by hand */ }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });
})();
