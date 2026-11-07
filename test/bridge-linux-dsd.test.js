"use strict";
/*
 * Mandarin Bridge for Linux and a DAC whose native DSD the kernel holds back (item 323, bridge/linux Dac.cs). A DAC's
 * USB descriptor can say it takes DSD as raw data (a UAC2 streaming format with its RAW_DATA bit: Mandarin's Android
 * driver reads it, and plays such a DAC natively), yet Linux's USB audio driver lists DSD_U32_BE for it only where
 * its quirk table knows the maker; any other DAC is given PCM formats alone and its DSD goes as DoP. The Bridge reads
 * the descriptor too (sysfs), and where it says raw DSD and ALSA lists none, says so: in /dac.json, on its page, in
 * its log, with the modprobe line that has the kernel offer it (QUIRK_FLAG_DSD_RAW, for that DAC alone). A DAC whose
 * descriptor says no such thing, or that the kernel offers natively, is said nothing of.
 *
 * Linux 6.x lists a raw-DSD altset as "Format: SPECIAL DSD_U32_BE" (item 325): the owner's SMSL SU-1 on DietPi
 * (kernel 6.12, its stream0 as the kernel wrote it), its native DSD read from it, up to DSD512, where the Bridge took
 * only the line's first word and sent DSD as DoP.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ports = require("./ports");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const skip = !(fs.existsSync(BRIDGE) && fs.existsSync(ENGINE)) && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(150);
  }
}

// A USB audio device's descriptors: the device, its configuration, and one UAC2 streaming interface whose alternate
// settings carry [formats] (each AS_GENERAL's bmFormats: 1 PCM, 0x80000000 raw data).
function descriptors(formats) {
  const d = [Buffer.from([18, 1, 0, 2, 0xef, 2, 1, 64, 0x22, 0x26, 0x41, 0, 0, 1, 1, 2, 0, 1])];
  d.push(Buffer.from([9, 2, 0, 0, 2, 1, 0, 0x80, 250]));
  d.push(Buffer.from([9, 4, 1, 0, 0, 1, 2, 0x20, 0]));   // the streaming interface's zero-bandwidth setting
  formats.forEach((f, k) => {
    d.push(Buffer.from([9, 4, 1, k + 1, 1, 1, 2, 0x20, 0]));
    const g = Buffer.alloc(16); g[0] = 16; g[1] = 0x24; g[2] = 1; g[3] = 3; g[5] = 1; g.writeUInt32LE(f >>> 0, 6); g[10] = 2;
    d.push(g);
    d.push(Buffer.from([6, 0x24, 2, 1, 4, 32]));         // FORMAT_TYPE: 4 bytes a slot, 32 bits
  });
  const all = Buffer.concat(d);
  all.writeUInt16LE(all.length - 18, 18 + 2);            // the configuration's total length
  return all;
}

// A computer with one USB DAC ([card]) on its port, as /proc/asound and sysfs have it: its stream0 [formats], its descriptor [desc].
function computer(root, { card, usbid, name, stream, desc }) {
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  w("asound/cards", ` 1 [${card.padEnd(15)}]: USB-Audio - ${name}\n                      ${name} at usb-0000:00:14.0-2, high speed\n`);
  w("asound/card1/usbid", usbid + "\n");
  w("asound/card1/pcm0p/info", "name: USB Audio\n");
  w("asound/card1/stream0", ["Playback:", "  Interface 1", ...stream, ""].join("\n"));
  const dev = path.join(root, "sys", "devices", "pci0000:00", "usb1", "1-2");
  fs.mkdirSync(path.join(dev, "1-2:1.0", "sound", "card1"), { recursive: true });
  fs.writeFileSync(path.join(dev, "descriptors"), desc);
  fs.mkdirSync(path.join(root, "sys", "class", "sound", "card1"), { recursive: true });
  fs.symlinkSync(path.join(dev, "1-2:1.0"), path.join(root, "sys", "class", "sound", "card1", "device"));
}

async function bridgeOn(t, setup) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-dsd-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  computer(tmp, setup);
  const port = ports.port();
  const p = spawn(BRIDGE, ["--port", String(port), "--data", path.join(tmp, "data"), "--asound", path.join(tmp, "asound"), "--sys", path.join(tmp, "sys"),
    "--device", "file:" + path.join(tmp, "dac.raw"), "--address", "127.0.0.1", "--engine", ENGINE, "--server", "127.0.0.1:1"], { stdio: ["ignore", "ignore", "pipe"] });
  let said = "";
  p.stderr.on("data", d => { said += d; });
  t.after(() => p.kill());
  const base = "http://127.0.0.1:" + port;
  const dac = await until(async () => (await fetch(base + "/dac.json")).json());
  const state = await (await fetch(base + "/api/state")).json();
  return { dac: dac.dac, state, page: await (await fetch(base + "/")).text(), said: () => said };
}

const PCM_ONLY = ["    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000", "    Bits: 32",
  "    Altset 2", "    Format: S32_LE", "    Channels: 2", "    Rates: 88200, 176400, 352800", "    Bits: 32"];

test("a DAC whose descriptor says raw DSD, the kernel offering it none: DoP, and the line that has it natively", { skip, timeout: 60000 }, async (t) => {
  const b = await bridgeOn(t, { card: "RU7", usbid: "2622:0041", name: "Cayin RU7", stream: PCM_ONLY, desc: descriptors([1, 0x80000000]) });
  assert.deepEqual([b.dac.dsd_native, b.dac.dsd_dop], [[], [64, 128]], "DoP alone, as ALSA lists PCM alone");
  assert.equal(b.dac.dsd_raw, true, "its descriptor says raw DSD");
  assert.equal(b.dac.dsd_kernel_fix, "options snd-usb-audio vid=0x2622 pid=0x0041 quirk_flags=0x8000");
  assert.equal(b.state.dsd_fix, b.dac.dsd_kernel_fix, "its page shows it");
  assert.match(b.state.dacs[0].takes, /DSD128 as DoP \(native DSD held back by this computer's kernel\)$/);
  assert.match(b.page, /this computer's kernel offers it only as DoP/);
  await until(() => /Cayin RU7 takes DSD natively .* echo "options snd-usb-audio vid=0x2622 pid=0x0041 quirk_flags=0x8000" \| sudo tee \/etc\/modprobe\.d\/mandarin-dsd\.conf/.test(b.said()), 5000);
});

test("a DAC whose descriptor says nothing of raw DSD, and one the kernel offers natively: nothing said", { skip, timeout: 60000 }, async (t) => {
  const plain = await bridgeOn(t, { card: "SU1", usbid: "152a:85dd", name: "SMSL SU-1", stream: PCM_ONLY, desc: descriptors([1]) });
  assert.equal(plain.dac.dsd_raw, false);
  assert.equal(plain.dac.dsd_kernel_fix, null);
  assert.equal(plain.state.dsd_fix, null);
  const native = await bridgeOn(t, { card: "Mojo", usbid: "20b1:301f", name: "Chord Mojo",
    stream: [...PCM_ONLY.slice(0, 5), "    Altset 2", "    Format: DSD_U32_BE", "    Channels: 2", "    Rates: 88200, 176400, 352800", "    Bits: 32"], desc: descriptors([1, 0x80000000]) });
  assert.deepEqual(native.dac.dsd_native, [64, 128, 256], "offered natively by the kernel");
  assert.equal(native.dac.dsd_raw, true);
  assert.equal(native.dac.dsd_kernel_fix, null, "nothing held back");
  assert.doesNotMatch(native.said(), /takes DSD natively/);
});

// The owner's SMSL SU-1 on DietPi (kernel 6.12.115+deb13.1): its stream0's playback altsets as the kernel wrote them.
const SU1 = [
  "    Altset 1", "    Format: S32_LE", "    Channels: 2", "    Endpoint: 0x01 (1 OUT) (ASYNC)",
  "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000", "    Data packet interval: 125 us", "    Bits: 32",
  "    Channel map: FL FR", "    Sync Endpoint: 0x81 (1 IN)", "    Sync EP Interface: 1", "    Sync EP Altset: 1", "    Implicit Feedback Mode: No",
  "  Interface 1", "    Altset 2", "    Format: S32_LE", "    Channels: 2", "    Endpoint: 0x01 (1 OUT) (ASYNC)",
  "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000", "    Data packet interval: 125 us", "    Bits: 24",
  "    Channel map: FL FR", "    Sync Endpoint: 0x81 (1 IN)", "    Sync EP Interface: 1", "    Sync EP Altset: 2", "    Implicit Feedback Mode: No",
  "  Interface 1", "    Altset 3", "    Format: SPECIAL DSD_U32_BE", "    Channels: 2", "    Endpoint: 0x01 (1 OUT) (ASYNC)",
  "    Rates: 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000", "    Data packet interval: 125 us", "    Bits: 32",
  "    DSD raw: DOP=0, bitrev=0", "    Channel map: FL FR", "    Sync Endpoint: 0x81 (1 IN)", "    Sync EP Interface: 1", "    Sync EP Altset: 3", "    Implicit Feedback Mode: No"];

test("Linux 6.x's \"Format: SPECIAL DSD_U32_BE\" (the owner's SMSL SU-1 on DietPi): native DSD to DSD512, nothing held back", { skip, timeout: 60000 }, async (t) => {
  const b = await bridgeOn(t, { card: "AUDIO", usbid: "152a:85dd", name: "SMSL USB AUDIO", stream: SU1, desc: descriptors([1, 1, 0x80000000]) });
  assert.deepEqual([b.dac.dsd_native, b.dac.dsd_dop, b.dac.dsd], [[64, 128, 256, 512], [64, 128, 256], [64, 128, 256, 512]], JSON.stringify(b.dac));
  assert.deepEqual(b.dac.rates, [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000]);
  assert.deepEqual(b.dac.dac_bits, [24, 32]);
  assert.equal(b.dac.dsd_kernel_fix, null, "the kernel offers it: no line to add");
  assert.match(b.state.dacs[0].takes, /, native DSD512$/);
  await until(() => /\[player\] the engine on .*, native DSD DSD_U32_BE:64,128,256,512/.test(b.said()), 5000);
});
