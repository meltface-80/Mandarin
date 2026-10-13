"use strict";
/*
 * Qobuz and Tidal whole in the C# server (v0.8.47, stage 4.4 and 4.5;
 * server/Mandarin.Server/Services/Accounts.cs, ServiceStreams.cs, TidalApi.cs,
 * ServiceRoutes.cs, Streams.cs and Transcoder.cs), against the fakes on
 * loopback (test/fake-qobuz.js, test/fake-tidal.js) and a stand-in Sonos room
 * (test/fake-sonos.js), each held to what the Node server answered, writes and
 * sends for the same request from the same start (asked of it directly, the
 * services its own for that moment, the state put back between):
 *
 *   - signed out: Settings → Services' state and its switches, word for word;
 *   - Qobuz's sign-in, good and bad: the answer, and the account kept as the
 *     Node server keeps it (never the password);
 *   - Tidal's sign-in with a link and a code: begun, asked again, approved
 *     (the account, the user and the subscription kept), let go, and expired
 *     (by the clock, and by Tidal's word);
 *   - signing out and disconnecting, word for word;
 *   - Tidal's token, refreshed by the C# server alone: due for a request, an
 *     import or a watch; two asking at once, one refresh; one Tidal refuses,
 *     in the Node server's words; the Node server's own never asked;
 *   - playing an album from the browser (POST /api/<s>/play): the answer,
 *     the rows and the room's queue, as the Node server's; refused likewise;
 *   - the streams: each file the very one the Node server makes, the answers'
 *     headers the same; Qobuz's plays reported as the Node server reports
 *     them; Tidal's hi-res from DASH, fed to ffmpeg here, the Node server's
 *     loopback address never asked; the CD an account without hi-res gets.
 *
 * test/qobuz.test.js and test/tidal.test.js are the services' own.
 *
 * Since v0.8.50 (stage 7) the Node server's side is a recording
 * (test/golden/services-signin-node.json, test/golden.js): made
 * through the C# server with the Node server behind
 * it (MANDARIN_FRONT=1, while index.js was still there); every run since starts
 * the program alone and holds it to the recording. A conversion is held to the
 * very file ffmpeg makes with the Node server's arguments, as recorded, from
 * the same audio the fakes send (the fixture's file, or Tidal's DASH pieces
 * joined); times written as the test ran, the data folder and the fakes'
 * ports are said by name.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg, haveSoxr, probe } = require("./fixtures");
const { FakeQobuz } = require("./fake-qobuz");
const { FakeTidal } = require("./fake-tidal");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { built } = require("./server");
const { recording } = require("./golden");
const { spawnSync } = require("child_process");

const rec = recording("services-signin-node");
const skip = built() || (!rec.exists() && "no recording of the Node server's answers") || (!haveFfmpeg() && "ffmpeg is not installed");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const SOXR = haveSoxr();
const DAY = 86400e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting " + what);
    await sleep(100);
  }
}

test("Qobuz and Tidal whole: signing in and out, the token, playing and the streams, by the C# server as the Node server", { skip, timeout: 300000 }, async (t) => {
  const lib = makeLibrary();
  const cd = [1, 2, 3].map(i => path.join(lib.music, "Artist A", "Album One", `0${i} Song ${i}.flac`));
  const hi = [1, 2].map(i => path.join(lib.music, "Artist B", "Hi Res", `0${i} Hi ${i}.flac`));
  const qobuz = new FakeQobuz({ albums: [
    { id: "q100", title: "Q Album", artist: "Q Artist", rate: 44100, bits: 16, year: 2021, tracks: cd.map((f, i) => ({ id: 5001 + i, title: "Q Song " + (i + 1), file: f, duration: 3 })) },
    { id: "q200", title: "Q Hi-Res", artist: "Q Artist", rate: 96000, bits: 24, year: 2022, tracks: hi.map((f, i) => ({ id: 6001 + i, title: "Q Hi " + (i + 1), file: f, duration: 4 })) }
  ] });
  const tidal = new FakeTidal({ albums: [
    { id: 2001, title: "T Album", artist: "T Artist", year: 2021, hires: false, tracks: cd.map((f, i) => ({ id: 8001 + i, title: "T Song " + (i + 1), file: f, duration: 3 })) },
    { id: 2002, title: "T Hi-Res", artist: "T Artist", year: 2022, hires: true, tracks: hi.map((f, i) => ({ id: 9001 + i, title: "T Hi " + (i + 1), file: f, duration: 4, rate: 96000 })) }
  ] });
  const house = new FakeHousehold();
  t.after(() => Promise.all([qobuz.stop(), tidal.stop(), house.stop()]));
  await qobuz.start();
  await tidal.start();
  await house.start();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, tidalBaseUrl: tidal.base, tidalAuthUrl: tidal.authBase, tidalImagesUrl: tidal.authBase + "/images/",
    // The import and the watch out of the way: nothing is brought in unasked.
    qobuzSyncDelayMs: 1e9, serviceWatchMs: 1e9 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  // The database, read straight.
  const raw = ctx.db.raw;
  /* The data folder and any port on loopback by name; a time written as the test ran in days from now. */
  const named = (text) => String(text).split(lib.data).join("<data>").replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
    // The tokens the fakes hand out, new each sign-in.
    .replace(/\b(tok|at|rt)-[0-9a-f]{12}\b/g, "$1-<new>")
    .replace(/(":)(1\d{12})\b/g, (m, pre, t) => { const d = (Number(t) - Date.now()) / DAY; return Math.abs(d) < 3 ? `${pre}"<now ${Math.round(d)} d>"` : m; });
  /* The Node server's answer to the same request, as recorded. */
  const theirs = (label) => rec.want(label);
  const call = async (base, p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), j, text };
  };
  const get = (p) => call(B, p);
  const post = (p, body) => call(B, p, body || {});
  const setting = (k) => { const r = raw.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? r.value : undefined; };

  await until(() => ctx.frontRuns && ctx.frontRuns.has("services"), 30000, "the services handed over");
  await until(async () => (await get("status")).j.index_count >= 3, 30000, "the library");
  const kitchen = await until(async () => (await get("zones")).j.zones.find(z => z.display_name === "Kitchen"), 30000, "the room");
  const room = house.room("Kitchen");

  await t.test("signed out: Settings → Services and its switches, as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const c = await get("settings/" + s), n = await theirs("signed out: settings/" + s, "settings/" + s);
      assert.deepEqual([c.status, c.by, c.j.connected], [200, "C#", false]);
      assert.equal(named(c.text), n.text, s);
      for (const body of [{ quality: "cd" }, { quality: "nope" }, { quality: null }, { import: true }, { import: false, quality: s === "qobuz" ? "hires192" : "hires" }]) {
        const mine = await post("settings/" + s, body);
        const written = setting(s + "Settings");
        const n = await rec.want("signed out, a switch: " + s + " " + JSON.stringify(body));
        assert.deepEqual([mine.status, mine.by, named(mine.text)], [n.status, "C#", n.text], s + " " + JSON.stringify(body));
        assert.equal(written, n.written, s + ": written the same");
      }
    }
  });

  await t.test("Qobuz's sign-in, good and bad: the answer and the account, as the Node server's", async () => {
    // Refused: both needed; a wrong password in Qobuz's words.
    for (const body of [{ username: "tester@example.com" }, { password: "pw" }, {}, { username: "tester@example.com", password: "wrong" }, { username: 5, password: "pw" }]) {
      const mine = await post("settings/qobuz/signin", body), n = await theirs("Qobuz's sign-in refused: " + JSON.stringify(body), "settings/qobuz/signin", body);
      assert.deepEqual([mine.by, mine.status, named(mine.text)], ["C#", n.status, n.text], JSON.stringify(body));
      assert.ok(mine.status >= 400);
    }
    assert.ok([undefined, "null"].includes(setting("qobuz")), "nothing kept");
    const kept = () => { const a = JSON.parse(setting("qobuz")); assert.ok(a.since >= t0 && a.since <= Date.now(), "since then"); return JSON.stringify(Object.assign(a, { since: "now" })); };
    let t0 = Date.now();
    const logins = qobuz.logins;
    const mine = await post("settings/qobuz/signin", { username: "tester@example.com", password: "pw" });
    assert.deepEqual([mine.status, mine.by, mine.j.connected, mine.j.user.login, mine.j.subscription, mine.j.hires], [200, "C#", true, "tester@example.com", "Studio", true], mine.text);
    assert.equal(qobuz.logins, logins + 1, "asked of Qobuz once");
    const account = kept();
    assert.equal(account.includes("pw"), false, "the password is not kept");
    assert.equal(JSON.parse(account).token, qobuz.token);
    const n = await rec.want("Qobuz's sign-in");
    assert.equal(named(mine.text), n.text, "the same answer");
    assert.equal(named(account), n.account, "the same account");
    // Signed in, the state as the Node server's.
    assert.equal(named((await get("settings/qobuz")).text), (await theirs("Qobuz signed in: settings/qobuz", "settings/qobuz")).text);
  });

  await t.test("Tidal's sign-in with a link and a code: begun, asked again, approved, as the Node server's", async () => {
    const sansExpiry = (text, t0, t1) => text.replace(/"expires_at":(\d+)/, (m, n) => {
      assert.ok(Number(n) >= t0 + 300e3 && Number(n) <= t1 + 300e3, "five minutes from the ask: " + n);
      return `"expires_at":"in 5 min"`;
    });
    // Begun: the link and the code; asked again for the state, the same; let go, the same.
    let t0 = Date.now();
    const mine = await post("settings/tidal/signin");
    let t1 = Date.now();
    assert.deepEqual([mine.status, mine.by, mine.j.connected, mine.j.pending.url, mine.j.pending.code, mine.j.pending.error], [200, "C#", false, "https://link.tidal.com/ABCDE", "ABCDE", null], mine.text);
    const again = await post("settings/tidal/signin");
    assert.equal(again.text, mine.text, "one under way: the same one");
    const polls = tidal.polls;
    await until(() => tidal.polls > polls, 10000, "Tidal asked again");
    assert.ok(tidal.polls > polls, "Tidal asked whether it has happened");
    const state = await get("settings/tidal");
    assert.equal(state.text, mine.text, "still waiting for the person");
    const cancelled = await post("settings/tidal/signin/cancel");
    assert.equal(cancelled.j.pending, undefined, "let go");
    const after = tidal.polls;
    // A window longer than its look's second: Tidal must not be asked again in it.
    await sleep(1300);
    assert.equal(tidal.polls, after, "Tidal no longer asked");
    const n = await rec.want("Tidal's sign-in begun");
    assert.equal(sansExpiry(mine.text, t0, t1), n.text, "the same answer");
    assert.equal(sansExpiry(state.text, t0, t1), n.state, "the same state");
    assert.equal(cancelled.text, n.cancelled, "let go the same");
    // Approved on tidal.com: the account, its user and subscription kept, as the Node server kept them.
    const kept = (a0, a1) => {
      const a = JSON.parse(setting("tidal"));
      assert.ok(a.since >= a0 && a.since <= a1 && a.token.expires >= a0 + 3600e3 && a.token.expires <= a1 + 3600e3, "since then, good for the hour");
      a.since = "now"; a.token.expires = "in an hour";
      return JSON.stringify(a);
    };
    const signedIn = async (base) => {
      ctx.db.setSetting("tidal", null);
      const a0 = Date.now();
      const r = await call(base, "settings/tidal/signin", {});
      assert.equal(r.j.connected, false);
      tidal.approve();
      const st = await until(async () => { const s = await call(base, "settings/tidal"); return s.j.connected && s.j.subscription && s; }, 20000, "signed in");
      return { st, account: kept(a0, Date.now()) };
    };
    const c = await signedIn(B);
    assert.equal(c.st.by, "C#");
    assert.deepEqual([c.st.j.user.login, c.st.j.user.name, c.st.j.user.country, c.st.j.subscription, c.st.j.hires, c.st.j.pending], ["tester@example.com", "Tess", "GB", "HIFI_PLUS", true, undefined]);
    assert.equal(JSON.parse(c.account).token.access, tidal.access);
    const theirsIn = await rec.want("Tidal approved");
    assert.equal(named(c.account), theirsIn.account, "the same account");
    assert.equal(named(c.st.text), theirsIn.text, "the same state");
    // Signed in already: asking again changes nothing.
    assert.equal((await post("settings/tidal/signin")).text, c.st.text);
  });

  await t.test("Tidal's sign-in expired: by the clock, and by Tidal's word, as the Node server says it", async () => {
    const acc = setting("tidal");
    const expired = async (base, how) => {
      ctx.db.setSetting("tidal", null);
      if (how === "clock") tidal.deviceExpiresIn = 1;
      const t0 = Date.now();
      const r = await call(base, "settings/tidal/signin", {});
      tidal.deviceExpiresIn = 300;
      if (how === "tidal") tidal.devices.clear();
      const st = await until(async () => { const s = await call(base, "settings/tidal"); return s.j.pending && s.j.pending.error && s; }, 15000, how);
      // Asked again: begun afresh.
      tidal.deviceExpiresIn = 300;
      const fresh = await call(base, "settings/tidal/signin", {});
      await call(base, "settings/tidal/signin/cancel", {});
      return { r, st, fresh, t0 };
    };
    const sans = (text) => text.replace(/"expires_at":\d+/, `"expires_at":"…"`);
    for (const how of ["clock", "tidal"]) {
      const mine = await expired(B, how);
      const n = await rec.want("Tidal's sign-in expired: " + how);
      assert.equal(mine.st.by, "C#");
      assert.equal(mine.st.j.pending.error, "The sign-in link expired — ask for a new one", how);
      assert.equal(sans(named(mine.st.text)), n.st, how + ": the same state");
      assert.equal(mine.fresh.j.pending.error, null, how + ": a new link and code");
      assert.equal(sans(named(mine.fresh.text)), n.fresh);
    }
    ctx.db.setSetting("tidal", JSON.parse(acc));
  });

  await t.test("signing out and disconnecting, as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      for (const how of ["signout", "disconnect"]) {
        const acc = setting(s);
        const mine = await post(`settings/${s}/${how}`);
        assert.deepEqual([mine.status, mine.by, mine.j.connected], [200, "C#", false], mine.text);
        assert.equal(setting(s), "null", "let go");
        const n = await rec.want("signing out: " + s + " " + how);
        assert.deepEqual([named(mine.text), setting(s)], [n.text, n.kept], s + " " + how);
        ctx.db.setSetting(s, JSON.parse(acc));
      }
    }
    await ctx.library.reload();
  });

  await t.test("Tidal's token: refreshed by the C# server alone, one at a time; refused in the Node server's words", async () => {
    const due = () => { const a = JSON.parse(setting("tidal")); a.token.expires = Date.now() + 1000; ctx.db.setSetting("tidal", a); };
    // Due for a request: refreshed first, the new token kept.
    due();
    let before = tidal.refreshes;
    let r = await get("tidal/search?q=t+album");
    assert.deepEqual([r.status, r.by, tidal.refreshes], [200, "C#", before + 1], r.text);
    const a = JSON.parse(setting("tidal"));
    assert.deepEqual([a.token.access, a.token.refresh], [tidal.access, tidal.refreshToken]);
    assert.ok(a.token.expires > Date.now() + 3000e3);
    // Two asking at once: one refresh, the second given the first's.
    due();
    before = tidal.refreshes;
    const release = tidal.holdRefresh();
    const both = Promise.all([get("tidal/search?q=first"), get("tidal/search?q=second"), get("tidal/new-releases?days=7")]);
    await until(() => tidal.parkedRefreshes >= 1, 10000, "the refresh");
    // A window: no second refresh may be asked for in it.
    await sleep(500);
    assert.equal(tidal.parkedRefreshes, 1, "asked for once");
    release();
    for (const x of await both) assert.deepEqual([x.status, x.by], [200, "C#"], x.text);
    assert.equal(tidal.refreshes, before + 1, "one refresh");
    // No refresh token kept by Tidal's answer: the old one kept.
    // Refused: in the Node server's words, for a request, a write and Update library now.
    const fakeRefresh = tidal.refreshToken;
    ctx.db.setSetting("tidalSettings", { quality: "hires", import: true });
    try {
      tidal.refreshToken = "rt-revoked";
      for (const [p, body] of [["tidal/search?q=refused", null], ["tidal/favorite", { album_id: "2001" }], ["settings/tidal/import", {}]]) {
        due();
        const mine = body ? await post(p, body) : await get(p);
        const n = await rec.want("a refresh refused: " + p);
        assert.deepEqual([mine.status, mine.by, mine.j], [401, "C#", { error: "invalid_grant", connected: false }], p + ": " + mine.text);
        assert.equal(mine.text, n.text, p + ": the same words");
      }
      assert.equal(JSON.parse(setting("tidal")).token.refresh, fakeRefresh, "nothing kept of a refused refresh");
    } finally { tidal.refreshToken = fakeRefresh; ctx.db.setSetting("tidalSettings", { quality: "hires", import: false }); }
    // Due for an import and a watch: refreshed here (test/services-import-csharp.test.js holds the rows).
    ctx.db.setSetting("tidalSettings", { quality: "hires", import: true });
    try {
      due();
      before = tidal.refreshes;
      r = await post("settings/tidal/import");
      assert.deepEqual([r.status, r.by, r.j.ok, tidal.refreshes], [200, "C#", true, before + 1], r.text);
      // The import runs on after its answer, and the watch looks at nothing while one runs (it answers null for the service then):
      // asked until it has looked — the server's own first import, scheduled when the switch went on, may run just after the one asked for.
      await until(async () => !(await get("settings/tidal")).j.importing, 20000, "Tidal's import");
      const w = await until(async () => {
        due();
        const r0 = tidal.refreshes;
        const x = await (await fetch(B + "/internal/jobs/watch", { method: "POST", headers: { "X-Mandarin-Front-Key": ctx.frontKey } })).json();
        if (!x.services || !x.services.tidal) return null;
        return Object.assign(x, { refreshed: tidal.refreshes - r0 });
      }, 20000, "the watch, once no import runs");
      assert.deepEqual([w.ok, w.services.tidal.failed, w.refreshed], [true, 0, 1], "the watch refreshed the token due, once: " + JSON.stringify(w));
    } finally { ctx.db.setSetting("tidalSettings", { quality: "hires", import: false }); await ctx.library.reload(); }
  });

  // ---------------------------------------------------------------- playing

  const columns = (table) => raw.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const typed = (table, where, ...args) => {
    const cs = columns(table);
    return raw.prepare(`SELECT ${cs.map(c => `${c}, typeof(${c}) AS "${c}:type"`).join(", ")} FROM ${table} WHERE ${where}`).all(...args);
  };
  const strip = (o, keys) => { const x = Object.assign({}, o); for (const k of keys) { delete x[k]; delete x[k + ":type"]; } return x; };
  const rows = (key) => {
    const a = typed("albums", "key = ?", key)[0];
    assert.ok(a, key + ": written");
    return { id: a.id, album: strip(a, ["id", "added_at", "updated_at"]), tracks: typed("tracks", "album_id = ? ORDER BY path", a.id).map(x => strip(x, ["id", "album_id"])) };
  };
  const forget = (key) => {
    const a = raw.prepare("SELECT art_path FROM albums WHERE key = ?").get(key);
    if (a && a.art_path) for (const f of [a.art_path, a.art_path + ".url"]) fs.rmSync(f, { force: true });
    raw.prepare("DELETE FROM albums WHERE key = ?").run(key);
    return ctx.library.reload();
  };
  const titles = () => room.queue.map(q => (/<dc:title>([^<]*)<\/dc:title>/.exec(q.meta) || [])[1]);

  await t.test("playing an album from the browser: the answer, the rows and the room's queue, as the Node server's", async () => {
    for (const [s, id, body, want] of [
      ["qobuz", "q100", { kind: "play_now" }, ["Q Song 1", "Q Song 2", "Q Song 3"]],
      ["qobuz", "q100", { kind: "play_now", track: 1 }, ["Q Song 1", "Q Song 2", "Q Song 3"]],
      ["qobuz", "q200", { kind: "queue", track: "0" }, ["Q Hi 1"]],
      ["qobuz", "q100", { kind: "nonsense" }, ["Q Song 1", "Q Song 2", "Q Song 3"]],
      ["tidal", "2001", { kind: "play_now" }, ["T Song 1", "T Song 2", "T Song 3"]]
    ]) {
      const key = s + ":" + id, what = key + " " + JSON.stringify(body);
      const run = async (base) => {
        await forget(key);
        room.queue = [];
        const r = await call(base, `${s}/play`, Object.assign({ album_id: id, zone_or_output_id: kitchen.zone_id }, body));
        await until(() => room.queue.length >= want.length, 15000, what + ": the queue");
        return { r, rows: rows(key), queue: titles() };
      };
      // The C# server holds playback (v0.8.49, stage 6): its play is held to what the room must be sent.
      const mine = await run(B);
      assert.deepEqual([mine.r.status, mine.r.by, mine.r.j.ok, mine.r.j.offset], [200, "C#", true, mine.rows.id], what + ": " + mine.r.text);
      assert.deepEqual(mine.r.j.action, ["play_now", "play_next", "queue", "shuffle"].includes(body.kind) ? body.kind : "play_now");
      assert.deepEqual(mine.queue, want, what + ": the room's queue");
    }
    // Refused, in the same words: signed in but asked wrongly.
    for (const [p, body] of [["qobuz/play", {}], ["qobuz/play", { album_id: "q100" }], ["qobuz/play", { album_id: "q100", zone_or_output_id: kitchen.zone_id, track: 9 }],
      ["qobuz/play", { album_id: "nope", zone_or_output_id: kitchen.zone_id }], ["tidal/play", { album_id: "2001", zone_or_output_id: "no-such-room" }]]) {
      const mine = await post(p, body), n = await theirs("a play refused: " + p + " " + JSON.stringify(body).replace(kitchen.zone_id, "<room>"), p, body, { fix: (t) => named(t).split(kitchen.zone_id).join("<room>") });
      assert.deepEqual([mine.by, mine.status, named(mine.text).split(kitchen.zone_id).join("<room>")], ["C#", n.status, n.text], p + " " + JSON.stringify(body));
      assert.ok(mine.status >= 400, mine.text);
    }
    // Its part, from the C# server only (recording: the Node server's own address).
  });

  // ---------------------------------------------------------------- the streams

  const made = path.join(lib.data, "transcode");
  // Nothing being made (what the room's playing made ready behind it, done), then the folder emptied.
  const settle = async () => {
    let quiet = 0;
    await until(() => { quiet = fs.readdirSync(made).some(f => f.endsWith(".part")) ? 0 : quiet + 1; return quiet >= 10; }, 60000, "the folder quiet");
  };
  const clear = () => { for (const f of fs.readdirSync(made)) fs.rmSync(path.join(made, f), { force: true }); };
  const trackId = (p) => raw.prepare("SELECT id FROM tracks WHERE path = ?").get(p).id;
  const fetchStream = async (base, addr) => {
    const r = await fetch(base + addr, { headers: H });
    const body = Buffer.from(await r.arrayBuffer());
    const h = (k) => r.headers.get(k);
    return { status: r.status, by: h("x-mandarin-answered"), type: h("content-type"), cache: h("cache-control"), ranges: h("accept-ranges"), length: h("content-length"), body };
  };
  // An answer's headers; its length said as the body's (a file another ffmpeg makes is a few bytes apart).
  const heads = (x) => [x.status, x.type, x.cache, x.ranges, x.length == null ? null : Number(x.length) === x.body.length ? "the body's" : x.length];
  // The kept file's name with the track's id said by name.
  const fileName = (f) => f.replace(/^\d+-/, "<id>-");
  /*
   * The audio a fake sends for a track: the fixture's file, or Tidal's DASH pieces joined (as the C# server
   * feeds them to ffmpeg); the Node server's ffmpeg arguments, as a template, run on it: the file it made.
   */
  const source = (p) => {
    const id = /(\d+)$/.exec(p)[1];
    const d = tidal.dash && tidal.dash.get(id);
    if (p.startsWith("tidal://") && d && tidal.playbackCalls.some(c => String(c.track_id) === id && c.quality === "HI_RES_LOSSLESS")) {
      const f = path.join(lib.root || path.dirname(lib.data), "dash-" + id + ".mp4");
      fs.writeFileSync(f, Buffer.concat([d.init, ...d.segments]));
      return f;
    }
    for (const a of (p.startsWith("qobuz://") ? qobuz : tidal).albums) for (const t of a.tracks) if (String(t.id) === id) return t.file;
    throw new Error("no such track in the fakes: " + p);
  };
  const remade = (tpl, input) => {
    const out = path.join(path.dirname(lib.data), "node-made-" + Date.now() + ".flac");
    const r = spawnSync(FFMPEG, tpl.map(a => a === "<in>" ? input : a === "<out>" ? out : SOXR ? a : a.replace(/resampler=soxr:precision=\d+:/, "")));
    assert.equal(r.status, 0, String(r.stderr));
    return fs.readFileSync(out);
  };
  /*
   * One stream from each, from the same start (nothing of it in the
   * transcode folder): the first answer (sent as it is made) and a second
   * (from the folder), and the file kept. The Node server's made by itself,
   * the services its own for the moment (recording); its file, as recorded
   * there, made again from the same audio by its arguments.
   */
  const streamed = async (addr, what) => {
    const id = /\/t(\d+)/.exec(addr)[1];
    const go = (base) => async () => {
      await settle();
      clear();
      const asks = qobuz.fileUrlCalls.length;
      const first = await fetchStream(base, addr);
      const file = await until(() => fs.readdirSync(made).find(f => f.startsWith(id + "-") && f.endsWith(".flac")), 20000, what + ": kept");
      const second = await fetchStream(base, addr);
      return { first, second, file, bytes: fs.readFileSync(path.join(made, file)), asks: qobuz.fileUrlCalls.slice(asks).map(c => c.track_id + ":" + c.format_id + ":" + c.sig_ok) };
    };
    const mine = await go(B)();
    const trackPath = raw.prepare("SELECT path FROM tracks WHERE id = ?").get(Number(id)).path;
    const theirs = await rec.want("streamed: " + what);
    assert.deepEqual([mine.first.by, mine.second.by], ["C#", "C#"], what);
    assert.deepEqual(heads(mine.first), theirs.first, what + ": the first answer's headers");
    assert.deepEqual(heads(mine.second), theirs.second, what + ": the second's");
    assert.equal(fileName(mine.file), theirs.file, what + ": kept under the same name");
    assert.ok(mine.bytes.equals(remade(theirs.tpl, source(trackPath))), what + ": the very file the Node server makes");
    assert.ok(mine.second.body.equals(mine.bytes), what + ": sent from the folder");
    assert.deepEqual(mine.asks, theirs.asks, what + ": asked of the service as the Node server asked");
    return { mine, theirs };
  };

  await t.test("Qobuz's streams: copied as they come or converted, the files and the answers as the Node server's", async () => {
    await post("qobuz/open", { album_id: "q100" });
    await post("qobuz/open", { album_id: "q200" });
    const song = trackId("qobuz://track/5001"), hiRes = trackId("qobuz://track/6001");
    // Each asked once, signed, for the format the device takes and the account allows.
    let x = await streamed(`/stream/t${song}.flac`, "CD to Sonos, as it comes");
    assert.deepEqual(probe(x.mine.bytes), { rate: 44100, channels: 2, bits: 16 });
    assert.ok(x.mine.bytes.equals(fs.readFileSync(cd[0])), "the FLAC frames as Qobuz sent them");
    assert.deepEqual(x.mine.asks, ["5001:6:true"]);
    x = await streamed(`/stream/t${hiRes}.flac`, "24/96 to Sonos, converted to 24/48");
    assert.deepEqual(probe(x.mine.bytes), { rate: 48000, channels: 2, bits: 24 });
    assert.deepEqual(x.mine.asks, ["6001:7:true"]);
    x = await streamed(`/stream/t${hiRes}.96000-24.flac`, "24/96 to a streamer that takes it, as it comes");
    assert.deepEqual(probe(x.mine.bytes), { rate: 96000, channels: 2, bits: 24 });
    assert.deepEqual(x.mine.asks, ["6001:7:true"]);
    x = await streamed(`/stream/t${hiRes}.192000-24.flac`, "24/96 to a streamer promised 192");
    assert.deepEqual(probe(x.mine.bytes), { rate: 192000, channels: 2, bits: 24 });
    assert.deepEqual(x.mine.asks, ["6001:27:true"]);
    x = await streamed(`/stream/t${song}.flac?g=-3.5`, "CD with a ReplayGain");
    assert.deepEqual(probe(x.mine.bytes), { rate: 44100, channels: 2, bits: 24 });
    assert.deepEqual(x.mine.asks, ["5001:6:true"]);
  });

  await t.test("Qobuz's plays reported as the Node server reports them: Start on the fetch, End when the next starts", async () => {
    const one = trackId("qobuz://track/5001"), two = trackId("qobuz://track/5002");
    // From the same start: no play under way on either (the streams above were plays too).
    const acc0 = setting("qobuz");
    await post("settings/qobuz/signout");
    ctx.db.setSetting("qobuz", JSON.parse(acc0));
    const plays = async (base) => {
      await settle();
      qobuz.reports.length = 0;
      clear();
      await fetchStream(base, `/stream/t${one}.flac`);
      await until(() => qobuz.reports.length >= 1, 10000, "the start");
      // It plays a while first: the end report says how long.
      await sleep(1100);
      await fetchStream(base, `/stream/t${two}.flac`);
      await until(() => qobuz.reports.length >= 3, 10000, "the end and the next start");
      return qobuz.reports.map(x => ({ which: x.which, fields: Object.keys(x.event).join(","), event: Object.assign({}, x.event, { date: typeof x.event.date, duration: x.which === "end" ? x.event.duration >= 1 && x.event.duration <= 3 : x.event.duration }) }));
    };
    const mine = await plays(B);
    const theirs = await rec.want("Qobuz's plays reported");
    assert.deepEqual(mine.map(x => x.which + ":" + x.event.track_id), ["start:5001", "end:5001", "start:5002"]);
    assert.deepEqual(mine, theirs, "the same reports");
    assert.deepEqual([mine[0].event.user_id, mine[0].event.credential_id, mine[0].event.format_id, mine[0].event.intent, mine[0].event.device_id], [4242, 77, 6, "streaming", 9001]);
    // A speaker asking the Node server itself (by its own address, unsigned; recording): the file made by C#, the play reported there.
    // Alone, the speaker asks the program, and the play under way is the third track's all the same.
    await settle();
    clear();
    qobuz.reports.length = 0;
    const three = trackId("qobuz://track/5003");
    const r = await fetchStream(B, `/stream/t${three}.flac`);
    assert.deepEqual([r.status, r.by], [200, "C#"]);
    await until(() => qobuz.reports.some(x => x.which === "start" && x.event.track_id === 5003), 10000, "reported");
    // Signing out ends the play under way: reported, as the Node server's sign-out does.
    qobuz.reports.length = 0;
    const acc = setting("qobuz");
    assert.equal((await post("settings/qobuz/signout")).by, "C#");
    assert.deepEqual(qobuz.reports.map(x => x.which + ":" + x.event.track_id), ["end:5003"], "the play under way reported over");
    ctx.db.setSetting("qobuz", JSON.parse(acc));
    // Signed out, nothing of Qobuz streams, made already or not.
    ctx.db.setSetting("qobuz", null);
    const refused = await fetchStream(B, `/stream/t${one}.flac`);
    const theirs2 = await rec.want("signed out, a stream");
    assert.deepEqual([refused.status, refused.by, refused.body.length], [403, "C#", 0]);
    assert.equal(theirs2.status, 403);
    ctx.db.setSetting("qobuz", JSON.parse(acc));
  });

  await t.test("Tidal's streams: CD from one address, hi-res from DASH fed to ffmpeg here, as the Node server's", async () => {
    await post("tidal/open", { album_id: "2001" });
    await post("tidal/open", { album_id: "2002" });
    const song = trackId("tidal://track/8001"), hiRes = trackId("tidal://track/9001");
    let x = await streamed(`/stream/t${song}.flac`, "CD to Sonos, as it comes");
    assert.ok(x.mine.bytes.equals(fs.readFileSync(cd[0])), "the FLAC frames as Tidal sent them");
    await settle();
    tidal.playbackCalls.length = 0;
    tidal.dashFetches.length = 0;
    clear();
    // From DASH: the C# server's own run first, the Node server's loopback address never asked.
    const first = await fetchStream(B, `/stream/t${hiRes}.flac`);
    assert.deepEqual([first.status, first.by], [200, "C#"]);
    await until(() => fs.readdirSync(made).some(f => f.endsWith(".flac")), 20000, "kept");
    assert.ok(tidal.dashFetches.some(f => f.piece === "init.mp4") && tidal.dashFetches.some(f => f.piece === "1.m4s"), "the pieces fetched: " + JSON.stringify(tidal.dashFetches));
    assert.deepEqual(tidal.playbackCalls.map(c => c.quality), ["HI_RES_LOSSLESS"]);
    x = await streamed(`/stream/t${hiRes}.flac`, "24/96 to Sonos from DASH, converted to 24/48");
    assert.deepEqual(probe(x.mine.bytes), { rate: 48000, channels: 2, bits: 24 });
    x = await streamed(`/stream/t${hiRes}.96000-24.flac`, "24/96 to a streamer, from DASH");
    assert.deepEqual(probe(x.mine.bytes), { rate: 96000, channels: 2, bits: 24 });
    assert.deepEqual(raw.prepare("SELECT sample_rate, bits FROM tracks WHERE path = 'tidal://track/9001'").get(), { sample_rate: 96000, bits: 24 });
  });

  await t.test("an account Tidal gives CD to: asked for hi-res once, then CD, copied as it comes, the rows learnt; as the Node server", async () => {
    const one = trackId("tidal://track/9001"), two = trackId("tidal://track/9002");
    const reset = () => {
      raw.prepare("UPDATE tracks SET sample_rate = 96000, bits = 24 WHERE path IN ('tidal://track/9001', 'tidal://track/9002')").run();
      raw.prepare("UPDATE albums SET max_rate = 96000, max_bits = 24 WHERE key = 'tidal:2002'").run();
      return ctx.library.reload();
    };
    tidal.denyHires = true;
    const run = async (base) => {
      await settle();
      await reset();
      clear();
      // What was learnt of the account before forgotten: a setting written (each server's own).
      if (base === B) await post("settings/tidal", { quality: "hires" }); else ctx.tidal.hiresDenied = false;
      tidal.playbackCalls.length = 0;
      const a = await fetchStream(base, `/stream/t${one}.flac`);
      await until(() => fs.readdirSync(made).filter(f => f.endsWith(".flac")).length >= 1, 20000, "the first");
      const b = await fetchStream(base, `/stream/t${two}.flac`);
      await until(() => fs.readdirSync(made).filter(f => f.endsWith(".flac")).length >= 2, 20000, "the second");
      const files = fs.readdirSync(made).filter(f => f.endsWith(".flac")).sort();
      return { a, b, calls: tidal.playbackCalls.map(c => c.track_id + ":" + c.quality), files, bytes: files.map(f => fs.readFileSync(path.join(made, f))),
        rows: raw.prepare("SELECT path, sample_rate, bits FROM tracks WHERE path IN ('tidal://track/9001', 'tidal://track/9002') ORDER BY path").all() };
    };
    try {
      const mine = await run(B);
      const theirs = await rec.want("an account Tidal gives CD to");
      assert.deepEqual(mine.calls, ["9001:HI_RES_LOSSLESS", "9002:LOSSLESS"], "hi-res asked for once; CD from then on");
      assert.deepEqual(mine.calls, theirs.calls);
      assert.deepEqual([mine.a.by, mine.a.status, mine.b.status], ["C#", 200, 200]);
      assert.deepEqual(mine.files.map(fileName), theirs.files, "kept under the same names");
      // Never upsampled to the plan: copied at what it is (the fake sends the file it has, whatever it says of it).
      assert.ok(mine.bytes[0].equals(fs.readFileSync(hi[0])) && mine.bytes[1].equals(fs.readFileSync(hi[1])), "copied as it comes");
      assert.deepEqual(mine.rows, theirs.rows, "the rows learnt the same");
      assert.deepEqual(mine.rows.find(r => r.path === "tidal://track/9001"), { path: "tidal://track/9001", sample_rate: 44100, bits: 16 });
    } finally { tidal.denyHires = false; await reset(); }
  });
  t.after(() => rec.done());
});
