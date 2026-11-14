/*
 * SQ-tool's "Compare two songs" (item 413), beside "Does your DAC get exactly the file?": song A and song B chosen
 * from Mandarin's music folder (searched or browsed, as a test's song is), compared by SQ-tool (its
 * api/comparisons: common ground, then a null test), and the result shown: the verdict in words, the null depth,
 * level, offset and polarity, the difference across frequency, spectrograms of A, B and the difference, each song's
 * dynamics, and the files to download. Loaded before app.js, which hands it its helpers (window.SQ) and its pages
 * (#/compare, #/compare/<id>).
 */
(function () {
  "use strict";

  var C = { pick: null, songs: { a: null, b: null }, seq: 0, timer: null, id: null, rev: null, browse: "" };
  var COLOR = { a: "#3987e5", b: "#199e70", diff: "#e8836b", music: "#c9c6bd" };
  var VERDICT_CLASS = { IDENTICAL: "good", "SAME MASTER": "good", "ABOVE 20 KHZ": "meh", "DIFFERENT MASTER": "meh", "DIFFERENT RECORDINGS": "bad" };

  function H() { return window.SQ; }
  function $(sel) { return document.querySelector(sel); }
  function main() { return document.getElementById("main"); }
  function dash(v, digits, unit) { return v == null ? "–" : H().fmtDb(v, digits) + (unit ? " " + unit : ""); }

  // The two modes, side by side, on both of their pages.
  function modes(which) {
    return '<nav class="modes" aria-label="What to check">' +
      '<a href="#/"' + (which === "dac" ? ' aria-current="page"' : "") + ">Does your DAC get exactly the file?</a>" +
      '<a href="#/compare"' + (which === "compare" ? ' aria-current="page"' : "") + ">Compare two songs</a></nav>";
  }

  function show(hash) {
    clearTimeout(C.timer);
    var m = hash.match(/^#\/compare\/([A-Za-z0-9._-]+)/);
    if (m) showResult(m[1]); else showChoose();
  }

  // ---------------------------------------------------------------- choosing A and B

  function showChoose() {
    C.id = null; C.pick = null;
    main().innerHTML = modes("compare") +
      '<section class="card"><h1>Compare two songs</h1><p class="muted">A 24/192 against a 16/44.1, an original against a remaster: ' +
      "SQ-tool brings both to one sample rate, lines them up, matches their level and subtracts one from the other (a null test).</p>" +
      '<div class="slots">' + slot("a") + slot("b") + "</div>" +
      '<div id="cmp-picker" hidden><input type="search" id="cmp-q" placeholder="Search the music folder" autocomplete="off" enterkeyhint="search" aria-label="Search the music folder">' +
      '<div id="cmp-browser"></div></div>' +
      '<button class="btn primary big wide" id="cmp-go" data-cmp-go disabled>Compare</button></section>' +
      '<section class="card"><h2>Previous comparisons</h2><div id="cmp-list" class="tests"><p class="muted">Loading…</p></div></section>';
    renderSlots();
    var timer = null;
    $("#cmp-q").addEventListener("input", function (e) {
      clearTimeout(timer);
      var q = e.target.value.trim();
      timer = setTimeout(function () { if (C.pick) (q ? search(q) : browse(C.browse)); }, 300);
    });
    H().api("api/comparisons").then(function (list) {
      var el = $("#cmp-list");
      if (el) el.innerHTML = list.length ? list.map(listItem).join("") : '<p class="empty">No comparisons yet.</p>';
    }).catch(function (e) { var el = $("#cmp-list"); if (el) el.innerHTML = '<div class="alert bad">' + H().esc(e.message) + "</div>"; });
  }

  function slot(w) { return '<div class="slot" id="slot-' + w + '"></div>'; }

  function renderSlots() {
    ["a", "b"].forEach(function (w) {
      var s = C.songs[w], el = $("#slot-" + w);
      if (!el) return;
      el.className = "slot" + (C.pick === w ? " picking" : "");
      el.innerHTML = '<span class="slot-name" style="background:' + COLOR[w] + '">' + w.toUpperCase() + "</span>" +
        '<span class="slot-song">' + (s ? '<b>' + H().esc(s.name) + '</b><span class="muted small">' + H().esc(s.folder || "") + "</span>"
          : '<span class="muted">Song ' + w.toUpperCase() + " not chosen</span>") + "</span>" +
        '<button class="btn small" data-cmp-choose="' + w + '">' + (C.pick === w ? "Choosing…" : s ? "Change" : "Choose") + "</button>";
    });
    var go = $("#cmp-go");
    if (go) go.disabled = !(C.songs.a && C.songs.b);
  }

  function choose(w) {
    C.pick = w;
    renderSlots();
    $("#cmp-picker").hidden = false;
    var q = $("#cmp-q");
    q.placeholder = "Search the music folder for song " + w.toUpperCase();
    if (q.value.trim()) search(q.value.trim()); else browse(C.browse);
    q.focus();
  }

  function rows(list) {
    return '<div class="files">' + list.join("") + "</div>";
  }

  function browse(path) {
    var seq = ++C.seq;
    H().api("api/browse?path=" + encodeURIComponent(path)).then(function (d) {
      var box = $("#cmp-browser");
      if (seq !== C.seq || !box) return;
      if (!d.available) { box.innerHTML = '<div class="alert warn"><p>Mandarin\'s music folder isn\'t there.</p></div>'; return; }
      C.browse = d.path;
      var parts = d.path ? d.path.split("/") : [];
      var crumbs = '<div class="crumbs"><button data-cmp-dir="">Music</button>' + parts.map(function (p, i) {
        return "<span>›</span><button data-cmp-dir=\"" + H().esc(parts.slice(0, i + 1).join("/")) + '">' + H().esc(p) + "</button>";
      }).join("") + "</div>";
      var list = d.dirs.map(function (n) {
        return '<button class="file" data-cmp-dir="' + H().esc(d.path ? d.path + "/" + n : n) + '"><span class="ico">▸</span><span class="fname">' + H().esc(n) + "</span></button>";
      }).concat(d.files.map(function (f) {
        return H().songButton(d.path ? d.path + "/" + f.name : f.name, f.name, H().fmtBytes(f.size), f.ok, "data-cmp-song", d.path);
      }));
      box.innerHTML = crumbs + (list.length ? rows(list) : '<p class="empty">No folders or songs here.</p>');
    }).catch(function (e) {
      if (path) { C.browse = ""; browse(""); return; }
      var box = $("#cmp-browser");
      if (box) box.innerHTML = '<div class="alert bad">' + H().esc(e.message) + "</div>";
    });
  }

  function search(q) {
    var seq = ++C.seq, box = $("#cmp-browser");
    box.innerHTML = '<p class="muted"><span class="spinner"></span> Searching…</p>';
    H().api("api/search?q=" + encodeURIComponent(q)).then(function (list) {
      if (seq !== C.seq || !document.body.contains(box)) return;
      box.innerHTML = list.length ? rows(list.map(function (f) { return H().songButton(f.path, f.name, f.folder, f.ok, "data-cmp-song", f.folder); }))
        : '<p class="empty">Nothing found for “' + H().esc(q) + "”.</p>";
    }).catch(function (e) { if (document.body.contains(box)) box.innerHTML = '<div class="alert bad">' + H().esc(e.message) + "</div>"; });
  }

  function picked(el) {
    var w = C.pick || (C.songs.a ? "b" : "a");
    C.songs[w] = { path: el.getAttribute("data-cmp-song"), name: el.querySelector(".fname").textContent, folder: el.getAttribute("data-folder") || "" };
    C.pick = null;
    $("#cmp-picker").hidden = true;
    renderSlots();
    if (!C.songs.a || !C.songs.b) choose(C.songs.a ? "b" : "a");
  }

  function compare(btn) {
    btn.disabled = true;
    H().api("api/comparisons", { method: "POST", json: { a: C.songs.a.path, b: C.songs.b.path } }).then(function (r) {
      location.hash = "#/compare/" + encodeURIComponent(r.id);
    }).catch(function (e) { H().toast(e.message); btn.disabled = false; });
  }

  function listItem(c) {
    var cls = VERDICT_CLASS[c.verdict] || "";
    var chip = c.state === "ready" ? '<span class="chip ' + cls + '">' + H().esc(c.headline) + "</span>"
      : c.state === "error" ? '<span class="chip bad">Error</span>' : '<span class="chip">Comparing…</span>';
    return '<a class="test-item" href="#/compare/' + encodeURIComponent(c.id) + '"><div><div class="name">' +
      H().esc((c.a || {}).filename) + " <span class=\"muted\">against</span> " + H().esc((c.b || {}).filename) + "</div>" +
      '<div class="muted small">' + H().esc(H().fmtTime(c.created)) + '</div><div class="chips">' + chip + '</div></div><span class="go">›</span></a>';
  }

  // ---------------------------------------------------------------- the result

  function showResult(id) {
    C.id = id; C.rev = null;
    main().innerHTML = modes("compare") + '<section class="card" id="cmp-head"><span class="spinner"></span> Loading…</section>' +
      '<div id="cmp-body"></div>';
    load();
  }

  function load() {
    var id = C.id;
    H().api("api/comparisons/" + encodeURIComponent(id)).then(function (c) {
      if (C.id !== id) return;
      if (c.rev !== C.rev) { C.rev = c.rev; window.SQCompareView.render(c, $("#cmp-head"), $("#cmp-body")); }
      if (c.state === "comparing") C.timer = setTimeout(load, 1000);
    }).catch(function (e) {
      if (C.id === id) $("#cmp-head").innerHTML = '<div class="alert bad">' + H().esc(e.message) + ' <a href="#/compare">Back</a></div>';
    });
  }

  function remove() {
    if (!confirm("Delete this comparison?")) return;
    H().api("api/comparisons/" + encodeURIComponent(C.id), { method: "DELETE" }).then(function () { location.hash = "#/compare"; })
      .catch(function (e) { H().toast(e.message); });
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-cmp-choose], [data-cmp-song], [data-cmp-dir], [data-cmp-go], [data-cmp-delete]") : null;
    if (!el) return;
    if (el.hasAttribute("data-cmp-choose")) choose(el.getAttribute("data-cmp-choose"));
    else if (el.hasAttribute("data-cmp-song")) picked(el);
    else if (el.hasAttribute("data-cmp-dir")) browse(el.getAttribute("data-cmp-dir"));
    else if (el.hasAttribute("data-cmp-go")) compare(el);
    else if (el.hasAttribute("data-cmp-delete")) remove();
  });

  window.SQCompare = { show: show, modes: modes, leave: function () { clearTimeout(C.timer); C.id = null; },
    COLOR: COLOR, VERDICT_CLASS: VERDICT_CLASS, dash: dash };
})();
