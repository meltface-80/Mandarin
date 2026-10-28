"use strict";
/*
 * Loaded before every test file (package.json's test script): the album
 * identification scan stays off unless a test turns it on, so the suite never
 * asks the real MusicBrainz about the fixture library.
 */
if (!process.env.IDENTIFY) process.env.IDENTIFY = "0";
// Nor this machine's own sound devices (v0.6.18): a test brings its own.
if (!process.env.LOCAL_AUDIO) process.env.LOCAL_AUDIO = "0";
// Nor the tag readers' check (v0.8.13): a child process reading every file; its own test turns it on.
if (!process.env.TAGCHECK) process.env.TAGCHECK = "0";
// Nor Apple's iTunes: a closed port on loopback unless a test brings a fake.
if (!process.env.ITUNES_URL) process.env.ITUNES_URL = "http://127.0.0.1:9";
// Nothing left in the system's temp directory (item 201): a folder of this process's own, gone at its end.
require("./tmp-run");

// Nor anything else off this machine (v0.6.2): GitHub's runners reach the
// internet and this suite must not. Opening a page or an album makes the
// server look things up (an album's write-up, related artists); unanswered
// here they fail at once, as they do offline, instead of running on after
// a test has ended. Loopback — the fakes, the server under test — is
// untouched. ALLOW_NETWORK=1 lifts it.
//
// And no request waits for ever (v0.8.49): a server that never answers (a
// deadlock, a request held behind a stuck one) used to hold a test file open
// to its five-minute timeout, with nothing in the log to say which request.
// Now the request fails after a minute and a half, naming its address. The
// longest a test's request legitimately takes is the phone's long poll (25 s).
if (typeof globalThis.fetch === "function") {
  const real = globalThis.fetch;
  const LOCAL = /^(127\.|localhost$|\[?::1\]?$)/;
  const PATIENCE_MS = 90000;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    let host = "";
    try { host = new URL(url).hostname; } catch (e) { /* not a URL: let fetch say so */ }
    if (host && !LOCAL.test(host) && !process.env.ALLOW_NETWORK) throw new TypeError(`fetch failed: ${host} is off limits to the tests (test/setup.js)`);
    if (init && init.signal) return real(input, init);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`${(init && init.method) || "GET"} ${url} gave no answer in ${PATIENCE_MS / 1000} s (test/setup.js)`)), PATIENCE_MS);
    try { return await real(input, Object.assign({}, init, { signal: ac.signal })); }
    finally { clearTimeout(timer); }
  };
}
