"use strict";
/*
 * A Squeezelite player's page (item 313, app/audio-devices.js, app/device-gapless.js): a SlimProto player (a
 * stand-in, test/fake-slim.js) connected and opened in Settings → Audio Devices. Found by connecting to Mandarin,
 * its Standard SlimProto; its rates as it said them in its hello, with no "assumed" note; its Output, as a
 * renderer's; Gapless its note alone; DSD as DSF, to its own -D. A Mandarin Bridge played Mandarin's continuous PCM
 * (item 322, its hello's ContinuousPcm=1) has no Gapless group (item 326). The app's words are DevicePage.kt's (DeviceSlimTest).
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeSlim } = require("./fake-slim");
const { FakeSlimPcm } = require("./fake-slim-pcm");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), SLIM = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("a Squeezelite player's page: found by connecting, SlimProto, its own rates, Output, Gapless its note", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", upnpMulticast: false, identify: false, slimprotoPort: SLIM });
  await srv.start();
  const player = new FakeSlim({ port: SLIM, name: "Mojo 2 Pi", mac: "02:00:00:00:00:44", caps: "Model=squeezelite,ModelName=SqueezeLite,Firmware=v1.9.9-1449,MaxSampleRate=768000,dsf,dff,flc,pcm" });
  const bridge = new FakeSlimPcm({ port: SLIM, name: "Study Bridge", mac: "02:00:00:00:00:45" });
  t.after(async () => { player.close(); bridge.close(); await srv.stop(); });
  await player.connect();
  await bridge.connect();
  const token = await signIn(B);
  const auth = { Authorization: "Bearer " + token };
  let dev, br;
  for (let i = 0; i < 100 && !(dev && br); i++) {
    const all = (await (await fetch(B + "/api/audio-devices", { headers: auth })).json()).devices || [];
    dev = all.find(d => d.kind === "slim" && d.name === "Mojo 2 Pi"); br = all.find(d => d.kind === "slim" && d.name === "Study Bridge");
    if (!dev || !br) await sleep(100);
  }
  assert.equal(dev.name, "Mojo 2 Pi");
  assert.equal((await (await fetch(B + "/api/audio-devices/" + dev.id, { headers: auth })).json()).continuous_pcm, false, "a Squeezelite: a file a track");
  assert.equal((await (await fetch(B + "/api/audio-devices/" + br.id, { headers: auth })).json()).continuous_pcm, true, "the Bridge said ContinuousPcm=1");
  const b = await Browser.launch({ width: 412, height: 915 });
  let r, rb;
  try {
    const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
    const open = id => page.eval(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 200 && typeof openDevice !== "function"; i++) await sleep(50);
      document.getElementById("settings-overlay").classList.remove("hidden");
      await openDevice(${JSON.stringify(id)});
      for (let i = 0; i < 100 && !document.querySelector('[data-seg="mode"]'); i++) await sleep(50);
      const pane = document.querySelector('.settings-pane[data-pane="device"]') || document.body;
      const kv = Object.fromEntries([...pane.querySelectorAll(".dev-kv")].map(e => [e.querySelector(".dev-k").textContent, e.querySelector(".dev-v").textContent]));
      const gapless = [...pane.querySelectorAll(".cap-group")].find(g => /Gapless/.test(g.querySelector(".cap-label")?.textContent || ""));
      return {
        kv, text: pane.textContent,
        mode: !!pane.querySelector('[data-seg="mode"]'),
        rates: [...pane.querySelectorAll('[data-cap="rate"].is-on')].map(e => +e.getAttribute("data-v")),
        gapless: gapless && gapless.textContent, gaplessSwitch: !!(gapless && gapless.querySelector("[data-dev-albumstream]"))
      };
    })()`);
    r = await open(dev.id);
    rb = await open(br.id);
  } finally { await b.close(); }
  assert.equal(r.kv["Found by"], "It connected to Mandarin");
  assert.equal(r.kv["Standard"], "SlimProto (Squeezebox)");
  assert.ok(r.mode, "its Output, as a renderer's");
  assert.deepEqual(r.rates, [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000], "every rate to its MaxSampleRate, on by its word");
  assert.doesNotMatch(r.text, /are assumed/, "no unknown renderer's note");
  assert.match(r.text, /What this player says it plays, in its hello/);
  assert.match(r.text, /DSD files go to it as DSF.*-D option/);
  assert.match(r.gapless || "", /plays one track into the next from its own buffer/);
  assert.equal(r.gaplessSwitch, false, "no Albums as one stream: it is gapless as it is");
  // A Mandarin Bridge played continuous PCM: no Gapless group at all (item 326).
  assert.equal(rb.gapless, undefined, "no Gapless for the Bridge: " + rb.gapless);
  assert.ok(rb.mode, "its Output all the same");
});
