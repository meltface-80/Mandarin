#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * os/test/in-app-update.js MANDARIN PAGE RELEASE_LOG ALBUM — the boot test's in-app update (item 398), on an installed
 * Mandarin OS: once installed, Settings → Updates is the only way Mandarin gets newer, so it is made as the page makes
 * it, and what it leaves is checked.
 *   MANDARIN     Mandarin through the firewall (http://127.0.0.1:13500), asking os/test/fake-release.js for releases
 *   PAGE         the system page (http://127.0.0.1:10080): the journal of this start, Mandarin's log, its services
 *   RELEASE_LOG  fake-release.js's output: the requests it answered
 *   ALBUM        an album the test put in Storage, in the library before the update
 * Signed in (the account made as a device makes it, test/auth-helper.js), the library scanned; Check for updates offers
 * the release, Update downloads and checks it, and Mandarin starts again as that version: the library there at once
 * and unchanged, the device still signed in and the account's password still taking, nothing more to update, the
 * service never failed nor started again by systemd, and the update's own lines in Mandarin's log. Each step a line;
 * the first that fails ends it with "FAIL: why" and exit code 1.
 */
const fs = require("fs");
const { signIn } = require("../../test/auth-helper");

const sleep = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));
class Failed extends Error {}
/** @type {(why: string) => never} */
const fail = why => { throw new Failed(why); };
const ok = (/** @type {string} */ what) => process.stdout.write(`ok: ${what}\n`);

/**
 * [fn]'s first truthy answer within [ms]; null when it never came. A request that fails is asked again.
 * @template T @param {() => Promise<T>} fn @param {number} ms @returns {Promise<T|null>}
 */
async function until(fn, ms) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not answering yet */ }
    if (Date.now() - t0 > ms) return null;
    await sleep(2000);
  }
}

/** @param {string} base @param {string} rel @param {string} [token] @param {boolean} [post] */
async function api(base, rel, token, post) {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(base + "/api/" + rel, post ? { method: "POST", headers, body: "{}" } : { headers });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/**
 * The system page's [rel] (api/logs/journal, api/state), asked again for two minutes: in a virtual machine without KVM,
 * a page busy reading the journal closed the connection without an answer once. Why, where it never answers.
 * @param {string} page @param {string} rel @returns {Promise<string>}
 */
async function pageGet(page, rel) {
  let why = "";
  const got = await until(async () => {
    try {
      const r = await fetch(`${page}/${rel}`, { signal: AbortSignal.timeout(60000) });
      if (r.status === 200) return { text: await r.text() };
      why = `HTTP ${r.status}`;
    } catch (e) { why = `${e.message}${e.cause ? ` (${e.cause.message || e.cause})` : ""}`; }
    return null;
  }, 120000);
  return got ? got.text : fail(`the system page's /${rel} didn't answer: ${why}`);
}

/**
 * The update made through [base] (Mandarin), checked through [page] (the system page) and [releaseLog], [album] in the library.
 * @param {string} base @param {string} page @param {string} releaseLog @param {string} album the album put in Storage
 */
async function run(base, page, releaseLog, album) {
  const was = (await api(base, "health")).body;
  const token = await signIn(base);
  ok(`signed in to Mandarin ${was.version}`);
  const get = async (/** @type {string} */ rel) => (await api(base, rel, token)).body;
  const titles = async () => (/** @type {{ albums: { title: string }[] }} */ (await get("library/albums?sort=album"))).albums.map(a => a.title).sort();

  // The library as it is: scanned (again, while a scan already under way, a USB drive's, missed the album), its albums.
  const scanned = await until(async () => {
    const s = await get("status");
    if (s.scan.running) return null;
    const t = await titles();
    if (t.includes(album)) return { s, t };
    await api(base, "library/rescan", token, true);
    return null;
  }, 600000);
  if (!scanned) return fail(`the library never had the album put in Storage (${album}): ${JSON.stringify((await get("status")).scan)}`);
  const before = scanned.s, albums = scanned.t;
  ok(`the library scanned: ${before.index_count} albums (${albums.join(", ")})`);

  // Settings → Updates: Check for updates, then Update, as the page asks (public/app/updater.js).
  const st = (await api(base, "update/check", token, true)).body;
  if (st.error || !st.available) fail("Check for updates offered nothing: " + JSON.stringify(st));
  const next = String(st.latest);
  ok(`Check for updates offers ${next} over ${st.current}`);
  const applied = await api(base, "update/apply", token, true);
  if (applied.status !== 200 || !applied.body.ok) fail(`Update was refused (${applied.status}): ${applied.body.error || JSON.stringify(applied.body)}`);
  ok(`Update downloaded and checked it: ${applied.body.status.apply.phase}`);

  // Back as the new version, the library there the moment it answers.
  const h = await until(async () => { const x = (await api(base, "health")).body; return x.version === next && x; }, 600000);
  if (!h) return fail(`Mandarin never came back as ${next}: ${JSON.stringify(await api(base, "health").then(r => r.body, e => e.message))}`);
  if (!h.ok) fail("Mandarin came back unwell: " + JSON.stringify(h));
  if (h.albums !== before.index_count) fail(`Mandarin came back with ${h.albums} albums, not ${before.index_count}`);
  ok(`Mandarin answers as ${h.version}, ${h.albums} albums at once`);

  // Its data as it was: still signed in, the password still taking, the library unchanged, nothing more to update.
  const status = await api(base, "status", token);
  if (status.status !== 200) fail(`the device was signed out by the update (${status.status})`);
  if (status.body.index_count !== before.index_count) fail(`the library has ${status.body.index_count} albums, not ${before.index_count}`);
  const after = await titles();
  if (JSON.stringify(after) !== JSON.stringify(albums)) fail(`the albums changed: ${after.join(", ")}`);
  await signIn(base, { create: false });
  const now = (await api(base, "update/status", token)).body;
  if (now.current !== next || now.available) fail("Mandarin still has an update to make: " + JSON.stringify(now));
  ok("the library, the account and the device's sign-in kept; nothing more to update");

  // What it took: each file of the release, once checked (the bundle and the program each with its signature).
  const asked = fs.readFileSync(releaseLog, "utf8");
  for (const f of [`musicd-server-${next}.tar.gz`, `musicd-server-${next}.tar.gz.sig`, "mandarin-server-linux-x64.gz", "mandarin-server-linux-x64.gz.sig", "mandarin-server.sha256"]) {
    if (!asked.includes(`GET /dl/${f} 200`)) fail(`the release's ${f} was never downloaded:\n${asked}`);
  }
  ok("the release's bundle, program, sums and both signatures downloaded");

  // Started again in its own process, as the update does it (Server.StartAgain): systemd never saw it fail or stop.
  const journal = await pageGet(page, "api/logs/journal");
  const bad = journal.split("\n").filter(l => /mandarin\.service: (Main process exited|Failed with result|Scheduled restart job|Start request repeated)|mandarin-server.*(segfault|core dumped)/.test(l));
  if (bad.length) fail("the journal says Mandarin's service failed:\n" + bad.join("\n"));
  const state = JSON.parse(await pageGet(page, "api/state"));
  const unit = state.services.find((/** @type {{ unit: string }} */ s) => s.unit === "mandarin.service");
  if (!unit || unit.state !== "active") fail("the system page says mandarin.service isn't running: " + JSON.stringify(unit));
  if (state.mandarin.version !== next) fail(`the system page sees Mandarin ${state.mandarin.version}, not ${next}`);
  const log = await pageGet(page, "api/logs/mandarin");
  for (const said of [`[update] the C# server ${next} is in place`, "[server] starting again from ", `Mandarin's server ${next} (C#)`]) {
    if (!log.includes(said)) fail(`Mandarin's log never says "${said}":\n${log.split("\n").filter(l => /update|server\]/.test(l)).slice(-30).join("\n")}`);
  }
  ok("started again in its own process: nothing failed in the journal, its service running, the update in its log");
}

if (require.main === module) {
  const [base, page, releaseLog, album] = process.argv.slice(2);
  run(base, page, releaseLog, album).then(() => process.exit(0), e => {
    console.log("FAIL: " + (e instanceof Failed ? e.message : `${e.stack}${e.cause ? `\n  cause: ${e.cause.stack || e.cause}` : ""}`));
    process.exit(1);
  });
}

module.exports = { run };
