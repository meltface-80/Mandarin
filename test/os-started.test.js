"use strict";
/*
 * Mandarin OS after its own update (item 401, 0.1.4): os-started, run as it is on the stand-in installed box
 * (test/os-update-box.js).
 *   - boot (every start): a new version whose three tries all failed (systemd-boot marked its entry +0-3 and started
 *     the one before) is said for the system page (update-last.json: failed, from, to), logged, and its entry and kernel
 *     image taken off the EFI partition, the version running's left as they are; an update noted that never got an
 *     entry (the computer stopped first) is forgotten;
 *   - health (a start being tried, before boot-complete.target): the data partition, the services, the network and the
 *     system page there, and Mandarin answering where it answered before the update: kept (exit 0, said), or not
 *     (exit 1: the unit starts the computer again, a try taken).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { makeBox, skip } = require("./os-update-box");

const TRYING = "sys/firmware/efi/efivars/LoaderBootCountPath-4a67b082-0a4c-41cf-b6c7-440b29bb8c4f";

test("os-started boot: a version that didn't start in its three tries said, and taken off the EFI partition", { skip, timeout: 60000 }, async () => {
  const box = makeBox();
  try {
    // 0.1.5 written on vda3 and tried three times; systemd-boot then started 0.1.4 again.
    fs.renameSync(path.join(box.root, "efi/loader/entries/mandarin-os_0.1.3.conf"), path.join(box.root, "efi/loader/entries/mandarin-os_0.1.5+0-3.conf"));
    box.put("efi/EFI/mandarin-os/mandarin-os_0.1.5.efi", "0.1.5's kernel\n");
    fs.writeFileSync(path.join(box.root, "efi/loader/entries/mandarin-os_0.1.5+0-3.conf"),
      box.read("efi/loader/entries/mandarin-os_0.1.5+0-3.conf").replace(/0\.1\.3/g, "0.1.5"));
    box.put("data/MandarinOS/update-pending.json", JSON.stringify({ from: "0.1.4", to: "0.1.5", at: "2026-11-13 03:00 UTC", mandarin: true }));
    const r = await box.started("boot");
    assert.equal(r.status, 0, r.stderr);
    const last = box.json("data/MandarinOS/update-last.json");
    assert.deepEqual([last.result, last.from, last.to], ["failed", "0.1.4", "0.1.5"]);
    assert.deepEqual(box.entries(), ["mandarin-os_0.1.4.conf"], "0.1.5's entry gone, 0.1.4's kept");
    assert.ok(!box.exists("efi/EFI/mandarin-os/mandarin-os_0.1.5.efi"), "its kernel image gone");
    assert.ok(box.exists("efi/EFI/mandarin-os/mandarin-os_0.1.4.efi"), "0.1.4's kept");
    assert.ok(!box.exists("data/MandarinOS/update-pending.json"));
    assert.match(box.oslog(), /ERROR \[update\] Mandarin OS 0\.1\.5 didn't start in its three tries: back on 0\.1\.4/);
    assert.match(box.oslog(), /INFO \[update\] Mandarin OS 0\.1\.5's entry taken off the EFI partition: it is never started again/);
  } finally { box.cleanup(); }

  const stopped = makeBox();
  try {
    stopped.put("data/MandarinOS/update-pending.json", JSON.stringify({ from: "0.1.4", to: "0.1.5", at: "2026-11-13 03:00 UTC" }));
    const r = await stopped.started("boot");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!stopped.exists("data/MandarinOS/update-pending.json"), "nothing starts 0.1.5: forgotten");
    assert.deepEqual(stopped.entries(), ["mandarin-os_0.1.3.conf", "mandarin-os_0.1.4.conf"], "the EFI partition as it was");
  } finally { stopped.cleanup(); }
});

test("os-started health: a new version kept only with its data, services, network, page, and Mandarin where it answered before", { skip, timeout: 60000 }, async () => {
  const serve = body => new Promise(r => { const s = http.createServer((req, res) => res.end(body)).listen(0, "127.0.0.1", () => r(s)); });
  const page = await serve("<title>Mandarin OS</title>"), mandarin = await serve(JSON.stringify({ ok: true, version: "1.4.0" }));
  const url = s => "http://127.0.0.1:" + s.address().port;
  const box = makeBox({ version: "0.1.5" });
  try {
    box.put(TRYING, "x");
    box.put("sys/class/net/eth0/carrier", "1\n");
    box.shim("nmcli", `echo "eth0:ethernet"`);
    box.shim("ip", `echo "2: eth0    inet 192.168.1.20/24 brd 192.168.1.255 scope global dynamic eth0"`);
    box.put("data/MandarinOS/update-pending.json", JSON.stringify({ from: "0.1.4", to: "0.1.5", at: "2026-11-13 03:00 UTC", mandarin: true }));
    const env = { MANDARIN_OS_PAGE: url(page), MANDARIN_OS_MANDARIN: "http://127.0.0.1:9", MANDARIN_OS_WAIT: "2" };

    // Mandarin answered before the update, and doesn't now: not kept.
    let r = await box.started("health", env);
    assert.equal(r.status, 1, r.stderr);
    assert.match(box.oslog(), /Mandarin OS 0\.1\.5, being tried: Mandarin doesn't answer \(it did before the update\)\. Not kept/);
    assert.ok(!box.exists("data/MandarinOS/update-last.json"), "nothing said kept");

    // A service that isn't running: not kept.
    box.shim("systemctl", `[ "$1 $2 $3" = "is-active -q smbd.service" ] && exit 3; [ "$1 $2" = "is-active smbd.service" ] && echo failed; exit 0`);
    r = await box.started("health", Object.assign({}, env, { MANDARIN_OS_MANDARIN: url(mandarin) }));
    assert.equal(r.status, 1);
    assert.match(box.oslog(), /smbd\.service isn't running \(failed\)/);

    // Everything there: kept, and said.
    box.shim("systemctl");
    r = await box.started("health", Object.assign({}, env, { MANDARIN_OS_MANDARIN: url(mandarin) }));
    assert.equal(r.status, 0, r.stderr + box.oslog());
    const last = box.json("data/MandarinOS/update-last.json");
    assert.deepEqual([last.result, last.from, last.to], ["updated", "0.1.4", "0.1.5"]);
    assert.ok(!box.exists("data/MandarinOS/update-pending.json"));
    assert.match(box.oslog(), /Mandarin OS 0\.1\.5 works \(192\.168\.1\.20\/24; Mandarin 1\.4\.0\): kept/);

    // The system page not answering: not kept.
    page.close();
    r = await box.started("health", Object.assign({}, env, { MANDARIN_OS_MANDARIN: url(mandarin), MANDARIN_OS_PAGE: "http://127.0.0.1:9" }));
    assert.equal(r.status, 1);
    assert.match(box.oslog(), /the system page doesn't answer/);
  } finally { box.cleanup(); page.close(); mandarin.close(); }
});
