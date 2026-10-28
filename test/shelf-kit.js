"use strict";
/*
 * The Shelf's browser tests' shared parts (test/shelf.test.js, test/shelf-album-view.test.js): the library, the fetch
 * written down and stood in for before the page's own scripts, and the helpers run in the page.
 */
const path = require("path");
const { makeLibrary, gen } = require("./fixtures");

// The library: makeLibrary's three albums (1997, 2020 and a set with no year)
// and seven more, across genres, letters and decades.
function library() {
  const lib = makeLibrary();
  const more = [["The Beatles", "Abbey Road", "Rock", 1969], ["Björk", "Homogenic", "Electronic", 1997], ["Miles Davis", "Kind of Blue", "Jazz", 1959],
    ["10cc", "The Original Soundtrack", "Rock", 1975], ["!!!", "Myth Takes", "Dance", 2007], ["Daft Punk", "Discovery", "Electronic", 2001],
    ["Nina Simone", "Pastel Blues", "Jazz", 1965]];
  for (const [artist, album, genre, year] of more) {
    gen(path.join(lib.music, artist, album, "01 x.flac"), { seconds: 1, tags: { title: album + " one", artist, album, track: 1, genre, date: String(year) } });
  }
  return lib;
}

// Before the page's own scripts: every POST written down, which server
// answered each request (window.__by), and any address answered with a
// stand-in (window.__fake) or refused (window.__fail).
const INIT = `(() => {
  window.__log = []; window.__fake = {}; window.__fail = {}; window.__by = []; window.__asked = {}; window.__heard = {};
  const real = window.fetch.bind(window);
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (init && init.method === "POST") window.__log.push({ path: url.pathname, body: init.body ? JSON.parse(init.body) : null });
    if (window.__fail[url.pathname]) return json({ error: "Refused: " + url.pathname }, window.__fail[url.pathname]);
    if (window.__fake[url.pathname]) {
      // Counted once the page has read it (window.__heard): a test waits for
      // that, not for a while, before it acts on what the page now shows.
      const k = url.pathname, n = window.__asked[k] = (window.__asked[k] || 0) + 1;
      const r = json(window.__fake[k], 200), read = r.json.bind(r);
      r.json = async () => { const v = await read(); window.__heard[k] = Math.max(window.__heard[k] || 0, n); return v; };
      return r;
    }
    const r = await real(input, init);
    window.__by.push(url.pathname + " " + (r.headers.get("x-mandarin-answered") || "Node"));
    return r;
  };
})();`;

const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = s => document.querySelector(s);
  const shown = s => { const e = $(s); return !!e && !e.classList.contains("hidden") && getComputedStyle(e).display !== "none"; };
  const posts = p => window.__log.filter(x => x.path === p).map(x => x.body);
  const poll = () => document.dispatchEvent(new Event("visibilitychange"));   // the page asks for the zone again
  // Asked again, and an answer asked for from now on read and painted: not one
  // already on its way with what was there before (a busy machine can take
  // longer than any fixed wait).
  const polled = async () => {
    const k = "/api/zone-state", n = window.__asked[k] || 0;
    poll();
    await until(() => (window.__heard[k] || 0) > n);
    await sleep(0);
  };
  const tile = (cat, label) => [...document.querySelectorAll('.tile[data-cat="' + cat + '"]')].find(t => t.textContent.includes(label));
`;

// A finger on the shelf (as Rouen's own shelf tests drive it): taps, long
// presses, the case at the front turned over, and the rows on its back.
const DRIVE = `
  const S = () => window.__shelfState();
  const stage = $("#stage");
  let pid = 20;
  const pe = (type, x, y, id) => stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
  const tap = (x, y) => { const id = ++pid; pe("pointerdown", x, y, id); pe("pointerup", x, y, id); };
  // A long press: held this long.
  const hold = async (x, y) => { const id = ++pid; pe("pointerdown", x, y, id); await sleep(650); pe("pointerup", x, y, id); await sleep(60); };
  const mid = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  // The cover on show at the front: a pooled one put away may still carry its number.
  const front = () => [...document.querySelectorAll('.it[data-v="' + Math.round(S().p) + '"]')].find(e => e.getBoundingClientRect().width > 0);
  // Turned over (item 206, Rouen v1.9.67-t5): the turn unfolds into the album view over the screen above the bar —
  // since item 218 the library's own, the page in a frame (/?embed=album): its album shown with its tracks, its
  // opening done, then a frame. In the frame: fwin(), its document fdoc(), and $f(selector).
  const ov = $("#open");
  const fwin = () => { const f = ov.querySelector("iframe"); return f ? f.contentWindow : null; };
  const fdoc = () => { const w = fwin(); return w ? w.document : null; };
  const $f = (s) => { const d = fdoc(); return d ? d.querySelector(s) : null; };
  const viewOpen = () => !ov.classList.contains("hidden") && ov.classList.contains("on");
  const albumShown = (t) => { const m = $f("#album-modal"); return !!m && !m.classList.contains("hidden") && !!$f("#modal-tracks li.t-row") && (!t || ($f("#modal-title") || {}).textContent === t); };
  const turnOver = async () => { await until(() => front(), 4000); const c = mid(front()), t = S().title; tap(c.x, c.y);
    await until(() => viewOpen() && !ov.classList.contains("loading") && albumShown(t), 20000);
    await until(() => ov.getAnimations({ subtree: false }).every(a => a.playState !== "running"), 4000); await new Promise(r => requestAnimationFrame(r)); };
  // At rest: no move under way, on a case, nothing on the shelf still moving; then a frame.
  const rest = async () => {
    await until(() => S().mode === "idle" && Math.abs(S().p - Math.round(S().p)) < 0.01 && stage.getAnimations({ subtree: true }).every(a => a.playState !== "running"), 6000);
    await new Promise(r => requestAnimationFrame(r));
  };
  // The album view's tracks, as the library's album view lists them: each its title and its length, a set's discs headed.
  const rows = () => [...fdoc().querySelectorAll("#modal-tracks li.t-row, #modal-tracks li.t-disc")].map(li => li.classList.contains("t-disc") ? "# " + li.textContent
    : li.querySelector(".t-title").textContent + (li.querySelector(".t-len") ? " " + li.querySelector(".t-len").textContent : ""));
  // What the frame asked the server to do (its own stand-in log: INIT runs in it too).
  const fposts = (path) => (fwin().__log || []).filter(x => x.path === path).map(x => x.body);
`;

module.exports = { library, INIT, HELPERS, DRIVE };
