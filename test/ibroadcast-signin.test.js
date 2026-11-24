"use strict";
/*
 * iBroadcast's sign-in (item 443), against a stand-in on loopback (test/fake-ibroadcast.js): Settings → Services →
 * iBroadcast, a page of its own; Sign in asks iBroadcast for a code with Mandarin's client id and only the scopes it
 * needs, shows the link and the code, and asks again until the code is approved (slower when iBroadcast says
 * slow_down); signed in, the account read (its name, Premium, the formats iBroadcast takes), never a token shown or
 * logged; a token gone stale refreshed and the call made again; the account read again after six hours; signed out
 * here and at iBroadcast; a code turned down, said so. Then the same on the page, in a browser.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const skip = built();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}

test("item 443: iBroadcast signed in with a code, its account read, a stale token refreshed, signed out", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast().start();
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, ibroadcastBaseUrl: ib.base });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const state = async () => (await fetch(base + "/api/settings/ibroadcast", { headers: H })).json();
  const post = async p => { const r = await fetch(base + "/api/settings/ibroadcast" + p, { method: "POST", headers: H, body: "{}" }); return Object.assign({ status: r.status }, await r.json()); };

  assert.deepEqual(await state(), { connected: false }, "signed out, nothing under way");

  // Sign in: a code, asked with Mandarin's client id and only the scopes it needs.
  const begun = await post("/signin");
  assert.equal(begun.status, 200, JSON.stringify(begun));
  assert.match(begun.pending.url, /^https:\/\/media\.ibroadcast\.com\/device\?code=/);
  assert.match(begun.pending.code, /^[0-9A-F]{6}$/);
  const asked = [...ib.codes.values()][0];
  assert.equal(asked.clientId, "15389a47e1c211f1b50eb49691aa2236");
  assert.deepEqual(asked.scope.split(" ").sort(), ["user.account:read", "user.library:read", "user.library:write", "user.upload"]);
  assert.equal((await post("/signin")).pending.code, begun.pending.code, "one under way: the same code");

  // Not approved yet: still waiting, iBroadcast asked again (slower once it said slow_down).
  await until(() => ib.polls >= 2, 15000, "a second ask");
  assert.equal((await state()).connected, false);
  // The account read after the token lands, slowly (item 452): signed in, it says nothing of the account until it is read.
  ib.statusDelayMs = 1500;
  ib.approve();
  const signed = await until(async () => { const s = await state(); return s.connected && s.user && s.user.name && s; }, 20000, "the sign-in and the account read");
  ib.statusDelayMs = 0;
  // Read once while it was slow, not again at each look (item 495: a read left over landed later, over what came after).
  assert.equal(ib.apiBodies.filter(b => b.path === "/api/status").length, 1, "the account read once");
  assert.deepEqual(signed.user, { name: "tester" });
  assert.equal(signed.premium, true);
  assert.deepEqual(signed.formats, ["flac", "m4a", "mp3", "wav"]);
  const shown = JSON.stringify(signed);
  for (const secret of [ib.access, ib.refreshToken]) assert.ok(!shown.includes(secret), "no token shown");
  const sent = ib.apiBodies.find(b => b.path === "/api/status");
  assert.deepEqual([sent.body.client, sent.body.device_name, sent.body.mode, sent.body.supported_types, sent.body.user_agent === sent.agent], ["mandarin", "Mandarin", "status", true, true]);

  // Six hours on, with the token gone stale: the account read again after one refresh.
  ib.expire();
  const kept = JSON.parse(ctx.db.raw.prepare("SELECT value FROM settings WHERE key = 'ibroadcast'").get().value);
  kept.checked = Date.now() - 7 * 3600 * 1000;
  ctx.db.raw.prepare("UPDATE settings SET value = ? WHERE key = 'ibroadcast'").run(JSON.stringify(kept));
  const calls = ib.apiBodies.length;
  await state();
  await until(() => ib.refreshes === 1 && ib.apiBodies.length === calls + 2, 15000, "the refresh and the call again");
  // The stand-in notes the call as it is asked; the server keeps what it read once the answer is in (IBroadcast.Describe).
  // Waited for (item 495: read at once, it was found not yet kept once in a full run).
  const kept2 = () => JSON.parse(ctx.db.raw.prepare("SELECT value FROM settings WHERE key = 'ibroadcast'").get().value);
  const after = await until(() => { const a = kept2(); return a.checked > Date.now() - 60000 && a.token.access === ib.access && a; }, 15000, "read again, and kept");
  assert.equal(after.token.access, ib.access, "the new token kept");
  assert.equal(after.token.refresh, ib.refreshToken, "the refresh token kept when none came back");

  // The log says what happened, never a token.
  const log = await until(() => { const s = fs.readFileSync(path.join(lib.data, "Logs", "Mandarin_log.txt"), "utf8"); return /\[ibroadcast\] signed in as/.test(s) && s; });
  for (const secret of [ib.access, ib.refreshToken, ...[...ib.codes.keys()]]) assert.ok(!log.includes(secret), "no token logged");
  assert.match(log, /\[ibroadcast\] the account answer holds: .*user/);

  // Signed out: forgotten here, let go at iBroadcast.
  const out = await post("/signout");
  assert.deepEqual([out.status, out.connected], [200, false]);
  assert.equal(ib.revoked[0].refresh_token, ib.refreshToken);
  assert.equal(ib.revoked[0].client_id, "15389a47e1c211f1b50eb49691aa2236");
  assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'ibroadcast'").get().n, 0);

  // A code turned down on iBroadcast: said so.
  ib.slowOnce = false;
  await post("/signin");
  ib.deny();
  const denied = await until(async () => { const s = await state(); return s.pending && s.pending.error && s; }, 15000, "the refusal");
  assert.equal(denied.pending.error, "The sign-in was turned down on iBroadcast");
  assert.deepEqual(await post("/signin/cancel"), { status: 200, connected: false });

  if (!findBrowser()) return;
  // On the page: Services → iBroadcast, Sign in, the code; approved, who and Premium.
  ib.slowOnce = false;
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], init: "window.open = () => null;" });
  await page.eval(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 100 && !document.querySelector("#settings-toggle"); i++) await sleep(100);
    document.querySelector("#settings-toggle").click(); await sleep(300);
    document.querySelector('.settings-nav-item[data-pane="streaming"]').click(); await sleep(200);
    document.querySelector('[data-parity="settings-services.ibroadcast"]').click(); await sleep(200);
    document.getElementById("ib-signin").click();
  })()`);
  const code = await until(() => page.eval(`(() => { const c = document.getElementById("ib-auth-code"); return c && c.offsetParent && c.textContent; })()`), 15000, "the code on the page");
  assert.equal(code, [...ib.codes.values()].pop().userCode);
  ib.approve();
  const seen = await until(() => page.eval(`(() => { const p = document.getElementById("ib-premium"); return p && p.offsetParent && [document.getElementById("ib-status").textContent, p.textContent, document.getElementById("ib-formats").textContent]; })()`), 20000, "signed in on the page");
  assert.deepEqual(seen, ["Signed in as tester", "Yes: your files play as they are", "FLAC, M4A, MP3, WAV"]);
});
