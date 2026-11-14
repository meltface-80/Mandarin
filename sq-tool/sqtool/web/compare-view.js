/*
 * The result of comparing two songs (compare.js, item 413): the verdict in words and the numbers of the null test,
 * the difference across frequency, spectrograms of A, B and the difference, each song's format and dynamics, and the
 * files to download. Drawn with app.js's helpers (window.SQ).
 */
(function () {
  "use strict";

  function H() { return window.SQ; }
  function V() { return window.SQCompare; }
  function esc(s) { return H().esc(s); }
  // A size, never negative (a crest factor, a range): no sign.
  function plain(v, unit) { return v == null ? "–" : v.toFixed(1) + " " + unit; }

  function render(c, head, body) {
    if (!head || !body) return;
    var names = '<div class="cmp-names">' + who("a", c.a) + who("b", c.b) + "</div>";
    if (c.state === "comparing") {
      head.innerHTML = "<h1>Comparing two songs</h1>" + names + '<p class="muted"><span class="spinner"></span> Comparing… Long songs at high rates take a minute.</p>';
      body.innerHTML = "";
      return;
    }
    if (c.state === "error") {
      head.innerHTML = "<h1>Comparing two songs</h1>" + names + '<div class="alert bad"><p>' + esc(c.message) + "</p></div>" + actions(c, false);
      body.innerHTML = "";
      return;
    }
    var r = c.result;
    head.innerHTML = "<h1>Two songs compared</h1>" + names + verdict(r) + numbers(r) + details(r);
    body.innerHTML = spectrumCard(r) + spectrogramCard(c) + songsCard(c, r) + '<section class="card"><h2>Downloads</h2>' + actions(c, true) + "</section>";
    drawSpectrum(r);
  }

  function who(w, song) {
    song = song || {};
    return '<div class="cmp-name"><span class="slot-name" style="background:' + V().COLOR[w] + '">' + w.toUpperCase() + "</span><span><b>" +
      esc(song.filename) + '</b><span class="muted small">' + esc((song.music_path || "").split("/").slice(0, -1).join("/")) + "</span></span></div>";
  }

  function verdict(r) {
    var cls = V().VERDICT_CLASS[r.verdict] || "";
    return '<div class="verdict-card ' + cls + '"><span class="badge ' + cls + '" id="cmp-verdict">' + esc(r.headline) + "</span>" +
      '<div class="cmp-words">' + esc(r.words) + ".</div></div>";
  }

  function nullText(r) {
    var n = r.null || {};
    if (r.identical) return ["none left", "the samples are identical"];
    if (!r.aligned || n.depth_db == null) return ["–", "nothing lines up"];
    if (n.residual_dbfs != null && n.residual_dbfs < -200) return ["nothing left", "once level and polarity are matched"];
    return [H().fmtDb(n.depth_db, 1) + " dB", "what is left: " + H().fmtDb(n.residual_dbfs, 1) + " dBFS rms"];
  }

  function offsetText(r) {
    var o = r.offset;
    if (!o) return ["–", ""];
    var s = Math.round(o.samples * 100) / 100;
    if (Math.abs(s) < 0.005) return ["none", "they start together"];
    return [(s > 0 ? "+" : "−") + Math.abs(s).toLocaleString() + " samples", "B starts " + Math.abs(o.ms).toFixed(3) + " ms " + (s > 0 ? "later" : "earlier")];
  }

  function numbers(r) {
    var n = nullText(r), o = offsetText(r);
    var level = r.aligned && r.level_db != null ? [H().fmtDb(r.level_db, 2) + " dB", r.level_db > 0.005 ? "B is louder" : r.level_db < -0.005 ? "B is quieter" : "the same level"] : ["–", ""];
    var pol = r.aligned ? (r.polarity_inverted ? ["inverted", "B is upside down"] : (r.polarity_channels || []).some(Boolean) ? ["mixed", "inverted on some channels"] : ["the same", ""]) : ["–", ""];
    function cell(id, label, v) {
      return '<div class="bignum" id="' + id + '"><span class="label">' + label + '</span><span class="value">' + esc(v[0]) + '</span><span class="sub">' + esc(v[1]) + "</span></div>";
    }
    return '<div class="bignums">' + cell("cmp-null", "Null depth", n) + cell("cmp-level", "Level, B against A", level) +
      cell("cmp-offset", "Time offset", o) + cell("cmp-polarity", "Polarity", pol) + "</div>" +
      (r.where ? '<p class="cmp-where"><b>Where the difference lies:</b> ' + esc(r.where) + "</p>" : "");
  }

  function details(r) {
    var n = r.null || {}, lines = [];
    if (n.in_band_depth_db != null && n.depth_db != null && n.depth_db - n.in_band_depth_db > 0.5) {
      lines.push("Below 20 kHz: " + H().fmtDb(n.in_band_depth_db, 1) + " dB against the music (" + H().fmtDb(n.in_band_dbfs, 1) + " dBFS rms)");
    }
    if ((n.channels || []).length > 1 && n.depth_db != null && n.residual_dbfs > -200) {
      lines.push("By channel: " + n.channels.map(function (ch, i) { return "ch" + (i + 1) + " " + H().fmtDb(ch.depth_db, 1) + " dB"; }).join(" · "));
    }
    if ((r.level_db_channels || []).length > 1 && r.aligned) {
      lines.push("Level by channel: " + r.level_db_channels.map(function (x) { return H().fmtDb(x, 2) + " dB"; }).join(" · "));
    }
    if (r.overlap) lines.push("Compared over " + H().fmtSecs(r.overlap.seconds) + " where both play, at " + H().fmtRate(r.common.rate));
    lines = lines.concat(r.notes || []);
    return lines.length ? "<details><summary>Details</summary><ul class=\"lines\">" + lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></details>" : "";
  }

  function spectrumCard(r) {
    if (!r.spectrum || !(r.spectrum.bands || []).length) return "";
    return '<section class="card"><h2>The difference across frequency</h2>' +
      H().chartBlock("cmp-bands", "By third octave", "What is left after matching (dBFS rms in each band) beside the music (B).") + "</section>";
  }

  function drawSpectrum(r) {
    var bands = (r.spectrum || {}).bands || [];
    if (!bands.length) return;
    var x = bands.map(function (b) { return b.freq; });
    var series = [{ label: "The music (B)", color: V().COLOR.music, x: x, y: bands.map(function (b) { return b.music_dbfs; }) },
      { label: "What is left", color: V().COLOR.diff, x: x, y: bands.map(function (b) { return b.residual_dbfs; }) }];
    H().spectrumChart(document.getElementById("cmp-bands"), series, 180);
    H().legend(document.getElementById("lg-cmp-bands"), series);
  }

  function spectrogramCard(c) {
    var base = "api/comparisons/" + encodeURIComponent(c.id) + "/spectrogram/";
    var w = Math.min(2400, Math.round((document.getElementById("main").clientWidth || 800) * (window.devicePixelRatio || 1)));
    var panels = [["a", "A", V().COLOR.a], ["b", "B, lined up with A", V().COLOR.b], ["diff", "The difference: B − A, level matched", V().COLOR.diff]];
    return '<section class="card"><h2>Spectrograms</h2><div class="spec-stack cmp-specs">' + panels.map(function (p) {
      return '<div class="spec-panel"><img alt="Spectrogram: ' + esc(p[1]) + '" src="' + base + p[0] + ".png?w=" + w + "&h=300&floor=-150&scale=log&map=" + H().MAP + '">' +
        '<span class="spec-label"><span class="swatch" style="background:' + p[2] + '"></span>' + esc(p[1]) + "</span></div>";
    }).join("") + '</div><div class="colorbar"><span>−150 dB</span><i style="background:' + H().mapGradient() + '"></i><span>0 dB</span></div>' +
      '<p class="spec-note">On A\'s timeline, 20 Hz to ' + H().fmtHz(c.result.common.rate / 2) + " (log scale). Black in the difference: below −150 dBFS.</p></section>";
  }

  function songsCard(c, r) {
    var rows = [
      ["Format", function (s) { return esc(s.label); }],
      ["Sample rate", function (s) { return H().fmtRate(s.rate); }],
      ["Bits in use", function (s) { return s.is_float ? (s.resolution ? s.resolution + " (float)" : "float") : String(s.resolution || s.bits); }],
      ["Channels", function (s) { return String(s.channels); }],
      ["Length", function (s) { return H().fmtSecs(s.seconds); }],
      ["Peak", function (s) { return V().dash(s.dynamics.peak_dbfs, 1, "dBFS"); }],
      ["RMS", function (s) { return V().dash(s.dynamics.rms_dbfs, 1, "dBFS"); }],
      ["Crest factor", function (s) { return plain(s.dynamics.crest_db, "dB"); }],
      ["Loudness", function (s) { return V().dash(s.dynamics.lufs, 1, "LUFS"); }],
      ["Loudness range", function (s) { return plain(s.dynamics.lra_lu, "LU"); }],
      ["Peak to loudness", function (s) { return plain(s.dynamics.plr_db, "dB"); }]
    ];
    return '<section class="card"><h2>The two songs</h2><div class="table-wrap"><table class="cmp"><thead><tr><th></th>' +
      ["a", "b"].map(function (w) { return '<th><div class="colhead"><span class="swatch" style="background:' + V().COLOR[w] + '"></span>' + w.toUpperCase() + "</div></th>"; }).join("") +
      "</tr></thead><tbody>" + rows.map(function (row) {
        var cells = ["a", "b"].map(function (w) { try { return row[1](r[w]); } catch (e) { return "–"; } });
        return "<tr><td>" + row[0] + "</td>" + cells.map(function (x, i) { return '<td class="' + (i && x !== cells[0] ? "diff" : "") + '">' + x + "</td>"; }).join("") + "</tr>";
      }).join("") + '</tbody></table></div><p class="muted small">Loudness is integrated loudness after BS.1770; loudness range, the spread of its 3-second loudness. A louder, more compressed master shows a higher loudness, a lower range and a lower crest factor. Highlighted: B differs from A.</p></section>';
  }

  function actions(c, ready) {
    var base = "api/comparisons/" + encodeURIComponent(c.id), links = [];
    if (ready) {
      links.push('<a class="btn small" id="cmp-diff" href="' + base + '/difference.wav" download>⤓ The difference: B − A, level matched (WAV)</a>');
      links.push('<a class="btn small" id="cmp-diff-loud" href="' + base + '/difference.wav?normalised=1" download>⤓ The difference, gain-normalised to −1 dBFS peak: louder than it is (WAV)</a>');
      links.push('<a class="btn small" href="' + base + '/audio/a.wav" download>⤓ A as compared (WAV)</a>');
      links.push('<a class="btn small" href="' + base + '/audio/b.wav" download>⤓ B as compared, lined up to a fraction of a sample (WAV)</a>');
    }
    return (links.length ? '<div class="downloads">' + links.join("") + "</div>" +
      '<p class="muted small">A and B as compared: at the rate and channel count they were compared at. The difference is 32-bit float, on A\'s timeline where both play. Turn the volume down before playing one: the normalised difference is made loud on purpose.</p>' : "") +
      '<div class="row"><a class="btn small" href="#/compare">Compare two other songs</a><button class="btn small danger" data-cmp-delete>Delete this comparison</button></div>';
  }

  window.SQCompareView = { render: render };
})();
