"use strict";
/*
 * tagcheck-worker.js — the tag readers compared, file by file (v0.8.13): a
 * child process of its own (lib/library/tagcheck.js starts it), on the cores
 * playback doesn't keep, at the lowest priority, its reads last (lib/cpu.js).
 *
 * Each file is read here as the scanner reads it (scanner.js readTags, with
 * music-metadata) and by the C# server (POST /internal/tags), a batch at a
 * time: here a few files at once (v0.8.15, one per core playback doesn't
 * keep), there side by side as well. The two readings are compared as JSON,
 * and what came of it written to tag_checks. A file that changed since the
 * scan read it is left for the next pass. While something is playing it goes
 * gently: a rest after each batch twice as long as the batch took.
 *
 * It says which files it has in hand whenever that changes, so that if
 * music-metadata brings this process down (it can), the server knows which
 * files to read again, one at a time ([careful], read first), to find it.
 */
const fs = require("fs");

// Started so already (lib/cpu.js forkOptions); where nice or ionice is missing, this thread at least.
require("../cpu").lowerThisThread();

const BATCH = 48;
const send = (m) => { try { process.send(m); } catch (e) { /* the server is leaving */ } };
let paused = false, playing = false;
process.on("message", (m) => {
  if (m && m.type === "pause") paused = true;
  if (m && m.type === "resume") paused = false;
  if (m && m.type === "pace") playing = !!m.playing;
  if (m && m.type === "stop") process.exit(0);
});
process.on("disconnect", () => process.exit(0));

const replacer = (k, v) => typeof v === "bigint" ? { $bigint: String(v) } : (typeof v === "number" && !Number.isFinite(v)) ? { $num: String(v) } : v;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cut = (v) => { const s = v === undefined ? "(none)" : JSON.stringify(v); return s.length > 300 ? s.slice(0, 300) + "…" : s; };

/* What differs between the two readings: [{ field, node, csharp }], the tags by name. */
function differences(a, b) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === "tags" && a.tags && b.tags && typeof a.tags === "object" && typeof b.tags === "object") {
      for (const t of new Set([...Object.keys(a.tags), ...Object.keys(b.tags)])) {
        if (JSON.stringify(a.tags[t]) !== JSON.stringify(b.tags[t])) out.push({ field: "tags." + t, node: cut(a.tags[t]), csharp: cut(b.tags[t]) });
      }
      if (Object.keys(a.tags).join("\n") !== Object.keys(b.tags).join("\n") && !out.some(d => d.field.startsWith("tags.")))
        out.push({ field: "tags (order)", node: cut(Object.keys(a.tags)), csharp: cut(Object.keys(b.tags)) });
    } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ field: k, node: cut(a[k]), csharp: cut(b[k]) });
  }
  if (!out.length && Object.keys(a).join() !== Object.keys(b).join()) out.push({ field: "(order)", node: cut(Object.keys(a)), csharp: cut(Object.keys(b)) });
  return out.slice(0, 20);
}

(async () => {
  const { dataDir, frontUrl, frontKey, atOnce = 1, careful = [] } = JSON.parse(process.env.MANDARIN_TAGCHECK || "{}");
  const DB = require("./db");
  const { readTags } = require("./scanner");
  const db = DB.open(dataDir, { log: () => {} }).raw;
  const next = db.prepare(`SELECT t.id, t.path, t.mtime, t.size FROM tracks t LEFT JOIN tag_checks c ON c.track_id = t.id
                           WHERE t.id > ? AND t.path NOT LIKE '%://%' AND (c.track_id IS NULL OR c.mtime IS NOT t.mtime OR c.size IS NOT t.size)
                           ORDER BY t.id LIMIT ${BATCH}`);
  const byId = db.prepare("SELECT id, path, mtime, size FROM tracks WHERE id = ?");
  const put = db.prepare(`INSERT INTO tag_checks(track_id, mtime, size, outcome, detail, checked_at) VALUES(?, ?, ?, ?, ?, ?)
                          ON CONFLICT(track_id) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, outcome = excluded.outcome,
                          detail = excluded.detail, checked_at = excluded.checked_at`);
  const inHand = new Set();
  const say = () => send({ type: "at", ids: [...inHand] });

  // music-metadata's readings, [n] at a time.
  async function readHere(rows, n) {
    const out = new Map();
    let i = 0;
    const one = async () => {
      while (i < rows.length) {
        const r = rows[i++];
        inHand.add(r.id); say();
        try { out.set(r.id, { ok: true, json: JSON.stringify(await readTags(r.path), replacer) }); }
        catch (e) { out.set(r.id, { ok: false, error: String((e && e.message) || e) }); }
        inHand.delete(r.id); say();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n, rows.length)) }, one));
    return out;
  }

  // One batch both ways, compared and kept.
  async function check(rows, n) {
    // Only files as the scan last read them: one changed since waits for the next scan.
    const todo = rows.filter(r => {
      try { const st = fs.statSync(r.path); return Math.floor(st.mtimeMs) === r.mtime && st.size === r.size; } catch (e) { return false; }
    });
    if (!todo.length) return 0;
    const node = await readHere(todo, n);
    let cs;
    try {
      const res = await fetch(frontUrl + "/internal/tags", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Mandarin-Front-Key": frontKey },
        body: JSON.stringify(todo.map(r => r.path)), signal: AbortSignal.timeout(120000)
      });
      // A C# server from before v0.8.13 (an install updated in place keeps its own): no reader to check.
      if (res.status === 404) process.exit(4);
      if (!res.ok) throw new Error("HTTP " + res.status);
      cs = new Map((await res.json()).map(x => [x.path, x]));
    } catch (e) {
      send({ type: "log", line: `[tagcheck] the C# server didn't answer (${e.message}); trying again later` });
      process.exit(3);
    }
    const now = Date.now();
    db.transaction(() => {
      for (const r of todo) {
        const h = node.get(r.id), c = cs.get(r.path);
        let outcome, detail = null;
        if (!c) { outcome = "csharp_failed"; detail = { csharp: "no answer" }; }
        else if (h.ok && c.ok) {
          const cj = JSON.stringify(c.tags);
          if (h.json === cj) outcome = "same";
          else { outcome = "different"; detail = differences(JSON.parse(h.json), c.tags); }
        } else if (!h.ok && !c.ok) { outcome = "both_failed"; detail = { node: h.error, csharp: c.error }; }
        else if (!h.ok) { outcome = "node_failed"; detail = { node: h.error }; }
        else { outcome = "csharp_failed"; detail = { csharp: c.error }; }
        try { put.run(r.id, r.mtime, r.size, outcome, detail ? JSON.stringify(detail) : null, now); } catch (e) { /* the track went meanwhile */ }
      }
    })();
    return todo.length;
  }

  let after = 0, checked = 0;
  try {
    // The files in hand when the reader came down last time: one at a time, to find the one.
    for (const id of careful) {
      const r = byId.get(id);
      if (r && !r.path.includes("://")) checked += await check([r], 1);
    }
    for (;;) {
      while (paused) await sleep(1000);
      const rows = next.all(after);
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      const t0 = Date.now();
      const n = await check(rows, atOnce);
      if (!n) continue;
      checked += n;
      send({ type: "progress", checked });
      // Gently while something plays; else straight on (the lowest priority yields to everything anyway).
      await sleep(playing ? Math.max(300, 2 * (Date.now() - t0)) : 10);
    }
  } finally {
    try { db.close(); } catch (e) { /* closed */ }
  }
  send({ type: "done", checked });
  process.exit(0);
})().catch(e => { send({ type: "log", line: "[tagcheck] " + ((e && e.stack) || e) }); process.exit(2); });
