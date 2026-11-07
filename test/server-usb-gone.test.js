"use strict";
/*
 * A Linux server plays no sound device of its own (item 324): a USB DAC on the computer Mandarin runs on is played by
 * Mandarin Bridge for Linux, installed beside it, where the server used to open the computer's sound cards itself
 * (ALSA) and compete with the Bridge for the DAC. A sound card the server had in its register from before is
 * forgotten at its next look round, with a word in its log, and none is listed: Audio Devices says how a DAC there is
 * played (the page's and the app's words, AudioDevicesTest).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (process.platform !== "linux" && "a Linux server's");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("a Linux server's own sound cards: none listed, one kept from before forgotten", { skip, timeout: 60000 }, async (t) => {
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const auth = { Authorization: "Bearer " + await signIn(B) };
  // The DAC the server played itself before: in its register, switched on.
  const now = Date.now();
  ctx.db.raw.prepare("INSERT INTO audio_devices (id, kind, family, network_name, manufacturer, model, location, caps, settings, first_seen, last_seen) VALUES (?, 'local', 'local', 'Chord Mojo', 'Chord Electronics Ltd', 'USB audio', 'alsa:plughw:CARD=Mojo,DEV=0', '{}', '{\"enabled\":true}', ?, ?)")
    .run("LOCAL_0123456789ab", now, now);
  // A look round already under way when it was put in (the server's first, on a busy machine) is joined, not begun
  // again, and answers without it: asked again until a round has seen it.
  const rescan = async () => (await fetch(B + "/api/audio-devices/rescan", { method: "POST", headers: auth })).json();
  let r = await rescan();
  for (let i = 0; i < 10 && r.ok && r.devices.some(d => d.id === "LOCAL_0123456789ab"); i++) r = await rescan();
  assert.equal(r.ok, true);
  assert.ok(!r.devices.some(d => d.id === "LOCAL_0123456789ab"), "the sound card kept from before, forgotten");
  assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM audio_devices WHERE kind = 'local'").get().n, 0, "none in the register");
  assert.deepEqual([r.local.platform, r.local.count], ["linux", 0], "none of its own listed");
  assert.ok(ctx.logs.some(l => /\[local\] Chord Mojo: this computer's sound card, forgotten: Mandarin no longer plays it itself; Mandarin Bridge for Linux, beside it, does/.test(l)), ctx.logs.join("\n"));
  assert.ok(!ctx.logs.some(l => /audio engine .* plays sound devices on this computer/.test(l)), "no audio engine started for it");
});
