"use strict";
/*
 * server/build.sh puts the program in place while one still runs from it (item 382): the v1.2.5 release's build failed
 * with "cp: cannot create regular file 'bin/mandarin-server': Text file busy", a server one of its tests left running
 * from that file. The program is now put in place by a rename, which replaces it, the running one keeping its own file.
 * build.sh's lines that put it in place are run here against a program running from the file (Linux alone says busy).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const build = fs.readFileSync(path.join(__dirname, "..", "server", "build.sh"), "utf8");

test("build.sh puts the program in place while one is still running from it", { skip: process.platform !== "linux" && "Linux alone refuses to write a running program" }, async () => {
  const lines = build.split("\n");
  const from = lines.findIndex(l => /^cp bin\/"\$RID"\/mandarin-server /.test(l));
  assert.ok(from > 0, "build.sh copies the program built for RID");
  const put = lines.slice(from, lines.findIndex((l, i) => i >= from && !/^(cp|mv) /.test(l))).join("\n");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "server-build-busy-"));
  fs.mkdirSync(path.join(dir, "bin", "linux-x64"), { recursive: true });
  // The one running: a copy of this Node, one program whatever its name (Ubuntu's sleep is one of many, told by name),
  // started from bin/mandarin-server and waiting.
  fs.copyFileSync(process.execPath, path.join(dir, "bin", "mandarin-server"));
  fs.chmodSync(path.join(dir, "bin", "mandarin-server"), 0o755);
  const running = spawn(path.join(dir, "bin", "mandarin-server"), ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    await new Promise(r => setTimeout(r, 500));
    fs.writeFileSync(path.join(dir, "bin", "linux-x64", "mandarin-server"), "the new program\n", { mode: 0o755 });
    const r = spawnSync("sh", ["-e", "-c", "RID=linux-x64\n" + put], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, "put in place: " + r.stderr);
    assert.equal(fs.readFileSync(path.join(dir, "bin", "mandarin-server"), "utf8"), "the new program\n");
    assert.ok(!fs.existsSync(path.join(dir, "bin", "mandarin-server.new")), "nothing left beside it");
    assert.equal(running.exitCode, null, "the running one carried on");
  } finally { running.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});
