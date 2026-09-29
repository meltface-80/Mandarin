"use strict";
/*
 * Settings → Audio Devices: UPnP renderers are found and read, every player
 * lands in the register with its capabilities in layers, a name you give a
 * device shows everywhere, and a device that has gone can be forgotten.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseSink } = require("../lib/renderers/protocolinfo");
const { parseDescription } = require("../lib/renderers/description");
const { profileFor, effective } = require("../lib/renderers/profiles");
const { Registry } = require("../lib/renderers/registry");
const { isSonos } = require("../lib/renderers/ssdp");
const { idFor, seedLocation } = require("../lib/renderers/discovery");
const DB = require("../lib/library/db");
const { FakeRenderer, SINK_WIIM } = require("./fake-renderer");
const { FakeHousehold } = require("./fake-sonos");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3607;
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 100));
  }
}

test("GetProtocolInfo's Sink: containers, and rates only from raw PCM", () => {
  const s = parseSink(SINK_WIIM + ",http-get:*:video/mp4:*,http-get:*:audio/x-dsf:*,rtsp-rtp-udp:*:audio/L24;rate=96000:*");
  assert.deepEqual(s.rates, [44100, 48000, 96000]);
  for (const c of ["flac", "wav", "alac", "mp3", "aac", "ogg", "dsd", "pcm"]) assert.ok(s.containers.includes(c), c);
  assert.ok(!s.mimes.includes("video/mp4"));
  assert.ok(s.mimes.includes("audio/l16"));
  assert.deepEqual(parseSink(""), { mimes: [], containers: [], rates: [], raw: "" });
  assert.deepEqual(parseSink(null).mimes, []);
});

test("a device description: URLs resolved, the renderer found inside a root device", async () => {
  const r = new FakeRenderer({ name: "Telly", manufacturer: "Samsung", model: "UE55", nested: true, urlBase: true });
  r.port = 4321;
  const d = parseDescription(r.description(), r.location);
  assert.equal(d.friendlyName, "Telly");
  assert.equal(d.modelName, "UE55");
  assert.equal(d.udn, r.udn);
  assert.ok(d.renderer);
  assert.equal(d.services.AVTransport.controlUrl, "http://127.0.0.1:4321/upnp/control/AVTransport1");
  assert.equal(d.services.ConnectionManager.type, "urn:schemas-upnp-org:service:ConnectionManager:1");
  assert.equal(d.openhome, false);
  assert.equal(parseDescription("<html>not upnp</html>", "http://x/"), null);
  const oh = parseDescription(r.description().replace("urn:schemas-upnp-org:service:RenderingControl:1", "urn:av-openhome-org:service:Playlist:1"), r.location);
  assert.ok(oh.openhome);
  assert.ok(oh.services.Playlist);
});

test("profiles: what a model takes, and the layers a chip comes from", () => {
  assert.equal(profileFor({ manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus" }).id, "wiim-pro-plus");
  assert.equal(profileFor({ manufacturer: "Linkplay", model: "WiiM Pro" }).id, "wiim-pro");
  assert.equal(profileFor({ manufacturer: "Chord Electronics Ltd", model: "Poly" }).id, "chord-poly");
  assert.equal(profileFor({ manufacturer: "Poly Inc", model: "Poly Headset" }).id, "generic");
  assert.equal(profileFor({ manufacturer: "Acme", model: "Streamer" }).id, "generic");
  assert.equal(profileFor({ family: "wiim" }).id, "wiim");

  const wiim = effective({ kind: "upnp", manufacturer: "Linkplay", model: "WiiM Pro Plus", playable: true, caps: { advertised: { containers: ["flac", "wav"], rates: [44100, 48000] } } });
  const on = list => list.filter(x => x.on).map(x => x.hz || x.n);
  assert.deepEqual(on(wiim.rates), [44100, 48000, 88200, 96000, 176400, 192000]);
  assert.equal(wiim.rates.find(r => r.hz === 192000).source, "profile");
  assert.equal(wiim.rates.find(r => r.hz === 352800).source, "off");
  assert.deepEqual(on(wiim.bits), [16, 24]);
  assert.ok(wiim.editable && wiim.playable);
  assert.deepEqual(wiim.containers, ["flac", "wav"]);

  const poly = effective({ kind: "upnp", manufacturer: "Chord Electronics", model: "Poly", caps: {} });
  assert.ok(poly.rates.find(r => r.hz === 768000).on);
  assert.ok(poly.bits.find(b => b.n === 32).on);
  assert.equal(poly.dsd.find(d => d.n === 256).source, "later");

  const generic = effective({ kind: "upnp", manufacturer: "Acme", model: "Box", caps: { advertised: { rates: [96000] } } });
  assert.deepEqual(on(generic.rates), [44100, 48000, 96000]);
  assert.equal(generic.rates.find(r => r.hz === 44100).source, "floor");
  assert.equal(generic.rates.find(r => r.hz === 96000).source, "advertised");

  // You set it: the whole layer is yours; verified still says so.
  const set = effective({ kind: "upnp", manufacturer: "Linkplay", model: "WiiM Pro Plus",
    caps: { user: { rates: [44100, 176400] }, verified: { rates: { "176400": "2026-10-02T10:00:00Z" } } } });
  assert.deepEqual(on(set.rates), [44100, 176400]);
  assert.equal(set.rates.find(r => r.hz === 44100).source, "user");
  assert.equal(set.rates.find(r => r.hz === 176400).source, "verified");
  assert.equal(set.rates.find(r => r.hz === 192000).source, "off");

  const sonos = effective({ kind: "sonos", caps: {} });
  assert.deepEqual(on(sonos.rates), [44100, 48000]);
  assert.equal(sonos.editable, false);
  const phone = effective({ kind: "phone", caps: {} });
  assert.ok(phone.rates.find(r => r.hz === 192000).on && !phone.editable);
});

test("the register: identity kept, names and layers yours, forget is final", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-reg-"));
  const db = DB.open(dir, { log: () => {} });
  const reg = new Registry(db);
  const first = reg.seen({ id: "UPNP_abc", kind: "upnp", family: "wiim", network_name: "Living Room", manufacturer: "Linkplay", model: "WiiM Pro Plus", ip: "10.0.0.5", caps: { advertised: { containers: ["flac"] } }, playable: true });
  assert.equal(first.network_name, "Living Room");
  assert.equal(first.caps.playable, true);
  // Seen again with less known: nothing blanked, first_seen kept.
  const again = reg.seen({ id: "UPNP_abc", kind: "upnp", network_name: "Living Room", model: "", ip: "10.0.0.9" });
  assert.equal(again.model, "WiiM Pro Plus");
  assert.equal(again.family, "wiim");
  assert.equal(again.ip, "10.0.0.9");
  assert.equal(again.first_seen, first.first_seen);
  assert.deepEqual(again.caps.advertised, { containers: ["flac"] });

  reg.rename("UPNP_abc", "  Kitchen \u0007streamer ");
  assert.equal(reg.get("UPNP_abc").name, "Kitchen streamer");
  assert.equal(reg.nameOf("UPNP_abc"), "Kitchen streamer");
  reg.rename("UPNP_abc", "");
  assert.equal(reg.get("UPNP_abc").name, null);
  assert.equal(reg.nameOf("UPNP_abc"), null);

  reg.setUserCaps("UPNP_abc", { rates: [48000, 999, 96000], bits: [24] });
  assert.deepEqual(reg.get("UPNP_abc").caps.user, { rates: [48000, 96000], bits: [24] });
  reg.setUserCaps("UPNP_abc", { bits: null });
  assert.deepEqual(reg.get("UPNP_abc").caps.user, { rates: [48000, 96000] });
  reg.seen({ id: "UPNP_abc", kind: "upnp", network_name: "Living Room", caps: { advertised: { containers: ["flac", "wav"] } } });
  assert.deepEqual(reg.get("UPNP_abc").caps.user, { rates: [48000, 96000] }, "a new advertised layer keeps yours");
  reg.markVerified("UPNP_abc", { rate: 96000, bits: 24 });
  assert.ok(reg.get("UPNP_abc").caps.verified.rates["96000"]);
  reg.setUserCaps("UPNP_abc", null);
  assert.equal(reg.get("UPNP_abc").caps.user, undefined);

  // The name overlay survives a reopen: it is read from the table.
  reg.rename("UPNP_abc", "Kitchen");
  const reg2 = new Registry(db);
  assert.equal(reg2.nameOf("UPNP_abc"), "Kitchen");

  reg.forget("UPNP_abc");
  assert.equal(reg.get("UPNP_abc"), null);
  assert.equal(reg.nameOf("UPNP_abc"), null);
  db.close();
});

test("Sonos answers are the Sonos code's; ids and seeds", () => {
  assert.ok(isSonos({ usn: "uuid:RINCON_000E58AAAA0001400::urn:schemas-upnp-org:device:MediaRenderer:1", server: "Linux UPnP/1.0 Sonos/80.1-53025 (ZPS9)" }));
  assert.ok(isSonos({ usn: "uuid:abc::urn:x", server: "Linux UPnP/1.0 Sonos/80.1" }));
  assert.ok(!isSonos({ usn: "uuid:FF31F09E-1234::urn:schemas-upnp-org:device:MediaRenderer:1", server: "Linux/3.10 UPnP/1.0 Linkplay/1.0" }));
  assert.equal(idFor("uuid:FF31F09E-1234"), "UPNP_FF31F09E-1234");
  assert.equal(seedLocation("192.168.1.50"), "http://192.168.1.50:49152/description.xml");
  assert.equal(seedLocation("http://192.168.1.50:8080/desc.xml"), "http://192.168.1.50:8080/desc.xml");
  assert.equal(seedLocation(" "), "");
});

test("Audio Devices through the server: found, read, named, ticked, forgotten", { skip, timeout: 90000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM Pro Plus", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", modelNumber: "WiiM Pro Plus", linkplay: { DeviceName: "Living Room WiiM", firmware: "4.8.700000" } });
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics Ltd", model: "Poly", sink: "http-get:*:audio/flac:*,http-get:*:audio/wav:*,http-get:*:audio/x-dsf:*" });
  const telly = new FakeRenderer({ name: "Telly", manufacturer: "Samsung", model: "UE55", nested: true, noAvTransport: true });
  await wiim.start(); await poly.start(); await telly.start();
  const { createServer } = require("../index.js");
  const srv = createServer({
    port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"],
    upnpHosts: [wiim.location, poly.location, telly.location], upnpMulticast: false, upnpOfflineMs: 2500
  });
  await srv.start();
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  };
  const list = async () => (await call("GET", "/api/audio-devices")).j.devices;

  try {
    // Everything appears: three renderers from the seeds, two rooms from the household.
    await until(async () => { const l = await list(); return l.length >= 5 ? l : null; });
    // Read straight after a round, so "online" (seen within the offline
    // allowance, shortened for this test) is fresh.
    const all = (await call("POST", "/api/audio-devices/rescan")).j.devices;
    const byId = Object.fromEntries(all.map(d => [d.id, d]));
    const w = byId[idFor(wiim.udn)], p = byId[idFor(poly.udn)], tv = byId[idFor(telly.udn)];
    assert.ok(w && p && tv, "the renderers are listed");
    assert.ok(byId.RINCON_KITCHEN01400 && byId.RINCON_STUDY001400, "the Sonos rooms are listed");
    assert.equal(byId.RINCON_KITCHEN01400.kind, "sonos");
    assert.equal(byId.RINCON_KITCHEN01400.name, "Kitchen");
    assert.ok(byId.RINCON_KITCHEN01400.online);

    // The WiiM: read through UPnP and its own API.
    assert.equal(w.kind, "upnp");
    assert.equal(w.family, "wiim");
    assert.equal(w.name, "Living Room WiiM", "the name the WiiM app uses");
    assert.equal(w.model, "WiiM Pro Plus");
    assert.equal(w.firmware, "4.8.700000");
    assert.equal(w.profile.id, "wiim-pro-plus");
    assert.ok(w.online && w.playable && w.editable);
    assert.equal(w.state, "stopped");
    assert.ok(w.rates.find(r => r.hz === 192000).on && w.rates.find(r => r.hz === 192000).source === "profile");
    assert.ok(!w.rates.find(r => r.hz === 352800).on);
    assert.ok(w.containers.includes("flac") && w.containers.includes("wav"));
    assert.ok(wiim.requests.some(r => r.path === "/httpapi.asp" && /getStatusEx/.test(r.query)), "the LinkPlay API was asked");
    assert.ok(wiim.requests.some(r => r.soap.includes("GetProtocolInfo")), "the sink list was asked for");

    // The Poly: known by profile, 768 kHz and 32-bit on; DSD marked for later.
    assert.equal(p.profile.id, "chord-poly");
    assert.ok(p.rates.find(r => r.hz === 768000).on);
    assert.ok(p.bits.find(b => b.n === 32).on);
    assert.ok(p.containers.includes("dsd"));
    assert.equal(p.family, "generic");

    // The switch: a renderer is off until you turn it on; a room is on until you turn it off.
    assert.equal(w.enabled, false); assert.equal(w.can_toggle, true);
    assert.equal(byId.RINCON_KITCHEN01400.enabled, true);
    assert.ok(!(await call("GET", "/api/zones")).j.zones.some(z => z.zone_id === w.id), "off: not a zone");
    let sw = await call("PATCH", "/api/audio-devices/" + w.id, { enabled: true });
    assert.equal(sw.status, 200); assert.equal(sw.j.enabled, true);
    await until(async () => (await call("GET", "/api/zones")).j.zones.some(z => z.zone_id === w.id));
    sw = await call("PATCH", "/api/audio-devices/" + w.id, { enabled: false });
    assert.equal(sw.j.enabled, false);
    assert.ok(!(await call("GET", "/api/zones")).j.zones.some(z => z.zone_id === w.id), "off again");
    sw = await call("PATCH", "/api/audio-devices/RINCON_KITCHEN01400", { enabled: false });
    assert.equal(sw.j.enabled, false);
    assert.ok(!(await call("GET", "/api/zones")).j.zones.some(z => z.zone_id === "RINCON_KITCHEN01400"), "a room switched off leaves the picker");
    assert.ok(!(await call("GET", "/api/outputs")).j.outputs.some(o => o.output_id === "RINCON_KITCHEN01400"));
    assert.ok((await call("GET", "/api/zones")).j.zones.some(z => z.zone_id === "RINCON_STUDY001400"), "the other room stays");
    await call("PATCH", "/api/audio-devices/RINCON_KITCHEN01400", { enabled: true });
    await until(async () => (await call("GET", "/api/zones")).j.zones.some(z => z.zone_id === "RINCON_KITCHEN01400"));

    // The TV: found inside its root device, but nothing to play to.
    assert.equal(tv.model, "UE55");
    assert.equal(tv.playable, false);

    // The full record.
    const full = (await call("GET", "/api/audio-devices/" + w.id)).j;
    assert.equal(full.location, wiim.location);
    assert.equal(full.found_by, "UPnP discovery");
    assert.equal((await call("GET", "/api/audio-devices/UPNP_nothing")).status, 404);

    // A name of your own; "" goes back to the network name.
    let r = await call("PATCH", "/api/audio-devices/" + w.id, { name: " Kitchen streamer " });
    assert.equal(r.status, 200);
    assert.equal(r.j.name, "Kitchen streamer");
    assert.equal(r.j.renamed, true);
    assert.equal(r.j.network_name, "Living Room WiiM");
    assert.equal((await list()).find(d => d.id === w.id).name, "Kitchen streamer");
    r = await call("PATCH", "/api/audio-devices/" + w.id, { name: "" });
    assert.equal(r.j.name, "Living Room WiiM");
    assert.equal(r.j.renamed, false);

    // A renamed Sonos room is renamed everywhere the page looks — and only there.
    r = await call("PATCH", "/api/audio-devices/RINCON_KITCHEN01400", { name: "Cook’s corner" });
    assert.equal(r.status, 200);
    const zonesNow = (await call("GET", "/api/zones")).j.zones;
    const kz = zonesNow.find(z => z.zone_id === "RINCON_KITCHEN01400");
    assert.equal(kz.display_name, "Cook’s corner");
    assert.equal(kz.outputs[0].display_name, "Cook’s corner");
    assert.equal(zonesNow.find(z => z.zone_id === "RINCON_STUDY001400").display_name, "Study");
    const outs = (await call("GET", "/api/outputs")).j.outputs;
    assert.equal(outs.find(o => o.output_id === "RINCON_KITCHEN01400").display_name, "Cook’s corner");
    assert.equal(outs.find(o => o.output_id === "RINCON_KITCHEN01400").zone_name, "Cook’s corner");
    const sc = (await call("GET", "/api/shortcut/zones")).j.zones;
    assert.equal(sc.find(z => z.zone_id === "RINCON_KITCHEN01400").display_name, "Cook’s corner");
    assert.equal(house.room("Kitchen").name, "Kitchen", "the speaker itself is never renamed");
    const zs = (await call("GET", "/api/zone-state?zone=RINCON_KITCHEN01400")).j;
    assert.equal(zs.zone.display_name, "Cook’s corner");

    // What a Sonos room plays is fixed; a renderer's rates are yours to tick.
    assert.equal((await call("PATCH", "/api/audio-devices/RINCON_KITCHEN01400", { caps: { user: { rates: [44100] } } })).status, 400);
    r = await call("PATCH", "/api/audio-devices/" + w.id, { caps: { user: { rates: [44100, 48000, 96000] } } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.j.rates.filter(x => x.on).map(x => x.hz), [44100, 48000, 96000]);
    assert.equal(r.j.rates.find(x => x.hz === 96000).source, "user");
    assert.equal((await call("PATCH", "/api/audio-devices/" + w.id, { caps: { user: { rates: [12345] } } })).status, 400);
    r = await call("PATCH", "/api/audio-devices/" + w.id, { caps: { user: null } });
    assert.equal(r.j.rates.find(x => x.hz === 192000).source, "profile");

    // Random album radio: one switch per zone, on the device's page.
    const full2 = (await call("GET", "/api/audio-devices/RINCON_KITCHEN01400")).j;
    assert.equal(full2.zone_id, "RINCON_KITCHEN01400");
    assert.equal(full2.radio, false);
    r = await call("PATCH", "/api/audio-devices/RINCON_KITCHEN01400", { radio: true });
    assert.equal(r.j.radio, true);
    assert.equal((await call("GET", "/api/radio?zone=RINCON_KITCHEN01400")).j.enabled, true);
    assert.equal((await call("GET", "/api/audio-devices/RINCON_STUDY001400")).j.radio, false, "the other room's radio is its own");
    r = await call("PATCH", "/api/audio-devices/RINCON_KITCHEN01400", { radio: false });
    assert.equal(r.j.radio, false);
    assert.equal((await call("GET", "/api/radio?zone=RINCON_KITCHEN01400")).j.enabled, false);

    // Forget is for a device that has gone.
    await call("POST", "/api/audio-devices/rescan");
    assert.equal((await call("POST", "/api/audio-devices/" + w.id + "/forget")).status, 409);
    await poly.stop();
    await call("POST", "/api/audio-devices/rescan");
    await new Promise(res => setTimeout(res, 2700));
    const gone = (await call("GET", "/api/audio-devices/" + p.id)).j;
    assert.equal(gone.online, false);
    assert.equal(gone.state, "offline");
    r = await call("POST", "/api/audio-devices/" + p.id + "/forget");
    assert.equal(r.status, 200);
    assert.ok(!r.j.devices.some(d => d.id === p.id));
    assert.equal((await call("GET", "/api/audio-devices/" + p.id)).status, 404);
    // The rest are still there, and a rescan does not bring the Poly back.
    await call("POST", "/api/audio-devices/rescan");
    const after = await list();
    assert.ok(after.some(d => d.id === w.id) && !after.some(d => d.id === p.id));
  } finally {
    await srv.stop();
    await house.stop();
    await wiim.stop(); await poly.stop(); await telly.stop();
  }
});
