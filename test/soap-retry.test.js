"use strict";
/*
 * A player that closes its connection once it has answered (Audirvana's
 * UPnP renderer does): the next control request, sent on the pooled
 * connection, must not fail with "socket hang up" — it is sent once more
 * on a fresh one (v0.7.1).
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const SOAP = require("../lib/sonos/soap");

const TYPE = "urn:schemas-upnp-org:service:AVTransport:1";
const answer = (action) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="${TYPE}"></u:${action}Response></s:Body></s:Envelope>`;

test("a control request on a connection the player has closed is sent again on a new one", async () => {
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
    await SOAP.call(url, TYPE, "Stop", { InstanceID: 0 });
    await new Promise(r => setTimeout(r, 80));   // the player has cut the connection by now
    await SOAP.call(url, TYPE, "Stop", { InstanceID: 0 });   // on the dead pooled socket first
    await new Promise(r => setTimeout(r, 80));
    await SOAP.call(url, TYPE, "Stop", { InstanceID: 0 });
    assert.ok(dropped >= 1, "the pooled connection was dropped under a request: " + dropped);
    assert.ok(requests >= 3 + dropped, "and each dropped one was sent again: " + requests);
  } finally { srv.close(); }
});

test("a request that fails on a fresh connection is a real failure", async () => {
  const srv = http.createServer((req, res) => { req.socket.destroy(); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/AVTransport/control`;
  try {
    await assert.rejects(SOAP.call(url, TYPE, "Stop", { InstanceID: 0 }), /not responding/);
  } finally { srv.close(); }
});
