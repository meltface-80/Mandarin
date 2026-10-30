"use strict";
/*
 * .github/publish-apk.sh: the Android app built on a push to main,
 * put in dist/ through a pull request the workflow opens and merges. Run here
 * as android.yml runs it, on the commit the app was built from, against a
 * repository of its own (a bare one for origin) with gh stood in by a script
 * that writes down what it is asked.
 *
 * Two merges close together: the later merge's run ended first, or the
 * earlier's publish reached main after the later merge. The commit is made on
 * main as it is now, so its pull request merges; main already carrying a
 * newer version is left as it is.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", ".github", "publish-apk.sh");

/* A repository at version [v], its app [had] in dist/, pushed to a bare origin; gh written down. */
function repo(v, had) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-apk-"));
  const origin = path.join(root, "origin.git"), work = path.join(root, "work"), bin = path.join(root, "bin");
  const git = (...a) => execFileSync("git", a, { cwd: work, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, work], { stdio: "ignore" });
  git("config", "user.name", "t"); git("config", "user.email", "t@t");
  const version = (x, code) => {
    fs.mkdirSync(path.join(work, "android", "app"), { recursive: true });
    fs.writeFileSync(path.join(work, "android", "app", "build.gradle.kts"), (code ? `        versionCode = ${code}\n` : "") + `        versionName = "${x}"\n`);
  };
  const publish = (x) => {
    fs.mkdirSync(path.join(work, "dist"), { recursive: true });
    fs.writeFileSync(path.join(work, "dist", "mandarin-android.apk"), "apk " + x);
    fs.writeFileSync(path.join(work, "dist", "latest.json"), `{\n  "version": "${x}",\n  "file": "Mandarin-Android-${x}.apk"\n}\n`);
  };
  version(v); publish(had);
  git("add", "-A"); git("commit", "-q", "-m", "start"); git("push", "-q", "origin", "main");
  fs.mkdirSync(bin);
  const log = path.join(root, "gh.log");
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$2" in create) echo https://pr/1 ;; esac\n`, { mode: 0o755 });
  return {
    git, version, publish, origin, work,
    /* The script on the commit checked out, the app built at [apk]; its output. */
    run(apk) {
      return execFileSync(SCRIPT, [apk], { cwd: work, encoding: "utf8",
        env: { ...process.env, PATH: bin + ":" + process.env.PATH, GITHUB_REF_NAME: "main", GITHUB_SHA: git("rev-parse", "HEAD"), GITHUB_REPOSITORY: "o/r" } });
    },
    gh: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []),
    /* The app built, as the workflow leaves it. */
    built(x) { const f = path.join(work, "android", `Mandarin-Android-${x}.apk`); fs.writeFileSync(f, "built " + x); return f; },
    on: (ref, file) => execFileSync("git", ["--git-dir", origin, "show", `${ref}:${file}`], { encoding: "utf8" }),
    branches: () => execFileSync("git", ["--git-dir", origin, "branch", "--format=%(refname:short)"], { encoding: "utf8" }).trim().split("\n")
  };
}

test("main moved on after the commit built (another version's app published): the pull request is made on main as it is, and merges", () => {
  const r = repo("1.0.16", "1.0.15");
  // The merge the app is built from…
  r.version("1.0.17"); r.git("commit", "-q", "-am", "v1.0.17"); r.git("push", "-q", "origin", "main");
  const built = r.git("rev-parse", "HEAD");
  // …then the earlier merge's run publishes its app on main.
  r.publish("1.0.16"); r.git("commit", "-q", "-am", "Publish 1.0.16"); r.git("push", "-q", "origin", "main");
  const main = r.git("rev-parse", "HEAD");
  r.git("checkout", "-q", "--detach", built);
  r.run(r.built("1.0.17"));
  assert.ok(r.branches().includes("publish-apk/1.0.17"), "the branch pushed");
  const parent = execFileSync("git", ["--git-dir", r.origin, "rev-parse", "publish-apk/1.0.17^"], { encoding: "utf8" }).trim();
  assert.equal(parent, main, "made on main as it is now, so it merges without a conflict");
  assert.equal(r.on("publish-apk/1.0.17", "dist/mandarin-android.apk"), "built 1.0.17");
  const latest = JSON.parse(r.on("publish-apk/1.0.17", "dist/latest.json"));
  assert.equal(latest.version, "1.0.17");
  assert.equal(latest.file, "Mandarin-Android-1.0.17.apk");
  assert.equal(latest.sha256, crypto.createHash("sha256").update("built 1.0.17").digest("hex"));
  assert.equal(r.on("publish-apk/1.0.17", "android/app/build.gradle.kts").trim(), 'versionName = "1.0.17"', "main's own files, as they are");
  assert.deepEqual(r.gh().map(l => l.split(" ").slice(0, 2).join(" ")), ["pr list", "pr create", "pr merge"]);
});

test("main already carries a newer version's app (the later merge's run ended first): left as it is", () => {
  const r = repo("1.0.16", "1.0.15");
  const built = r.git("rev-parse", "HEAD");
  r.version("1.0.17"); r.publish("1.0.17"); r.git("commit", "-q", "-am", "v1.0.17 and its app"); r.git("push", "-q", "origin", "main");
  r.git("checkout", "-q", "--detach", built);
  assert.match(r.run(r.built("1.0.16")), /already carries 1\.0\.17, newer than 1\.0\.16/);
  assert.ok(!r.branches().includes("publish-apk/1.0.16"), "nothing pushed");
  assert.deepEqual(r.gh(), [], "no pull request");
  assert.match(r.on("main", "dist/latest.json"), /"version": "1\.0\.17"/);
});

test("main already carries this version's app (a run again): nothing done", () => {
  const r = repo("1.0.17", "1.0.17");
  assert.match(r.run(r.built("1.0.17")), /1\.0\.17 already published/);
  assert.deepEqual(r.gh(), []);
});

test("the same version built again with a higher versionCode (a fix folded into it, item 115): published over it, its code said", () => {
  const r = repo("1.1.0", "1.1.0");
  r.version("1.1.0", 326);
  fs.writeFileSync(path.join(r.work, "dist", "latest.json"), '{\n  "version": "1.1.0",\n  "code": 326,\n  "file": "Mandarin-Android-1.1.0.apk"\n}\n');
  r.git("commit", "-q", "-am", "1.1.0 published as code 326"); r.git("push", "-q", "origin", "main");
  assert.match(r.run(r.built("1.1.0")), /1\.1\.0 already published/, "the same code again: nothing done");
  assert.deepEqual(r.gh(), []);
  r.version("1.1.0", 327); r.git("commit", "-q", "-am", "the fix, code 327"); r.git("push", "-q", "origin", "main");
  r.run(r.built("1.1.0"));
  const latest = JSON.parse(r.on("publish-apk/1.1.0", "dist/latest.json"));
  assert.equal(latest.version, "1.1.0");
  assert.equal(latest.code, 327);
  assert.equal(r.on("publish-apk/1.1.0", "dist/mandarin-android.apk"), "built 1.1.0");
  assert.deepEqual(r.gh().map(l => l.split(" ").slice(0, 2).join(" ")), ["pr list", "pr create", "pr merge"]);
});

test("the version's short notes (item 223): its \"- Fixed - …\" lines in CHANGELOG.md go in latest.json, and none without them", () => {
  const r = repo("1.0.16", "1.0.15");
  fs.writeFileSync(path.join(r.work, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- New - not out yet\n\n## v1.0.17\n\nWhat 1.0.17 is. Items 1 and 2.\n\n" +
    "- Fixed - track times now show on albums\n- New - the **Shelf**, a new way to browse\n- Tweaks - the share card copies itself\n\n- `2-shelf` (item 2): **the Shelf.**\n  - Redesign - an entry's own point\n\n" +
    "## v1.0.16\n\n- Fixed - an older one\n");
  r.version("1.0.17"); r.git("add", "-A"); r.git("commit", "-q", "-m", "v1.0.17"); r.git("push", "-q", "origin", "main");
  r.run(r.built("1.0.17"));
  assert.equal(JSON.parse(r.on("publish-apk/1.0.17", "dist/latest.json")).notes, "• Fixed - track times now show on albums\n• New - the Shelf, a new way to browse\n• Tweaks - the share card copies itself");
  const s = repo("1.0.16", "1.0.15");
  s.version("1.0.17"); s.git("commit", "-q", "-am", "v1.0.17, no changelog"); s.git("push", "-q", "origin", "main");
  s.run(s.built("1.0.17"));
  assert.equal(JSON.parse(s.on("publish-apk/1.0.17", "dist/latest.json")).notes, null);
});
