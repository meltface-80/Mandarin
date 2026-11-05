"use strict";
/*
 * The USB stream kept from one track to the next (item 304, android/app UsbAudioSink.kt, which Mandarin Bridge for
 * Android builds too). Each track's configure opened the stream on the DAC again, and UsbDriver.open closes what is
 * open first: on the owner's FiiO R7 Bridge the DAC was let go and taken back between every two tracks
 * ("UsbDriver: closed", "open: … dsd" 35 ms apart), the DAC locking again to DSD256, the last of the track before
 * still in the ring dropped, and DoP's marker begun again on 0x05 whatever the last frame's was. Now a track that goes
 * to the DAC as the one before did (the same DAC, rate and kind) follows on in the stream that is open. The sources
 * are read here as written: the app's Kotlin doesn't run in this suite.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SINK = fs.readFileSync(path.join(__dirname, "..", "android", "app", "src", "main", "java", "com", "musicd", "server", "android", "UsbAudioSink.kt"), "utf8");
const configure = SINK.slice(SINK.indexOf("override fun configure("), SINK.indexOf("private fun keeps("));

test("a track that goes to the DAC as the one before did keeps the stream open, DSD and PCM alike", () => {
  const keeps = SINK.slice(SINK.indexOf("private fun keeps("), SINK.indexOf("/** What the engine sends with nothing to play"));
  // Kept only for the very stream this track would open: the DAC on the port, its rate, its kind, alive.
  for (const part of ["c.kind == kind", "c.rate == rate", "c.device == UsbDac.device()", "!UsbDriver.dead()", "usb &&"])
    assert.ok(keeps.includes(part), "kept only where " + part);
  // DSD: kept before anything is opened, the same packing (native, words reversed or DoP), DoP's marker left as it was.
  const dsd = configure.slice(configure.indexOf("if (DsdRenderer.isDsd(inputFormat))"), configure.indexOf("if (wantUsb(inputFormat) && mode == \"pcm\""));
  const keptDsd = dsd.indexOf("if (mode == plan.first && keeps(kind, plan.second)) { drained = false; return }");
  assert.ok(keptDsd > 0, "a DSD track like the one before is kept");
  assert.ok(keptDsd < dsd.indexOf("UsbDriver.open("), "before the stream is opened again");
  assert.ok(keptDsd < dsd.indexOf("dopMarker = 0x05"), "DoP's marker goes on as it was");
  assert.ok(keptDsd < dsd.indexOf("startSet = false"), "the position goes on from the track before, as Android's own sink keeps it");
  // PCM: the same, at the rate playing.
  const pcmKeep = configure.indexOf("if (wantUsb(inputFormat) && mode == \"pcm\" && keeps(\"pcm\", inputFormat.sampleRate))");
  assert.ok(pcmKeep > 0, "a PCM track at the rate playing is kept");
  assert.ok(pcmKeep < configure.indexOf("UsbDriver.open(context, inputFormat.sampleRate)"), "before the stream is opened again");
});
