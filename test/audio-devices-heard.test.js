"use strict";
/*
 * A renderer that says it has come is listed at once (v1.0.7). Before, the
 * server only searched, once a minute, and a player switched on waited for
 * the next search: now it hears the announcements renderers make (NOTIFY
 * ssdp:alive, Renderers/SsdpListen.cs) and reads the one announced straight
 * away. The fake renderer here never answers a search, so only its
 * announcement can bring it in; it is sent to this computer itself, as a
 * network with no multicast still delivers it.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const dgram = require("dgram");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { built } = require("./server");
const { score } = require("./score");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const noBin = built();
const skip = noBin || (!haveFfmpeg() && "ffmpeg is not installed");
const MR = "urn:schemas-upnp-org:device:MediaRenderer:1";

const notify = (location, usn, { nts = "ssdp:alive", nt = MR, server = "Linux/5.4 UPnP/1.0 Fake/1.0" } = {}) =>
  "NOTIFY * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nCACHE-CONTROL: max-age=1800\r\n" +
  `LOCATION: ${location}\r\nNT: ${nt}\r\nNTS: ${nts}\r\nSERVER: ${server}\r\nUSN: ${usn}::${nt}\r\n\r\n`;

test("an announcement: a renderer's here-I-am is its place; a goodbye, a search, another device, a Sonos player are not", { skip: noBin }, () => {
  const at = "http://192.168.1.50:49152/description.xml";
  const r = score({ fn: "ssdp", heard: [
    notify(at, "uuid:abc"),
    notify(at, "uuid:abc", { nts: "ssdp:byebye" }),
    notify(at, "uuid:abc", { nt: "upnp:rootdevice" }),
    notify(at, "uuid:RINCON_000E58AAAA0001400"),
    notify(at, "uuid:abc", { server: "Linux UPnP/1.0 Sonos/80.1-53025 (ZPS9)" }),
    `HTTP/1.1 200 OK\r\nLOCATION: ${at}\r\nST: ${MR}\r\nUSN: uuid:abc::${MR}\r\n\r\n`,
    `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nST: ${MR}\r\n\r\n`,
    notify("", "uuid:abc")
  ] });
  assert.deepEqual(r.alive, [at, null, null, null, null, null, null, null]);
});

test("a renderer that announces itself is listed within seconds, not at the next search a minute on", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const telly = new FakeRenderer({ name: "Announced Telly", manufacturer: "Samsung", model: "UE55" });
  await telly.start();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpHosts: [], upnpMulticast: true });
  await srv.start();
  const sock = dgram.createSocket("udp4");
  try {
    const token = await signIn(B);
    const listed = async () => {
      const r = await fetch(B + "/api/audio-devices", { headers: { Authorization: "Bearer " + token } });
      return ((await r.json()).devices || []).some(d => d.id === idFor(telly.udn));
    };
    // The first search has been and gone without it (it answers none).
    await new Promise(r => setTimeout(r, 6000));
    assert.equal(await listed(), false, "not found by searching");
    const msg = Buffer.from(notify(telly.location, telly.udn));
    const t0 = Date.now();
    let found = false;
    while (!found && Date.now() - t0 < 10000) {
      await new Promise(r => sock.send(msg, 1900, "127.0.0.1", r));
      await new Promise(r => setTimeout(r, 500));
      found = await listed();
    }
    assert.ok(found, "listed after its announcement");
  } finally {
    sock.close();
    await srv.stop();
    await telly.stop();
  }
});
