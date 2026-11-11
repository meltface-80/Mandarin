"use strict";
/*
 * The album view on a tablet (v0.7.8) and a phone, in a browser at iPad sizes
 * and a phone's, as the sleeve has it (bug list item 24): the cover a 160px
 * sleeve with the title and the artist line beside it, the buttons and the
 * tracks under both, the cover's glow behind the top:
 *   - every item of the ⋯ menu is on screen and can be tapped. The button row
 *     is near the top now, so the menu opens downwards, over the tracks (it
 *     opened upwards, and from 720px up it rose past the panel's top edge,
 *     where the panel clips it: reported from an iPad);
 *   - scrolled so the row is near the top, it still opens downwards;
 *   - the head a line each beside the sleeve (item 28): the title, the
 *     artists, the date, then the rate and the album's length; its label at
 *     the head of About (item 349);
 *   - from 720px up About this album sits beside the tracks;
 *   - on a phone held upright (item 349): the cover centred on top, the date,
 *     rate and length centred under it, the title across the page, then the
 *     tabs (Tracks, Credits, About), the tracks the one open, the review About's;
 *     no Tracks or Credits heading under the tabs that say them (item 355); no bar behind the tabs in their place,
 *     their row filled only while held at the top as the page scrolls (item 358);
 *   - a tablet held sideways (item 214): the album in three columns, the
 *     cover, its head and its buttons on the left, the tracks on the right;
 *     still the whole ⋯ menu on screen, every item tapped.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
  await until(() => document.querySelector("#home-view .album"));
  const al = (await (await fetch("/api/library/albums?sort=album")).json()).albums.find(a => a.title === "Album One");
  window.__openAlbum(al, {});
  // The album's details in (the button row is drawn again with them, then its tracks and total time), then a frame.
  await until(() => document.querySelector("#modal-actions .overflow-wrap .overflow-btn") && $("modal-tracks").querySelectorAll("li").length === 3 && $("modal-total").textContent);
  await new Promise(r => requestAnimationFrame(r));
  // Eleven tracks and a review, as the album in the report has (the fixture
  // has three tracks, and no review without the network).
  const ol = $("modal-tracks"), row = ol.querySelector("li");
  for (let i = 0; i < 8; i++) ol.appendChild(row.cloneNode(true));
  $("album-bio-section").classList.remove("hidden");
  // Expanded (Show more): long, and it must grow downwards from under the cover.
  $("album-bio-text").textContent = "Late Developers is the twelfth studio album by the Scottish indie pop band Belle and Sebastian. ".repeat(12);
  $("album-bio-text").dataset.clipped = "false";
  // Laid out, any transition of the section's done: the album view's own (Home's unheard disc turns behind it, item 167).
  await until(() => $("album-modal").getAnimations({ subtree: true }).every(a => a.playState === "finished" || a.effect.getTiming().iterations === Infinity));
  await new Promise(r => requestAnimationFrame(r));
  const body = document.querySelector("#album-modal .modal-body");
  const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const open = async () => {
    const btn = document.querySelector("#modal-actions .overflow-wrap .overflow-btn");
    btn.click();
    // The menu open and done moving, then a frame: each item is measured where it rests.
    const menu = await until(() => { const m = document.querySelector("#modal-actions .overflow-wrap .overflow-menu"); return m && m.getBoundingClientRect().height > 0 && m.getAnimations({ subtree: true }).every(a => a.playState === "finished") && m; });
    await new Promise(r => requestAnimationFrame(r));
    const items = [...menu.querySelectorAll(".sel-menu-item")];
    // Each item really the thing at its own centre: on screen, not clipped, not covered.
    const hit = items.map(b => { const x = b.getBoundingClientRect(); const e = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return !!e && (e === b || b.contains(e)); });
    const r = { items: items.map(b => b.textContent), hit, menu: box(menu), down: menu.getBoundingClientRect().top >= btn.getBoundingClientRect().bottom };
    btn.click(); await sleep(60);
    return r;
  };
  const out = { wide: $("album-modal").classList.contains("album-wide") };
  body.scrollTop = 0; await new Promise(r => requestAnimationFrame(r));
  out.rest = await open();
  out.panel = box(document.querySelector("#album-modal .modal-panel"));
  out.share = box($("modal-share-btn"));
  out.art = box(document.querySelector("#album-modal .modal-art"));
  out.bio = box($("album-bio-section"));
  out.title = box($("modal-title"));
  out.tracks = box(document.querySelector(".track-list-wrap"));
  const glow = $("modal-ambient");
  out.glow = { shown: getComputedStyle(glow).display !== "none" && glow.getBoundingClientRect().height > 0, src: glow.getAttribute("src") || "" };
  out.hscroll = body.scrollWidth > body.clientWidth;
  out.viewport = [innerWidth, innerHeight];
  // The head, a line each beside the sleeve: the title, the artists, the date (the label after it),
  // then the rate and the album's length. The fixture has no date or label: given one, as the server's extras would.
  renderExtras({ release_date: "2006-11-20", album: { label: "RCA" } }, al);
  $("modal-quality").className = "album-quality"; $("modal-quality").textContent = "16/44.1";
  await new Promise(r => requestAnimationFrame(r));
  out.total = $("modal-total").textContent;
  out.head = ["modal-title", "modal-subtitle", "modal-date", "modal-facts"].map(id => Object.assign(box($(id)), { text: $(id).textContent.replace(/\\s+/g, " ").trim() }));
  out.headArt = box(document.querySelector("#album-modal .modal-art"));
  out.tracksHead = document.querySelector(".tracks-head").textContent.trim();
  // Which of the Tracks and Credits headings are drawn (item 355): on a phone the tabs say them.
  out.heads = [".tracks-head", "#album-credits > .section-label"].map(s => getComputedStyle(document.querySelector(s)).display !== "none");
  out.label = $("album-about-facts").textContent.trim();
  out.tabs = [...document.querySelectorAll("#album-tabs .album-tab")].filter(t => getComputedStyle(t).display !== "none" && t.getBoundingClientRect().height > 0).map(t => t.textContent.trim());
  // The tabs' row filled only while held at the top as the page scrolls (item 358): in its place, nothing behind it.
  const tabsEl = $("album-tabs");
  out.tabsRest = getComputedStyle(tabsEl).backgroundColor;
  // Long enough to scroll the tabs to the top (the fixture's tracks aren't): rows added under the tracks for this alone.
  const extra = [...Array(20)].map(() => ol.appendChild(row.cloneNode(true)));
  body.scrollTop = tabsEl.offsetTop + 400; await sleep(300);
  out.tabsHeld = [getComputedStyle(tabsEl).backgroundColor, getComputedStyle(document.body).backgroundColor, Math.round(tabsEl.getBoundingClientRect().top - $("modal-actions").getBoundingClientRect().bottom)];
  // Held, what scrolls past is cut off at the line under the tabs (item 375): the tracks' cut where the line crosses them.
  { const wrap = document.querySelector(".track-list-wrap"), t = tabsEl.getBoundingClientRect();
    out.cutHeld = { clip: wrap.style.clipPath, want: Math.ceil(t.bottom - wrap.getBoundingClientRect().top), head: $("modal-actions").style.clipPath, tabs: tabsEl.style.clipPath }; }
  body.scrollTop = 0; await sleep(300);
  extra.forEach(e => e.remove());
  out.tabsBack = getComputedStyle(tabsEl).backgroundColor;
  out.cutBack = [...document.querySelectorAll("#album-modal .modal-body *")].filter(e => e.style.clipPath).map(e => e.id || e.className);
  // Centred, clear of Back (item 373): the shown tabs' extent, the first's left edge, and Back's right.
  { const shownTabs = [...tabsEl.querySelectorAll(".album-tab")].filter(x => x.getBoundingClientRect().width > 0).map(x => x.getBoundingClientRect());
    if (shownTabs.length) out.tabsBox = { l: shownTabs[0].left, r: shownTabs[shownTabs.length - 1].right, first: shownTabs[0].left };
    out.backR = $("modal-close-btn").getBoundingClientRect().right; }
  // Scrolled so the button row is near the top of the panel.
  const rowTop = $("modal-actions").getBoundingClientRect().top - body.getBoundingClientRect().top;
  body.scrollTop = Math.max(0, rowTop - 60); await new Promise(r => requestAnimationFrame(r));
  out.scrolledBy = body.scrollTop;
  out.scrolled = await open();
  return out;
})()`;

test("the album view on a tablet and a phone: a 160px sleeve, the title beside it, the whole ⋯ menu on screen", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json(); if (st.index_count === 3) break; await new Promise(r => setTimeout(r, 100)); }
    for (const [w, h, tablet] of [[1180, 820, true], [820, 1180, true], [390, 844, false]]) {
      const size = `${w}x${h}`;
      const b = await Browser.launch({ width: w, height: h });
      let r;
      try {
        // A touch screen, as a tablet or a phone is.
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
        r = await page.eval(DRIVER);
        assert.deepEqual(page.errors, [], size);
      } finally { await b.close(); }
      assert.ok(r.rest.items.length >= 4, size + ": the menu has its items: " + r.rest.items.join(", "));
      // Share card straight after Listen later.
      assert.equal(r.rest.items[r.rest.items.indexOf("Listen later") + 1], "Share card", size + ": Share card under Listen later: " + r.rest.items.join(", "));
      assert.ok(r.rest.hit.every(Boolean), `${size}: every item can be tapped (${r.rest.items.map((t, i) => (r.rest.hit[i] ? "✓ " : "✗ ") + t).join(", ")})`);
      assert.ok(r.rest.menu.t >= r.panel.t, `${size}: the menu's top (${r.rest.menu.t}) is inside the panel (${r.panel.t})`);
      if (r.wide) {
        // Item 214: three columns. The cover over the head on the left, the tracks on the right; the menu on screen.
        assert.ok(w > h, size + ": three columns held sideways only");
        assert.ok(r.rest.menu.b <= h && r.rest.menu.t >= r.share.b, `${size}: the whole menu on screen, clear of Share (${JSON.stringify(r.rest.menu)})`);
        assert.ok(r.title.t >= r.art.b && r.title.l < r.art.r, `${size}: the title under the cover (title ${JSON.stringify(r.title)}, art ${JSON.stringify(r.art)})`);
        assert.ok(r.tracks.l > r.title.r && r.tracks.l > r.art.r, `${size}: the tracks on the right (${JSON.stringify(r.tracks)})`);
        assert.ok(r.bio.l > r.art.r && r.bio.r < r.tracks.l, `${size}: About this album between them (${JSON.stringify(r.bio)})`);
        assert.equal(r.hscroll, false, size + ": no sideways scroll");
        continue;
      }
      // A tablet's row is near the top, so the menu opens downwards; a phone's sits under the cover now (item 349),
      // and it opens whichever way has the room, clear of the mini player: every item tapped either way (above).
      if (tablet) assert.equal(r.rest.down, true, size + ": at rest it opens downwards, the row near the top");
      assert.ok(r.rest.menu.t >= r.share.b, `${size}: the menu (${r.rest.menu.t}) stays clear of Share (${r.share.b})`);
      assert.equal(r.label, "RCA", size + ": its label at the head of About (item 349)");
      if (!tablet) {
        // A phone held upright (item 349): the cover centred on top, two thirds of the page; the date, rate and length
        // centred under it; the title across the page under them; the tabs, the tracks the one open, the review About's.
        const [title, artist, date, facts] = r.head;
        const mid = r.viewport[0] / 2;
        assert.ok(Math.abs(r.art.r - r.art.l - Math.min(r.viewport[0] * 0.67, 300)) < 2, `${size}: the cover two thirds of the page (${r.art.r - r.art.l})`);
        assert.ok(Math.abs((r.art.l + r.art.r) / 2 - mid) < 2, `${size}: the cover centred (${JSON.stringify(r.art)})`);
        assert.match(date.text, /^\S.*2006$/, size + ": the date alone");
        assert.equal(facts.text, "16/44.1 " + r.total, size + ": the rate and the length (the dots between them drawn by style.css)");
        assert.ok(date.t >= r.art.b && Math.abs(date.t - facts.t) < 6, `${size}: the date and the facts on one line under the cover (${JSON.stringify([date, facts])})`);
        assert.ok(Math.abs((date.l + facts.r) / 2 - mid) < 3, `${size}: that line centred (${date.l}–${facts.r})`);
        assert.ok(title.t >= facts.b && title.l < r.art.l && artist.t >= title.b - 1, `${size}: the title across the page under them, the artists under it (${JSON.stringify([title, artist])})`);
        assert.deepEqual(r.tabs, ["Tracks", "Credits", "About"], size + ": the tabs, no Versions for an album of one");
        assert.equal(r.tabsRest, "rgba(0, 0, 0, 0)", size + ": no bar behind the tabs in their place (item 358)");
        assert.ok(r.tabsHeld[2] > 30, size + ": scrolled, the tabs held at the top, the buttons gone up past them (" + r.tabsHeld[2] + ")");
        assert.equal(r.tabsHeld[0], "rgba(0, 0, 0, 0)", size + ": held at the top, still no bar behind them (item 373)");
        assert.equal(r.tabsBack, "rgba(0, 0, 0, 0)", size + ": back in their place, no bar");
        assert.equal(r.cutHeld.clip, `inset(${r.cutHeld.want}px 0px 0px)`, size + ": held, the tracks cut off at the line under the tabs (item 375): " + JSON.stringify(r.cutHeld));
        assert.match(r.cutHeld.head, /^inset\(\d+px 0px 0px\)$/, size + ": and the buttons gone up past it");
        assert.equal(r.cutHeld.tabs, "", size + ": the tabs themselves never cut");
        assert.deepEqual(r.cutBack, [], size + ": back in their place, nothing cut");
        assert.ok(Math.abs((r.tabsBox.l + r.tabsBox.r) / 2 - r.viewport[0] / 2) < 2, size + ": the tabs centred (item 373): " + JSON.stringify(r.tabsBox));
        assert.ok(r.tabsBox.first >= r.backR, size + ": the first tab clear of Back at the corner (" + r.tabsBox.first + " from " + r.backR + ")");
        assert.ok(r.tracks.t > title.b, `${size}: the tracks under the head (${r.tracks.t})`);
        assert.ok(r.bio.b - r.bio.t === 0, `${size}: the review About's, not shown on Tracks (${JSON.stringify(r.bio)})`);
        assert.equal(r.tracksHead, "Tracks", size + ": the Tracks line");
        assert.deepEqual(r.heads, [false, false], size + ": no Tracks or Credits heading under the tabs that say them (item 355)");
        assert.equal(r.hscroll, false, size + ": no sideways scroll");
        continue;
      }
      // The sleeve: 160px, the title and the artist line beside it, the tracks under it.
      assert.ok(Math.abs(r.art.r - r.art.l - 160) < 1, `${size}: the cover a 160px sleeve (${r.art.r - r.art.l})`);
      assert.ok(r.title.l > r.art.r && r.title.t < r.art.b, `${size}: the title beside the sleeve (title ${JSON.stringify(r.title)}, art ${JSON.stringify(r.art)})`);
      assert.ok(r.tracks.t > r.art.b, `${size}: the tracks under the sleeve (${r.tracks.t}, sleeve ends ${r.art.b})`);
      assert.ok(r.glow.shown && /size=96/.test(r.glow.src), `${size}: the cover's glow behind the top (${JSON.stringify(r.glow)})`);
      assert.equal(r.hscroll, false, size + ": no sideways scroll");
      assert.match(r.total, /^\d+:\d\d$/, size + ": the album's total time is shown: " + r.total);
      const [title, artist, date, facts] = r.head;
      assert.equal(artist.text, "Artist A", size + ": the artists");
      assert.match(date.text, /^\S.*2006$/, size + ": the date; its label About's (item 349)");
      assert.equal(facts.text, "16/44.1 " + r.total, size + ": the rate and the length");
      for (let i = 1; i < r.head.length; i++) assert.ok(r.head[i].t >= r.head[i - 1].b - 1, `${size}: a line each, in order (${JSON.stringify(r.head)})`);
      for (const line of r.head) assert.ok(line.l > r.headArt.r, `${size}: beside the sleeve (${JSON.stringify(line)})`);
      assert.ok(r.headArt.b - facts.b >= 0 && r.headArt.b - facts.b <= 6, `${size}: the last line at the sleeve's foot (${facts.b}, ${r.headArt.b})`);
      assert.ok(title.b - title.t < 40 && artist.b - artist.t < 26 && date.b - date.t < 26, size + ": the title and each line one line high");
      assert.equal(r.tracksHead, "Tracks", size + ": the Tracks line, the total gone from it");
      assert.deepEqual(r.heads, [true, true], size + ": the Tracks and Credits headings, there being no tabs");
      assert.ok(r.panel.l <= 0 && r.panel.t <= 0 && r.panel.r >= r.viewport[0] && r.panel.b >= r.viewport[1], `${size}: the album view fills the screen, not a card (${JSON.stringify(r.panel)})`);
      if (tablet) {
        assert.ok(r.bio.l >= r.tracks.r && r.bio.t < r.tracks.b, `${size}: About this album beside the tracks (tracks ${JSON.stringify(r.tracks)}, review ${JSON.stringify(r.bio)})`);
        // Landscape is too short for eleven tracks, so it scrolls; portrait holds them all.
        if (w > h) assert.ok(r.scrolledBy > 0, size + ": the page scrolls (eleven tracks)");
        if (r.scrolledBy > 0) {
          assert.ok(r.scrolled.hit.every(Boolean), `${size}: scrolled, every item can still be tapped (${r.scrolled.hit.join(",")})`);
          assert.equal(r.scrolled.down, true, size + ": scrolled with no room above, it opens downwards");
        }
      }
    }
  } finally { await srv.stop(); }
});

test("the app's album tabs: centred, clear of Back, never a bar behind them; held, the page cut off under them (items 358, 373, 375)", () => {
  const fs = require("fs"), path = require("path");
  const phone = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/AlbumPhone.kt"), "utf8");
  const screen = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/AlbumScreen.kt"), "utf8");
  const row = phone.slice(phone.indexOf("internal fun AlbumTabRow("), phone.indexOf("ALBUM_TABS.forEachIndexed"));
  assert.doesNotMatch(row, /\.background\(/, "never a bar behind them, held or not");
  assert.match(row, /padding\(horizontal = 44\.dp\)/, "room at each side for Back at the corner");
  assert.match(row, /Arrangement\.spacedBy\(18\.dp, Alignment\.CenterHorizontally\)/, "centred");
  // Held at the top (item 375): the same row laid over the page there, the page cut off at the line under it, the whole
  // width, so above it is the page's own background and glow, never a bar, and the tracks never show through.
  assert.doesNotMatch(phone, /stickyHeader/, "not held by the list, which would draw the tracks behind them");
  assert.match(phone, /item\(key = TABS_KEY\) \{ AlbumTabRow\(tab, versions, scroll, onTab\) \}/, "in their place in the page");
  assert.match(phone, /clipRect\(top = l\.toFloat\(\)\) \{ this@drawWithContent\.drawContent\(\) \}/, "the page cut off at the line");
  assert.match(phone, /t\.offset <= info\.viewportStartOffset && list\.canScrollBackward/, "held once the tabs reach the top");
  assert.match(screen, /LazyColumn\(Modifier\.fillMaxSize\(\)\.clipUnderTabs\(held\)\.padding\(horizontal = 18\.dp\)/, "cut the whole width, before the page's side padding");
  assert.match(screen, /phoneTabs\(tab, a\.versions\.size, tabsScroll\)[\s\S]*HeldTabs\(held, tab, a\.versions\.size, tabsScroll\)/, "the held row over the page, after it");
  // No Share, previous or next at the corner (item 373): Share card in the ⋯.
  assert.doesNotMatch(screen, /NavDiscs|parity\("album\.share"/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/AlbumHeadParts.kt"), "utf8"), /parity\("album\.share", Contract\.label\("album\.share"\)\)[\s\S]{0,40}onClick = \{ open = false; onPage\("share", null\) \}/);
});
