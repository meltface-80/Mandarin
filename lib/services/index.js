"use strict";
/*
 * services/index.js — the streaming services Mandarin plays from (Qobuz,
 * v0.6.23; Tidal, v0.6.24), as one list for the code that only needs to
 * know "is this album streamed, and from where": the library, the scanner,
 * the stream route, the transcode cache, downloads, loudness, Clean up.
 *
 * A streamed album is a row in `albums` keyed "<service>:<id>" with no
 * folder; its tracks are rows whose path is "<service>://track/<id>". The
 * service objects themselves (lib/qobuz, lib/tidal) extend
 * lib/services/streaming.js.
 */
const SERVICES = {
  qobuz: { id: "qobuz", name: "Qobuz" },
  tidal: { id: "tidal", name: "Tidal" }
};
const IDS = Object.keys(SERVICES);

for (const s of Object.values(SERVICES)) {
  s.key = s.id + ":";
  s.path = s.id + "://track/";
}

/* The service a track path belongs to ("qobuz", "tidal"), or null for a file. */
function ofPath(p) {
  const s = String(p || "");
  for (const id of IDS) if (s.startsWith(SERVICES[id].path)) return id;
  return null;
}
/* The service an album key belongs to, or null for an album of files. */
function ofKey(k) {
  const s = String(k || "");
  for (const id of IDS) if (s.startsWith(SERVICES[id].key)) return id;
  return null;
}
const isStreamed = p => ofPath(p) !== null;
/* The service's own id of a track ("qobuz://track/123" → "123") or album key. */
function trackIdOf(p) { const id = ofPath(p); return id ? String(p).slice(SERVICES[id].path.length) : null; }
function albumIdOf(k) { const id = ofKey(k); return id ? String(k).slice(SERVICES[id].key.length) : null; }

module.exports = { SERVICES, IDS, ofPath, ofKey, isStreamed, trackIdOf, albumIdOf };
