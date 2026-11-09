"use strict";
/*
 * The Linux Bridge's install line tries its download again (item 380): GitHub's download service answers 502 or 504 now
 * and then for a file that is there, and install.sh stopped at the first ("curl: (22) The requested URL returned error:
 * 504"). Its download is run here as sh runs it, curl stood in for: failing twice, then sending the file; and failing
 * every time, where it gives up after five tries and says so.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const install = fs.readFileSync(path.join(__dirname, "..", "bridge", "linux", "install.sh"), "utf8");

/** install.sh's download, from its first line to the end of its retries, with curl failing [fails] times. */
function download(fails) {
  const lines = install.split("\n");
  const from = lines.findIndex(l => l.includes('echo "Downloading Mandarin Bridge'));
  const to = lines.findIndex((l, i) => i > from && l.trim() === "done");
  assert.ok(from > 0 && to > from, "install.sh's download and its retries");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-install-"));
  try {
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "curl"), `#!/bin/sh
n=$(cat "${dir}/count" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${dir}/count"
if [ $n -le ${fails} ]; then echo "curl: (22) The requested URL returned error: 504" >&2; exit 22; fi
while [ $# -gt 0 ]; do [ "$1" = -o ] && { echo tarball > "$2"; exit 0; }; shift; done
`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "bin", "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "step.sh"), `set -e\nARCH=x64\nRELEASES=https://example.invalid\nTMP="${dir}"\n${lines.slice(from, to + 1).join("\n")}\necho downloaded\n`);
    const r = spawnSync("sh", ["step.sh"], { cwd: dir, encoding: "utf8", env: Object.assign({}, process.env, { PATH: path.join(dir, "bin") + path.delimiter + process.env.PATH }) });
    return { code: r.status, out: r.stdout + r.stderr, tries: Number(fs.readFileSync(path.join(dir, "count"), "utf8")), got: fs.existsSync(path.join(dir, "bridge.tar.gz")) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("install.sh: a download GitHub fails twice is tried again and goes through", () => {
  const r = download(2);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([r.tries, r.got], [3, true]);
  assert.match(r.out, /trying again \(1 of 4\)[\s\S]*trying again \(2 of 4\)[\s\S]*downloaded/);
});

test("install.sh: a download that never comes gives up after five tries, saying so", () => {
  const r = download(99);
  assert.equal(r.code, 1, r.out);
  assert.equal(r.tries, 5);
  assert.match(r.out, /couldn't be downloaded from GitHub \(5 tries\)/);
  assert.doesNotMatch(r.out, /downloaded\n/);
});
