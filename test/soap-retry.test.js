"use strict";
/*
 * A player that closes its connection once it has answered (Audirvana's
 * UPnP renderer does): the next control request, sent on the pooled
 * connection, must not fail with "socket hang up" — it is sent once more
 * on a fresh one (v0.7.1). The C# server's sender (Playback/SoapHttp.cs,
 * through `mandarin-server score`; lib/sonos/soap.js until v0.8.50).
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { built } = require("./server");
const { scoreAsync } = require("./score");

const TYPE = "urn:schemas-upnp-org:service:AVTransport:1";
const skip = built();
/* The calls made one after another, each [wait] ms after the last: each { out } or { error }. */
const calls = async (url, waits) => (await scoreAsync({ fn: "soapcall", calls: waits.map(wait => ({ url, service: TYPE, action: "Stop", args: { InstanceID: 0 }, wait })) })).results;
const answer = (action) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="${TYPE}"></u:${action}Response></s:Body></s:Envelope>`;

test("a control request on a connection the player has closed is sent again on a new one", { skip }, async () => {
  let requests = 0, dropped = 0;
  const srv = http.createServer((req, res) => {
    requests++;
    // A second request on the same connection is dropped without an answer:
    // the player promised keep-alive and did not mean it.
    req.socket.__n = (req.socket.__n || 0) + 1;
    if (req.socket.__n > 1) { dropped++; req.socket.destroy(); return; }
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Content-Type", "text/xml");
      res.end(answer("Stop"));
    });
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/AVTransport/control`;
  try {
    // The second and third on the dead pooled socket first, the player having cut it by then.
    const results = await calls(url, [0, 80, 80]);
    assert.deepEqual(results.map(x => x.error || null), [null, null, null], JSON.stringify(results));
    assert.ok(dropped >= 1, "the pooled connection was dropped under a request: " + dropped);
    assert.ok(requests >= 3 + dropped, "and each dropped one was sent again: " + requests);
  } finally { srv.close(); }
});

test("a request that fails on a fresh connection is a real failure", { skip }, async () => {
  const srv = http.createServer((req, res) => { req.socket.destroy(); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/AVTransport/control`;
  try {
    assert.match((await calls(url, [0]))[0].error, /not responding/);
  } finally { srv.close(); }
});
