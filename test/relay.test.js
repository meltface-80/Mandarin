"use strict";
/*
 * The Android app's page reaches the server through the app's relay, which
 * the WebView treats as a web proxy: the request line carries the whole
 * address. The server must answer those exactly as it answers the usual kind.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { signIn } = require("./auth-helper");

const PORT = ports.port();

// Raw HTTP/1.1 on one connection: each request's status line and body, in order.
function rawRequests(requests) {
  return new Promise((resolve, reject) => {
    const c = net.connect(PORT, "127.0.0.1", () => c.write(requests.join("")));
    let buf = "";
    c.on("data", d => {
      buf += d;
      const n = (buf.match(/HTTP\/1\.1 \d{3}/g) || []).length;
      if (n >= requests.length && /\r\n\r\n[\s\S]*$/.test(buf)) setTimeout(() => { c.end(); resolve(buf); }, 150);
    });
    c.on("error", reject);
  });
}

test("requests relayed with the whole address are answered as usual", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-relay-"));
  fs.mkdirSync(path.join(dir, "music"));
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: path.join(dir, "music"), dataDir: path.join(dir, "data"), serverIp: "127.0.0.1", sonosHosts: [] });
  await srv.start();
  try {
    const token = await signIn("http://127.0.0.1:" + PORT);
    const home = "http://192.168.1.10:" + PORT;
    const out = await rawRequests([
      `GET ${home}/api/health HTTP/1.1\r\nHost: 192.168.1.10:${PORT}\r\nProxy-Connection: keep-alive\r\n\r\n`,
      `GET ${home}/api/auth/status HTTP/1.1\r\nHost: 192.168.1.10:${PORT}\r\nCookie: musicd_session=${token}\r\n\r\n`,
      // Not signed in, asking for a page: sent to sign in, with a path to come back to — not the whole address.
      `GET ${home}/library?x=1 HTTP/1.1\r\nHost: 192.168.1.10:${PORT}\r\nAccept: text/html\r\nConnection: close\r\n\r\n`
    ]);
    const statuses = out.match(/HTTP\/1\.1 \d{3}/g);
    assert.equal(statuses[0], "HTTP/1.1 200");
    assert.equal(statuses[1], "HTTP/1.1 200");
    assert.match(out, /"signed_in":true/);
    const loc = /Location: ([^\r\n]+)/i.exec(out);
    if (loc) assert.ok(loc[1].startsWith("/"), "a path, not an address: " + loc[1]);
  } finally {
    await srv.stop();
  }
});
