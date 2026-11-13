"use strict";
/*
 * Mandarin OS's Reinstall Mandarin and the builds it installs (item 405, os/…/reinstall-mandarin and channel.sh), run
 * as they are under a root of the test's own, the installer (linux-install.sh), Mandarin's program, runuser, systemctl
 * and curl stood in for:
 *   - no file in the share's Installer: the latest release, as before, and no backup (nothing changes channel);
 *   - a file there whose name starts with "dev" (any case): dev's builds, the installer asked for them, the channel kept
 *     for mandarin.service (MachineSettings/mandarin-channel.env), and Mandarin's data backed up first by Mandarin itself,
 *     as its own user, into its backups;
 *   - gone again: back to the latest release, backed up first again; a Mandarin too old to back up by itself has its
 *     database copied into its backups instead, stopped first;
 *   - a backup that can't be made: nothing installed, the channel as it was; an install that fails: the channel as it was;
 *   - moved, and the release doesn't answer on the data dev's build left: said in the log, the backup named, a failure;
 *   - apply makes Installer as Storage is, beside it at the top of the share (item 406), a line in it and nothing about
 *     how it is used; 0.1.5's Storage/Installer moved into it, what was put there kept; mandarin.service
 *     reads the channel from the data partition, which Mandarin OS's own updates leave alone.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const LIB = path.join(__dirname, "..", "os", "mkosi.extra", "usr", "lib", "mandarin-os");
const skip = process.platform !== "linux" ? "Linux only" : spawnSync("sh", ["-c", "command -v jq"]).status !== 0 && "jq is not installed";

/** A stand-in box: Mandarin [have] installed, which makes backups itself unless [old]; the installer installs [next]. */
function box({ have = "1.3.1", old = false, installs = true, answers = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-os-reinstall-"));
  const root = path.join(dir, "root"), lib = path.join(dir, "lib"), bin = path.join(dir, "bin"), log = path.join(dir, "calls.log");
  for (const d of [lib, bin, path.join(root, "data/MandarinServer"), path.join(root, "data/Storage"), path.join(root, "opt/mandarin/server/bin")]) fs.mkdirSync(d, { recursive: true });
  for (const f of ["reinstall-mandarin", "channel.sh", "log.sh"]) fs.copyFileSync(path.join(LIB, f), path.join(lib, f));
  const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); };
  put("data/MandarinServer/musicd.db", "the database");
  put("data/MandarinServer/musicd.db-wal", "its log");
  const program = (v) => `#!/bin/bash\necho "mandarin-server $* DATA_DIR=$DATA_DIR" >> "${log}"\n[ "$1" = --version ] && { echo ${v}; exit 0; }\n` +
    (old ? `echo "mandarin-server: no command \\"$*\\" in Mandarin ${v}." >&2; exit 2\n`
      : `[ "$1" = backup ] && { mkdir -p "$DATA_DIR/backups"; echo made > "$DATA_DIR/backups/auto-x.tar.gz"; echo '{"id":"auto-x","kind":"auto","label":"'"$2"'"}'; exit 0; }\n`);
  const install = (v) => { put("opt/mandarin/server/bin/mandarin-server", program(v)); fs.chmodSync(path.join(root, "opt/mandarin/server/bin/mandarin-server"), 0o755); put("opt/mandarin/server/bin/mandarin-server.version", v + "\n"); };
  install(have);
  // The installer: what it was asked, then the build of the channel asked for put in place (or a failure).
  fs.writeFileSync(path.join(lib, "linux-install.sh"), `#!/bin/bash\necho "linux-install $*" >> "${log}"\n${installs ? "" : "exit 1\n"}` +
    `case "$2" in dev) v=1.3.2-t9 ;; *) v=1.3.1 ;; esac\nprintf '%s\\n' "$v" > "${root}/opt/mandarin/server/bin/mandarin-server.version"\n`, { mode: 0o755 });
  const shim = (name, body = "") => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
  shim("runuser", `[ "$1 $2 $3" = "-u mandarin --" ] || exit 9\nshift 3\nexec "$@"`);
  shim("systemctl");
  shim("mountpoint", "exit 0");
  shim("logger");
  shim("sleep");
  shim("curl", answers ? "exit 0" : "exit 7");
  const env = Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH, MANDARIN_OS_ROOT: root, MANDARIN_OS_WAIT: "3" });
  return {
    root,
    run: () => spawnSync("bash", [path.join(lib, "reinstall-mandarin")], { env, encoding: "utf8" }),
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""),
    clear: () => fs.writeFileSync(log, ""),
    oslog: () => { const f = path.join(root, "data/MandarinOS/Logs/MandarinOS_log.txt"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; },
    channel: () => { const f = path.join(root, "data/MachineSettings/mandarin-channel.env"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null; },
    backups: () => { const d = path.join(root, "data/MandarinServer/backups"); return fs.existsSync(d) ? fs.readdirSync(d).sort() : []; },
    put, install,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

test("Reinstall Mandarin installs the builds the share's Installer asks for, backing Mandarin's data up when they change", { skip }, () => {
  const b = box();
  try {
    // Nothing there: the latest release, as before; no backup.
    b.put("data/Installer/README.txt", "Used by Mandarin's reinstaller. Leave it as it is.\n");
    let r = b.run();
    assert.equal(r.status, 0, r.stdout + r.stderr + b.oslog());
    assert.match(b.calls(), /^linux-install --channel latest --music \/data\/Storage --data \/data\/MandarinServer$/m);
    assert.doesNotMatch(b.calls(), /backup/);
    assert.equal(b.channel(), "MANDARIN_CHANNEL=latest\n");

    // dev.bin (as the owner is given it): dev's builds, Mandarin's own backup first, as its own user.
    b.put("data/Installer/dev.bin", Buffer.from([0, 1, 2]));
    b.clear();
    r = b.run();
    assert.equal(r.status, 0, r.stdout + r.stderr + b.oslog());
    const calls = b.calls();
    assert.match(calls, new RegExp(`^runuser -u mandarin -- env DATA_DIR=${b.root}/data/MandarinServer ${b.root}/opt/mandarin/server/bin/mandarin-server backup Before development builds$`, "m"));
    assert.ok(calls.indexOf("backup") < calls.indexOf("linux-install"), "backed up before anything is installed");
    assert.match(calls, /^linux-install --channel dev --music \/data\/Storage --data \/data\/MandarinServer$/m);
    assert.equal(b.channel(), "MANDARIN_CHANNEL=dev\n");
    assert.deepEqual(b.backups(), ["auto-x.tar.gz"]);
    assert.match(b.oslog(), /\[reinstall\] Mandarin's data backed up first: MandarinServer\/Backups\/auto-x\.tar\.gz/);
    assert.match(b.oslog(), /\[reinstall\] done: 1\.3\.2-t9/);

    // Again on dev: no backup, nothing changes.
    b.clear();
    assert.equal(b.run().status, 0);
    assert.doesNotMatch(b.calls(), /backup/);

    // Any case, any ending: DEV.txt is dev too; README.txt alone is not.
    fs.rmSync(path.join(b.root, "data/Installer/dev.bin"));
    b.put("data/Installer/DEV.txt", "");
    b.clear();
    b.run();
    assert.match(b.calls(), /^linux-install --channel dev /m);

    // Gone: back to the latest release, Mandarin's data backed up first again.
    fs.rmSync(path.join(b.root, "data/Installer/DEV.txt"));
    b.clear();
    r = b.run();
    assert.equal(r.status, 0, r.stdout + r.stderr + b.oslog());
    assert.match(b.calls(), /mandarin-server backup Before the latest release/);
    assert.match(b.calls(), /^linux-install --channel latest /m);
    assert.equal(b.channel(), "MANDARIN_CHANNEL=latest\n");
    assert.match(b.oslog(), /Mandarin 1\.3\.1 answers on its data/);
  } finally { b.cleanup(); }
});

test("a Mandarin too old to back up by itself has its database copied into its backups, stopped first", { skip }, () => {
  const b = box({ old: true });
  try {
    b.put("data/Installer/dev", "");
    const r = b.run();
    assert.equal(r.status, 0, r.stdout + r.stderr + b.oslog());
    const backups = b.backups();
    assert.equal(backups.length, 2, backups.join(" "));
    assert.match(backups[0], /^before-dev-\d{4}-\d{2}-\d{2}-\d{6}\.db$/);
    assert.equal(backups[1], backups[0] + "-wal");
    assert.equal(fs.readFileSync(path.join(b.root, "data/MandarinServer/backups", backups[0]), "utf8"), "the database");
    const calls = b.calls();
    assert.ok(calls.indexOf("systemctl stop mandarin.service") < calls.indexOf("linux-install"), "stopped before it is copied");
    assert.match(b.oslog(), /Mandarin 1\.3\.1 makes no backup itself: its database copied first to MandarinServer\/Backups\/before-dev-/);
  } finally { b.cleanup(); }
});

test("nothing moves when the backup can't be made, nor when the install fails; a release that doesn't answer is said", { skip }, () => {
  let b = box();
  try {
    // Mandarin's backup fails: nothing installed, the channel as it was.
    fs.writeFileSync(path.join(b.root, "opt/mandarin/server/bin/mandarin-server"), "#!/bin/bash\n[ \"$1\" = backup ] && { echo 'database is locked' >&2; exit 1; }\n", { mode: 0o755 });
    b.put("data/Installer/dev.bin", "");
    let r = b.run();
    assert.equal(r.status, 1);
    assert.doesNotMatch(b.calls(), /linux-install/, "nothing installed");
    assert.equal(b.channel(), null, "the channel as it was");
    assert.match(b.oslog(), /couldn't be backed up: left on the latest release/);
  } finally { b.cleanup(); }

  b = box({ installs: false });
  try {
    b.put("data/Installer/dev.bin", "");
    const r = b.run();
    assert.equal(r.status, 1);
    assert.equal(b.channel(), "MANDARIN_CHANNEL=latest\n", "the channel as it was");
  } finally { b.cleanup(); }

  // From dev's build back to a release that doesn't answer on the data it left: said, the backup named, a failure.
  b = box({ have: "1.3.2-t9", answers: false });
  try {
    b.put("data/MachineSettings/mandarin-channel.env", "MANDARIN_CHANNEL=dev\n");
    const r = b.run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(b.oslog(), /Mandarin 1\.3\.1 doesn't answer on the data Mandarin 1\.3\.2-t9 left: its backup is kept, MandarinServer\/Backups\/auto-x\.tar\.gz/);
    assert.deepEqual(b.backups(), ["auto-x.tar.gz"]);
  } finally { b.cleanup(); }
});

test("apply makes Installer as Storage is, at the top of the share, 0.1.5's moved into it; mandarin.service reads the channel from the data partition", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-os-installer-"));
  try {
    const bin = path.join(dir, "bin"), log = path.join(dir, "calls.log");
    fs.mkdirSync(bin);
    for (const c of ["chown", "chmod"]) fs.writeFileSync(path.join(bin, c), `#!/bin/sh\necho "${c} $*" >> "${log}"\n`, { mode: 0o755 });
    // 0.1.5's, in Storage, with the owner's dev.bin in it.
    const old = path.join(dir, "data/Storage/Installer");
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, "README.txt"), "Used by Mandarin's reinstaller. Leave it as it is.\n");
    fs.writeFileSync(path.join(old, "dev.bin"), "Mandarin: development builds\n");
    const r = spawnSync("bash", ["-c", `. "${LIB}/channel.sh" && channel_folder music`], { env: Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH, MANDARIN_OS_ROOT: dir }), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const folder = path.join(dir, "data/Installer");
    assert.equal(fs.readFileSync(path.join(folder, "dev.bin"), "utf8"), "Mandarin: development builds\n", "what was put in Storage's moved with it");
    assert.ok(!fs.existsSync(old), "Storage/Installer taken away");
    assert.equal(fs.readlinkSync(path.join(dir, "data/Share/Installer")), "/data/Installer", "at the top of the share, as Storage is");
    assert.equal(fs.readFileSync(path.join(folder, "README.txt"), "utf8"), "Used by Mandarin's reinstaller. Leave it as it is.\n");
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [`chown music:mandarin ${folder} ${folder}/README.txt`, `chmod 2775 ${folder}`, `chmod 0664 ${folder}/README.txt`]);
    const apply = fs.readFileSync(path.join(LIB, "apply"), "utf8");
    const storage = apply.indexOf("chmod 2775 /data/Storage /data/Storage/USB"), made = apply.indexOf('channel_folder "${user:-}"');
    assert.ok(storage > 0 && made > storage, "made by apply, after Storage");
    const unit = fs.readFileSync(path.join(__dirname, "..", "os", "mkosi.extra", "etc", "systemd", "system", "mandarin.service.d", "mandarin-os.conf"), "utf8");
    assert.match(unit, /^EnvironmentFile=-\/data\/MachineSettings\/mandarin-channel\.env$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
