"use strict";
/*
 * A sound device on the computer Mandarin runs on (v0.6.18): a USB DAC, the
 * built-in speakers.
 *   - the devices are found: ALSA cards (a USB DAC's own rates and depths),
 *     a Mac's Core Audio outputs, ffmpeg's numbering of them;
 *   - the output plays a track and the next one into the same open device
 *     with nothing between them, pauses where it is, and scales the volume
 *     on an audio taper (untouched at 100%);
 *   - end to end: off until turned on, then a zone; an album plays to it,
 *     the next track follows, the volume is kept.
 * The "device" in these tests is a file the PCM is written to at the speed
 * it would play (lib/local/devices.js, file:).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const L = require("../lib/local/devices");
const { LocalOutput, amplitude, parseWav } = require("../lib/local/output");
const { effective } = require("../lib/renderers/profiles");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
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

test("this computer's sound devices: ALSA cards, a Mac's outputs, ffmpeg's numbers", () => {
  const { root, dev } = fakeAsound();
  const { devices, hidden } = L.listLinux({ root, dev });
  assert.equal(hidden, 1, "a card /dev/snd doesn't let us open is counted, not listed");
  assert.deepEqual(devices.map(d => d.network_name), ["HDA Intel PCH (ALC892 Analog)", "HDA Intel PCH (HDMI 0)", "Chord Mojo"]);
  const mojo = devices[2];
  assert.equal(mojo.kind, "local");
  assert.equal(mojo.location, "alsa:plughw:CARD=Mojo,DEV=0");
  assert.equal(mojo.manufacturer, "Chord Electronics Ltd");
  assert.equal(mojo.model, "USB audio");
  assert.deepEqual(mojo.caps.advertised.rates, [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000]);
  assert.deepEqual(mojo.caps.advertised.bits, [24, 32]);
  assert.equal(mojo.id, L.listLinux({ root, dev }).devices[2].id, "the same id every time");
  assert.match(mojo.id, /^LOCAL_[0-9a-f]{12}$/);
  assert.deepEqual(devices[0].caps.advertised.rates, [], "an internal card says nothing: 44.1 and 48 kHz until ticked");
  assert.deepEqual(L.hwParams(mojo.location, root), { rate: 96000, format: "S32_LE" });

  // The chips: the Mojo's own rates are on as advertised; the HDA's are the floor.
  const chips = effective(Object.assign({ playable: true, caps: mojo.caps }, mojo));
  assert.equal(chips.profile.id, "local");
  assert.ok(chips.rates.every(r => r.on && r.source === "advertised"));
  assert.deepEqual(chips.bits.filter(b => b.on).map(b => b.n), [16, 24, 32]);
  const hda = effective(Object.assign({ playable: true, caps: devices[0].caps }, devices[0]));
  assert.deepEqual(hda.rates.filter(r => r.on).map(r => r.hz), [44100, 48000]);

  const mac = L.parseMac(JSON.stringify({ SPAudioDataType: [{ _items: [
    { _name: "MacBook Pro Microphone", coreaudio_device_input: 1, coreaudio_device_srate: 48000 },
    { _name: "MacBook Pro Speakers", coreaudio_device_output: 2, coreaudio_device_srate: 48000, coreaudio_device_transport: "coreaudio_device_type_builtin", coreaudio_default_audio_output_device: "spaudio_yes" },
    { _name: "Topping E30", coreaudio_device_output: 2, coreaudio_device_srate: 96000, coreaudio_device_transport: "coreaudio_device_type_usb", coreaudio_device_manufacturer: "Topping" }
  ] }] }));
  assert.deepEqual(mac.map(d => [d.network_name, d.model, d.caps.advertised.rates[0]]), [["MacBook Pro Speakers", "Built-in", 48000], ["Topping E30", "USB audio", 96000]]);
  assert.equal(mac[1].location, "coreaudio:Topping E30");
  const idx = L.parseAudiotoolboxList([
    "[AudioToolbox @ 0x7f] CoreAudio devices:",
    "[AudioToolbox @ 0x7f] [0]       MacBook Pro Microphone, BuiltInMicrophoneDevice",
    "[AudioToolbox @ 0x7f] [1]         MacBook Pro Speakers, BuiltInSpeakerDevice",
    "[AudioToolbox @ 0x7f] [2]                  Topping E30, AppleUSBAudioEngine:Topping:E30:1:1"].join("\n"));
  assert.equal(idx.get("Topping E30"), 2);
  assert.equal(idx.get("MacBook Pro Speakers"), 1);
});

test("the volume is an audio taper; the decoder's WAV header is read", () => {
  assert.equal(amplitude(100), 1);
  assert.equal(amplitude(0), 0);
  assert.equal(amplitude(80, true), 0, "muted");
  assert.ok(Math.abs(20 * Math.log10(amplitude(50)) - -25) < 1e-9, "50% is −25 dB");
  assert.ok(Math.abs(20 * Math.log10(amplitude(10)) - -45) < 1e-9, "10% is −45 dB");
  assert.ok(amplitude(5) > 0 && amplitude(5) < amplitude(10));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(96000, 24); h.writeUInt16LE(32, 34);
  h.write("data", 36);
  assert.deepEqual(parseWav(h), { channels: 2, rate: 96000, bits: 32, start: 44 });
  assert.equal(parseWav(h.subarray(0, 30)), null, "not all there yet");
});

test("the output: two tracks into one open device, nothing between; paused where it is; scaled below 100%", { skip, timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localout-"));
  const tone = (f, secs) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}:sample_rate=44100`, "-ac", "2", "-sample_fmt", "s16", f]);
  const t1 = path.join(dir, "t1.flac"), t2 = path.join(dir, "t2.flac");
  tone(t1, 1.5); tone(t2, 1);
  const out = path.join(dir, "out.raw");
  const o = new LocalOutput({ id: "x", name: "Test", sinkArgs: L.sinkArgsFor("file:" + out), volume: 100 });
  await o.setUri(t1); await o.setNextUri(t2); await o.play();
  assert.equal((await o.getTransportInfo()).CurrentTransportState, "TRANSITIONING");
  await until(async () => (await o.getTransportInfo()).CurrentTransportState === "PLAYING");
  assert.equal((await o.getPositionInfo()).TrackURI, t1);
  await until(async () => (await o.getPositionInfo()).TrackURI === t2, 8000);
  await until(async () => (await o.getTransportInfo()).CurrentTransportState === "STOPPED", 8000);
  assert.equal(o.takeError(), null);
  // Every frame of both, in one file, nothing added between them.
  assert.equal(fs.statSync(out).size, Math.round(2.5 * 44100) * 8);
  const src = execFileSync("ffmpeg", ["-loglevel", "error", "-i", t1, "-i", t2, "-filter_complex", "concat=n=2:v=0:a=1", "-c:a", "pcm_s32le", "-f", "s32le", "-"], { maxBuffer: 1 << 24 });
  assert.ok(src.equals(fs.readFileSync(out)), "at 100% the samples are untouched");

  // Paused: the position holds; play carries on.
  const out2 = path.join(dir, "out2.raw");
  const p = new LocalOutput({ id: "y", name: "Test", sinkArgs: L.sinkArgsFor("file:" + out2), volume: 50 });
  await p.setUri(t1); await p.play();
  await until(() => p.position() > 0.3);
  await p.pause();
  await sleep(300);
  const at = p.position();
  await sleep(700);
  assert.equal((await p.getTransportInfo()).CurrentTransportState, "PAUSED_PLAYBACK");
  assert.equal(p.position(), at, "held where it is");
  await p.play();
  await until(async () => (await p.getTransportInfo()).CurrentTransportState === "STOPPED", 8000);
  const b = fs.readFileSync(out2);
  assert.equal(b.length, Math.round(1.5 * 44100) * 8, "all of it, after the pause");
  let peak = 0, srcPeak = 0;
  for (let i = 0; i < b.length; i += 4) peak = Math.max(peak, Math.abs(b.readInt32LE(i)));
  for (let i = 0; i < b.length; i += 4) srcPeak = Math.max(srcPeak, Math.abs(src.readInt32LE(i)));
  assert.ok(Math.abs(20 * Math.log10(peak / srcPeak) - -25) < 0.01, "50% is 25 dB down");

  // A device that isn't there: said, and stopped.
  const gone = new LocalOutput({ id: "z", name: "Gone", sinkArgs: async () => ["-f", "alsa", "plughw:CARD=NoSuchCard,DEV=0"] });
  await gone.setUri(t1); await gone.play();
  await until(async () => (await gone.getTransportInfo()).CurrentTransportState === "STOPPED", 8000);
  const e = await until(() => gone.takeError());
  assert.match(e.message, /isn't there|stopped|couldn't/);
});

test("end to end: a sound device on this computer is a zone; an album plays to it", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const out = path.join(lib.data, "dac.raw");
  const DAC = {
    id: L.idOf("test:dac"), kind: "local", family: "local", network_name: "Test DAC", manufacturer: "Test", model: "USB audio",
    location: "file:" + out, playable: true, caps: { advertised: { containers: ["flac"], rates: [44100, 48000, 96000], bits: [16, 24, 32] } }
  };
  const PORT = 3631, B = "http://127.0.0.1:" + PORT;
  // The server's log, for what the player says of the device.
  const logs = [], realLog = console.log;
  console.log = (...a) => { logs.push(a.join(" ")); realLog(...a); };
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpMulticast: false, localAudio: { list: async () => ({ devices: [DAC], platform: "linux", hidden: 0 }) } });
  const ctx = await srv.start();
  const token = await signIn(B);
  const auth = { Authorization: "Bearer " + token };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? {
      method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {})
    } : { headers: auth });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  try {
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
    assert.equal(r.ok, true, JSON.stringify(r));
    const s1 = await until(async () => { const s = (await api("zone-state?zone=" + DAC.id)).zone; return s && s.state === "playing" && s.now_playing && s; });
    assert.equal(s1.now_playing.line1, "Song 1");
    await until(() => fs.existsSync(out) && fs.statSync(out).size > 0);
    const v = await api("volume", { output_id: DAC.id, value: 30 });
    assert.equal(v.ok, true);
    // The next track follows by itself.
    const s2 = await until(async () => { const s = (await api("zone-state?zone=" + DAC.id)).zone; return s && s.state === "playing" && s.now_playing && s.now_playing.line1 === "Song 2" && s; }, 15000);
    assert.ok(!logs.some(l => /started by hand/.test(l)), "the device moved on by itself: " + logs.filter(l => /Test DAC/.test(l)).join("; "));
    const p = await api("control", { zone_or_output_id: DAC.id, command: "pause" });
    assert.equal(p.ok, true, JSON.stringify(p));
    await until(async () => (await api("zone-state?zone=" + DAC.id)).zone.state === "paused");
    assert.equal(ctx.devices.registry.get(DAC.id).settings.local_volume, 30, "the volume is kept");
  } finally { console.log = realLog; await srv.stop(); }
});
