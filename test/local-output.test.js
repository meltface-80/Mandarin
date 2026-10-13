"use strict";
/*
 * A sound device on the computer Mandarin runs on (v0.6.18): a USB DAC, the
 * built-in speakers.
 *   - the devices are found: ALSA cards (a USB DAC's own rates and depths),
 *     a Mac's Core Audio outputs;
 *   - the volume is on an audio taper (untouched at 100%);
 *   - end to end: off until turned on, then a zone; an album plays to it,
 *     the next track follows, the volume is kept.
 * The C# server's (Local/LocalDevices.cs, EngineOutput.cs; lib/local/ until
 * v0.8.50); how the engine plays a device, gapless, paused and scaled, is
 * test/engine.test.js. The "device" here is a file the PCM is written to at
 * the speed it would play (file:).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { built } = require("./server");
const { score } = require("./score");

const noBin = built();
const skip = noBin || (!haveFfmpeg() && "ffmpeg is not installed");
const local = (job) => score(Object.assign({ fn: "local" }, job));
const effective = (record) => score({ fn: "profiles", records: [{ record }] }).effective[0];
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

function fakeAsound() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asound-"));
  const dev = path.join(root, "dev");
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  w("cards", [
    " 0 [PCH            ]: HDA-Intel - HDA Intel PCH",
    "                      HDA Intel PCH at 0xf7f10000 irq 32",
    " 1 [Mojo           ]: USB-Audio - Chord Mojo",
    "                      Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed",
    " 2 [Hidden         ]: USB-Audio - Hidden DAC",
    "                      Someone Hidden DAC at usb-0000:00:14.0-3, full speed", ""].join("\n"));
  w("card0/pcm0p/info", "card: 0\ndevice: 0\nname: ALC892 Analog\n");
  w("card0/pcm3p/info", "card: 0\ndevice: 3\nname: HDMI 0\n");
  w("card0/pcm0c/info", "name: ALC892 Analog\n");
  w("card1/pcm0p/info", "name: USB Audio\n");
  w("card1/usbid", "20b1:301f\n");
  w("card1/stream0", [
    "Chord Electronics Ltd Chord Mojo at usb-0000:00:14.0-2, high speed : USB Audio", "",
    "Playback:", "  Status: Stop",
    "  Interface 1", "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Bits: 32",
    "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000",
    "  Interface 1", "    Altset 2", "    Format: S24_3LE", "    Bits: 24", "    Rates: 44100, 48000, 96000", ""].join("\n"));
  w("card1/pcm0p/sub0/hw_params", "access: RW_INTERLEAVED\nformat: S32_LE\nsubformat: STD\nchannels: 2\nrate: 96000 (96000/1)\n");
  w("card2/pcm0p/info", "name: USB Audio\n");
  fs.mkdirSync(dev);
  for (const n of ["pcmC0D0p", "pcmC0D3p", "pcmC1D0p"]) fs.writeFileSync(path.join(dev, n), "");
  return { root, dev };
}

test("this computer's sound devices: ALSA cards, a Mac's outputs", { skip: noBin }, () => {
  const { root, dev } = fakeAsound();
  const { devices, hidden } = local({ linux: [root, dev] });
  assert.equal(hidden, 1, "a card /dev/snd doesn't let us open is counted, not listed");
  assert.deepEqual(devices.map(d => d.network_name), ["HDA Intel PCH (ALC892 Analog)", "HDA Intel PCH (HDMI 0)", "Chord Mojo"]);
  const mojo = devices[2];
  assert.equal(mojo.kind, "local");
  assert.equal(mojo.location, "alsa:plughw:CARD=Mojo,DEV=0");
  assert.equal(mojo.manufacturer, "Chord Electronics Ltd");
  assert.equal(mojo.model, "USB audio");
  assert.deepEqual(mojo.caps.advertised.rates, [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000]);
  assert.deepEqual(mojo.caps.advertised.bits, [24, 32]);
  assert.equal(mojo.id, local({ linux: [root, dev] }).devices[2].id, "the same id every time");
  assert.match(mojo.id, /^LOCAL_[0-9a-f]{12}$/);
  assert.deepEqual(devices[0].caps.advertised.rates, [], "an internal card says nothing: 44.1 and 48 kHz until ticked");
  assert.deepEqual(local({ hw: [[mojo.location, root]] }).hw[0], { rate: 96000, format: "S32_LE" });

  // The chips: the Mojo's own rates are on as advertised; the HDA's are the floor.
  const chips = effective(Object.assign({ playable: true, caps: mojo.caps }, mojo));
  assert.equal(chips.profile.id, "local");
  assert.ok(chips.rates.every(r => r.on && r.source === "advertised"));
  assert.deepEqual(chips.bits.filter(b => b.on).map(b => b.n), [16, 24, 32]);
  const hda = effective(Object.assign({ playable: true, caps: devices[0].caps }, devices[0]));
  assert.deepEqual(hda.rates.filter(r => r.on).map(r => r.hz), [44100, 48000]);

  const mac = local({ mac: JSON.stringify({ SPAudioDataType: [{ _items: [
    { _name: "MacBook Pro Microphone", coreaudio_device_input: 1, coreaudio_device_srate: 48000 },
    { _name: "MacBook Pro Speakers", coreaudio_device_output: 2, coreaudio_device_srate: 48000, coreaudio_device_transport: "coreaudio_device_type_builtin", coreaudio_default_audio_output_device: "spaudio_yes" },
    { _name: "Topping E30", coreaudio_device_output: 2, coreaudio_device_srate: 96000, coreaudio_device_transport: "coreaudio_device_type_usb", coreaudio_device_manufacturer: "Topping" }
  ] }] }) }).mac;
  assert.deepEqual(mac.map(d => [d.network_name, d.model, d.caps.advertised.rates[0]]), [["MacBook Pro Speakers", "Built-in", 48000], ["Topping E30", "USB audio", 96000]]);
  assert.equal(mac[1].location, "coreaudio:Topping E30");
});

test("the volume is an audio taper", { skip: noBin }, () => {
  const [full, none, muted, half, tenth, five] = local({ amplitude: [[100], [0], [80, true], [50], [10], [5]] }).amplitude;
  assert.equal(full, 1);
  assert.equal(none, 0);
  assert.equal(muted, 0, "muted");
  assert.ok(Math.abs(20 * Math.log10(half) - -25) < 1e-9, "50% is −25 dB");
  assert.ok(Math.abs(20 * Math.log10(tenth) - -45) < 1e-9, "10% is −45 dB");
  assert.ok(five > 0 && five < tenth);
});

/* A server with Test DAC (its "sound card" a file) as this computer's own device, turned on and a zone; Album One asked to play to it. */
async function dacPlayed(t) {
  const lib = makeLibrary();
  const out = path.join(lib.data, "dac.raw");
  const DAC = {
    id: local({ ids: ["test:dac"] }).ids[0], kind: "local", family: "local", network_name: "Test DAC", manufacturer: "Test", model: "USB audio",
    location: "file:" + out, playable: true, caps: { advertised: { containers: ["flac"], rates: [44100, 48000, 96000], bits: [16, 24, 32] } }
  };
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  // The device stands in for this computer's own (local_devices): its file the sound card.
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpMulticast: false, localDevices: { devices: [DAC], platform: "linux", hidden: 0 } });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const auth = { Authorization: "Bearer " + token };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? {
      method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {})
    } : { headers: auth });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  await until(async () => (await api("status")).index_count >= 3);
  const listed = await until(async () => (await api("audio-devices")).devices.find(d => d.id === DAC.id));
  assert.equal(listed.kind, "local");
  assert.equal(listed.enabled, false, "off until turned on");
  assert.equal((await api("zones")).zones.some(z => z.zone_id === DAC.id), false);
  const d = await api("audio-devices/" + DAC.id, { enabled: true }, "PATCH");
  assert.equal(d.status, 200);
  assert.equal(d.found_by, "This computer (ALSA)");
  assert.equal(d.location, out);
  assert.equal(d.can_fix_volume, true);
  assert.ok(d.dsp, "it has DSP, run on the server");
  const z = await until(async () => (await api("zones")).zones.find(x => x.zone_id === DAC.id));
  assert.equal(z.outputs[0].volume.value, 50, "starts at 50%");

  const cd = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  const r = await api("play", { offset: cd.offset, zone_or_output_id: DAC.id, kind: "play_now" });
  return { r, api, ctx, DAC, out };
}

test("end to end: a sound device on this computer is a zone; an album plays to it", { skip: skip || (process.platform === "darwin" && "a Mac's sound devices play through Mandarin DAC Bridge: Mandarin's audio engine plays through ALSA"), timeout: 120000 }, async (t) => {
  const { r, api, ctx, DAC, out } = await dacPlayed(t);
  assert.equal(r.ok, true, JSON.stringify(r));
  const s1 = await until(async () => { const s = (await api("zone-state?zone=" + DAC.id)).zone; return s && s.state === "playing" && s.now_playing && s; });
  assert.equal(s1.now_playing.line1, "Song 1");
  await until(() => fs.existsSync(out) && fs.statSync(out).size > 0);
  const v = await api("volume", { output_id: DAC.id, value: 30 });
  assert.equal(v.ok, true);
  // The next track follows by itself.
  await until(async () => { const s = (await api("zone-state?zone=" + DAC.id)).zone; return s && s.state === "playing" && s.now_playing && s.now_playing.line1 === "Song 2" && s; }, 15000);
  assert.ok(!ctx.logs.some(l => /started by hand/.test(l)), "the device moved on by itself: " + ctx.logs.filter(l => /Test DAC/.test(l)).join("; "));
  const p = await api("control", { zone_or_output_id: DAC.id, command: "pause" });
  assert.equal(p.ok, true, JSON.stringify(p));
  await until(async () => (await api("zone-state?zone=" + DAC.id)).zone.state === "paused");
  const kept = () => JSON.parse(ctx.db.raw.prepare("SELECT settings FROM audio_devices WHERE id = ?").get(DAC.id).settings || "{}").local_volume;
  await until(() => kept() === 30).catch(() => null);
  assert.equal(kept(), 30, "the volume is kept");
});

// On a Mac (v0.8.49 on) a sound device of this computer can't be played: Mandarin's audio engine plays
// through ALSA (docs/specs/csharp-migration.md, stage 6 part 4); a Mac's DAC plays through Mandarin DAC Bridge.
test("on a Mac, playing to a sound device of this computer is refused in words", { skip: skip || (process.platform !== "darwin" && "a Mac's own"), timeout: 120000 }, async (t) => {
  const { r } = await dacPlayed(t);
  assert.deepEqual([r.status, r.error], [409, "Test DAC can't be played from this server: Mandarin's audio engine isn't here"], JSON.stringify(r));
});
