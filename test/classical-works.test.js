"use strict";
/*
 * A classical album's page (bug list item 49), set out as works and
 * movements as the server answers them (item 48): the composers' line in
 * the artists' place and who performs it under them, WORKS over the list,
 * a work's row with its ring, its movements indented under it with their
 * numbers, a one-track work its own row, and the work's row opening Play
 * now, Play next and Queue; and the page keeping the screens contract on
 * such an album too (the app's AlbumWorks.kt is held to the same items).
 * Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { gen } = require("./fixtures");
const { started, until } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");
const contract = require("../docs/specs/screens.json");
const { CHECK } = require("./parity-check");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

const KIT = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = e => !!e && !e.classList.contains("hidden") && e.getClientRects().length > 0;
  const $ = s => document.querySelector(s);`;

/* The quartets opened from Home's Library row. */
const OPEN = `(async () => { ${KIT}
  const tile = () => [...document.querySelectorAll("#home-library .album")].find(t => /String Quartets/.test(t.textContent));
  if (!(await until(() => tile()))) return "no album on Home";
  await sleep(300);
  tile().click();
  if (!(await until(() => document.querySelectorAll("#modal-tracks li.t-work").length === 2 && $("#modal-actions .overflow-btn")))) return "no works";
  await sleep(500);
  return "open";
})()`;

/* What the page shows of it. */
const READ = `(() => { ${KIT}
  return {
    composers: ($("#modal-composers") || {}).textContent, performers: ($("#modal-performers") || {}).textContent,
    artistLine: shown($("#modal-subtitle")),
    head: $(".tracks-head span").textContent,
    rows: [...document.querySelectorAll("#modal-tracks li")].map(li => [li.className, (li.querySelector(".t-title") || li).textContent.trim(), ((li.querySelector(".t-len") || {}).textContent || "").trim(), ((li.querySelector(".t-sub") || {}).textContent || "").trim()]),
    rings: [...document.querySelectorAll("#modal-tracks .t-work-play")].map(b => b.getAttribute("aria-label")),
  };
})()`;

/* The second work's row tapped: its buttons; tapped again: closed. */
const TAP = `(async () => { ${KIT}
  const rows = document.querySelectorAll("#modal-tracks li.t-work");
  rows[1].click(); await sleep(300);
  const out = { buttons: [...document.querySelectorAll("#modal-tracks li.t-work.is-open .t-actions button")].map(b => b.textContent), open: document.querySelectorAll("#modal-tracks li.is-open").length };
  rows[1].click(); await sleep(300);
  out.after = document.querySelectorAll("#modal-tracks li.is-open").length;
  return out;
})()`;

test("a classical album's page: works and movements, the composers' line, and the contract kept on it", { skip, timeout: 240000 }, async (t) => {
  const { lib, base, token, api } = await started(t);
  // A quartet on one track, and one of two movements, tagged as Picard tags them.
  const dir = path.join(lib.music, "Henryk Górecki", "String Quartets");
  const q2 = "String Quartet No. 2, Op. 64";
  const tags = (i, title, work, more) => Object.assign({ title, artist: "Kronos Quartet", album: "String Quartets", track: i, date: "1993", genre: "Classical",
    composer: "Henryk Górecki", work, performer: "Kronos Quartet" }, more || {});
  gen(path.join(dir, "01.flac"), { seconds: 1, freq: 300, tags: tags(1, "String Quartet No. 1, Op. 62", "String Quartet No. 1, Op. 62") });
  gen(path.join(dir, "02.flac"), { seconds: 1, freq: 350, tags: tags(2, q2 + ": I. Largo sostenuto", q2, { movementname: "Largo sostenuto", movement: 1 }) });
  gen(path.join(dir, "03.flac"), { seconds: 1, freq: 400, tags: tags(3, q2 + ": II. Deciso", q2, { movementname: "Deciso", movement: 2 }) });
  await api("library/rescan", {});
  await until(async () => {
    const s = (await api("status")).json;
    return s && !(s.scan && s.scan.running) && ((await api("library/albums?count=100")).json.albums || []).some(a => a.title === "String Quartets");
  }, 30000, "the quartets scanned");

  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true });
  assert.equal(await page.eval(OPEN), "open");
  const r = await page.eval(READ);
  assert.deepEqual(page.errors, [], "nothing thrown");
  assert.equal(r.composers, "Henryk Górecki", "the composer where the artists go");
  assert.equal(r.performers, "Kronos Quartet", "who performs it, under");
  assert.equal(r.artistLine, false, "the artists' line stands down");
  assert.equal(r.head, "Works");
  assert.deepEqual(r.rows, [
    ["t-row t-work", "String Quartet No. 1, Op. 62", "0:01", "Kronos Quartet"],
    ["t-row t-work", q2, "0:02", "Kronos Quartet"],
    ["t-row t-movement", "I. Largo sostenuto", "0:01", ""],
    ["t-row t-movement", "II. Deciso", "0:01", ""],
  ], "a one-track work its own row; the other's movements under it, numbered");
  assert.deepEqual(r.rings, ["Play String Quartet No. 1, Op. 62", "Play " + q2]);
  assert.deepEqual(await page.eval(TAP), { buttons: ["Play now", "Play next", "Queue"], open: 1, after: 0 });
  const wrong = await page.eval(CHECK("album", contract.screens.album.items, "#album-modal .modal-panel"));
  assert.deepEqual(wrong, [], "the page and the contract differ on a classical album:\n  " + wrong.join("\n  "));
});
