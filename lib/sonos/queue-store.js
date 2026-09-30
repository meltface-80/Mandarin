"use strict";
/*
 * queue-store.js — the queues the server keeps itself, kept on disk too.
 *
 * A Sonos room holds its own queue on the speaker, so a restart of this
 * server costs it nothing. A phone's queue and a UPnP renderer's live here,
 * in memory — and an update ends with a restart, which used to take them
 * with it: the music stopped and the page said nothing was playing. So each
 * of those queues is written to the settings table as it changes (what's
 * queued, at once; where in the track, every ten seconds while it plays)
 * and put back when the server starts (lib/sonos/zones.js, restoreQueues).
 *
 * What's kept is small: track ids, the place in the queue, the position,
 * the modes and the volume. The items themselves are rebuilt from the
 * library on the way back, with the same signed addresses as before (the
 * signature is of the path with a secret that is itself kept), so a
 * renderer still playing the track it was given is recognised at once.
 */
const PREFIX = "queue:";
const DEBOUNCE_MS = 300;
const POSITION_MS = 10000;

class QueueStore {
  constructor(db, { log = () => {} } = {}) {
    this.db = db;
    this.log = log;
    this.timers = new Map();      // id -> pending write
    this.wroteAt = new Map();     // id -> when last written
    this.del = db.raw.prepare("DELETE FROM settings WHERE key = ?");
    this.list = db.raw.prepare("SELECT key, value FROM settings WHERE key LIKE ?");
  }

  key(id) { return PREFIX + id; }

  /*
   * Keep this snapshot. `light`: only the position moved — worth a write
   * every ten seconds, not every second. Anything else is written after a
   * moment's pause, so a burst of queue edits is one write.
   */
  save(id, snap, light = false) {
    const t = this.timers.get(id);
    if (light && t) return;                                    // a write is on its way
    const since = Date.now() - (this.wroteAt.get(id) || 0);
    const wait = light ? Math.max(DEBOUNCE_MS, POSITION_MS - since) : DEBOUNCE_MS;
    if (t) clearTimeout(t);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      this.write(id, snap);
    }, wait);
    if (timer.unref) timer.unref();
    this.timers.set(id, timer);
  }

  write(id, snap) {
    try {
      this.db.setSetting(this.key(id), snap);
      this.wroteAt.set(id, Date.now());
    } catch (e) { this.log(`[queues] couldn't keep the queue of ${id}: ${e.message}`); }
  }

  /* Nothing queued any more: nothing to put back. */
  forget(id) {
    const t = this.timers.get(id);
    if (t) { clearTimeout(t); this.timers.delete(id); }
    try { this.del.run(this.key(id)); } catch (e) { /* nothing to forget */ }
  }

  /* Every kept queue, each with its zone id. */
  all() {
    const out = [];
    for (const r of this.list.all(PREFIX + "%")) {
      try {
        const snap = JSON.parse(r.value);
        if (snap && Array.isArray(snap.ids)) out.push(Object.assign({ id: r.key.slice(PREFIX.length) }, snap));
      } catch (e) { /* not ours */ }
    }
    return out;
  }

  /* Write whatever is still waiting (the server is stopping cleanly). */
  flush(build) {
    for (const [id, t] of this.timers) {
      clearTimeout(t);
      this.timers.delete(id);
      const snap = build(id);
      if (snap) this.write(id, snap);
    }
  }
}

module.exports = { QueueStore, PREFIX };
