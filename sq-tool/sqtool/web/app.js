/*
 * SQ-tool, Mandarin's: is what a zone's DAC is fed exactly the file? Choose a song, choose a zone, Record: Mandarin
 * plays the song there from its start and records exactly what the DAC is fed (Mandarin Bridge's /capture, or a USB
 * DAC on Mandarin's server off its bus), hands the recording here, and SQ-tool compares it with the file, sample by
 * sample, with spectrograms and charts. Served by Mandarin at /sq-tool/; its recording is Mandarin's, at
 * /api/sq-tool/ (zones, record). No dependencies.
 */
(function () {
  "use strict";

  // Plain, muted colours that stay apart for every reader, colour-blind ones too.
  var COLORS = { source: "#3987e5", a: "#199e70" };
  var DIFF = "#e8836b";
  var MUSIC = "#c9c6bd";  // the music beside what remains, on the difference charts
  // Mandarin's recording under way (its /api/sq-tool/record "state").
  var ACTIVE = ["starting", "recording", "handing"];
  // The spectrogram colour map (matches sqtool/spectrogram.py; its name keeps pictures in other
  // colours out of the browser's cache).
  var MAP = "inferno";
  var MAP_STEPS = [[0, 0, 4], [22, 11, 57], [66, 10, 104], [106, 23, 110], [147, 38, 103], [188, 55, 84],
    [221, 81, 58], [243, 120, 25], [252, 165, 10], [246, 215, 70], [252, 255, 164]];
  var S = {
    page: null, tid: null, state: null, test: null, rev: null, html: {}, charts: [], timer: null,
    job: null, zones: null, zone: load("sq.zone", ""),
    browsePath: load("sq.browse", ""), searchSeq: 0,
    spec: { mode: "signals", scale: load("sq.scale", "log"), floor: load("sq.floor", { signals: -150, diffs: -180 }),
      matched: false, t0: 0, t1: 0, data: "", panels: [], info: {}, width: 0 }
  };
  var main = document.getElementById("main");
  // Mandarin's own API, beside this page's (which is relative to /sq-tool/).
  var MANDARIN = "/api/sq-tool/";

  // ---------------------------------------------------------------- helpers

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
  function setHtml(el, html) {
    // Only touch the DOM when something changed: keeps taps, focus and open <details> intact.
    if (!el || el.__html === html) return false;
    el.__html = html;
    el.innerHTML = html;
    return true;
  }
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: {} };
    if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers["Content-Type"] = "application/json"; }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
        return data;
      });
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 5000);
  }

  function fmtRate(r) { if (!r) return "–"; var k = r / 1000; return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + " kHz"; }
  function fmtClock(s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), sec = s % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }
  function fmtAt(s, dec) {
    // m:ss with `dec` decimals, rounding carried into the minutes correctly.
    var scale = Math.pow(10, dec), units = Math.round(Math.max(0, s) * scale), perMin = 60 * scale;
    var m = Math.floor(units / perMin), rest = (units - m * perMin) / scale;
    var txt = rest.toFixed(dec);
    return m + ":" + (rest < 10 ? "0" : "") + txt;
  }
  function fmtSecs(s) { return s == null ? "–" : s < 60 ? s.toFixed(s < 10 ? 3 : 2) + " s" : fmtAt(s, 2); }
  function fmtTime(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return iso ? String(iso).replace("T", " ").slice(0, 16) : "–";
    return d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function fmtDb(v, digits) { return v == null ? "−∞" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(digits == null ? 1 : digits); }
  function fmtNum(n) { return n == null ? "–" : Number(n).toLocaleString(); }
  function fmtBytes(n) {
    if (n == null) return "–";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + " " + u[i];
  }
  function fmtHz(f) { return f >= 1000 ? (f / 1000 >= 10 ? (f / 1000).toFixed(1) : (f / 1000).toFixed(2)) + " kHz" : f.toFixed(0) + " Hz"; }
  function fpColor(fp) { return fp ? "hsl(" + (parseInt(fp.slice(0, 6), 16) % 360) + " 32% 56%)" : "transparent"; }
  function swatch(color) { return '<span class="swatch" style="background:' + color + '"></span>'; }
  function recActive(job) { return !!(job && ACTIVE.indexOf(job.state) >= 0); }
  // Recording the music itself, Mandarin says.
  function hearing(job) { return !!(job && job.state === "recording"); }
  function zoneName(t) { return (t.players && t.players.a) || "The zone"; }
  function whoName(t, w) { return w === "source" ? "The file" : zoneName(t); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  // ---------------------------------------------------------------- pages

  function route() {
    var h = location.hash || "#/";
    var m = h.match(/^#\/test\/([A-Za-z0-9._-]+)/);
    closeSheet();
    if (m) showTest(m[1]);
    else if (h.indexOf("#/new") === 0) showNew();
    else showHome();
  }
  window.addEventListener("hashchange", function () { route(); window.scrollTo(0, 0); });

  function leavePage() {
    S.charts = [];
    S.html = {};
    S.test = null;
    S.rev = null;
  }

  // ---------------------------------------------------------------- home

  function showHome() {
    leavePage();
    S.page = "home"; S.tid = null;
    main.innerHTML =
      '<section class="card hero"><h1>Does your DAC get exactly what is in the file?</h1>' +
      "<p>SQ-tool proves it, sample by sample. Mandarin plays a song to a zone and records exactly what the zone's DAC is fed; " +
      "SQ-tool compares that recording with the file.</p>" +
      "<ol><li>Choose a song from Mandarin's music folder.</li>" +
      "<li>Choose the zone: a <b>Mandarin Bridge</b>, or a USB DAC on Mandarin's server. Press <b>Record</b>: Mandarin plays the song there from its start and records it.</li>" +
      "<li>See whether it is bit-perfect, and where it isn't, with spectrograms and charts.</li></ol>" +
      '<a class="btn primary big" href="#/new">Start a new test</a></section>' +
      '<section class="card"><h2>Previous tests</h2><div id="tests" class="tests"><p class="muted">Loading…</p></div></section>';
    api("api/tests").then(function (list) {
      if (S.page !== "home") return;
      $("#tests").innerHTML = list.length ? list.map(testItem).join("") : '<p class="empty">No tests yet.</p>';
    }).catch(function (e) { if (S.page === "home") $("#tests").innerHTML = '<div class="alert bad">' + esc(e.message) + "</div>"; });
  }

  function testItem(t) {
    var r = t.results.a, zone = (t.players && t.players.a) || "";
    var chip = r && r.verdict ? '<span class="chip ' + verdictClass(r.verdict) + '">' + esc(zone) + ": " + esc(badgeText(r.verdict)) + "</span>"
      : t.captures.a ? '<span class="chip">' + esc(zone) + ": recorded</span>" : '<span class="chip">not recorded yet</span>';
    var src = t.source || {};
    return '<a class="test-item" href="#/test/' + encodeURIComponent(t.id) + '"><div><div class="name">' + esc(t.title) + "</div>" +
      '<div class="muted small">' + (t.artist ? esc(t.artist) + " · " : "") + esc(fmtTime(t.created)) +
      (src.rate ? " · " + fmtRate(src.rate) + (src.bits ? "/" + src.bits + "-bit" : "") : "") + "</div>" +
      '<div class="chips">' + chip + '</div></div><span class="go">›</span></a>';
  }

  // ---------------------------------------------------------------- choosing the song

  function showNew() {
    leavePage();
    S.page = "new"; S.tid = null;
    main.innerHTML =
      '<section class="card"><h1>Choose the song</h1><p class="muted">From Mandarin\'s music folder: Mandarin plays it, and SQ-tool compares what the DAC is fed with it.</p>' +
      '<input type="search" id="q" placeholder="Search the music folder" autocomplete="off" enterkeyhint="search" aria-label="Search the music folder">' +
      '<div id="browser"><p class="muted">Loading…</p></div></section>';
    browse(S.browsePath);
    var timer = null;
    $("#q").addEventListener("input", function (e) {
      clearTimeout(timer);
      var q = e.target.value.trim();
      timer = setTimeout(function () {
        if (S.page === "new") q ? search(q) : browse(S.browsePath);
      }, 300);
    });
  }

  function songButton(path, name, meta, ok) {
    if (ok === false) {
      return '<button class="file song off" disabled title="SQ-tool reads FLAC, WAV and AIFF files"><span class="ico">♪</span><span class="fname">' +
        esc(name) + '</span><span class="fmeta">can\'t be read here</span></button>';
    }
    return '<button class="file song" data-song="' + esc(path) + '"><span class="ico">♪</span><span class="fname">' + esc(name) +
      '</span><span class="fmeta">' + esc(meta || "") + "</span></button>";
  }

  function browse(path) {
    var seq = ++S.searchSeq;
    api("api/browse?path=" + encodeURIComponent(path)).then(function (d) {
      if (seq !== S.searchSeq || S.page !== "new" || ($("#q") && $("#q").value.trim())) return;
      if (!d.available) {
        $("#browser").innerHTML = '<div class="alert warn" style="margin-top:10px"><p>Mandarin\'s music folder isn\'t there (' + esc(d.root) + ").</p></div>";
        return;
      }
      S.browsePath = d.path;
      save("sq.browse", d.path);
      var parts = d.path ? d.path.split("/") : [];
      var crumbs = '<div class="crumbs"><button data-dir="">Music</button>' + parts.map(function (part, i) {
        return '<span>›</span><button data-dir="' + esc(parts.slice(0, i + 1).join("/")) + '">' + esc(part) + "</button>";
      }).join("") + "</div>";
      var rows = d.dirs.map(function (name) {
        return '<button class="file" data-dir="' + esc(d.path ? d.path + "/" + name : name) + '"><span class="ico">▸</span><span class="fname">' + esc(name) + "</span></button>";
      }).concat(d.files.map(function (f) {
        return songButton(d.path ? d.path + "/" + f.name : f.name, f.name, fmtBytes(f.size), f.ok);
      }));
      $("#browser").innerHTML = crumbs + '<div class="files">' + (rows.join("") || '<p class="empty">No folders or songs here.</p>') + "</div>";
    }).catch(function (e) {
      if (S.page !== "new") return;
      if (path) { S.browsePath = ""; browse(""); return; }
      $("#browser").innerHTML = '<div class="alert bad">' + esc(e.message) + "</div>";
    });
  }

  function search(q) {
    var seq = ++S.searchSeq, box = $("#browser");
    if (!box) return;
    box.innerHTML = '<p class="muted"><span class="spinner"></span> Searching…</p>';
    api("api/search?q=" + encodeURIComponent(q)).then(function (list) {
      if (seq !== S.searchSeq || !document.body.contains(box)) return;
      box.innerHTML = '<div class="files" style="margin-top:8px">' + (list.length ? list.map(function (f) {
        return songButton(f.path, f.name, f.folder, f.ok);
      }).join("") : '<p class="empty">Nothing found for “' + esc(q) + "”.</p>") + "</div>";
    }).catch(function (e) { if (document.body.contains(box)) box.innerHTML = '<div class="alert bad">' + esc(e.message) + "</div>"; });
  }

  function createTest(path) {
    $all("[data-song]").forEach(function (b) { b.disabled = true; });
    api("api/tests", { method: "POST", json: { path: path } }).then(function (r) {
      location.hash = "#/test/" + encodeURIComponent(r.id);
    }).catch(function (e) {
      toast(e.message);
      $all("[data-song]").forEach(function (b) { b.disabled = false; });
    });
  }

  // ---------------------------------------------------------------- a test

  function showTest(tid) {
    var same = S.page === "test" && S.tid === tid;
    leavePage();
    if (!same) { S.spec.t0 = 0; S.spec.t1 = 0; }
    S.spec.data = "";
    S.page = "test"; S.tid = tid;
    main.innerHTML =
      '<section class="card" id="t-head"><span class="spinner"></span> Loading…</section>' +
      '<section class="card" id="t-steps" hidden></section>' +
      '<section class="card" id="t-results" hidden></section>' +
      '<section class="card" id="t-spec" hidden></section>' +
      '<section class="card" id="t-charts" hidden></section>' +
      '<section class="card" id="t-details" hidden></section>' +
      '<section class="card" id="t-downloads" hidden></section>';
    loadZones();
    loadTest();
  }

  function loadTest() {
    var tid = S.tid;
    return api("api/tests/" + encodeURIComponent(tid)).then(function (t) {
      if (S.page !== "test" || S.tid !== tid) return;
      S.test = t; S.rev = t.rev;
      renderTest();
    }).catch(function (e) {
      if (S.page !== "test" || S.tid !== tid) return;
      $("#t-head").innerHTML = '<div class="alert bad">' + esc(e.message === "not found" ? "This test does not exist (any more)." : e.message) +
        '</div><p><a class="btn" href="#/">Back to the start</a></p>';
    });
  }

  // The zones Mandarin can record, and why not where it can't (its /api/sq-tool/zones).
  function loadZones() {
    return api(MANDARIN + "zones").then(function (d) {
      S.zones = d.zones || [];
      if (S.test) renderSteps();
    }).catch(function (e) { S.zones = { error: e.message }; if (S.test) renderSteps(); });
  }

  function renderTest() {
    renderHead(); renderSteps(); renderResults(); renderSpec(); renderCharts(); renderDetails(); renderDownloads();
  }

  function renderHead() {
    var t = S.test, src = t.source, a = t.analysis.source || {};
    var facts = [];
    if (src.state === "ready") {
      facts.push(esc(src.label));
      facts.push(fmtRate(src.rate));
      if (src.resolution) facts.push(src.resolution + " bits in use");
      if (src.channels !== 2) facts.push(src.channels + " channels");
      facts.push(fmtClock(src.duration));
      var peak = (a.channel_stats || []).reduce(function (m, c) { return c.peak_db != null && c.peak_db > m ? c.peak_db : m; }, -Infinity);
      if (isFinite(peak)) facts.push("peak " + fmtDb(peak) + " dBFS");
    }
    setHtml($("#t-head"), '<div class="song-head"><div><h1>' + esc(t.title) + "</h1>" +
      '<div class="sub">' + esc([t.artist, t.album].filter(Boolean).join(" · ") || src.filename) + "</div>" +
      '<div class="facts">' + facts.map(function (f) { return '<span class="chip">' + f + "</span>"; }).join("") + "</div></div>" +
      '<button class="btn small" data-act="test-menu" aria-label="Test options">⋯</button></div>');
  }

  // -- steps: the song, then its recording on a zone

  function renderSteps() {
    var t = S.test, el = $("#t-steps");
    if (!t || !el) return;
    el.hidden = false;
    var job = S.job, busyElsewhere = recActive(job) && job.test !== t.id;
    var src = t.source, html = '<div class="steps">';
    var srcDetail = src.state === "ready" ? "Analysed: " + esc(src.label) + " · " + fmtRate(src.rate) + " · " + fmtClock(src.duration)
      : src.state === "error" ? '<span style="color:var(--bad)">' + esc(src.message) + "</span>"
        : '<span class="spinner"></span> Reading and analysing the song…';
    html += step(1, src.state === "ready" ? "done" : src.state === "error" ? "" : "now", "The song", srcDetail, "");
    html += recordStep(2, t, job, busyElsewhere) + "</div>";
    if (busyElsewhere) {
      html += '<div class="alert info" style="margin-top:12px">Another test is being recorded right now. <a href="#/test/' +
        encodeURIComponent(job.test) + '">Go to it</a></div>';
    }
    setHtml(el, html);
    updateLive(job, t);
    $("#rec-badge").hidden = !hearing(job);
  }

  function step(n, cls, what, detail, act, extra) {
    return '<div class="step ' + cls + '"><div class="num">' + (cls === "done" ? "✓" : n) + '</div><div><div class="what">' + what + "</div>" +
      (detail ? '<div class="detail">' + detail + "</div>" : "") + (act ? '<div class="act">' + act + "</div>" : "") + (extra || "") + "</div></div>";
  }

  // The zone picker: every room Mandarin has, those it can't record shown with why.
  function zonePicker(disabled) {
    if (!S.zones) return '<p class="muted small"><span class="spinner"></span> Asking Mandarin which zones can be recorded…</p>';
    if (S.zones.error) return '<div class="alert bad">Mandarin didn\'t say which zones can be recorded: ' + esc(S.zones.error) + "</div>";
    var can = S.zones.filter(function (z) { return z.can; });
    if (!can.length) {
      return '<div class="alert warn"><p>No zone can be recorded yet.</p>' + (S.zones.length ? "<ul>" + S.zones.map(function (z) {
        return "<li><b>" + esc(z.name) + "</b>: " + esc(z.why) + "</li>";
      }).join("") + "</ul>" : "") + '<p><button class="linkbtn" data-act="help">What can be recorded?</button></p></div>';
    }
    if (!can.some(function (z) { return z.zone_id === S.zone; })) S.zone = can[0].zone_id;
    return '<label class="field">Record on<select id="zone"' + (disabled ? " disabled" : "") + ">" + S.zones.map(function (z) {
      return '<option value="' + esc(z.zone_id) + '"' + (z.zone_id === S.zone ? " selected" : "") + (z.can ? "" : " disabled") + ">" +
        esc(z.name) + (z.can ? "" : " — " + esc(z.why)) + "</option>";
    }).join("") + "</select></label>";
  }

  function recordStep(n, t, job, busyElsewhere) {
    var cap = t.captures.a, res = t.results.a, here = job && job.test === t.id;
    var who = cap ? '<span class="row" style="gap:6px">' + swatch(COLORS.a) + esc(zoneName(t)) + "</span>" : "Record it on a zone";
    if (here && recActive(job)) return step(n, hearing(job) ? "recording" : "now", "Recording on " + esc(job.name), "", "", liveBox(job));
    var songReady = t.source.state === "ready";
    var canRecord = songReady && !recActive(job) && S.zones && !S.zones.error && S.zones.some(function (z) { return z.can; });
    var recBtn = function (label, big) {
      return '<button class="btn ' + (big ? "rec big" : "small") + '" data-act="record"' + (canRecord ? "" : " disabled") + ">" +
        (big ? '<span class="recdot"></span>' : "") + esc(label) + "</button>";
    };
    var failed = here && job.state === "failed" ? '<div class="alert bad" style="margin-top:8px">' + esc(job.says) + "</div>" : "";
    var picker = songReady && !busyElsewhere ? zonePicker(!canRecord) : "";
    if (cap && cap.state === "analysing") return step(n, "now", who, '<span class="spinner"></span> Analysing the recording…', "");
    if (cap && cap.state === "error") {
      return step(n, "", who, '<span style="color:var(--bad)">' + esc(cap.message || "the recording could not be analysed") + "</span>" + failed, picker + recBtn("Record again", false));
    }
    if (cap && cap.state === "ready") {
      var badge = !res ? '<span class="badge wait"><span class="spinner"></span> comparing</span>'
        : res.state === "comparing" ? '<span class="badge wait"><span class="spinner"></span> comparing</span>'
          : res.state === "error" ? '<span class="badge bad">error</span>'
            : '<span class="badge ' + verdictClass(res.verdict) + '">' + esc(badgeText(res.verdict)) + "</span>";
      var detail = "Recorded " + fmtClock(cap.seconds) + " · " + fmtRate(cap.rate) + (cap.recorded ? " · " + esc(fmtTime(cap.recorded)) : "");
      return step(n, "done", who + badge, detail + failed, picker + recBtn("Record again", false));
    }
    var hint = !songReady ? "You can record as soon as the song has been analysed."
      : "Mandarin plays the song on this zone from its start, and records exactly what its DAC is fed, to the song's last sample.";
    return step(n, songReady ? "now" : "", who, hint + failed, picker + recBtn("Record", true));
  }

  function liveBox(job) {
    var bar = '<div class="progress" id="live-bar"' + (job.seconds ? "" : " hidden") + '><span></span></div>';
    if (hearing(job)) {
      return '<div class="live-box rec" aria-live="polite"><div class="row spread"><span><span class="dot rec"></span><b>Recording what the DAC is fed</b></span></div>' +
        '<div class="clock" id="live-clock"></div>' + bar + '<div class="small muted" id="live-says"></div>' +
        '<div class="row"><button class="btn rec" data-act="stop">Stop</button></div></div>';
    }
    return '<div class="live-box" aria-live="polite"><div class="row"><span class="spinner"></span><b id="live-says">' + esc(job.says) + "</b></div>" +
      '<div class="row"><button class="btn" data-act="stop">Stop</button></div></div>';
  }

  function updateLive(job, t) {
    // The clock and progress change every second: update them in place, not by re-rendering.
    if (!job || job.test !== t.id) return;
    var says = $("#live-says");
    if (says) says.textContent = job.says;
    var clock = $("#live-clock");
    if (!clock || !hearing(job)) return;
    clock.innerHTML = fmtClock(job.recorded) + (job.seconds ? " <small>/ " + fmtClock(job.seconds) + "</small>" : "");
    var bar = $("#live-bar span");
    if (bar && job.seconds) bar.style.width = Math.min(100, 100 * job.recorded / job.seconds).toFixed(1) + "%";
  }

  // -- verdicts

  function verdictClass(v) {
    if (v === "IDENTICAL" || v === "PARTIAL") return "good";
    if (v === "GAPS" || v === "NO SIGNAL") return "meh";
    return "bad";
  }

  function badgeText(v) {
    return ({
      IDENTICAL: "BIT-PERFECT",
      PARTIAL: "BIT-PERFECT",
      GAPS: "DROPOUTS",
      ALTERED: "ALTERED",
      DIFFERENT: "NOT BIT-PERFECT",
      RESAMPLED: "RESAMPLED",
      CHANNELS: "CHANNELS DIFFER",
      "NO MATCH": "SONG NOT FOUND",
      "NO SIGNAL": "NO SIGNAL"
    })[v] || v;
  }

  function gainText(g) {
    if (!g || !g.length) return null;
    var same = g.every(function (x) { return x != null && Math.abs(x - g[0]) < 0.005; });
    return same ? fmtDb(g[0], 2) + " dB" : g.map(function (x) { return fmtDb(x, 2); }).join(" / ") + " dB";
  }

  function plainText(t, r) {
    var P = esc(zoneName(t)), v = r.verdict;
    var out = {
      IDENTICAL: "Every sample " + P + "'s DAC was fed is exactly the sample in the file.",
      PARTIAL: "Every sample " + P + "'s DAC was fed matches the file, but part of the song is missing from the recording.",
      GAPS: "The samples are unchanged, but the stream has " + plural(r.events || 0, "gap or jump", "gaps or jumps") + " (dropouts).",
      ALTERED: "Parts of what the DAC was fed differ from the file.",
      DIFFERENT: "The samples were changed on the way to " + P + "'s DAC.",
      RESAMPLED: P + "'s DAC was fed " + fmtRate((t.captures.a || {}).rate) + " instead of the file's " + fmtRate(t.source.rate) + ": the music was resampled.",
      CHANNELS: P + "'s DAC was fed a different number of channels.",
      "NO MATCH": "The song could not be found in what " + P + "'s DAC was fed. Did it play this file?",
      "NO SIGNAL": "The file is digital silence."
    }[v] || esc(r.headline);
    if (v === "PARTIAL" && r.missing_start_seconds > 0 && !r.missing_start_silent) {
      out += " The first " + fmtSecs(r.missing_start_seconds) + " was not recorded.";
    }
    return out;
  }

  function verdictCard(t) {
    var r = t.results.a;
    var head = '<div class="q">' + swatch(COLORS.a) + "What " + esc(zoneName(t)) + "'s DAC was fed, against the file</div>";
    if (!r) {
      var wait = !t.captures.a ? "Record it on a zone to see this" : t.source.state !== "ready" ? "Waiting for the song" : '<span class="spinner"></span> Comparing…';
      return '<div class="verdict-card">' + head + '<span class="badge wait">' + wait + "</span></div>";
    }
    if (r.state === "comparing") return '<div class="verdict-card">' + head + '<span class="badge wait"><span class="spinner"></span> Comparing…</span></div>';
    if (r.state === "error") return '<div class="verdict-card bad">' + head + '<span class="badge bad">Error</span><p class="small">' + esc(r.message) + "</p></div>";
    var cls = verdictClass(r.verdict), nums = [];
    var g = gainText(r.gain_db);
    if (g && r.verdict !== "IDENTICAL") nums.push("level " + g);
    if (r.null_db != null && r.residual_rms_db != null) {
      nums.push("after matching the level, what remains is " + Math.abs(r.null_db).toFixed(1) + " dB below the music (" + fmtDb(r.residual_rms_db) + " dBFS rms)");
    }
    var tl = r.plots && r.plots.timeline;
    return '<div class="verdict-card ' + cls + '">' + head + '<span class="badge ' + cls + '">' + esc(badgeText(r.verdict)) + "</span>" +
      "<div>" + plainText(t, r) + "</div>" +
      (nums.length ? '<div class="small muted">' + esc(nums.join(" · ")) + "</div>" : "") +
      (tl && tl.length && r.verdict !== "IDENTICAL" ? timelineHtml(tl, t.source.duration) : "") +
      ((r.lines || []).length ? "<details><summary>Details</summary><ul>" + r.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></details>" : "") +
      "</div>";
  }

  function timelineHtml(bands, total) {
    var end = Math.max(total || 0, bands.reduce(function (m, b) { return Math.max(m, b.end); }, 0)) || 1;
    var colors = { identical: "var(--ok)", inserted: "var(--warn)", dropped: "var(--warn)", repeated: "var(--warn)", ending: "var(--muted)" };
    return '<div class="timeline">' + bands.map(function (b) {
      return '<span style="left:' + (100 * b.start / end).toFixed(3) + "%;width:" + (100 * (b.end - b.start) / end).toFixed(3) +
        "%;background:" + (colors[b.kind] || "var(--bad)") + '" title="' + esc(b.kind + " at " + fmtSecs(b.start)) + '"></span>';
    }).join("") + '</div><div class="tl-legend">Where the samples match over the song: green = identical, amber = dropout or jump, red = different.</div>';
  }

  function summaryText(t) {
    var r = t.results.a, P = "<b>" + esc(zoneName(t)) + "</b>";
    if (!r || r.state !== "ready") return "";
    if (r.verdict === "IDENTICAL" || r.verdict === "PARTIAL") return P + " is bit-perfect: its DAC is fed exactly the samples in the file.";
    if (r.verdict === "GAPS") return P + "'s DAC was fed the file's samples unchanged, but the stream had dropouts.";
    return P + " is not bit-perfect: its DAC is not fed exactly the samples in the file.";
  }

  function renderResults() {
    var t = S.test, el = $("#t-results");
    el.hidden = !Object.keys(t.captures).length;
    if (el.hidden) return;
    var summary = summaryText(t);
    setHtml(el, "<h2>Result</h2>" + (summary ? '<p class="summary">' + summary + "</p>" : "") +
      '<div class="verdicts">' + verdictCard(t) + "</div>");
  }

  // ---------------------------------------------------------------- spectrograms

  function specPanels(t) {
    var z = zoneName(t), out = [];
    var capReady = t.captures.a && t.captures.a.state === "ready", resReady = t.results.a && t.results.a.state === "ready";
    if (S.spec.mode === "signals") {
      out.push({ which: "source", label: "The file", color: COLORS.source, ok: true });
      out.push({ which: "a", label: "What " + z + "'s DAC was fed", color: COLORS.a, ok: capReady, wait: "Record it on a zone to see what its DAC was fed", marks: "a" });
    } else {
      out.push({ which: "diff-a", label: z + " − the file", color: COLORS.a, ok: resReady, wait: "Record it on a zone to see the difference", marks: "a" });
    }
    return out;
  }

  function specData(t) {
    // Everything the images depend on: when it changes, they are fetched again.
    var c = t.captures.a || {}, r = t.results.a || {};
    return hash(JSON.stringify([t.source.fingerprint, c.state, c.recorded, c.fingerprint, c.seconds, r.state, r.created, JSON.stringify(r.alignment || null)]));
  }

  function renderSpec() {
    var t = S.test, el = $("#t-spec");
    el.hidden = t.source.state !== "ready";
    if (el.hidden) return;
    var sp = S.spec, dur = t.source.duration;
    if (!sp.t1 || sp.t1 > dur) { sp.t0 = 0; sp.t1 = dur; }
    if (!el.__built) {
      el.__built = true;
      el.innerHTML = '<div class="card-head"><h2>Spectrogram</h2><div class="seg" role="group" aria-label="What to show">' +
        '<button data-spec-mode="signals">The file and what the DAC was fed</button><button data-spec-mode="diffs">The difference</button></div></div>' +
        '<div class="toolbar">' +
        '<div class="seg" role="group" aria-label="Frequency scale"><button data-spec-scale="log">Log</button><button data-spec-scale="linear">Linear</button></div>' +
        '<select id="spec-floor" aria-label="Lowest level shown">' + [-100, -120, -150, -180, -210].map(function (v) {
          return '<option value="' + v + '">down to ' + v + " dB</option>";
        }).join("") + "</select>" +
        '<label class="check" id="spec-matched-wrap"><input type="checkbox" id="spec-matched"> Match levels first</label></div>' +
        '<div class="zoombar"><button class="btn small" data-zoom="all" title="Whole song">Whole song</button>' +
        '<button class="btn small" data-zoom="out" aria-label="Zoom out" title="Zoom out">−</button>' +
        '<button class="btn small" data-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>' +
        '<button class="btn small" data-zoom="left" aria-label="Earlier" title="Earlier">◀</button>' +
        '<button class="btn small" data-zoom="right" aria-label="Later" title="Later">▶</button>' +
        '<span class="range" id="spec-range"></span></div>' +
        '<div class="spec-stack" id="spec-stack"></div><div class="taxis" id="spec-taxis"></div>' +
        '<div class="colorbar"><span id="cb-low"></span><i id="cb-grad"></i><span>0 dB</span></div>' +
        '<p class="spec-note" id="spec-note"></p>';
      $("#spec-floor").addEventListener("change", function (e) {
        sp.floor[sp.mode] = Number(e.target.value); save("sq.floor", sp.floor); loadSpec();
      });
      $("#spec-matched").addEventListener("change", function (e) { sp.matched = e.target.checked; loadSpec(); });
      $("#cb-grad").style.background = "linear-gradient(to right," + MAP_STEPS.map(function (c, i) {
        return "rgb(" + c.join(",") + ") " + (10 * i) + "%";
      }).join(",") + ")";
      bindSpecPointer($("#spec-stack"));
    }
    var data = specData(t), panels = specPanels(t);
    var key = data + "|" + sp.mode + "|" + panels.map(function (p) { return p.which + p.ok + p.label; }).join(",");
    if (key !== sp.data) {
      sp.data = key;
      buildPanels(panels);
    }
    loadSpec();
  }

  function buildPanels(panels) {
    S.spec.panels = panels;
    $("#spec-stack").innerHTML = panels.map(function (p) {
      return '<div class="spec-panel" data-which="' + p.which + '"><img alt="">' +
        '<span class="spec-label">' + swatch(p.color) + esc(p.label) + "</span>" +
        '<div class="spec-faxis"></div><div class="spec-marks"></div>' +
        '<div class="spec-msg">' + (p.ok ? '<span class="spinner"></span>' : esc(p.wait)) + "</div></div>";
    }).join("");
    $all("#spec-stack .spec-panel").forEach(function (el) { el.__url = ""; });
  }

  function specParams(width, height) {
    var sp = S.spec;
    return "t0=" + sp.t0.toFixed(6) + "&t1=" + sp.t1.toFixed(6) + "&w=" + width + "&h=" + height + "&scale=" + sp.scale +
      "&floor=" + sp.floor[sp.mode] + (sp.mode === "diffs" && sp.matched ? "&matched=1" : "") + "&v=" + sp.data.split("|")[0] +
      "&map=" + MAP;
  }

  function loadSpec() {
    var t = S.test, sp = S.spec, stack = $("#spec-stack");
    if (!t || !stack) return;
    $all("[data-spec-mode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.specMode === sp.mode)); });
    $all("[data-spec-scale]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.specScale === sp.scale)); });
    $("#spec-floor").value = String(sp.floor[sp.mode]);
    $("#spec-matched-wrap").hidden = sp.mode !== "diffs";
    $("#spec-matched").checked = sp.matched;
    $("#cb-low").textContent = sp.floor[sp.mode] + " dB";
    var span = sp.t1 - sp.t0;
    $("#spec-range").textContent = span >= t.source.duration - 1e-6 ? "Whole song, " + fmtClock(t.source.duration)
      : fmtAt(sp.t0, decimals(span)) + " – " + fmtAt(sp.t1, decimals(span)) + " (" + fmtSecs(span) + ")";
    $("#spec-note").innerHTML = sp.mode === "signals"
      ? "Each picture shows one recording over the same stretch of the song, on one colour scale. Drag across a picture to zoom in; tap to read the time and frequency."
      : "What is left when one recording is subtracted from the other, sample by sample. <b>Black means the samples are identical.</b>" +
        (sp.matched ? " With “Match levels first”, a plain volume difference is removed before subtracting." : "");
    $("#spec-note").innerHTML += " Red lines mark dropouts (gaps or jumps in a stream): the pictures skip over them to keep everything lined up with the song.";
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.max(200, Math.min(3000, Math.round(stack.clientWidth * dpr / 50) * 50));
    sp.width = stack.clientWidth;
    $all(".spec-panel", stack).forEach(function (el, i) {
      var p = sp.panels[i];
      if (!p || !p.ok) return;
      var h = Math.max(64, Math.min(1200, Math.round(el.clientHeight * dpr)));
      var url = "api/tests/" + encodeURIComponent(t.id) + "/spectrogram/" + p.which + ".png?" + specParams(w, h);
      if (el.__url === url) return;
      el.__url = url;
      var msg = $(".spec-msg", el);
      msg.innerHTML = '<span class="spinner"></span>';
      msg.hidden = false;
      fetch(url).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) { throw new Error(d.error || "HTTP " + r.status); });
        var info = JSON.parse(r.headers.get("X-Spectrogram") || "{}");
        return r.blob().then(function (b) { return { blob: b, info: info }; });
      }).then(function (res) {
        if (el.__url !== url) return;
        var img = $("img", el);
        if (img.__obj) URL.revokeObjectURL(img.__obj);
        img.__obj = URL.createObjectURL(res.blob);
        img.src = img.__obj;
        el.__info = res.info;
        msg.hidden = true;
        drawFreqAxis(el, res.info);
        drawMarks(el, p);
        if (i === 0) drawTimeAxis(res.info);
      }).catch(function (e) {
        if (el.__url !== url) return;
        msg.hidden = false;
        msg.textContent = e.message;
      });
    });
    drawTimeAxis({ t0: sp.t0, t1: sp.t1 });
  }

  function decimals(span) { return span > 120 ? 0 : span > 10 ? 1 : span > 1 ? 2 : 3; }

  function drawTimeAxis(info) {
    var el = $("#spec-taxis"), t0 = info.t0, t1 = info.t1, span = t1 - t0;
    if (!el || !(span > 0)) return;
    var steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    var want = Math.max(2, Math.floor(el.clientWidth / 80)), step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] <= want) { step = steps[i]; break; }
    var dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3, html = "";
    for (var x = Math.ceil(t0 / step - 1e-9) * step; x <= t1 + 1e-9; x += step) {
      var pct = 100 * (x - t0) / span;
      if (pct < 3 || pct > 97) continue;
      html += '<span style="left:' + pct.toFixed(3) + '%">' + fmtAt(x, dec) + "</span>";
    }
    el.innerHTML = html;
  }

  function freqTicks(info) {
    var lo = info.fmin || 0, hi = info.fmax, ticks = [];
    if (S.spec.scale === "log") {
      [20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5].forEach(function (f) {
        if (f > lo && f < hi) ticks.push([f, 1 - Math.log(f / lo) / Math.log(hi / lo)]);
      });
    } else {
      var st = [1e3, 2e3, 5e3, 1e4, 2e4, 5e4].filter(function (s) { return hi / s <= 8; })[0] || 1e5;
      for (var f = st; f < hi; f += st) ticks.push([f, 1 - f / hi]);
    }
    return ticks.filter(function (x) { return x[1] > 0.06 && x[1] < 0.96; });
  }

  function drawFreqAxis(el, info) {
    $(".spec-faxis", el).innerHTML = freqTicks(info).map(function (x) {
      var f = x[0];
      return '<span style="top:' + (100 * x[1]).toFixed(2) + '%">' + (f >= 1000 ? f / 1000 + "k" : f) + "</span>";
    }).join("");
  }

  function drawMarks(el, p) {
    // Red ticks along the bottom: where the samples stop matching (dropouts, altered parts).
    var t = S.test, r = p.marks && t.results[p.marks], sp = S.spec, box = $(".spec-marks", el);
    var bands = r && r.plots && r.plots.timeline;
    if (!bands || r.verdict === "IDENTICAL") { box.innerHTML = ""; return; }
    var toSong = function (x) { return x; };
    var span = sp.t1 - sp.t0;
    box.innerHTML = bands.filter(function (b) { return b.kind !== "identical" && b.kind !== "ending"; }).map(function (b) {
      var a = toSong(b.start), e = Math.max(toSong(b.end), a);
      if (e < sp.t0 || a > sp.t1) return "";
      return '<span style="left:' + (100 * (a - sp.t0) / span).toFixed(3) + "%;width:" + (100 * (e - a) / span).toFixed(3) + '%"></span>';
    }).join("");
  }

  function zoomTo(a, b) {
    var sp = S.spec, dur = S.test.source.duration, min = 0.02;
    a = Math.max(0, a); b = Math.min(dur, b);
    if (b - a < min) { var c = (a + b) / 2; a = Math.max(0, c - min / 2); b = Math.min(dur, a + min); }
    sp.t0 = a; sp.t1 = b;
    loadSpec();
  }

  function zoomCmd(cmd) {
    var sp = S.spec, dur = S.test.source.duration, span = sp.t1 - sp.t0, c = (sp.t0 + sp.t1) / 2;
    if (cmd === "all") zoomTo(0, dur);
    else if (cmd === "in") zoomTo(c - span / 4, c + span / 4);
    else if (cmd === "out") {
      var ns = Math.min(dur, span * 2), a = Math.max(0, Math.min(dur - ns, c - ns / 2));
      zoomTo(a, a + ns);
    } else if (cmd === "left") { var l = Math.max(0, sp.t0 - span / 2); zoomTo(l, l + span); }
    else if (cmd === "right") { var r = Math.min(dur, sp.t1 + span / 2); zoomTo(r - span, r); }
  }

  function bindSpecPointer(stack) {
    var drag = null, sel = null, cursor = null, readout = null, hideTimer = null;
    function pos(e) { var r = stack.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; }
    function timeAt(x, w) { var sp = S.spec; return sp.t0 + (sp.t1 - sp.t0) * Math.min(1, Math.max(0, x / w)); }
    function clearSel() { if (sel) { sel.remove(); sel = null; } }
    function hideReadout() { if (cursor) { cursor.remove(); cursor = null; } if (readout) { readout.remove(); readout = null; } }
    function showReadout(q) {
      hideReadout();
      var panel = $all(".spec-panel", stack).filter(function (el) { return q.y >= el.offsetTop && q.y < el.offsetTop + el.offsetHeight; })[0];
      if (!panel || !panel.__info) return;
      var info = panel.__info, rel = (q.y - panel.offsetTop) / panel.offsetHeight, f;
      f = info.scale === "log" ? info.fmin * Math.pow(info.fmax / info.fmin, 1 - rel) : info.fmax * (1 - rel);
      var t = timeAt(q.x, q.w), span = S.spec.t1 - S.spec.t0;
      cursor = document.createElement("div"); cursor.className = "spec-cursor"; cursor.style.left = q.x + "px";
      readout = document.createElement("div"); readout.className = "spec-readout";
      readout.textContent = fmtAt(t, Math.min(3, decimals(span) + 1)) + " · " + fmtHz(f);
      readout.style.top = Math.max(0, q.y - 30) + "px";
      readout.style[q.x > q.w * 0.7 ? "right" : "left"] = (q.x > q.w * 0.7 ? q.w - q.x + 8 : q.x + 8) + "px";
      stack.appendChild(cursor); stack.appendChild(readout);
    }
    stack.addEventListener("pointerdown", function (e) {
      if (e.button > 0) return;
      var q = pos(e);
      drag = { x0: q.x, x1: q.x, y: q.y, w: q.w, id: e.pointerId, moved: false };
      try { stack.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    });
    stack.addEventListener("pointermove", function (e) {
      var q = pos(e);
      if (drag && e.pointerId === drag.id) {
        drag.x1 = q.x;
        if (Math.abs(drag.x1 - drag.x0) > 8) drag.moved = true;
        if (drag.moved) {
          hideReadout();
          if (!sel) { sel = document.createElement("div"); sel.className = "spec-sel"; stack.appendChild(sel); }
          var a = Math.max(0, Math.min(drag.x0, drag.x1)), b = Math.min(drag.w, Math.max(drag.x0, drag.x1));
          sel.style.left = a + "px"; sel.style.width = (b - a) + "px";
        }
      } else if (e.pointerType === "mouse") showReadout(q);
    });
    stack.addEventListener("pointerup", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag; drag = null; clearSel();
      if (d.moved) zoomTo(timeAt(Math.min(d.x0, d.x1), d.w), timeAt(Math.max(d.x0, d.x1), d.w));
      else {
        showReadout({ x: d.x0, y: d.y, w: d.w });
        clearTimeout(hideTimer);
        if (e.pointerType !== "mouse") hideTimer = setTimeout(hideReadout, 4000);
      }
    });
    stack.addEventListener("pointercancel", function () { drag = null; clearSel(); });
    stack.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && !drag) hideReadout(); });
  }

  // ---------------------------------------------------------------- charts

  function renderCharts() {
    var t = S.test, el = $("#t-charts"), an = t.analysis;
    el.hidden = t.source.state !== "ready";
    if (el.hidden) return;
    var items = ["source", "a"].filter(function (k) { return an[k] && an[k].plots && (k === "source" || (t.captures[k] || {}).state === "ready"); });
    var pairs = ["a"].filter(function (k) { var r = t.results[k]; return r && r.state === "ready" && r.plots && (r.plots.spectrum || r.plots.envelope); });
    var zooms = ["a"].filter(function (k) { var r = t.results[k]; return r && r.state === "ready" && r.zoom; });
    var html = "<h2>Charts</h2><div class=\"grid2\">" +
      chartBlock("ch-spec", "Average spectrum", "The level of each frequency over the whole song. Identical data draws identical lines, one on top of the other.") +
      chartBlock("ch-env", "Level over time", "Loudness through the song, all lined up with it.") + "</div>";
    pairs.forEach(function (k) {
      var lab = pairLabel(t, k);
      html += '<h3 style="margin-top:18px">Difference: ' + esc(lab) + "</h3>" +
        '<p class="muted small">After lining up what the DAC was fed with the song and matching their levels (' + esc(gainText(t.results[k].gain_db) || "no change") + "), this is what remains.</p>" +
        '<div class="grid2">' + chartBlock("ch-dspec-" + k, "Spectrum of what remains", "") + chartBlock("ch-denv-" + k, "What remains over time", "") + "</div>";
    });
    zooms.forEach(function (k) {
      var z = t.results[k].zoom;
      html += '<div class="chart-block" style="margin-top:18px"><h3>Close-up of the waveforms: ' + esc(pairLabel(t, k)) + "</h3>" +
        '<p class="muted">Channel ' + z.channel + ", sample by sample, around " + fmtAt(z.at_seconds, 3) + " of the " +
        "song" + (z.why === "largest" ? ", where they differ most." : ", where they first differ.") +
        '</p><canvas class="chart" id="ch-zoom-' + k + '"></canvas><div class="legend" id="lg-zoom-' + k + '"></div></div>';
    });
    var bits = items.filter(function (k) { return an[k].plots.bits; });
    if (bits.length) {
      html += '<div class="chart-block" style="margin-top:18px"><h3>Bit usage</h3><p class="muted">How often each bit of the 32-bit sample word is set, most significant bit on the left. ' +
        "Unused low bits (padding) stay empty; dither or processing fills them.</p>" +
        bitsHtml(bits.map(function (k) { return { name: whoName(t, k), bits: an[k].plots.bits, color: COLORS[k] }; })) + "</div>";
    }
    if (!setHtml(el, html)) return;
    var shift = function (k) {
      if (k === "source") return 0;
      var al = (t.results[k] || {}).alignment || {}, rate = (t.captures[k] || {}).rate || 1;
      return al.steps && al.steps.length ? al.steps[0][1] / rate : al.offset_seconds || 0;
    };
    var spec = items.map(function (k) {
      var p = an[k].plots.spectrum;
      return p && p.freqs ? { label: whoName(t, k), color: COLORS[k], x: p.freqs, y: p.db } : null;
    }).filter(Boolean);
    var env = items.map(function (k) {
      var p = an[k].plots.envelope, s = shift(k);
      return p && p.t ? { label: whoName(t, k), color: COLORS[k], x: p.t.map(function (x) { return x - s; }), y: p.db } : null;
    }).filter(Boolean);
    spectrumChart($("#ch-spec"), spec); legend($("#lg-ch-spec"), spec);
    timeChart($("#ch-env"), env, "dBFS", t.source.duration); legend($("#lg-ch-env"), env);
    pairs.forEach(function (k) {
      var pl = t.results[k].plots, music = { label: "music", color: MUSIC };
      if (pl.spectrum) {
        var s1 = [Object.assign({ x: pl.spectrum.freqs, y: pl.spectrum.signal_db }, music), { label: "what remains", color: DIFF, x: pl.spectrum.freqs, y: pl.spectrum.residual_db }];
        spectrumChart($("#ch-dspec-" + k), s1, 230); legend($("#lg-ch-dspec-" + k), s1);
      }
      if (pl.envelope) {
        var s2 = [Object.assign({ x: pl.envelope.t, y: pl.envelope.signal_db }, music), { label: "what remains", color: DIFF, x: pl.envelope.t, y: pl.envelope.residual_db }];
        timeChart($("#ch-denv-" + k), s2, "dBFS", null, 230); legend($("#lg-ch-denv-" + k), s2);
      }
    });
    zooms.forEach(function (k) {
      var z = t.results[k].zoom, ref = "source", cap = k;
      var x = z.ref.map(function (_, i) { return 1000 * (z.start_seconds + i / z.rate - z.at_seconds); });
      var series = [{ label: whoName(t, ref), color: COLORS[ref], x: x, y: z.ref }, { label: whoName(t, cap), color: COLORS[cap], x: x, y: z.cap }];
      chart($("#ch-zoom-" + k), { series: series, xMin: x[0], xMax: x[x.length - 1], linear: true, yLabel: "sample value",
        xFmt: function (v) { return (Math.round(v * 100) / 100) + " ms"; } });
      var big = 0;
      z.ref.forEach(function (v, i) { big = Math.max(big, Math.abs(z.cap[i] - v)); });
      legend($("#lg-zoom-" + k), series, "largest difference here: " + (big ? fmtDb(20 * Math.log10(big)) + " dBFS (" + big.toPrecision(3) + ")" : "none"));
    });
  }

  function pairLabel(t, k) {
    return zoneName(t) + " − the file";
  }

  function chartBlock(id, title, note) {
    return '<div class="chart-block"><h3>' + esc(title) + "</h3>" + (note ? '<p class="muted">' + esc(note) + "</p>" : "") +
      '<canvas class="chart" id="' + id + '"></canvas><div class="legend" id="lg-' + id + '"></div></div>';
  }

  function bitsHtml(rows) {
    return '<div class="bits">' + rows.map(function (r) {
      return '<div class="bitrow"><span>' + swatch(r.color) + esc(r.name) + '</span><div class="bitcells">' + r.bits.map(function (f, i) {
        var a = Math.min(1, f * 2);
        return '<span title="bit ' + (31 - i) + ": " + (100 * f).toFixed(1) + '%" style="' + (a > 0 ? "background:" + r.color + ";opacity:" + (0.25 + 0.75 * a).toFixed(2) : "") + '"></span>';
      }).join("") + "</div></div>";
    }).join("") + '<div class="bitaxis"><span>bit 31</span><span>bit 16</span><span>bit 0</span></div></div>';
  }

  function legend(el, series, extra) {
    if (!el) return;
    el.innerHTML = series.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.label) + "</span>"; }).join("") +
      (extra ? '<span class="muted">' + esc(extra) + "</span>" : "");
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function niceStep(range, target) {
    var raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * mag >= raw) return steps[i] * mag;
    return 10 * mag;
  }

  function drawChart(c) {
    var canvas = c.canvas, o = c.opts;
    if (!document.body.contains(canvas)) return;
    var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var L = o.linear ? 64 : 44, R = 10, T = 8, B = 22, pw = W - L - R, ph = H - T - B;
    var ys = [];
    o.series.forEach(function (s) { s.y.forEach(function (v, i) { if (v != null && isFinite(v) && s.x[i] >= o.xMin && s.x[i] <= o.xMax) ys.push(v); }); });
    ctx.font = "11px system-ui, sans-serif";
    if (!ys.length) { ctx.fillStyle = cssVar("--muted"); ctx.fillText("nothing to show (digital silence)", L + 10, T + 20); return; }
    var ymax = Math.max.apply(null, ys), ymin = Math.min.apply(null, ys);
    if (o.linear) {
      var pad = (ymax - ymin) * 0.08 || Math.abs(ymax) * 0.1 || 1e-6;
      ymax += pad; ymin -= pad;
    } else {
      ymax = Math.ceil((ymax + 3) / 10) * 10;
      ymin = Math.max(Math.floor((ymin - 6) / 10) * 10, ymax - (o.span || 180));
      if (ymax - ymin < 20) ymin = ymax - 20;
    }
    var xmin = o.xMin, xmax = o.xMax;
    if (!(xmax > xmin)) xmax = xmin + 1;
    var lx = function (x) { return o.xLog ? Math.log10(x) : x; };
    var X = function (x) { return L + (lx(x) - lx(xmin)) / (lx(xmax) - lx(xmin)) * pw; };
    var Y = function (y) { return T + (1 - (y - ymin) / (ymax - ymin)) * ph; };
    ctx.strokeStyle = cssVar("--line"); ctx.fillStyle = cssVar("--muted"); ctx.lineWidth = 1;
    var ystep = niceStep(ymax - ymin, 5);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (var y = Math.ceil(ymin / ystep) * ystep; y <= ymax; y += ystep) {
      ctx.beginPath(); ctx.moveTo(L, Y(y)); ctx.lineTo(W - R, Y(y)); ctx.stroke();
      ctx.fillText(o.linear ? Number(y.toPrecision(3)).toString() : String(Math.round(y)), L - 6, Y(y));
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    var xt = o.xLog ? [10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5] : (function () {
      var st = niceStep(xmax - xmin, Math.max(3, Math.floor(pw / 80))), out = [];
      for (var x = Math.ceil(xmin / st) * st; x <= xmax + st * 1e-6; x += st) out.push(x);
      return out;
    })();
    xt.forEach(function (x) {
      if (x < xmin || x > xmax) return;
      ctx.beginPath(); ctx.moveTo(X(x), T); ctx.lineTo(X(x), T + ph); ctx.stroke();
      ctx.fillText(o.xFmt(x), X(x), T + ph + 5);
    });
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    o.series.forEach(function (s, k) {
      ctx.strokeStyle = s.color; ctx.lineWidth = o.linear ? 1.4 : 1.6;
      if (o.linear && k > 0) ctx.setLineDash([5, 3]);
      ctx.beginPath();
      var pen = false;
      for (var i = 0; i < s.x.length; i++) {
        var v = s.y[i];
        if (v == null || !isFinite(v) || s.x[i] < xmin || s.x[i] > xmax) { pen = false; continue; }
        var px = X(s.x[i]), py = Y(Math.max(v, ymin));
        if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        pen = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (o.linear && s.x.length <= 400) {
        ctx.fillStyle = s.color;
        for (var j = 0; j < s.x.length; j++) { if (s.y[j] != null) { ctx.beginPath(); ctx.arc(X(s.x[j]), Y(s.y[j]), 1.6, 0, 6.3); ctx.fill(); } }
      }
    });
    ctx.restore();
    ctx.fillStyle = cssVar("--muted"); ctx.textAlign = "left"; ctx.textBaseline = "top";
    if (o.yLabel) ctx.fillText(o.yLabel, L + 4, T + 2);
  }

  function chart(canvas, opts) {
    if (!canvas) return;
    S.charts = S.charts.filter(function (c) { return c.canvas !== canvas && document.body.contains(c.canvas); });
    var c = { canvas: canvas, opts: opts };
    S.charts.push(c);
    drawChart(c);
  }

  function spectrumChart(canvas, series, span) {
    if (!series.length) return;
    var top = Math.max.apply(null, series.map(function (s) { return s.x[s.x.length - 1]; }));
    chart(canvas, { series: series, xLog: true, xMin: 20, xMax: top, yLabel: "dB", span: span || 160,
      xFmt: function (x) { return x >= 1000 ? (x / 1000) + "k" : String(x); } });
  }

  function timeChart(canvas, series, unit, end, span) {
    if (!series.length) return;
    var top = end || Math.max.apply(null, series.map(function (s) { return s.x[s.x.length - 1] || 1; }));
    chart(canvas, { series: series, xLog: false, xMin: 0, xMax: top, yLabel: unit, span: span || 160,
      xFmt: function (x) { return x >= 60 ? fmtClock(x) : Math.round(x * 10) / 10 + " s"; } });
  }

  // ---------------------------------------------------------------- details and downloads

  function renderDetails() {
    var t = S.test, el = $("#t-details"), an = t.analysis;
    var cols = ["source", "a"].filter(function (k) { return an[k] && (k === "source" || (t.captures[k] || {}).state === "ready"); });
    el.hidden = cols.length < 1 || t.source.state !== "ready";
    if (el.hidden) return;
    function cap(k) { return (an[k] && an[k].capture) || {}; }
    var rows = [
      ["Format", function (k) { return k === "source" ? esc(an[k].label) : "PCM, " + an[k].bits + "-bit samples"; }],
      ["Sample rate", function (k) { return fmtRate(an[k].rate); }, true],
      ["Channels", function (k) { return String(an[k].channels); }, true],
      ["Bits in use", function (k) {
        var a = an[k];
        if (a.is_float) return a.resolution ? a.resolution + " (float)" : "float";
        return a.resolution == null ? "–" : [String(a.resolution), a.resolution + (a.resolution < a.bits ? ' <span class="muted">of ' + a.bits + "</span>" : "")];
      }, true],
      ["Length", function (k) { return fmtSecs(an[k].duration); }],
      ["Silence before / after", function (k) { var a = an[k]; return fmtSecs(a.lead_silence / a.rate) + " / " + fmtSecs(a.trail_silence / a.rate); }],
      ["Peak", function (k) { return (an[k].channel_stats || []).map(function (s) { return fmtDb(s.peak_db, 2); }).join(" / ") + " dBFS"; }, true],
      ["Loudness (RMS)", function (k) { return (an[k].channel_stats || []).map(function (s) { return fmtDb(s.rms_db, 2); }).join(" / ") + " dBFS"; }, true],
      ["Clipped samples", function (k) { var n = (an[k].channel_stats || []).reduce(function (s, x) { return s + x.clipped; }, 0); return n ? fmtNum(n) : "none"; }, true],
      ["Fingerprint", function (k) { var f = an[k].fingerprint; return f ? swatch(fpColor(f)) + ' <span class="fp">' + esc(f.slice(0, 12)) + "</span>" : "–"; }, true],
      ["Recorded on", function (k) { return k === "source" ? "–" : esc((cap(k).player || {}).name || "–"); }],
      ["Recorded by", function (k) { return k === "source" ? "–" : esc(cap(k).device || "Mandarin"); }],
      ["Recorded", function (k) { return k === "source" ? esc(t.source.filename) : esc(fmtTime(cap(k).started)); }]
    ];
    var html = '<h2>Details</h2><div class="table-wrap"><table class="cmp"><thead><tr><th></th>' + cols.map(function (k) {
      return '<th><div class="colhead">' + swatch(COLORS[k]) + esc(whoName(t, k)) + "</div></th>";
    }).join("") + "</tr></thead><tbody>" + rows.map(function (r) {
      // A cell is its HTML, or [what to compare, HTML].
      var cells = cols.map(function (k) { try { var v = r[1](k); return Array.isArray(v) ? v : [v, v]; } catch (e) { return ["–", "–"]; } });
      return "<tr><td>" + r[0] + "</td>" + cells.map(function (x, i) {
        return '<td class="' + (r[2] && i > 0 && x[0] !== cells[0][0] ? "diff" : "") + '">' + x[1] + "</td>";
      }).join("") + "</tr>";
    }).join("") + '</tbody></table></div><p class="muted small">Highlighted: differs from the file. The same fingerprint means the same sample data.</p>';
    setHtml(el, html);
  }

  function renderDownloads() {
    var t = S.test, el = $("#t-downloads");
    el.hidden = t.source.state !== "ready";
    if (el.hidden) return;
    var base = "api/tests/" + encodeURIComponent(t.id), links = [];
    var link = function (href, text) { links.push('<a class="btn small" href="' + href + '" download>' + text + "</a>"); };
    link(base + "/audio/source.wav", "⤓ The song (WAV)");
    if ((t.captures.a || {}).state === "ready") link(base + "/audio/a.wav", "⤓ What " + esc(zoneName(t)) + "'s DAC was fed (WAV)");
    ["a"].forEach(function (k) {
      var r = t.results[k];
      if (!r || r.state !== "ready" || r.verdict === "RESAMPLED" || r.verdict === "CHANNELS" || r.verdict === "NO MATCH") return;
      link(base + "/difference/" + k + ".wav", "⤓ Difference: " + esc(pairLabel(t, k)));
      if (r.alignment && r.alignment.model && r.verdict !== "IDENTICAL") link(base + "/difference/" + k + ".wav?matched=1", "⤓ Difference, levels matched: " + esc(pairLabel(t, k)));
    });
    setHtml(el, '<h2>Downloads</h2><div class="downloads">' + links.join("") + "</div>" +
      '<p class="muted small">Difference files are 32-bit float WAV on the song\'s timeline: digital silence where the samples are identical (dropouts are skipped to keep it lined up). ' +
      "Turn the volume down before playing one: a difference can be loud.</p>");
  }

  // ---------------------------------------------------------------- sheets

  function openSheet(html) {
    $("#sheet-body").innerHTML = html;
    $("#sheet").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeSheet() {
    $("#sheet").hidden = true;
    $("#sheet-body").innerHTML = "";
    document.body.style.overflow = "";
  }

  function openHelp() {
    openSheet('<div class="stack"><h2 id="sheet-title">How SQ-tool works</h2>' +
      '<div class="card stack"><h3>What it proves</h3><p>Mandarin plays the song to the zone from its start, and records exactly what the zone\'s DAC is fed, ' +
      "every sample to the song's last: what goes into the DAC, after everything Mandarin and the device do. SQ-tool then compares it with the file, sample by sample. " +
      "Bit-perfect means every one of them is the file's.</p></div>" +
      '<div class="card stack"><h3>What can be recorded</h3><ul class="lines">' +
      "<li><b>Mandarin Bridge</b> on an Android phone or tablet with a USB DAC: it records what its USB driver feeds the DAC. An older app can't: update Mandarin Bridge.</li>" +
      "<li>Not yet: Mandarin Bridge for Linux or the Raspberry Pi, Sonos, or other streamers.</li></ul></div>" +
      '<div class="card stack"><h3>For a bit-perfect result</h3><ul class="lines">' +
      "<li>In Mandarin, the zone's <b>Output</b> as <b>Original</b>: upsampling, DSD from PCM, DSP and volume levelling change the samples on purpose.</li>" +
      "<li><b>Fixed volume</b>, or the DAC's own volume: a volume in software scales the samples.</li>" +
      "<li>A 16-bit song fed to a 32-bit DAC is still bit-perfect: its samples are padded with zeros, their values unchanged.</li></ul></div></div>");
  }

  function openTestMenu() {
    var t = S.test;
    if (!t) return;
    openSheet('<div class="stack"><h2 id="sheet-title">This test</h2>' +
      '<div class="card stack"><p class="small muted">Song file: ' + esc(t.source.music_path || t.source.filename) + "<br>Created " + esc(fmtTime(t.created)) + "</p>" +
      '<button class="btn danger" id="tm-delete">Delete this test</button></div></div>');
    $("#tm-delete").addEventListener("click", function () {
      if (!confirm("Delete this test and its recording?")) return;
      api("api/tests/" + encodeURIComponent(t.id), { method: "DELETE" }).then(function () {
        closeSheet(); location.hash = "#/";
      }).catch(function (e) { toast(e.message); });
    });
  }

  // ---------------------------------------------------------------- actions

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-act], [data-song], [data-dir], [data-close], [data-zoom], [data-spec-mode], [data-spec-scale]") : null;
    if (!el) return;
    var act = el.dataset.act;
    if (el.hasAttribute("data-close")) closeSheet();
    else if (el.dataset.song) createTest(el.dataset.song);
    else if (el.dataset.dir !== undefined) browse(el.dataset.dir);
    else if (el.dataset.zoom) zoomCmd(el.dataset.zoom);
    else if (el.dataset.specMode) { S.spec.mode = el.dataset.specMode; renderSpec(); }
    else if (el.dataset.specScale) { S.spec.scale = el.dataset.specScale; save("sq.scale", S.spec.scale); loadSpec(); }
    else if (act === "record") record(el);
    else if (act === "stop") api(MANDARIN + "record", { method: "POST", json: { stop: true } }).then(poll).catch(function (err) { toast(err.message); });
    else if (act === "help") openHelp();
    else if (act === "test-menu") openTestMenu();
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "zone") { S.zone = e.target.value; save("sq.zone", S.zone); }
  });
  $("#btn-help").addEventListener("click", openHelp);
  $("#rec-badge").addEventListener("click", function () {
    if (S.job && S.job.test) location.hash = "#/test/" + encodeURIComponent(S.job.test);
  });

  // Mandarin asked to play the song on the chosen zone and record what its DAC is fed.
  function record(btn) {
    var zone = ($("#zone") || {}).value || S.zone;
    if (!zone) { toast("Choose the zone"); return; }
    btn.disabled = true;
    api(MANDARIN + "record", { method: "POST", json: { test: S.tid, zone_or_output_id: zone } })
      .then(function (job) { S.job = job; renderSteps(); return poll(); })
      .catch(function (err) { toast(err.message); btn.disabled = false; });
  }

  // ---------------------------------------------------------------- polling

  function pending(t) {
    if (!t) return false;
    if (t.source.state === "preparing") return true;
    var busy = function (o, state) { return Object.keys(o).some(function (k) { return o[k].state === state; }); };
    return busy(t.captures, "analysing") || busy(t.results, "comparing");
  }

  function pollDelay() {
    if (document.hidden) return 15000;
    var st = S.state;
    if ((st && st.busy) || recActive(S.job) || pending(S.test)) return 1000;
    return 3000;
  }

  function poll() {
    clearTimeout(S.timer);
    var tid = S.page === "test" ? S.tid : null;
    var was = S.job;
    // Mandarin's recording, where it is; then this page's own state.
    return api(MANDARIN + "record").catch(function () { return null; }).then(function (job) {
      S.job = job && job.state !== "none" ? job : null;
      // A recording just over: the zones may have changed, and SQ-tool has the recording.
      if (recActive(was) && !recActive(S.job) && S.page === "test") loadZones();
      return api("api/state" + (tid ? "?test=" + encodeURIComponent(tid) : ""));
    }).then(function (st) {
      S.state = st;
      $("#version").textContent = "SQ-tool " + st.version;
      $("#free").textContent = fmtBytes(st.free_bytes) + " free";
      $("#rec-badge").hidden = !hearing(S.job);
      if (S.page === "test" && S.tid === tid) {
        if (st.test_rev === null) return;
        if (st.test_rev !== S.rev) return loadTest();
        if (S.test) renderSteps();
      }
    }).catch(function () { /* server restarting: try again */ }).then(function () {
      clearTimeout(S.timer);
      S.timer = setTimeout(poll, pollDelay());
    });
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      S.charts.forEach(drawChart);
      var stack = $("#spec-stack");
      if (stack && S.test && Math.abs(stack.clientWidth - S.spec.width) > 40) loadSpec();
      else if (stack && S.test) loadSpec();
    }, 200);
  });

  route();
  poll();
})();
