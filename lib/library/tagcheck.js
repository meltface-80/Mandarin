"use strict";
/*
 * tagcheck.js — the C# tag reader checked against this one, on the library
 * itself (v0.8.13).
 *
 * The scanner is to read tags in C# (Tags/ in the C# server). Before it does,
 * every file in the library is read both ways, in the background, and what
 * came of each kept (tag_checks): the same, different (and how), or a file
 * one reader or both couldn't read. Settings → Library Scanner shows how far
 * it has got and about how long it has to go; its report lists the
 * differences, to send in.
 *
 * The reading is done by a child process (tagcheck-worker.js), so that a file
 * that brings music-metadata down (one can make Node itself abort) takes only
 * the child with it: the file is noted as such and the check goes on after it.
 * The child reads a few files at a time (one per core playback doesn't keep);
 * when it comes down with several in hand, they are read again one at a time
 * to find the one that did it. It waits while the library is being scanned,
 * goes gently while something is playing, starts a few minutes after the
 * server does and again after each scan.
 *
 * What it found holds for the two readers it compared (v0.8.15): the files
 * are read again only when one of them changes — music-metadata's version
 * here, or the C# reader's (it says which with each reading, X-Tag-Reader) —
 * not at every update of the server.
 *
 * Once a pass has read every file the same both ways, the scanner reads tags
 * with the C# server (v0.8.14, verdict()): until either reader changes, or a
 * file read since comes out differently.
 */
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");
const CPU = require("../cpu");

const OUTCOMES = ["same", "different", "both_failed", "node_failed", "csharp_failed", "crashed"];
const MAX_CRASHES = 50;
// The builds before the readers were named (v0.8.13 and v0.8.14) checked with these two.
const UNNAMED = ["0.8.13", "0.8.14"];
const FIRST_READERS = "music-metadata 11.16.0 | C# 1";

/* music-metadata's version, as installed. */
function mmVersion() {
  try {
    const p = path.join(path.dirname(require.resolve("music-metadata/package.json", { paths: [__dirname] })), "package.json");
    return JSON.parse(fs.readFileSync(p, "utf8")).version;
  } catch (e) {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "node_modules", "music-metadata", "package.json"), "utf8")).version; }
    catch (e2) { return "?"; }
  }
}

class TagCheck {
  constructor({ db, dataDir, scanner, version, log, enabled, delayMs, playing }) {
    this.enabled = enabled !== false;
    this.db = db;
    this.dataDir = dataDir;
    this.scanner = scanner;
    this.version = version;
    this.log = log || (() => {});
    this.delayMs = delayMs == null ? 3 * 60 * 1000 : delayMs;
    this.playing = playing || (() => false);   // whether anything is playing: the check goes gently then
    this.front = null;          // { url, key }: the C# server, once known
    this.readers = null;        // "music-metadata 11.16.0 | C# 1": the two readers, once the C# server has said
    this.child = null;
    this.at = [];               // the tracks being read by music-metadata now
    this.suspects = null;       // the ones in hand when it came down: read one at a time next
    this.crashes = 0;
    this.state = "waiting";     // waiting | checking | paused | done | unavailable
    this.samples = [];          // [time, files checked]: how fast it is going
    this.timers = [];
    this.stopped = false;
    this.paced = null;
    this.probing = null;
  }

  /* The C# server in front, to ask for its readings. */
  setFront(url, key) {
    this.front = url ? { url, key } : null;
  }

  start() {
    // Which readers the results are for, asked of the C# server as soon as it answers.
    const ask = () => this.probe().then(r => { if (!r && this.front && !this.stopped) this.later(ask, 30000); }).catch(() => {});
    const p = setTimeout(ask, Math.min(3000, this.delayMs));
    p.unref();
    const t = setTimeout(() => this.kick(), this.delayMs);
    t.unref();
    // While the library is being scanned, the check waits; while something plays, it goes gently.
    const w = setInterval(() => this.followScan(), 2000);
    w.unref();
    this.timers.push(p, t, w);
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    if (this.child) { try { this.child.kill(); } catch (e) { /* gone */ } this.child = null; }
  }

  later(fn, ms) {
    const t = setTimeout(fn, ms);
    t.unref();
    this.timers.push(t);
  }

  /*
   * The two readers the results are for. Results kept for others are
   * dropped (every file is read again); those of the builds before the
   * readers were named are for the first two, and kept.
   */
  probe() {
    if (this.readers || this.stopped || !this.front) return Promise.resolve(this.readers);
    if (!this.probing) this.probing = this.ask().finally(() => { this.probing = null; });
    return this.probing;
  }

  async ask() {
    let res;
    try {
      res = await fetch(this.front.url + "/internal/tags", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Mandarin-Front-Key": this.front.key },
        body: "[]", signal: AbortSignal.timeout(15000)
      });
    } catch (e) {
      return null;   // not up yet (it starts this server): asked again
    }
    if (res.status === 404) {
      // A C# server from before v0.8.13 (an install updated in place keeps its own): no reader to check.
      this.front = null;
      this.state = "unavailable";
      this.log("[tagcheck] the C# server here has no tag reader yet (it comes with the image); no check");
      return null;
    }
    if (!res.ok) return null;
    // The C# reader of v0.8.13 said nothing: it was the first.
    const readers = `music-metadata ${mmVersion()} | C# ${res.headers.get("x-tag-reader") || "1"}`;
    const had = this.db.setting("tagcheckReaders", null);
    const legacy = had == null && UNNAMED.includes(this.db.setting("tagcheckVersion", null)) && readers === FIRST_READERS;
    if (legacy) {
      // Results from v0.8.13 or v0.8.14: the same two readers, kept.
      if (UNNAMED.includes(this.db.setting("tagcheckPassed", null))) this.db.setSetting("tagcheckPassed", readers);
    } else if (had !== readers) {
      const n = this.db.raw.prepare("DELETE FROM tag_checks").run().changes;
      this.db.setSetting("tagcheckPassed", null);
      if (n) this.log(`[tagcheck] a tag reader changed (${had || "an earlier build"} → ${readers}): every file is read both ways again`);
    }
    this.db.setSetting("tagcheckReaders", readers);
    this.readers = readers;
    return readers;
  }

  followScan() {
    if (!this.child) return;
    const scanning = !!(this.scanner && this.scanner.state && this.scanner.state.running);
    if (scanning && this.state === "checking") { this.child.send({ type: "pause" }); this.state = "paused"; this.samples = []; }
    else if (!scanning && this.state === "paused") { this.child.send({ type: "resume" }); this.state = "checking"; }
    this.pace();
  }

  /* Gently while anything plays: a rest after each few files twice as long as they took. */
  pace() {
    if (!this.child) return;
    let playing = false;
    try { playing = !!this.playing(); } catch (e) { /* as not */ }
    if (playing === this.paced) return;
    this.paced = playing;
    try { this.child.send({ type: "pace", playing }); } catch (e) { /* leaving */ }
  }

  /* A pass over every file not yet read both ways (or changed since). */
  kick() {
    if (!this.enabled || this.stopped || this.child) return;
    if (!this.front) { this.state = "unavailable"; return; }
    if (this.crashes >= MAX_CRASHES) return;
    if (!this.readers) {
      // Which readers first: then the pass, or again in a while.
      this.probe().then(r => { if (r) this.kick(); else if (this.front) this.later(() => this.kick(), 30000); }).catch(() => {});
      return;
    }
    this.state = this.scanner && this.scanner.state && this.scanner.state.running ? "paused" : "checking";
    const careful = this.suspects || [];
    this.suspects = null;
    const env = Object.assign({}, process.env, {
      MANDARIN_TAGCHECK: JSON.stringify({ dataDir: this.dataDir, frontUrl: this.front.url, frontKey: this.front.key, atOnce: CPU.slots(), careful })
    });
    // Background work (lib/cpu.js): the cores playback doesn't keep, the lowest priority, its reads last.
    const child = CPU.adopt(fork(path.join(__dirname, "tagcheck-worker.js"), [], CPU.forkOptions({ env, stdio: ["ignore", "ignore", "pipe", "ipc"] })), "background");
    this.child = child;
    this.at = [];
    this.paced = null;
    this.samples = [];
    let stderr = "";
    child.stderr.on("data", d => { stderr = (stderr + d).slice(-2000); });
    if (this.state === "paused") child.send({ type: "pause" });
    this.pace();
    child.on("message", (m) => {
      if (!m) return;
      if (m.type === "at") this.at = Array.isArray(m.ids) ? m.ids : m.id != null ? [m.id] : [];
      else if (m.type === "progress") this.sample(m.checked);
      else if (m.type === "log") this.log(m.line);
      else if (m.type === "done") this.log(`[tagcheck] every file read both ways (${m.checked} this pass)`);
    });
    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopped) return;
      if (code === 0) { this.state = "done"; this.at = []; this.samples = []; this.passed(); return; }
      if (code === 4) {
        // The C# server has no tag reader (older than this server): nothing to check against.
        this.front = null;
        this.state = "unavailable";
        this.log("[tagcheck] the C# server here has no tag reader yet (it comes with the image); no check");
        return;
      }
      const at = this.at.slice();
      this.at = [];
      if (at.length > 1) {
        // Brought down with several in hand: those again, one at a time, to find which.
        this.crashes++;
        this.suspects = at;
        this.log(`[tagcheck] the reader stopped with ${at.length} files in hand; reading them one at a time to find which`);
        this.later(() => this.kick(), 2000);
        return;
      }
      if (at.length === 1) {
        // music-metadata brought the process down on this file.
        this.crashes++;
        const id = at[0];
        const row = this.db.raw.prepare("SELECT mtime, size, path FROM tracks WHERE id = ?").get(id);
        const why = (stderr.match(/Assertion failed[^\n]*|FATAL ERROR[^\n]*|Error[^\n]*/) || [signal || "exit " + code])[0];
        if (row) {
          try {
            this.db.raw.prepare(`INSERT INTO tag_checks(track_id, mtime, size, outcome, detail, checked_at) VALUES(?, ?, ?, 'crashed', ?, ?)
                             ON CONFLICT(track_id) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, outcome = 'crashed',
                             detail = excluded.detail, checked_at = excluded.checked_at`)
              .run(id, row.mtime, row.size, JSON.stringify({ node: why.slice(0, 300) }), Date.now());
          } catch (e) { /* the track went meanwhile */ }
          this.log(`[tagcheck] reading ${row.path} stopped the reader (${why.slice(0, 120)}); going on after it`);
        }
        this.later(() => this.kick(), 5000);
        return;
      }
      // The C# server didn't answer, or something else went wrong: later.
      this.state = "waiting";
      this.later(() => this.kick(), 10 * 60 * 1000);
    });
  }

  /* How far this pass has got, now: kept for the last quarter of an hour, for the time left. */
  sample(checked, now = Date.now()) {
    this.samples.push([now, checked]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 15 * 60 * 1000) this.samples.shift();
  }

  /* About how long the files left will take, in ms, at the pace of the last few minutes; null when unknown. */
  timeLeft(left) {
    const s = this.samples;
    if (this.state !== "checking" || s.length < 2 || left <= 0) return null;
    const [t0, c0] = s[0], [t1, c1] = s[s.length - 1];
    if (t1 - t0 < 20000 || c1 <= c0) return null;
    return Math.round(left / ((c1 - c0) / (t1 - t0)));
  }

  /* A pass ended: every file read the same both ways, or not. */
  passed() {
    const s = this.summary();
    const odd = s.different + s.node_failed + s.csharp_failed;
    const key = this.readers;
    if (!key) return;
    const was = this.db.setting("tagcheckPassed", null) === key;
    if (!odd && s.checked === s.total) {
      if (!was) this.log(`[tagcheck] all ${s.total} files read the same both ways: the scanner reads tags with the C# server from now on`);
      this.db.setSetting("tagcheckPassed", key);
    } else if (odd) {
      if (was) this.db.setSetting("tagcheckPassed", null);
      this.log(`[tagcheck] ${odd} file${odd === 1 ? "" : "s"} read differently: the scanner goes on reading tags itself (Settings → Library Scanner has the report)`);
    }
  }

  /*
   * Whether the scanner may read tags with the C# server (v0.8.14): a whole
   * pass with these two readers read every file the same both ways, and
   * nothing read since has come out differently.
   */
  verdict() {
    const s = this.summary();
    const odd = s.different + s.node_failed + s.csharp_failed;
    const passed = !!this.readers && this.db.setting("tagcheckPassed", null) === this.readers;
    return { ready: s.available && passed && odd === 0, passed, odd };
  }

  /* How far it has got, for Settings → Library Scanner. */
  summary() {
    const total = this.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks WHERE path NOT LIKE '%://%'").get().n;
    const counts = Object.fromEntries(OUTCOMES.map(o => [o, 0]));
    for (const r of this.db.raw.prepare(`SELECT c.outcome, COUNT(*) AS n FROM tag_checks c JOIN tracks t ON t.id = c.track_id
                                     WHERE c.mtime IS t.mtime AND c.size IS t.size GROUP BY c.outcome`).all()) {
      if (r.outcome in counts) counts[r.outcome] = r.n;
    }
    const checked = OUTCOMES.reduce((a, o) => a + counts[o], 0);
    const available = this.enabled && !!this.front;
    return Object.assign({ available, state: available ? this.state : "unavailable", total, checked,
      time_left: available ? this.timeLeft(total - checked) : null, readers: this.readers }, counts);
  }

  /* The report, as text to send in. */
  report() {
    const s = this.summary();
    const n = (x) => Number(x || 0).toLocaleString("en-GB");
    const lines = [
      `Mandarin ${this.version}: tag reader check, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      `Readers: ${s.readers || "not known yet"}.`,
      `Files read both ways: ${n(s.checked)} of ${n(s.total)}.`,
      `The same: ${n(s.same)}.`,
      `Different: ${n(s.different)}.`,
      `Unreadable by both: ${n(s.both_failed)}.`,
      `Read only by C#: ${n(s.node_failed)}.`,
      `Read only by Node: ${n(s.csharp_failed)}.`,
      `Stopped the Node reader: ${n(s.crashed)}.`
    ];
    const titles = {
      different: "Different", node_failed: "Read only by C#", csharp_failed: "Read only by Node",
      crashed: "Stopped the Node reader", both_failed: "Unreadable by both"
    };
    for (const o of ["different", "csharp_failed", "node_failed", "crashed", "both_failed"]) {
      if (!s[o]) continue;
      const rows = this.db.raw.prepare(`SELECT t.path, c.detail FROM tag_checks c JOIN tracks t ON t.id = c.track_id
                                    WHERE c.outcome = ? AND c.mtime IS t.mtime AND c.size IS t.size ORDER BY t.path LIMIT 100`).all(o);
      lines.push("", `${titles[o]} (${n(s[o])}${s[o] > rows.length ? ", the first " + rows.length : ""})`);
      for (const r of rows) {
        lines.push(r.path);
        let d = null;
        try { d = JSON.parse(r.detail || "null"); } catch (e) { /* none */ }
        if (Array.isArray(d)) for (const x of d) lines.push(`  ${x.field}: Node ${x.node} | C# ${x.csharp}`);
        else if (d) lines.push(`  ${d.node ? "Node: " + d.node : ""}${d.node && d.csharp ? " | " : ""}${d.csharp ? "C#: " + d.csharp : ""}`);
      }
    }
    return lines.join("\n") + "\n";
  }
}

module.exports = { TagCheck, mmVersion };
