"use strict";
/*
 * Item 543: a multichannel DSD file (a 5.1 SACD's DSF) to a device that takes DSD natively. The DSD branch of the
 * plan sent it as it is, every channel, to a device that plays two: the Android Bridge refuses DSD of more than two
 * channels (the track failed), the Linux Bridge's ALSA can't open a stereo DAC at six. It goes as stereo PCM instead,
 * as every other multichannel track does; a stereo DSF still goes as it is. Asked of the C# server (`mandarin-server
 * score`), as test/streams-csharp.test.js asks it.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = !fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)";

const plans = (pairs) => {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify({ fn: "plans", plan: pairs }) + "\n", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out.plan;
};

const BRIDGE = { name: "FiiO R7 USB", rates: [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000], maxBits: 32,
  containers: ["flac", "wav", "dsd"], dsd: [64, 128, 256], dsdMimes: { dsf: "audio/dsf", dff: "audio/dff" } };
const DSF = (channels) => ({ path: "/m/sacd.dsf", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1, channels });
const DFF = (channels) => ({ path: "/m/sacd.dff", codec: "DSD", sampleRate: 5644800, bitsPerSample: 1, channels });

test("a stereo DSD file goes to a DSD device as it is", { skip }, () => {
  const [dsf, dff, unsaid] = plans([[DSF(2), BRIDGE], [DFF(2), BRIDGE], [DSF(undefined), BRIDGE]]);
  assert.equal(dsf.transcode, false); assert.equal(dsf.reason, "DSD64 as it is");
  assert.equal(dff.transcode, false); assert.equal(dff.reason, "DSD128 as it is");
  assert.equal(unsaid.transcode, false, "channels not known: two, as everywhere else");
});

test("a multichannel DSD file goes as stereo PCM, saying why (item 543)", { skip }, () => {
  for (const [p, n] of plans([[DSF(6), BRIDGE], [DFF(6), BRIDGE], [DSF(5), BRIDGE]]).map((p, i) => [p, [6, 6, 5][i]])) {
    assert.equal(p.transcode, true, JSON.stringify(p));
    assert.equal(p.mime, "audio/flac");
    assert.ok(!p.dsd, "not passed as DSD");
    assert.equal(p.reason, `${n}-channel DSD, played as stereo PCM for FiiO R7 USB`);
  }
});
