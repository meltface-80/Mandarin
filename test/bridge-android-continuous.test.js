"use strict";
/*
 * Mandarin Bridge for Android taking Mandarin's continuous PCM (item 322; the server's Renderers/Slim/SlimRuns.cs, the
 * Linux Bridge's end to end in test/bridge-linux.test.js). The app's Kotlin doesn't run in this suite, so its sources
 * are read as written: its hello says ContinuousPcm=1; a strm s of PCM ('p') puts its format on the run's address,
 * by the same table of rates as the server's strm and the Linux Bridge's; ExoPlayer reads that address's samples with
 * RawPcmExtractor, which takes exactly what Slim.kt writes, reading it with an hour's patience (PatientDataSource:
 * Mandarin waits to be told the next track before it sends it); each track Mandarin says it has come to (mtrk) retitles
 * the screen and notification; and the USB sink (android/app's, the Mandarin app's USB direct too) gives a change of
 * format half a second of silence ahead of the music, left out of the position.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const KT = (dir, f) => read(dir, "src", "main", "java", "com", "musicd", "server", "android", f);
const SLIM = KT("bridge/android/app", "Slim.kt"), RAW = KT("bridge/android/app", "RawPcmExtractor.kt");
const SERVICE = KT("bridge/android/app", "DacService.kt"), TRANSPORT = KT("bridge/android/app", "Transport.kt");
const SINK = KT("android/app", "UsbAudioSink.kt");

// The list of rates in [src] after [marker], as numbers.
const rates = (src, marker) => { const at = src.indexOf(marker) + marker.length; const list = src.slice(src.indexOf("[", at) + 1, src.indexOf("]", at)); return list.replace(/intArrayOf\(|\)/g, "").split(",").map(x => Number(x.trim())); };

test("the Android Bridge says it takes continuous PCM, reads a run's format from its strm and plays its samples raw", () => {
  assert.match(SLIM, /UDN=\$\{Store\.udn\(service\)\},ContinuousPcm=1,flc,pcm,wav,dsf,dff"/, "its hello");
  // strm's rate characters: the same table as the server's and the Linux Bridge's, place for place.
  const server = rates(read("server/Mandarin.Server/Renderers/Slim/SlimFrames.cs"), "private static readonly int[] Rates");
  const linux = rates(read("bridge/linux/Mandarin.Bridge/Slim.cs"), "private static readonly int[] Rates");
  const android = SLIM.match(/RATES = intArrayOf\(([^)]*)\)/)[1].split(",").map(x => Number(x.trim()));
  assert.ok(server.length >= 18 && server.includes(705600));
  assert.deepEqual(linux, server, "the Linux Bridge's");
  assert.deepEqual(android, server, "the Android Bridge's");
  // A strm s of PCM: its format put on the address as RawPcmExtractor reads it.
  const raw = SLIM.slice(SLIM.indexOf("private fun raw("), SLIM.indexOf("/** Mandarin told it the track"));
  assert.ok(raw.includes("b[2] != 'p'.code.toByte()"), "PCM only");
  assert.ok(raw.includes("'1' -> 16; '2' -> 24; '3' -> 32"), "the depth, as strm says it");
  assert.ok(raw.includes(`return "#pcm=s\${bits}le:\${RATES[r]}:$channels"`));
  assert.ok(raw.includes("b[6] != '1'.code.toByte()"), "little-endian only");
  assert.match(SLIM, /val item = raw\(b\)\?\.let \{ Transport\.Item\(said\.uri \+ it, said\.title, said\.artist, said\.album\) \} \?: said/);
  // What Slim.kt writes is what RawPcmExtractor takes: its pattern, run here on each depth.
  const said = new RegExp(RAW.match(/Regex\("([^"]+)"\)/)[1]);
  for (const s of ["#pcm=s16le:44100:2", "#pcm=s24le:96000:2", "#pcm=s32le:768000:2"]) assert.ok(said.test("http://h:3500/stream/slim/SLIM_0A/1.pcm?s=x" + s), s);
  assert.ok(!said.test("http://h:3500/stream/t1.flac"), "a file is read as ever");
  assert.ok(RAW.includes("16 -> C.ENCODING_PCM_16BIT; 24 -> C.ENCODING_PCM_24BIT; else -> C.ENCODING_PCM_32BIT"));
  assert.ok(RAW.includes("track.sampleMetadata(frames * 1_000_000L / rate, C.BUFFER_FLAG_KEY_FRAME, whole, pending - whole, null)"), "timed from the frames before");
  // ExoPlayer picks it by the address; anything else as before.
  assert.ok(SERVICE.includes("RawPcmExtractor.of(uri)?.let { arrayOf<Extractor>(it) } ?: createExtractors()"));
  // A run read with an hour's patience (Mandarin waits to be told the next track before it sends it); a file, 8 s.
  const patient = KT("bridge/android/app", "PatientDataSource.kt");
  assert.ok(patient.includes("val d = if (RawPcmExtractor.of(dataSpec.uri) != null) patient else usual"));
  assert.ok(SERVICE.includes(".setReadTimeoutMs(3_600_000)") && SERVICE.includes(".setReadTimeoutMs(8_000)"));
  assert.ok(SERVICE.includes("DataSource.Factory { PatientDataSource(usual.createDataSource(), patient.createDataSource()) }"));
  // Each track it comes to in a run, said: the screen and notification retitled.
  assert.ok(SLIM.includes(`"mtrk" -> told(String(b, Charsets.US_ASCII))`));
  assert.ok(SLIM.includes(`transport.retitle(header(lines, "X-Mandarin-Title"), header(lines, "X-Mandarin-Artist"), header(lines, "X-Mandarin-Album"))`));
  assert.ok(TRANSPORT.includes("current = Item(c.uri, title, artist, album)"));
});

test("the USB sink gives a change of format half a second of silence before the music, out of the position", () => {
  const configure = SINK.slice(SINK.indexOf("override fun configure("), SINK.indexOf("private fun keeps("));
  // DSD and PCM: a stream open before (usb) and another opened is a change; the silence set once it is open.
  const dsd = configure.slice(0, configure.indexOf("if (wantUsb(inputFormat) && mode == \"pcm\""));
  assert.ok(dsd.indexOf("val change = usb") < dsd.indexOf("UsbDriver.open("), "DSD: was a stream open");
  assert.ok(dsd.indexOf("if (change) settleWith(sil)") > dsd.indexOf("dopMarker = 0x05"), "DSD: silence once open, DoP's marker begun");
  const pcm = configure.slice(configure.indexOf("val change = usb", configure.indexOf("if (wantUsb(inputFormat) && mode == \"pcm\"")));
  assert.ok(pcm.indexOf("val change = usb") < pcm.indexOf("UsbDriver.open(context, inputFormat.sampleRate)"), "PCM: was a stream open");
  assert.ok(pcm.includes("if (change) settleWith(ByteArray(channels * subslot))"), "PCM: zeros");
  // Half a second of whole frames (DoP's two at a time, so its markers alternate on into the music).
  const settle = SINK.slice(SINK.indexOf("private fun settleWith("), SINK.indexOf("/** What the engine sends with nothing to play"));
  assert.ok(settle.includes("val count = (rate / 2) / (frames.size / per) * (frames.size / per)"));
  assert.ok(settle.includes("afterSilence = UsbDriver.played() + count"));
  // Written ahead of the music as the ring takes it; the position begins once it is played; a flush drops it.
  const handle = SINK.slice(SINK.indexOf("override fun handleBuffer("), SINK.indexOf("private fun room("));
  assert.ok(handle.indexOf("settle?.let") < handle.indexOf("if (!startSet)"), "the silence before the first buffer");
  assert.ok(handle.includes("if (sil.hasRemaining()) return false"), "the buffer waits until the silence is all in");
  assert.ok(handle.includes("playedAtStart = maxOf(UsbDriver.played(), afterSilence)"), "the position leaves the silence out");
  assert.ok(SINK.includes("val played = (UsbDriver.played() - playedAtStart).coerceAtLeast(0)"));
  for (const f of ["override fun flush()", "override fun reset()"]) assert.ok(SINK.slice(SINK.indexOf(f)).split("\n")[0].includes("settle = null; afterSilence = 0"), f);
});
