"use strict";
/*
 * The container's start (docker/entrypoint.sh, item 354) as the security audit's third finding left it, and what it
 * broke (item 386):
 *  - a folder it couldn't hand to the server's user (a data folder on an SMB share, on NFS with root_squash) stopped the
 *    container (set -e), and Docker started it again, and again: now it says so and starts, the server saying in its
 *    turn what it can't write;
 *  - the server kept only PGID (--clear-groups), so music readable through another group (a NAS's "media" group, say),
 *    which root read, wasn't: now it keeps the groups that own the music folder and the folders directly in it, never
 *    root's.
 * Run as root, as the container starts; skipped otherwise.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ENTRY = path.join(__dirname, "..", "docker", "entrypoint.sh");
const root = typeof process.getuid === "function" && process.getuid() === 0;
const haveSetpriv = spawnSync("setpriv", ["--version"]).status === 0;
const skip = !root ? "run as root, as the container starts" : !haveSetpriv ? "setpriv is not installed" : false;

/** entrypoint.sh run with [env], the command it starts printing its groups; chown failing where [chownFails]. */
function start(tmp, env, chownFails) {
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin, { recursive: true });
  if (chownFails) fs.writeFileSync(path.join(bin, "chown"), "#!/bin/sh\necho \"chown: changing ownership: Operation not permitted\" >&2\nexit 1\n", { mode: 0o755 });
  return spawnSync("sh", [ENTRY, "sh", "-c", "echo uid=$(id -u) groups=$(id -G)"],
    { env: { PATH: bin + ":" + process.env.PATH, ...env }, encoding: "utf8" });
}

test("a folder that can't be handed to the server's user: said, and the server started all the same", { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entry-"));
  const data = path.join(tmp, "data");
  fs.mkdirSync(data);
  const r = start(tmp, { MANDARIN_OWN: data, MUSIC_DIR: path.join(tmp, "none") }, true);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^uid=1000 /, r.stdout);
  assert.match(r.stderr, new RegExp(`entrypoint: ${data} couldn't be handed to 1000:1000`), r.stderr);
});

test("music readable through a group of its own: the server keeps that group, never root's", { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entry-"));
  const music = path.join(tmp, "music");
  fs.mkdirSync(path.join(music, "4tb"), { recursive: true });
  fs.mkdirSync(path.join(music, "1tb"));
  fs.chownSync(music, 0, 0);
  fs.chownSync(path.join(music, "4tb"), 0, 1234);   // a NAS's media group
  fs.chownSync(path.join(music, "1tb"), 0, 1000);   // the server's own
  const r = start(tmp, { MANDARIN_OWN: path.join(tmp, "nothing"), MUSIC_DIR: music }, false);
  assert.equal(r.status, 0, r.stderr);
  const groups = r.stdout.trim().split("groups=")[1].split(" ").map(Number).sort((a, b) => a - b);
  assert.deepEqual(groups, [1000, 1234], r.stdout);
});
