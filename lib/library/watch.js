"use strict";
/*
 * watch.js — the music folders watched for changes as they happen.
 *
 * The scanner re-reads the library on a timer (SCAN_INTERVAL_HOURS) and on
 * request. This watches each music folder with the file system's own
 * notifications (inotify on Linux, through fs.watch, recursively), so a
 * folder added, files copied in, an album deleted or renamed are noticed
 * within a minute: events are gathered, and a scan starts once they have
 * been quiet for [quietMs] (and at most once every [minGapMs]). The scan is
 * the ordinary one — only changed files are re-read, the mass-removal guard
 * holds — so a flood of events costs one scan.
 *
 * What the file system doesn't report (a change made on a network share from
 * another machine, say) still waits for the timer or Rescan library.
 */
const fs = require("fs");
const path = require("path");

class LibraryWatcher {
  constructor({ roots, onChange, log = () => {}, quietMs = 20000, minGapMs = 60000, ignore }) {
    this.rootsOf = roots;          // () => [dir…]
    this.onChange = onChange;      // () => Promise (a scan)
    this.log = log;
    this.quietMs = quietMs;
    this.minGapMs = minGapMs;
    this.ignore = ignore || (p => /(^|\/)(\.|@eaDir|#recycle|\.Trash)/.test(p));
    this.watchers = new Map();     // dir -> fs.FSWatcher
    this.timer = null;
    this.lastRun = 0;
    this.pending = 0;
    this.running = false;
    this.unsupported = false;
  }

  /** Watch every music folder that exists; folders gone are let go. */
  refresh() {
    const want = new Set((this.rootsOf() || []).filter(d => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } }));
    for (const [dir, w] of this.watchers) if (!want.has(dir)) { try { w.close(); } catch (e) { /* closed */ } this.watchers.delete(dir); }
    for (const dir of want) if (!this.watchers.has(dir)) this.add(dir);
  }

  add(dir) {
    let w;
    try {
      w = fs.watch(dir, { recursive: true, persistent: false }, (event, name) => this.saw(dir, event, name));
    } catch (e) {
      // Recursive watching isn't offered everywhere (an older kernel, a
      // file system without inotify): the timer and Rescan library remain.
      if (!this.unsupported) { this.unsupported = true; this.log(`[watch] not watching ${dir}: ${e.message}`); }
      return;
    }
    w.on("error", e => { this.log(`[watch] ${dir}: ${e.message}`); try { w.close(); } catch (x) { /* closed */ } this.watchers.delete(dir); });
    this.watchers.set(dir, w);
    this.log(`[watch] watching ${dir}`);
  }

  saw(dir, event, name) {
    const rel = name ? String(name) : "";
    if (rel && this.ignore(rel)) return;
    // Partial files being written (a copy under way) still count: the scan
    // waits for quiet, and the scanner skips what it can't read.
    this.pending++;
    this.last = { dir, event, name: rel, at: Date.now() };
    this.arm();
  }

  arm() {
    if (this.timer) clearTimeout(this.timer);
    const sinceRun = Date.now() - this.lastRun;
    const wait = Math.max(this.quietMs, this.minGapMs - sinceRun);
    this.timer = setTimeout(() => this.fire(), wait);
    this.timer.unref();
  }

  fire() {
    this.timer = null;
    if (this.running) { this.arm(); return; }
    const n = this.pending;
    this.pending = 0;
    this.lastRun = Date.now();
    this.running = true;
    this.log(`[watch] ${n} change${n === 1 ? "" : "s"} in the music folders${this.last && this.last.name ? ` (last: ${path.join(this.last.dir, this.last.name)})` : ""}: reading`);
    Promise.resolve().then(() => this.onChange()).catch(e => this.log("[watch] " + e.message)).then(() => {
      this.running = false;
      if (this.pending) this.arm();
    });
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const w of this.watchers.values()) { try { w.close(); } catch (e) { /* closed */ } }
    this.watchers.clear();
  }

  status() {
    return { watching: [...this.watchers.keys()], pending: this.pending, lastRun: this.lastRun || null, supported: !this.unsupported };
  }
}

module.exports = { LibraryWatcher };
