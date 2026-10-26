// @ts-check
"use strict";
/*
 * MusicD's own Tailscale engine, the app's child process, kept only while it is needed (bug list item 202). On 26 Oct
 * Android ended the app for the engine's CPU while both sat in the background at home. Each site is held to the
 * shape here; what the decision is (EngineIdle) and how the interface list is paced (InterfaceFeed) are core tests'.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android", "app", "src", "main", "java", "com", "musicd", "server", "android");
const read = (name) => fs.readFileSync(path.join(APP, name), "utf8");
const goRead = (name) => fs.readFileSync(path.join(__dirname, "..", "android", "musicdnet", name), "utf8");

test("at home the engine is kept only while the phone plays, and stopped once idle for the grace", () => {
  const away = read("Away.kt");
  assert.match(away, /if \(!away && awayAt != null\) engineAtHome\(c, "\$\{awayAt\.host\}:\$\{awayAt\.port\}"\) else engineIdle\.verdict\(away = true, inUse = true\)/);
  const home = away.slice(away.indexOf("private fun engineAtHome("), away.indexOf("\n    }\n", away.indexOf("private fun engineAtHome(")));
  assert.match(home, /PhonePlayerService\.current\?\.offlineState\(\)\?\.state == "playing"/);
  assert.match(home, /EngineIdle\.Verdict\.KEEP -> \{ keepReady\(c, target\); lookAgain\(/);
  assert.match(home, /EngineIdle\.Verdict\.WAIT -> if \(TailscaleEngine\.alive\(\)\) lookAgain\(engineIdle\.remaining\(\) \+ 500\)/);
  assert.match(home, /EngineIdle\.Verdict\.STOP -> if \(TailscaleEngine\.alive\(\)\) TailscaleEngine\.stop\("idle at home/);
  assert.doesNotMatch(away, /if \(!away && awayAt != null\) keepReady\(/, "keepReady no longer unconditional at home");
});

test("the interface list goes through InterfaceFeed: unchanged lists skipped, a change in the gap sent when it is up, a new engine always", () => {
  const eng = read("TailscaleEngine.kt");
  assert.match(eng, /private val feed = InterfaceFeed \{/);
  assert.match(eng, /fun sendInterfaces\(force: Boolean = false\) \{\s+val text = interfacesText\(\)\s+val action = synchronized\(feed\) \{ if \(force\) feed\.reset\(\); feed\.offer\(text\) \}/);
  assert.match(eng, /InterfaceFeed\.Action\.Skip -> return/);
  assert.match(eng, /is InterfaceFeed\.Action\.Later -> \{[\s\S]*?later\.postDelayed\(/);
  assert.match(eng, /InterfaceFeed\.Action\.Send -> runCatching \{ call\("POST", "\/interfaces", text\) \}/);
  assert.match(eng, /Log\.i\(TAG, "engine running, control port \$port"\)\s+sendInterfaces\(force = true\)/);
});

test("the engine's CPU is in each snapshot, and a stop says why with its CPU and last lines", () => {
  assert.match(read("AppLog.kt"), /line\("SNAP", "engine: " \+ \(TailscaleEngine\.cpuSeconds\(\)\?\.let \{ cpu ->/);
  const eng = read("TailscaleEngine.kt");
  assert.match(eng, /fun cpuSeconds\(\): Double\? = if \(!alive\(\)\) null else runCatching \{ json\("GET", "\/status", timeoutMs = 2000\)\.optDouble\("cpu_s", -1\.0\) \}/);
  assert.match(eng, /fun stop\(why: String = ""\) \{[\s\S]*?AppLog\.line\("REACH", "the Tailscale engine stopped"[\s\S]*?logTail\(\)/);
  assert.match(eng, /stop\("not reaching the server; started afresh"\)/);
  assert.match(eng, /\.map \{ LogRedact\.line\(it\) \}/, "its lines go through the redactor");
});

test("the Go engine reports its own CPU time in /status", () => {
  assert.match(goRead("status.go"), /CPU float64 `json:"cpu_s"`/);
  assert.match(goRead("status.go"), /CPU: cpuSeconds\(\)\}/);
  assert.match(goRead("cpu.go"), /syscall\.Getrusage\(syscall\.RUSAGE_SELF, &ru\)/);
});
