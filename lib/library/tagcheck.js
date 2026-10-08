"use strict";
/*
 * tagcheck.js — the C# tag reader checked against this one, on the library
 * itself (v0.8.13).
 *
 * The scanner is to read tags in C# (Tags/ in the C# server). Before it does,
 * every file in the library is read both ways, in the background, and what
 * came of each kept (tag_checks): the same, different (and how), or a file
 * one reader or both couldn't read. Settings → Library Scanner shows how far
 * it has got; its report lists the differences, to send in.
 *
 * The reading is done by a child process (tagcheck-worker.js), so that a file
 * that brings music-metadata down (one can make Node itself abort) takes only
 * the child with it: the file is noted as such and the check goes on after it.
 * It waits while the library is being scanned, starts a few minutes after the
 * server does and again after each scan, and reads every file once more when
 * the server is updated (the C# reader may have changed).
 */
const path = require("path");
const { fork } = require("child_process");
const CPU = require("../cpu");

const OUTCOMES = ["same", "different", "both_failed", "node_failed", "csharp_failed", "crashed"];
const MAX_CRASHES = 50;

class TagCheck {
  constructor({ db, dataDir, scanner, version, log, enabled, delayMs }) {
    this.enabled = enabled !== false;
    this.db = db;
    this.dataDir = dataDir;
    this.scanner = scanner;
    this.version = version;
    this.log = log || (() => {});
    this.delayMs = delayMs == null ? 3 * 60 * 1000 : delayMs;
    this.front = null;          // { url, key }: the C# server, once known
    this.child = null;
    this.at = null;             // the track being read by music-metadata
    this.crashes = 0;
    this.state = "waiting";     // waiting | checking | paused | done | unavailable
    this.timers = [];
    this.stopped = false;
  }

  /* The C# server in front, to ask for its readings. */
  setFront(url, key) {
    this.front = url ? { url, key } : null;
  }

  start() {
    // Results from another build were for another C# reader: read again.
    if (this.db.setting("tagcheckVersion", null) !== this.version) {
      this.db.raw.prepare("DELETE FROM tag_checks").run();
      this.db.setSetting("tagcheckVersion", this.version);
    }
    const t = setTimeout(() => this.kick(), this.delayMs);
    t.unref();
    // While the library is being scanned, the check waits.
    const w = setInterval(() => this.followScan(), 2000);
    w.unref();
    this.timers.push(t, w);
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    if (this.child) { try { this.child.kill(); } catch (e) { /* gone */ } this.child = null; }
  }

  followScan() {
    if (!this.child) return;
    const scanning = !!(this.scanner && this.scanner.state && this.scanner.state.running);
    if (scanning && this.state === "checking") { this.child.send({ type: "pause" }); this.state = "paused"; }
    else if (!scanning && this.state === "paused") { this.child.send({ type: "resume" }); this.state = "checking"; }
  }

  /* A pass over every file not yet read both ways (or changed since). */
  kick() {
    if (!this.enabled || this.stopped || this.child) return;
    if (!this.front) { this.state = "unavailable"; return; }
    if (this.crashes >= MAX_CRASHES) return;
    this.state = this.scanner && this.scanner.state && this.scanner.state.running ? "paused" : "checking";
    const env = Object.assign({}, process.env, {
      MANDARIN_TAGCHECK: JSON.stringify({ dataDir: this.dataDir, frontUrl: this.front.url, frontKey: this.front.key })
    });
    // Background work (lib/cpu.js): the cores playback doesn't keep, the lowest priority, its reads last.
    const child = CPU.adopt(fork(path.join(__dirname, "tagcheck-worker.js"), [], CPU.forkOptions({ env, stdio: ["ignore", "ignore", "pipe", "ipc"] })), "background");
    this.child = child;
    let stderr = "";
    child.stderr.on("data", d => { stderr = (stderr + d).slice(-2000); });
    if (this.state === "paused") child.send({ type: "pause" });
    child.on("message", (m) => {
      if (!m) return;
      if (m.type === "at") this.at = m.id;
      else if (m.type === "log") this.log(m.line);
      else if (m.type === "done") this.log(`[tagcheck] every file read both ways (${m.checked} this pass)`);
    });
    child.on("exit", (code, signal) => {
      this.child = null;
      if (this.stopped) return;
      if (code === 0) { this.state = "done"; this.at = null; return; }
      if (code === 4) {
        // The C# server has no tag reader (older than this server): nothing to check against.
        this.front = null;
        this.state = "unavailable";
        this.log("[tagcheck] the C# server here has no tag reader yet (it comes with the image); no check");
        return;
      }
      if (this.at != null) {
        // music-metadata brought the process down on this file.
        this.crashes++;
        const row = this.db.raw.prepare("SELECT mtime, size, path FROM tracks WHERE id = ?").get(this.at);
        const why = (stderr.match(/Assertion failed[^\n]*|FATAL ERROR[^\n]*|Error[^\n]*/) || [signal || "exit " + code])[0];
        if (row) {
          try {
            this.db.raw.prepare(`INSERT INTO tag_checks(track_id, mtime, size, outcome, detail, checked_at) VALUES(?, ?, ?, 'crashed', ?, ?)
                             ON CONFLICT(track_id) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, outcome = 'crashed',
                             detail = excluded.detail, checked_at = excluded.checked_at`)
              .run(this.at, row.mtime, row.size, JSON.stringify({ node: why.slice(0, 300) }), Date.now());
          } catch (e) { /* the track went meanwhile */ }
          this.log(`[tagcheck] reading ${row.path} stopped the reader (${why.slice(0, 120)}); going on after it`);
        }
        this.at = null;
        const t = setTimeout(() => this.kick(), 5000);
        t.unref();
        this.timers.push(t);
        return;
      }
      // The C# server didn't answer, or something else went wrong: later.
      this.state = "waiting";
      const t = setTimeout(() => this.kick(), 10 * 60 * 1000);
      t.unref();
      this.timers.push(t);
    });
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
    return Object.assign({ available, state: available ? this.state : "unavailable", total, checked }, counts);
  }

  /* The report, as text to send in. */
  report() {
    const s = this.summary();
    const n = (x) => Number(x || 0).toLocaleString("en-GB");
    const lines = [
      `Mandarin ${this.version}: tag reader check, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
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

module.exports = { TagCheck };
