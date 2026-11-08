"use strict";
/*
 * Plain http from outside the home network, said (item 367, the security audit's twelfth finding). Mandarin speaks plain
 * http, as a server at home has no certificate: safe at home and on the tailnet, whose own link is encrypted. A port
 * forwarded to the internet is neither, and what a request carries, the app's sign-in included, crosses it as it is.
 * The log says so, once a day for each address, with Tailscale to use instead; nothing at home, on the tailnet or
 * through a proxy that said https is told of.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");

const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("a plain-http request from outside the home network: said once for its address, with what to do instead", { timeout: 60000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  // Callers named as a proxy here names them (the tests' stand-in proxy is trusted).
  const ask = (ip, more = {}) => fetch(B + "/api/auth/status", { headers: Object.assign({ "X-Forwarded-For": ip }, more) });
  const said = (ip) => ctx.logs.filter(l => l.includes(`[auth] ${ip} asked over plain http from outside your home network`)).length;

  await ask("203.0.113.9"); await ask("203.0.113.9"); await ask("203.0.113.9");
  assert.equal(said("203.0.113.9"), 1, "from the internet over plain http: said once for its address");
  assert.ok(ctx.logs.some(l => l.includes("through Tailscale") && l.includes("not a port forward")), "with what to do instead");
  await ask("198.51.100.7");
  assert.equal(said("198.51.100.7"), 1, "another address: said for it too");
  await ask("203.0.113.10", { "X-Forwarded-Proto": "https" });
  assert.equal(said("203.0.113.10"), 0, "through a proxy that said https: nothing");
  for (const ip of ["192.168.1.9", "10.0.0.4", "100.101.102.103"]) { await ask(ip); assert.equal(said(ip), 0, ip + ", at home or on the tailnet: nothing"); }
  await fetch(B + "/api/auth/status");
  assert.equal(said("127.0.0.1"), 0, "this machine: nothing");
});
