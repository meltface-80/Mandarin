"use strict";
/*
 * An MQA track sent untouched to a DAC that decodes MQA, through a Mandarin Bridge (item 418; the server's
 * Mqa/MqaPlan.cs). The Bridges' code doesn't run in this suite, so their sources are read as written (as
 * test/bridge-android-continuous.test.js reads them): the server says it in the track's request
 * (X-Mandarin-Untouched: mqa, for a run of Mandarin's PCM and for a file alike) and never joins an untouched track and
 * another into one run; the Android Bridge reads the header into its track and, as that track becomes the one
 * playing, tells the USB driver, whose software gain (core UsbGain, its own test) is then 1 whatever the slider; the
 * Linux Bridge gives the engine a gain of 1 always, and the engine's padding of 16/24-bit words to 32 is lossless.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const KT = (dir, f) => read(dir, "src", "main", "java", "com", "musicd", "server", "android", f);

test("the server tells a Bridge which track goes untouched, and keeps it a run of its own", () => {
  const runs = read("server/Mandarin.Server/Renderers/Slim/SlimRuns.cs");
  const player = read("server/Mandarin.Server/Renderers/Slim/SlimPlayer.cs");
  const plan = read("server/Mandarin.Server/Mqa/MqaPlan.cs");
  assert.match(plan, /public const string Header = "X-Mandarin-Untouched";/);
  assert.match(plan, /HeaderFor\(string\? uri\) => Untouched\(uri\) \? Header \+ ": mqa\\r\\n" : ""/);
  assert.match(runs, /SlimPlayer\.Headers\(metas\.GetValueOrDefault\(e\.Uri, ""\)\) \+ Mqa\.MqaPlan\.HeaderFor\(e\.Uri\)/, "a run's request says it");
  assert.match(runs, /PcmFormat\.Of\(n\.Uri, n\.Meta\) != r\.Pcm \|\| Mqa\.MqaPlan\.Untouched\(n\.Uri\) != Mqa\.MqaPlan\.Untouched\(r\.Entries\[0\]\.Uri\)/,
    "an untouched track never joins another's run, nor another its");
  assert.match(player, /extra \+ Mqa\.MqaPlan\.HeaderFor\(uri\)/, "a file's request says it");
  // A Squeezelite's volume is a gain on the samples: unity while the untouched track plays, silence still silence.
  assert.match(player, /muted \|\| volume <= 0 \? 0 : Mqa\.MqaPlan\.Untouched\(current\) \? 1 : volume \/ 100/);
});

test("the Android Bridge plays a track its request says is untouched with no software gain", () => {
  const slim = KT("bridge/android/app", "Slim.kt"), transport = KT("bridge/android/app", "Transport.kt");
  const driver = KT("android/app", "UsbDriver.kt"), sink = KT("android/app", "UsbAudioSink.kt");
  assert.match(slim, /untouched = header\(lines, "X-Mandarin-Untouched"\)\.isNotEmpty\(\)/, "read from the request");
  assert.match(slim, /Transport\.Item\(said\.uri \+ it, said\.title, said\.artist, said\.album, said\.untouched, said\.art\)/, "a run of PCM keeps it");
  assert.match(transport, /class Item\(val uri: String, val title: String = "", val artist: String = "", val album: String = "", val untouched: Boolean = false, val art: String = ""\)/);
  assert.match(transport, /current = item; next = null; error = null\n\s+UsbDriver\.untouched = item\.untouched/, "a track set: its gain");
  assert.match(transport, /current = next; next = null\n\s+UsbDriver\.untouched = current\?\.untouched == true/, "the next, as it begins");
  assert.match(transport, /Item\(c\.uri, title, artist, album, c\.untouched, art\)/, "kept when retitled");
  assert.match(transport, /stopped = true; current = null; next = null\n\s+UsbDriver\.untouched = false/, "forgotten when stopped");
  assert.match(driver, /UsbGain\.software\(o\.info\.volumeControl, o\.dsd, fixed\(\), muted, level\(\), untouched\)/, "the driver's gain asks it");
  assert.match(sink, /val gain = UsbDriver\.softwareGain\(\)\.toDouble\(\)/, "and the sink applies that gain, 1 leaving the samples as they are");
});

test("the Linux Bridge never scales: the engine at a gain of 1, the samples untouched", () => {
  const player = read("bridge/linux/Mandarin.Bridge/Player.cs");
  assert.match(player, /Send\(new JsonObject \{ \["cmd"\] = "gain", \["value"\] = 1 \}\);/);
  assert.doesNotMatch(player, /\["cmd"\] = "gain", \["value"\] = (?!1 )/, "never another gain");
  const engine = read("engine/Mandarin.Audio/Engine.cs");
  assert.match(engine, /float g = mark\.Fmt == OutFormat\.Pcm \? Untouched\.Gain\(mark\.Uri, gain\) : 1f;/, "the engine's own: no volume on an untouched stream");
});
