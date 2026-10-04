"use strict";
/*
 * Loaded before every test file (package.json's test script): the album
 * identification scan stays off unless a test turns it on, so the suite never
 * asks the real MusicBrainz about the fixture library.
 */
if (!process.env.IDENTIFY) process.env.IDENTIFY = "0";
// Nor Apple's iTunes: a closed port on loopback unless a test brings a fake.
if (!process.env.ITUNES_URL) process.env.ITUNES_URL = "http://127.0.0.1:9";

// Nor anything else off this machine (v0.6.2): GitHub's runners reach the
// internet and this suite must not. Opening a page or an album makes the
// server look things up (an album's write-up, related artists); unanswered
// here they fail at once, as they do offline, instead of running on after
// a test has ended. Loopback — the fakes, the server under test — is
// untouched. ALLOW_NETWORK=1 lifts it.
if (!process.env.ALLOW_NETWORK && typeof globalThis.fetch === "function") {
  const real = globalThis.fetch;
  const LOCAL = /^(127\.|localhost$|\[?::1\]?$)/;
  globalThis.fetch = (input, init) => {
    let host = "";
    try { host = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url).hostname; } catch (e) { /* not a URL: let fetch say so */ }
    if (host && !LOCAL.test(host)) return Promise.reject(new TypeError(`fetch failed: ${host} is off limits to the tests (test/setup.js)`));
    return real(input, init);
  };
}
