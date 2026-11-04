"use strict";
/*
 * Mandarin Bridge's Wi-Fi, set from its own page (item 283, the Raspberry Pi image's): a computer just flashed, on no
 * network, opens a setup network of its own a moment after it starts; the page lists the networks in reach (strongest
 * first, a name holding a colon read whole) and joins the one chosen, the setup network closed first. A wrong password
 * is said, and the setup network opens again; the right one joins, and the setup network stays closed. Played here
 * against a stand-in for NetworkManager's nmcli that keeps what it was asked. Without --wifi the page has no Wi-Fi.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ports = require("./ports");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const skip = !(fs.existsSync(BRIDGE) && fs.existsSync(ENGINE)) && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

// NetworkManager's nmcli, as far as the Bridge asks it: what it was asked kept in $NM/log, the network in $NM/on.
const NMCLI = `#!/bin/sh
echo "$*" >> "$NM/log"
case "$*" in
  "-t networking connectivity") if [ -s "$NM/on" ]; then echo full; else echo none; fi ;;
  "-t -f ACTIVE,SSID device wifi") [ -s "$NM/on" ] && echo "yes:$(cat "$NM/on")"; echo "no:Neighbours" ;;
  "-t -f SSID,SIGNAL,SECURITY device wifi list") printf 'Home:60:WPA2\\nCafe\\\\:Guest:40:\\nHome:82:WPA2\\nNeighbours:20:WPA1 WPA2\\n' ;;
  "device wifi hotspot"*) echo "Device 'wlan0' successfully activated" ;;
  "connection down mandarin-setup") echo "Connection deactivated" ;;
  "device wifi connect Home password secret") echo Home > "$NM/on"; echo "Device 'wlan0' successfully activated" ;;
  "device wifi connect"*) echo "Error: Connection activation failed: Secrets were required, but not provided." >&2; exit 4 ;;
  *) echo "unknown: $*" >&2; exit 2 ;;
esac
`;

function start(t, args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-wifi-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const nm = path.join(tmp, "nm");
  fs.mkdirSync(nm);
  fs.writeFileSync(path.join(tmp, "nmcli"), NMCLI, { mode: 0o755 });
  const port = ports.port();
  const p = spawn(BRIDGE, ["--port", String(port), "--data", path.join(tmp, "data"), "--asound", path.join(tmp, "none"), "--device", "file:" + path.join(tmp, "dac.raw"),
    "--address", "127.0.0.1", "--engine", ENGINE, ...args.map(a => a.replace("NMCLI", path.join(tmp, "nmcli")))], { stdio: ["ignore", "ignore", "pipe"], env: Object.assign({}, process.env, { NM: nm }) });
  let said = "";
  p.stderr.on("data", d => { said += d; });
  t.after(() => p.kill());
  const asked = () => { try { return fs.readFileSync(path.join(nm, "log"), "utf8").split("\n").filter(Boolean); } catch (e) { return []; } };
  return { base: "http://127.0.0.1:" + port, asked, said: () => said };
}

const json = async (u, body) => (await fetch(u, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})).json();

test("the Bridge's Wi-Fi from its page: a setup network where there is none, the home network joined", { skip, timeout: 90000 }, async (t) => {
  const b = start(t, ["--wifi", "--nmcli", "NMCLI", "--setup-after", "1"]);
  const hotspots = () => b.asked().filter(l => l.startsWith("device wifi hotspot")).length;
  try {
    // No network a second after starting: the setup network, said on the page.
    await until(() => hotspots() === 1);
    assert.ok(b.asked().includes("device wifi hotspot con-name mandarin-setup ssid Mandarin Bridge Setup password mandarin-setup"), b.asked().join("\n"));
    assert.equal((await until(async () => { const s = await json(b.base + "/api/state"); return s.wifi && s.wifi.setup && s; })).wifi.setup, true);
    // The networks in reach, each once at its strongest, strongest first; a colon in a name read as the name's.
    const w = await json(b.base + "/api/wifi");
    assert.deepEqual(w.networks, [{ ssid: "Home", signal: 82, secure: true }, { ssid: "Cafe:Guest", signal: 40, secure: false }, { ssid: "Neighbours", signal: 20, secure: true }]);
    assert.equal(w.network, null);
    assert.match(await (await fetch(b.base + "/")).text(), /id="wifi"/);

    // A wrong password: the setup network closed for the try, the failure said, and the setup network open again.
    assert.deepEqual(await json(b.base + "/api/wifi", { ssid: "Home", password: "wrong" }), { joining: "Home" });
    await until(() => b.asked().includes("device wifi connect Home password wrong"));
    const tried = b.asked();
    assert.ok(tried.lastIndexOf("connection down mandarin-setup") < tried.indexOf("device wifi connect Home password wrong") && tried.includes("connection down mandarin-setup"), "the setup network closed before joining");
    await until(async () => /Secrets were required/.test((await json(b.base + "/api/state")).wifi.error || ""));
    await until(() => hotspots() === 2);

    // The right one: joined, and the setup network stays closed.
    await json(b.base + "/api/wifi", { ssid: "Home", password: "secret" });
    await until(async () => (await json(b.base + "/api/wifi")).network === "Home");
    await sleep(2500);
    assert.equal(hotspots(), 2, "no setup network once on the home network");
    assert.equal((await json(b.base + "/api/state")).wifi.setup, false);
  } catch (e) { console.log(b.said()); throw e; }
});

test("without --wifi, the Bridge's page has no Wi-Fi and nmcli is never asked", { skip, timeout: 30000 }, async (t) => {
  const b = start(t, []);
  const s = await until(async () => json(b.base + "/api/state"));
  assert.equal(s.wifi, null);
  assert.equal((await fetch(b.base + "/api/wifi")).status, 404);
  await sleep(1500);
  assert.deepEqual(b.asked(), []);
});
