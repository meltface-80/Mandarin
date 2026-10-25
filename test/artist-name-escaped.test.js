"use strict";
/*
 * Names and errors from elsewhere are shown as text, never read as the page's own markup (bug list item 176). An
 * artist's name comes from the tags, MusicBrainz, Last.fm and the credits; the artist page put it into its "No albums
 * found" line as markup, and its error line the same with the error's words, so a name such as <img src=x onerror=…>
 * ran in the page. A label's logo search did the same with the server's error. In a real browser against the real
 * server, at a phone's size. Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const NAME = "<img id=x src=x onerror=\"window.__ran = 'name'\">";
const ERROR = "<img id=y src=y onerror=\"window.__ran = 'error'\">";
const LOGO = "<img id=z src=z onerror=\"window.__ran = 'logo'\">";

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
  const $ = id => document.getElementById(id);
  await until(() => document.querySelector("#home-view .album"));
  const out = {};

  // An artist with no albums here: the page says so, with the name as it is.
  window.__showArtistAlbums(${JSON.stringify(NAME)});
  await until(() => document.querySelector("#album-grid .artist-view-empty"));
  await sleep(300);
  out.empty = { text: document.querySelector("#album-grid .artist-view-empty").textContent, x: !!$("x") };
  $("topbar-back").click();
  await sleep(300);

  // The server can't be asked: the error is said, its words as they are.
  const json0 = window.__artistJson;
  window.__artistJson = async () => { throw new Error(${JSON.stringify(ERROR)}); };
  window.__showArtistAlbums("Nobody Here");
  await until(() => document.querySelector('#content-count [data-parity="artist.error"]'));
  await sleep(300);
  out.error = { text: document.querySelector('#content-count [data-parity="artist.error"]').textContent, y: !!$("y") };
  window.__artistJson = json0;
  $("topbar-back").click();
  await sleep(300);

  // A label's logo search that failed, the server's error said.
  const fetch0 = window.fetch;
  window.fetch = (u, o) => String(u).startsWith("/api/labels/logo-candidates")
    ? Promise.resolve(new Response(JSON.stringify({ error: ${JSON.stringify(LOGO)} }), { status: 502, headers: { "Content-Type": "application/json" } }))
    : fetch0(u, o);
  $("labels-logo-btn").click();
  await until(() => /onerror/.test($("logo-candidates").textContent) || $("z"));
  await sleep(300);
  out.logo = { text: $("logo-candidates").textContent, z: !!$("z") };
  window.fetch = fetch0;

  out.ran = window.__ran || null;
  return out;
})()`;

test("an artist's name and the errors said beside it are shown as text, never run", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json();
      if (st.index_count >= 3 && !st.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      r = await page.eval(DRIVER);
    } finally { await b.close(); }
    assert.equal(r.empty.x, false, "the name made no element of its own");
    assert.equal(r.empty.text, `No albums found for "${NAME}"`, "the name shown as it is");
    assert.equal(r.error.y, false, "the error made no element of its own");
    assert.equal(r.error.text, "Error: " + ERROR);
    assert.equal(r.logo.z, false, "the logo search's error made no element of its own");
    assert.equal(r.logo.text, LOGO);
    assert.equal(r.ran, null, "nothing from the name or the errors ran");
  } finally { await srv.stop(); }
});
