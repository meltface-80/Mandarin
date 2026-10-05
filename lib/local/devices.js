"use strict";
/*
 * devices.js — the sound devices on the computer Mandarin runs on (v0.6.18),
 * for Settings → Audio Devices: what they are called, the rates they say
 * they take, and how ffmpeg opens each one (lib/local/output.js).
 *
 *   Linux   ALSA: the cards in /proc/asound with a playback device that
 *           /dev/snd lets this program open (in Docker, only with
 *           --device /dev/snd). A USB DAC lists its rates and depths in its
 *           stream file; others take 44.1 and 48 kHz until you tick more.
 *           Opened as plughw:CARD=<id>,DEV=<n> — by the card's name, so a
 *           DAC plugged into another port is still the same device.
 *   macOS   Core Audio: the output devices system_profiler lists, opened by
 *           ffmpeg's audiotoolbox output at the number ffmpeg gives that
 *           name when played to. The Mac converts what it is sent to the
 *           rate set for the device in Audio MIDI Setup.
 *
 * Like Music Assistant's Local Audio Out, a device's id comes from its name
 * (and, on Linux, its device number), so it is the same player after a
 * restart or a replug.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const FF = require("../ffmpeg");
const { RATES } = require("../renderers/profiles");

const PREFIX = "LOCAL_";
const idOf = (key) => PREFIX + crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };

// "Rates: 44100, 48000, 96000" or "Rates: 8000 - 192000 (continuous)".
function ratesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/Rates:\s*([^\n]+)/g)) {
    const r = m[1].match(/(\d+)\s*-\s*(\d+)\s*\(continuous\)/);
    if (r) { for (const hz of RATES) if (hz >= Number(r[1]) && hz <= Number(r[2])) out.add(hz); continue; }
    for (const n of m[1].split(",")) { const hz = Number(n.trim()); if (RATES.includes(hz)) out.add(hz); }
  }
  return RATES.filter(hz => out.has(hz));
}
// "Bits: 24" lines, or the formats where a card has none.
function bitsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/Bits:\s*(\d+)/g)) out.add(Number(m[1]));
  if (!out.size) for (const m of text.matchAll(/Format:\s*S(16|24|32)/g)) out.add(Number(m[1]));
  return [16, 24, 32].filter(n => out.has(n));
}

/* The ALSA playback devices this program can open. */
function listLinux({ root = "/proc/asound", dev = "/dev/snd" } = {}) {
  const cards = read(path.join(root, "cards"));
  const out = [];
  let hidden = 0;
  const lines = cards.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d+)\s+\[(\S+)\s*\]:\s*(\S+)\s+-\s+(.*)$/);
    if (!m) continue;
    const [, num, cardId, driver, shortName] = m;
    const longName = (lines[i + 1] || "").trim();
    const dir = path.join(root, "card" + num);
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (e) { continue; }
    const pcms = entries.map(e => e.match(/^pcm(\d+)p$/)).filter(Boolean).map(x => Number(x[1])).sort((a, b) => a - b);
    const usb = driver === "USB-Audio" || entries.includes("usbid");
    for (const d of pcms) {
      if (!fs.existsSync(path.join(dev, `pcmC${num}D${d}p`))) { hidden++; continue; }
      const pcmName = (read(path.join(dir, `pcm${d}p`, "info")).match(/^name:\s*(.*)$/m) || [])[1] || "";
      const stream = read(path.join(dir, "stream" + (usb ? 0 : d)));
      const name = pcms.length > 1 && pcmName ? `${shortName.trim()} (${pcmName.trim()})` : shortName.trim();
      const maker = usb ? longName.replace(/\s+at usb-.*$/, "").replace(new RegExp("\\s*" + shortName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"), "").trim() : "";
      out.push({
        id: idOf(`alsa:${cardId}:${d}`), kind: "local", family: "local",
        network_name: name, manufacturer: maker, model: usb ? "USB audio" : driver, location: `alsa:plughw:CARD=${cardId},DEV=${d}`,
        playable: true,
        caps: { advertised: { containers: ["flac"], rates: ratesIn(stream), bits: bitsIn(stream) } }
      });
    }
  }
  return { devices: out, hidden };
}

/* system_profiler's audio list (JSON) → the Mac's output devices. */
function parseMac(json) {
  let items = [];
  try { items = ((JSON.parse(json).SPAudioDataType || [])[0] || {})._items || []; } catch (e) { items = []; }
  const out = [];
  for (const it of items) {
    if (!it || !it._name || !(Number(it.coreaudio_device_output) > 0)) continue;
    const srate = Number(it.coreaudio_device_srate) || 0;
    const t = String(it.coreaudio_device_transport || "");
    const transport = /usb/.test(t) ? "USB audio" : /builtin|built-in/.test(t) ? "Built-in" : /hdmi|displayport/.test(t) ? "HDMI / DisplayPort"
      : /bluetooth/.test(t) ? "Bluetooth" : /airplay/.test(t) ? "AirPlay" : /virtual|aggregate/.test(t) ? "Virtual" : "Core Audio";
    out.push({
      id: idOf("coreaudio:" + it._name), kind: "local", family: "local",
      network_name: it._name, manufacturer: String(it.coreaudio_device_manufacturer || ""), model: transport,
      location: "coreaudio:" + it._name, playable: true,
      caps: { advertised: { containers: ["flac"], rates: RATES.includes(srate) ? [srate] : [], bits: [16, 24, 32] } }
    });
  }
  return out;
}

function listMac() {
  return new Promise(res => execFile("system_profiler", ["SPAudioDataType", "-json"], { timeout: 20000, maxBuffer: 4 << 20 },
    (err, stdout) => res({ devices: err ? [] : parseMac(stdout), hidden: 0 })));
}

/* ffmpeg's numbered Core Audio list ("[2]   Mojo, AppleUSBAudioEngine:…") → { name: index }. */
function parseAudiotoolboxList(text) {
  const out = new Map();
  for (const m of String(text).matchAll(/\[(\d+)\]\s+(.+?),\s+(\S*)\s*$/gm)) {
    const name = m[2].trim();
    if (!out.has(name)) out.set(name, Number(m[1]));
  }
  return out;
}

function macIndex(name, bin) {
  return new Promise((res, rej) => execFile(bin || FF.info().bin,
    ["-hide_banner", "-f", "lavfi", "-i", "anullsrc", "-t", "0.01", "-f", "audiotoolbox", "-list_devices", "true", "-"],
    { timeout: 15000 }, (err, stdout, stderr) => {
      const map = parseAudiotoolboxList(String(stderr || "") + String(stdout || ""));
      if (map.has(name)) return res(map.get(name));
      rej(new Error(map.size ? `${name} isn't connected to this Mac` : "this ffmpeg can't play to the Mac's sound devices (it has no audiotoolbox output)"));
    }));
}

/*
 * How ffmpeg opens a device: the arguments after the PCM input. 32-bit
 * samples go to the device's driver; ALSA's plug layer hands a DAC that
 * takes 24 or 16 bits what it takes, at the same rate.
 */
function sinkArgsFor(location, bin) {
  const loc = String(location || "");
  if (loc.startsWith("alsa:")) {
    const dev = loc.slice(5);
    return async () => ["-c:a", "pcm_s32le", "-f", "alsa", dev];
  }
  if (loc.startsWith("coreaudio:")) {
    const name = loc.slice(10);
    return async () => ["-c:a", "pcm_s32le", "-f", "audiotoolbox", "-audio_device_index", String(await macIndex(name, bin)), "-"];
  }
  if (loc.startsWith("file:")) {
    // Tests: the PCM at the speed it would play, into a file.
    const file = loc.slice(5);
    return async () => ["-af", "arealtime", "-c:a", "pcm_s32le", "-f", "s32le", "-y", file];
  }
  return async () => { throw new Error("unknown device " + loc); };
}

/*
 * What ALSA has the device open at, while it plays: { rate, format }. Linux
 * only; null elsewhere or when it isn't open.
 */
function hwParams(location, root = "/proc/asound") {
  const m = String(location || "").match(/^alsa:plughw:CARD=([^,]+),DEV=(\d+)$/);
  if (!m) return null;
  const card = read(path.join(root, "cards")).split("\n").map(l => l.match(/^\s*(\d+)\s+\[(\S+)\s*\]/)).find(x => x && x[2] === m[1]);
  if (!card) return null;
  const t = read(path.join(root, "card" + card[1], `pcm${m[2]}p`, "sub0", "hw_params"));
  const rate = Number((t.match(/^rate:\s*(\d+)/m) || [])[1]) || 0;
  return rate ? { rate, format: (t.match(/^format:\s*(\S+)/m) || [])[1] || "" } : null;
}

/* Every device this computer has, as the register takes them. */
async function list({ platform = process.platform, env = process.env } = {}) {
  if (env.LOCAL_AUDIO === "0") return { devices: [], hidden: 0, platform, off: true };
  if (platform === "linux") return Object.assign(listLinux(), { platform });
  if (platform === "darwin") return Object.assign(await listMac(), { platform });
  return { devices: [], hidden: 0, platform };
}

module.exports = { list, listLinux, hwParams, parseMac, parseAudiotoolboxList, sinkArgsFor, ratesIn, bitsIn, idOf, PREFIX };
