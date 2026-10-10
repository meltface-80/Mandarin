"use strict";
/*
 * Headphone profiles (Stage 3): AutoEq's index and profiles read, searched,
 * kept in the database and saved to a device's DSP — against a fake AutoEq
 * (test/fake-autoeq.js) — and a profile pasted by hand.
 */
const test = require("node:test");
const assert = require("node:assert");
const { parseIndex, parseProfile } = require("../lib/autoeq");
const { FakeAutoEq, INDEX } = require("./fake-autoeq");
const { makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");

const PORT = 3611;
const B = "http://127.0.0.1:" + PORT;

test("AutoEq's files are read", () => {
  const rows = parseIndex(INDEX);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { id: "oratory1990/over-ear/Sennheiser HD 650", name: "Sennheiser HD 650", source: "oratory1990", rig: "", form: "over-ear" });
  assert.deepEqual(rows[1], { id: "crinacle/GRAS 43AG-7 over-ear/Sennheiser HD 650", name: "Sennheiser HD 650", source: "crinacle", rig: "GRAS 43AG-7", form: "over-ear" });
  assert.equal(rows[3].form, "in-ear");
  const p = parseProfile("Preamp: -6.1 dB\nFilter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70\nFilter 2: OFF PK Fc 37 Hz Gain 0.7 dB Q 3.96\nFilter 3: ON PK Fc 8800 Hz Gain 5.1 dB Q 1.42\nFilter 4: ON HSC Fc 10000 Hz Gain -2.1 dB Q 0.70\nFilter 5: ON HPQ Fc 20 Hz Q 0.7\n");
  assert.equal(p.preamp, -6.1);
  assert.deepEqual(p.bands.map(b => b.type), ["low_shelf", "peak", "high_shelf", "high_pass"], "OFF left out; the types mapped");
  assert.deepEqual(p.bands[0], { type: "low_shelf", freq: 105, gain: 6.4, q: 0.7 });
  assert.equal(p.bands[3].gain, 0);
  assert.throws(() => parseProfile("nothing here"), /No filters/);
  // More than ten keeps the first ten.
  const many = parseProfile(new Array(12).fill(0).map((_, i) => `Filter ${i + 1}: ON PK Fc ${100 * (i + 1)} Hz Gain 1 dB Q 1`).join("\n"));
  assert.equal(many.bands.length, 10);
});

test("the C# server reads AutoEq's files as the Node server does (v0.8.26)", { skip: !require("fs").existsSync(require("path").join(__dirname, "..", "server", "bin", "mandarin-server")) && "the C# server isn't built (server/build.sh)" }, () => {
  const { spawnSync } = require("child_process");
  const bin = process.env.MANDARIN_SERVER_BIN || require("path").join(__dirname, "..", "server", "bin", "mandarin-server");
  const index = INDEX + [
    "- [Moondrop Blessing 2](./crinacle/711%20in-ear/Moondrop%20Blessing%202) by crinacle on 711",
    "- [Apple AirPods](./Rtings/earbud/Apple%20AirPods) by Rtings",
    "- [Café Phones](./oratory1990/over-ear/Caf%C3%A9%20Phones) by oratory1990   ",
    "  - [Indented](./a/b/Indented) by someone on rig one on rig two",
    "not a row", "- [Broken](no-dot-slash) by x"].join("\n");
  const profiles = [
    "Preamp: -6.1 dB\nFilter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70\nFilter 2: OFF PK Fc 37 Hz Gain 0.7 dB Q 3.96\nFilter 3: ON PK Fc 8800 Hz Gain 5.1 dB Q 1.42\nFilter 4: ON HSC Fc 10000 Hz Gain -2.1 dB Q 0.70\nFilter 5: ON HPQ Fc 20 Hz Q 0.7\n",
    "preamp: 3 dB\r\nfilter 1: on pk fc 100 hz gain 1 db q 1\r\n",
    "Filter 1: ON PK Fc 5 Hz Gain 1 dB Q 1\nFilter 2: ON PK Fc 100 Hz Gain 25 dB Q 1\nFilter 3: ON PK Fc 100 Hz Gain 1 dB Q 30\nFilter 4: ON LP Fc 15000 Hz Gain 9 dB Q 0.5\nFilter 5: ON XYZ Fc 100 Hz Gain 1 dB Q 1\nFilter 6: ON PEQ Fc 105.25 Hz Gain -6.15 dB Q 0.7065",
    "Preamp: 1.2.3 dB\nFilter: ON LS Fc 100 Hz Gain -0.04 dB\nFilter 2: ON HS Fc 12000.04 Hz Gain 2.25 dB Q 0.1",
    new Array(12).fill(0).map((_, i) => `Filter ${i + 1}: ON PK Fc ${100 * (i + 1)} Hz Gain 1 dB Q 1`).join("\n"),
    "Preamp: -3 dB\nnothing here", "", "Filter 1: ON PK Fc 1e3 Hz Gain 1 dB Q 1\nFilter 2: ON PK Fc -100 Hz Gain 1 dB Q 1"
  ];
  const jobs = [{ fn: "autoeq", index }].concat(profiles.map(profile => ({ fn: "autoeq", profile })));
  const r = spawnSync(bin, ["score"], { input: jobs.map(j => JSON.stringify(j)).join("\n") + "\n", encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(lines[0].rows, JSON.parse(JSON.stringify(parseIndex(index))), "the index");
  profiles.forEach((text, i) => {
    let want;
    try { const p = parseProfile(text); want = { preamp: p.preamp, bands: p.bands }; } catch (e) { want = { error: e.message }; }
    assert.deepEqual(lines[i + 1], JSON.parse(JSON.stringify(want)), "profile " + i + ": " + JSON.stringify(text).slice(0, 80));
  });
});

test("searched, fetched once, saved to a device", { timeout: 60000 }, async (t) => {
  const fake = new FakeAutoEq();
  const base = await fake.start();
  // Stopped even if what follows can't start (on a Mac without the speakers'
  // loopback addresses it couldn't): left open, it kept the run from ending.
  let stopped = false;
  t.after(async () => { if (!stopped) await fake.stop(); });
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"], autoeqBaseUrl: base, upnpMulticast: false });
  await srv.start();
  const token = await signIn(B);
  const auth = { Authorization: "Bearer " + token };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  try {
    await t.test("the index is searched by every word, the best source first", async () => {
      const r = await api("dsp/headphones?q=hd%20650");
      assert.equal(r.status, 200);
      assert.deepEqual(r.results.map(x => x.source), ["oratory1990", "crinacle"]);
      assert.ok(r.indexed_at > 0);
      assert.deepEqual((await api("dsp/headphones?q=moondrop")).results.map(x => x.name), ["Moondrop Aria"]);
      assert.deepEqual((await api("dsp/headphones?q=hd%20999")).results, []);
      assert.deepEqual((await api("dsp/headphones?q=")).results, []);
      assert.equal(fake.hits.filter(h => h === "/INDEX.md").length, 1, "the index was fetched once");
      // Behind the C# server (v0.8.26): answered by it.
      if (process.env.MANDARIN_FRONT === "1") {
        const h = await fetch(B + "/api/dsp/headphones?q=hd", { headers: auth });
        assert.equal(h.headers.get("x-mandarin-answered"), "C#");
      }
    });

    await t.test("a profile is fetched once and kept", async () => {
      const id = "oratory1990/over-ear/Sennheiser HD 650";
      const r = await api("dsp/headphones/profile?id=" + encodeURIComponent(id));
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.profile.source, "autoeq");
      assert.equal(r.profile.name, "Sennheiser HD 650 (oratory1990)");
      assert.equal(r.profile.preamp, -6.1);
      assert.equal(r.profile.bands.length, 4, "the OFF one left out");
      await api("dsp/headphones/profile?id=" + encodeURIComponent(id));
      assert.equal(fake.hits.filter(h => /HD 650 ParametricEQ/.test(h)).length, 1, "from the database the second time");
      assert.equal((await api("dsp/headphones/profile?id=nobody/over-ear/Nothing")).status, 404);
      assert.equal((await api("dsp/headphones/profile?id=../etc")).status, 404);
    });

    await t.test("a pasted profile is read the same way", async () => {
      const r = await api("dsp/headphones/parse", { name: "My IEMs", text: "Preamp: -3 dB\nFilter 1: ON PK Fc 3000 Hz Gain -4 dB Q 2\n" });
      assert.equal(r.status, 200);
      assert.deepEqual(r.profile, { source: "custom", id: "", name: "My IEMs", preamp: -3, bands: [{ type: "peak", freq: 3000, gain: -4, q: 2 }] });
      assert.equal((await api("dsp/headphones/parse", { text: "hello" })).status, 400);
    });

    await t.test("saved to the phone's DSP: the profile's own preamp holds when it covers the peak", async () => {
      // The phone is a device once it has said hello (its page in Audio Devices).
      const h = await api("phone/hello", { name: "Pixel" });
      const zone = h.zone_id;
      let dev;
      for (let i = 0; i < 50 && !dev; i++) { const d = await api("audio-devices/" + zone); if (d.status === 200) dev = d; else await new Promise(r => setTimeout(r, 200)); }
      assert.ok(dev, "the phone in the register");
      const prof = (await api("dsp/headphones/profile?id=" + encodeURIComponent("oratory1990/over-ear/Sennheiser HD 650"))).profile;
      const r = await api("audio-devices/" + zone, { dsp: { enabled: true, headphone: prof } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.dsp.headphone.name, "Sennheiser HD 650 (oratory1990)");
      assert.equal(r.dsp.headphone.bands.length, 4);
      assert.equal(r.dsp_info.active, true);
      assert.equal(r.dsp_info.bands, 4);
      // AutoEq's −6.1 dB is less than the half-dB-under-peak rule asks here, so the measured one applies.
      assert.ok(r.dsp_info.headroom <= -6.1, String(r.dsp_info.headroom));
      // The app hears of it with the profile inside.
      const got = await api("phone/commands?after=" + h.seq);
      const cmd = got.commands.find(c => c.op === "dsp");
      assert.ok(cmd && cmd.dsp.headphone && cmd.dsp.headphone.bands.length === 4);
      // Removed: the PEQ (none here) is all that's left.
      const off = await api("audio-devices/" + zone, { dsp: { headphone: null } }, "PATCH");
      assert.equal(off.dsp.headphone, null);
      assert.equal(off.dsp_info.active, false);
    });
  } finally {
    await srv.stop(); await house.stop(); await fake.stop(); stopped = true;
  }
});
