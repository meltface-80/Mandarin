"use strict";
/*
 * Mandarin's Shut down on Mandarin OS (item 389): Mandarin writes "poweroff" in /run/mandarin-os/power/request (as its
 * own user; PowerCsharpTests proves it does), and os/…/mandarin-os/power, run as root by mandarin-os-power.path, shuts
 * the computer down. Run here with systemctl stood in for: "poweroff" shuts down; anything else is not acted on; the
 * request is removed either way, so the path unit isn't started again by it; and the unit and its folder are on the
 * image (enabled, and the folder writable by Mandarin's group alone).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const OS = path.join(__dirname, "..", "os");
const SCRIPT = path.join(OS, "mkosi.extra", "usr", "lib", "mandarin-os", "power");

function run(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-os-power-"));
  try {
    const bin = path.join(dir, "bin"), calls = path.join(dir, "calls"), request = path.join(dir, "request");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh\necho "$*" >> "${calls}"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "logger"), "#!/bin/sh\n", { mode: 0o755 });
    if (text != null) fs.writeFileSync(request, text);
    const r = spawnSync("bash", [SCRIPT], { env: Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH, MANDARIN_OS_POWER: request }), encoding: "utf8" });
    return { status: r.status, stderr: r.stderr, calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "", left: fs.existsSync(request) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("Mandarin OS: Mandarin's Shut down shuts the computer down, and nothing else is acted on", { skip: process.platform === "win32" && "bash" }, () => {
  let r = run("poweroff\n");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls, "--no-block poweroff\n");
  assert.equal(r.left, false, "the request is removed");
  for (const other of ["reboot", "poweroff; rm -rf /", "halt", ""]) {
    r = run(other);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.calls, "", `"${other}" is not acted on`);
    assert.equal(r.left, false);
  }
  assert.equal(run(null).calls, "", "no request, nothing done");
});

test("Mandarin OS: the power request's unit is enabled, its folder Mandarin's group's alone", () => {
  assert.match(fs.readFileSync(path.join(OS, "mkosi.postinst.chroot"), "utf8"), /^systemctl enable [^\n]*\bmandarin-os-power\.path\b/m);
  assert.match(fs.readFileSync(path.join(OS, "mkosi.extra", "etc", "systemd", "system", "mandarin-os-power.path"), "utf8"), /^PathExists=\/run\/mandarin-os\/power\/request$/m);
  assert.match(fs.readFileSync(path.join(OS, "mkosi.extra", "etc", "tmpfiles.d", "mandarin-os-power.conf"), "utf8"), /^d \/run\/mandarin-os\/power 0770 root mandarin -$/m);
});
