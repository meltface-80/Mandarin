"use strict";
/*
 * Who asked, as the server believes it (item 362, the security audit's fourth finding). Every request from this
 * machine had its X-Forwarded-For believed, so a raw forward, a tunnel or a proxy passing a client's own header on
 * let a request from the internet claim a home address: create the account on a fresh install, come in with the
 * sign-in off. Now a proxy's word is believed only from the built-in Tailscale engine, on the port of its own the
 * server opens for it (127.0.0.1, said as it starts), and from the proxies named in TRUSTED_PROXIES; a request from
 * this machine naming a caller through anything else is the internet, said once in the log. A request from this
 * machine naming nobody is this machine, as before.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function start(trustedProxies) {
  const lib = makeLibrary();
  const port = ports.port();
  const { createServer } = require("./server");
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, trustedProxies });
  const ctx = await srv.start();
  let engine = 0;
  for (let i = 0; i < 100 && !engine; i++) { const m = ctx.logs.join("\n").match(/on 127\.0\.0\.1:(\d+) for the built-in Tailscale alone/); if (m) engine = Number(m[1]); else await sleep(50); }
  // Whether the server would let this caller create the account: a home caller only, on a fresh install.
  const home = async (p, forwarded) => (await (await fetch(`http://127.0.0.1:${p}/api/auth/status`, forwarded ? { headers: { "X-Forwarded-For": forwarded } } : {})).json()).can_setup;
  return { srv, ctx, port, engine, home };
}

test("as installed: only the Tailscale engine's own port is believed about who asked", { timeout: 60000 }, async () => {
  const { srv, ctx, port, engine, home } = await start("");
  try {
    assert.equal(await home(port), true, "from this machine, naming nobody: this machine, home");
    assert.equal(await home(port, "192.168.1.5"), false, "from this machine naming a home address through no trusted proxy: the internet");
    assert.equal(await home(port, "203.0.113.9"), false);
    assert.equal(ctx.logs.filter(l => l.includes("named who asked through a proxy that isn't trusted")).length, 1, "said once, with how to trust one's own proxy");
    assert.ok(ctx.logs.some(l => l.includes("TRUSTED_PROXIES=127.0.0.1")));
    assert.ok(engine > 0 && engine !== port, "a port of the engine's own, said as it starts: " + engine);
    // The engine, on its own port: the tailnet's caller as it names them (a tailnet address is away from home, a home one home).
    assert.equal(await home(engine, "192.168.1.5"), true, "the engine's word believed on its port");
    assert.equal(await home(engine, "203.0.113.9"), false);
    assert.equal(await home(engine, "100.101.102.103"), false, "a tailnet caller is away from home, as before");
  } finally { await srv.stop(); }
});

test("a proxy named in TRUSTED_PROXIES is believed about who asked", { timeout: 60000 }, async () => {
  const { srv, ctx, port, home } = await start("127.0.0.1");
  try {
    assert.equal(await home(port, "192.168.1.5"), true, "an nginx here, named: the home caller it names");
    assert.equal(await home(port, "203.0.113.9"), false, "and the internet caller it names");
    assert.equal(ctx.logs.some(l => l.includes("isn't trusted")), false);
  } finally { await srv.stop(); }
});
