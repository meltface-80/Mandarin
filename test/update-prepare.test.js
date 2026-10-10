"use strict";
/*
 * An update from Settings brings what has to come with it before it stages
 * anything (v0.8.29, lib/updater.js beforeApply): the C# server of the version
 * being installed (lib/server/csharp-update.js prepare). It is handed that
 * version once the download is unpacked and checked, before READY is written;
 * if it can't be had, the update stops there with its reason and nothing is
 * staged. (Through the C# server's own fetch, test/csharp-update.test.js.)
 */
const FAKE = 3679;
process.env.UPDATE_API = "http://127.0.0.1:" + FAKE;

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");
const { createUpdater } = require("../lib/updater");

test("an update stops before staging anything when what has to come with it can't be had", { timeout: 30000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-prepare-"));
  const app = path.join(tmp, "app");
  fs.mkdirSync(app);
  // A release of 9.9.9, its bundle as release.yml makes it (index.js and package.json are what's checked).
  const bundle = path.join(tmp, "bundle", "musicd-server");
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, "index.js"), "// 9.9.9\n");
  fs.writeFileSync(path.join(bundle, "package.json"), JSON.stringify({ name: "musicd-server", version: "9.9.9" }));
  const tarball = path.join(tmp, "musicd-server-9.9.9.tar.gz");
  execFileSync("tar", ["-C", path.join(tmp, "bundle"), "-czf", tarball, "musicd-server"]);
  const gh = http.createServer((req, res) => {
    const base = "http://127.0.0.1:" + FAKE;
    if (req.url === "/repos/me/musicd/releases/latest") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ tag_name: "v9.9.9", assets: [{ name: "musicd-server-9.9.9.tar.gz", browser_download_url: base + "/dl" }] }));
    }
    if (req.url === "/dl") return fs.createReadStream(tarball).pipe(res);
    res.statusCode = 404; res.end("{}");
  });
  await new Promise(r => gh.listen(FAKE, "127.0.0.1", r));
  t.after(() => new Promise(r => gh.close(r)));

  const make = (beforeApply) => createUpdater({ owner: "me", repo: "musicd", currentVersion: "9.9.8", packageName: "musicd-server", dir: app, viaLauncher: true, beforeApply });
  const ready = () => fs.existsSync(path.join(app, ".update", "READY"));

  await t.test("handed the version being installed, once the download is unpacked and checked, before anything is staged", async () => {
    const seen = [];
    const u = make(async (version) => {
      seen.push({ version, unpacked: fs.existsSync(path.join(app, ".update", "extract", "musicd-server", "index.js")), ready: ready(), phase: u.getStatus().apply.phase });
      // Stopped here, or the updater would end this process for its restart.
      throw new Error("the C# server 9.9.9 couldn't be fetched (release v9.9.9 carries no mandarin-server-linux-x64.gz); nothing was changed");
    });
    const st = await u.apply();
    assert.deepEqual(seen, [{ version: "9.9.9", unpacked: true, ready: false, phase: "preparing" }]);
    assert.equal(st.apply.phase, "error");
    assert.match(st.apply.error, /^the C# server 9\.9\.9 couldn't be fetched .*; nothing was changed$/, "its reason, as Settings shows it");
    assert.equal(ready(), false, "nothing staged for the launcher");
    assert.equal(st.apply.version, "9.9.9");
  });

  await t.test("tried again from Settings: asked again", async () => {
    let asked = 0;
    const u = make(async () => { asked++; throw new Error("still not there"); });
    await u.apply();
    const st = await u.apply();
    assert.equal(asked, 2, "an update that stopped can be tried again");
    assert.equal(st.apply.error, "still not there");
    assert.equal(ready(), false);
  });
});
