"use strict";
/*
 * A renderer's events asked for again soon after it didn't answer (item 196).
 * A GENA SUBSCRIBE it doesn't answer at all — asked while it was off the
 * network — was asked again only ten minutes later, and until then the device
 * was polled, a playing one read every few seconds where its events would have
 * said at once. Now one left unanswered is asked again after 15 s (then 30 s,
 * and so on up to the ten minutes); one the device answers "no" to still waits
 * the ten minutes.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

test("a subscription the renderer left unanswered is asked for again within seconds, not ten minutes", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics Ltd", model: "Poly", setNext: false });
  // Its subscriptions dropped unanswered from the start: off the network when the server first asks.
  poly.dropSubscribe = true;
  await poly.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [poly.location], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(async () => { await srv.stop(); await poly.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const POLY = idFor(poly.udn);
  await until(async () => (await call("GET", "audio-devices")).devices.some(d => d.id === POLY), 20000);
  assert.equal((await call("PATCH", "audio-devices/" + POLY, { enabled: true })).status, 200);
  // Asked, and not answered.
  await until(() => poly.refusals.some(r => r.startsWith("SUBSCRIBE")), 20000);
  assert.equal(poly.subscribers.length, 0);
  // Back on the network: subscribed again within seconds (15 s, and the next tick), the server saying so.
  poly.dropSubscribe = false;
  const t0 = Date.now();
  await until(() => poly.subscribers.length > 0, 40000);
  assert.ok(Date.now() - t0 < 40000, "subscribed again within 40 s, not ten minutes");
  await until(() => ctx.logs.some(l => l.includes("Poly: events on")), 5000);
});
