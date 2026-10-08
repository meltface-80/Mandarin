"use strict";
/*
 * tagcheck-worker.js — the tag readers compared, file by file (v0.8.13): a
 * child process of its own (lib/library/tagcheck.js starts it), on the cores
 * playback doesn't keep, at the lowest priority, its reads last (lib/cpu.js).
 *
 * Each file is read here as the scanner reads it (scanner.js readTags, with
 * music-metadata) and by the C# server (POST /internal/tags), a few at a time,
 * with a rest after each few twice as long as they took. The two readings are
 * compared as JSON, and what came of it written to tag_checks. A file that
 * changed since the scan read it is left for the next pass.
 *
 * Before each file it says which, so that if music-metadata brings this
 * process down on it (it can), the server knows which file did.
 */
const fs = require("fs");

// Started so already (lib/cpu.js forkOptions); where nice or ionice is missing, this thread at least.
require("../cpu").lowerThisThread();

const BATCH = 16;
const send = (m) => { try { process.send(m); } catch (e) { /* the server is leaving */ } };
let paused = false;
process.on("message", (m) => {
  if (m && m.type === "pause") paused = true;
  if (m && m.type === "resume") paused = false;
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
  const { dataDir, frontUrl, frontKey } = JSON.parse(process.env.MANDARIN_TAGCHECK || "{}");
  const DB = require("./db");
  const { readTags } = require("./scanner");
  const db = DB.open(dataDir, { log: () => {} }).raw;
  const next = db.prepare(`SELECT t.id, t.path, t.mtime, t.size FROM tracks t LEFT JOIN tag_checks c ON c.track_id = t.id
                           WHERE t.id > ? AND t.path NOT LIKE '%://%' AND (c.track_id IS NULL OR c.mtime IS NOT t.mtime OR c.size IS NOT t.size)
                           ORDER BY t.id LIMIT ${BATCH}`);
  const put = db.prepare(`INSERT INTO tag_checks(track_id, mtime, size, outcome, detail, checked_at) VALUES(?, ?, ?, ?, ?, ?)
                          ON CONFLICT(track_id) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, outcome = excluded.outcome,
                          detail = excluded.detail, checked_at = excluded.checked_at`);
  let after = 0, checked = 0;
  try {
    for (;;) {
      while (paused) await sleep(1000);
      const rows = next.all(after);
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      const t0 = Date.now();
      // Only files as the scan last read them: one changed since waits for the next scan.
      const todo = rows.filter(r => {
        try { const st = fs.statSync(r.path); return Math.floor(st.mtimeMs) === r.mtime && st.size === r.size; } catch (e) { return false; }
      });
      if (!todo.length) continue;
      const node = new Map();
      for (const r of todo) {
        send({ type: "at", id: r.id });
        try { node.set(r.id, { ok: true, json: JSON.stringify(await readTags(r.path), replacer) }); }
        catch (e) { node.set(r.id, { ok: false, error: String((e && e.message) || e) }); }
      }
      send({ type: "at", id: null });
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
          const n = node.get(r.id), c = cs.get(r.path);
          let outcome, detail = null;
          if (!c) { outcome = "csharp_failed"; detail = { csharp: "no answer" }; }
          else if (n.ok && c.ok) {
            const cj = JSON.stringify(c.tags);
            if (n.json === cj) outcome = "same";
            else { outcome = "different"; detail = differences(JSON.parse(n.json), c.tags); }
          } else if (!n.ok && !c.ok) { outcome = "both_failed"; detail = { node: n.error, csharp: c.error }; }
          else if (!n.ok) { outcome = "node_failed"; detail = { node: n.error }; }
          else { outcome = "csharp_failed"; detail = { csharp: c.error }; }
          try { put.run(r.id, r.mtime, r.size, outcome, detail ? JSON.stringify(detail) : null, now); } catch (e) { /* the track went meanwhile */ }
        }
      })();
      checked += todo.length;
      send({ type: "progress", checked });
      await sleep(Math.max(300, 2 * (Date.now() - t0)));
    }
  } finally {
    try { db.close(); } catch (e) { /* closed */ }
  }
  send({ type: "done", checked });
  process.exit(0);
})().catch(e => { send({ type: "log", line: "[tagcheck] " + ((e && e.stack) || e) }); process.exit(2); });
