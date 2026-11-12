"use strict";
/*
 * Mandarin OS installs Mandarin Bridge from the same as Mandarin (item 389, 0.1.1): a test image (dev's Mandarin, built
 * from source) dev's Bridge, test-bridge's install.sh, as os/build.sh writes bridge-from; a released Mandarin OS the
 * newest Bridge release's. Before, a test image installed the released Bridge (0.3.8) beside dev's Mandarin, which
 * offered it dev's (0.3.9) the moment it was installed. Run with curl stood in for: the address it fetches.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const LIB = path.join(__dirname, "..", "os", "mkosi.extra", "usr", "lib", "mandarin-os");

function fetched(from) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-os-bridge-"));
  try {
    const lib = path.join(dir, "lib"), bin = path.join(dir, "bin"), calls = path.join(dir, "calls");
    fs.mkdirSync(lib); fs.mkdirSync(bin);
    for (const f of ["install-bridge", "log.sh"]) fs.copyFileSync(path.join(LIB, f), path.join(lib, f));
    if (from != null) fs.writeFileSync(path.join(lib, "bridge-from"), from + "\n");
    // GitHub's list of releases, newest first: a Mandarin release, then Bridge 0.3.8's.
    const releases = JSON.stringify([{ tag_name: "v1.3.0", assets: [] },
      { tag_name: "mandarin-bridge-v0.3.8", assets: [{ name: "install.sh", browser_download_url: "https://example.invalid/v0.3.8/install.sh" }] }]);
    fs.writeFileSync(path.join(bin, "curl"), `#!/bin/sh\nfor a; do last="$a"; done\necho "$last" >> "${calls}"\ncase "$last" in *api.github.com*) echo '${releases}' ;; *) echo 'exit 0' ;; esac\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "logger"), "#!/bin/sh\n", { mode: 0o755 });
    const r = spawnSync("bash", [path.join(lib, "install-bridge")], { env: Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH }), encoding: "utf8" });
    return { calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [], stderr: r.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("a test image installs dev's Bridge, a released one the newest Bridge release", { skip: process.platform === "win32" && "bash" }, () => {
  assert.deepEqual(fetched("test-bridge").calls, ["https://github.com/meltface-80/Mandarin/releases/download/test-bridge/install.sh"]);
  for (const from of ["release", null]) {
    const r = fetched(from);
    assert.deepEqual(r.calls, ["https://api.github.com/repos/meltface-80/Mandarin/releases", "https://example.invalid/v0.3.8/install.sh"], String(from) + r.stderr);
  }
  const build = fs.readFileSync(path.join(__dirname, "..", "os", "build.sh"), "utf8");
  assert.match(build, /if \[ "\$\{MANDARIN_FROM:-source\}" = source \]; then echo test-bridge; else echo release; fi > mkosi\.extra\/usr\/lib\/mandarin-os\/bridge-from/);
});
