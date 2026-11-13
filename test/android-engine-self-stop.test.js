// @ts-check
"use strict";
/*
 * MusicD's own Tailscale engine stops itself (bug list item 404). On 13 Nov Android ended the app twice for the
 * engine's CPU while nothing but the app's long polls went through it: the app's at-home stop waited on main-thread
 * timers Android froze with the app, and the phone's player, home again, went on playing its queue over the engine.
 * Each site is held to its shape here; the decisions are the Go engine's tests (idle_test.go, stopreport_test.go) and
 * core's (EngineExitTest, EngineIdleTest, RouteTest).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "android");
const APP = path.join(ROOT, "app", "src", "main", "java", "com", "musicd", "server", "android");
const read = (/** @type {string} */ name) => fs.readFileSync(path.join(APP, name), "utf8");
const go = (/** @type {string} */ name) => fs.readFileSync(path.join(ROOT, "musicdnet", name), "utf8");
const core = (/** @type {string} */ name) => fs.readFileSync(path.join(ROOT, "core", "src", "main", "kotlin", "com", "musicd", "server", "client", name), "utf8");

test("the phone's engine watches itself; MusicD Server's never does", () => {
  const main = go("main.go");
  assert.match(main, /if !\*server \{\s+e\.watchItself\(defaultWatch\)/);
  assert.match(main, /mux\.HandleFunc\("POST \/keep", func[\s\S]*?e\.keep\(/);
  assert.match(main, /fw := &Forwarder\{TS: e\.ts, Target: target, Moved: &e\.moved\}/);
  assert.match(go("forward.go"), /io\.Copy\(up, counted\{c, f\.Moved\}\)[\s\S]*io\.Copy\(c, counted\{up, f\.Moved\}\)/);
});

test("the engine's note and exit codes are the ones the app reads", () => {
  const note = go("stopreport.go");
  const kt = core("EngineExit.kt");
  assert.match(note, /stopNoteName = "stopped\.txt"/);
  assert.match(read("EngineUse.kt"), /File\(File\(c\.filesDir, "tailscale"\), "stopped\.txt"\)/);
  assert.match(read("TailscaleEngine.kt"), /val dir = File\(c\.filesDir, "tailscale"\)[\s\S]*?"-dir", dir\.path/, "the engine's -dir is where the app looks");
  const goCode = (/** @type {string} */ n) => Number((note.match(new RegExp(n + "\\s+= (\\d+)")) || [])[1]);
  const ktCode = (/** @type {string} */ n) => Number((kt.match(new RegExp("const val " + n + " = (\\d+)")) || [])[1]);
  assert.strictEqual(goCode("exitIdle"), ktCode("IDLE"));
  assert.strictEqual(goCode("exitCPU"), ktCode("CPU"));
  assert.ok(goCode("exitIdle") > 2 && goCode("exitCPU") > 2, "not Go's own exit codes (1, 2 for a panic)");
});

test("its stop goes to the log from its note, not kept as a crash, and a stop the app didn't see is said at the next start", () => {
  const eng = read("TailscaleEngine.kt");
  assert.match(eng, /if \(process === p && !EngineUse\.ended\(app, code\)\) CrashLog\.keepNote\(/);
  assert.match(eng, /EngineUse\.leftOver\(c\)[\s\S]*?val p = pb\.start\(\)/);
  assert.match(eng, /sendInterfaces\(force = true\)\s+EngineUse\.started\(\)/);
  const use = read("EngineUse.kt");
  assert.match(use, /AppLog\.line\("REACH", EngineExit\.logLine\(note\) \{ LogRedact\.line\(it\) \}/);
  assert.match(use, /TailscaleEngine\.call\("POST", "\/keep\?s=\$\{EngineRest\.LEASE_S\}"/);
  assert.match(use, /fun wanted\(\): Boolean = EngineRest\.wanted\(NativeShell\.onScreen\.value, playing\)/);
});

test("once it stopped itself only a use brings it back: a request while in use, a stream; not a look at the way", () => {
  const away = read("Away.kt");
  assert.match(away, /if \(EngineUse\.rest\.mayStart\(EngineUse\.wanted\(\)\)\) repair\(c, "\$\{awayAt\.host\}:\$\{awayAt\.port\}", wasRunning\) else looked\(away\)/);
  assert.match(away, /fun notBeforeVpn\(c: Context\) \{\s+EngineUse\.revive\(c\)/);
  assert.match(away, /internal fun revive\(c: Context, ms: Long = 15_000\) \{[\s\S]*?repair\(c, [\s\S]*?waitRepair\(ms\)/);
  assert.match(read("PhonePlayerService.kt"), /spec\.withUri\(Uri\.parse\(EngineUse\.forStream\(this, Store\.localize\(this, key, opus\)\)\)\)/);
});

test("at home the engine is looked at when the app goes off screen and when the phone's player stops", () => {
  assert.match(read("MainActivity.kt"), /NativeShell\.onScreen\.value = false\s+AppLog\.line\("APP", "off screen"\); Away\.lookAtEngine\(this\)/);
  assert.match(read("PhonePlayerService.kt"), /override fun onIsPlayingChanged\(isPlaying: Boolean\) \{ if \(isPlaying\) retries = 0; EngineUse\.player\(this@PhonePlayerService, isPlaying\) \}/);
  assert.match(read("EngineUse.kt"), /if \(isPlaying\) renewSoon\(\) else Away\.lookAtEngine\(c\)/);
  const away = read("Away.kt");
  assert.match(away, /fun lookAtEngine\(c: Context\) \{[\s\S]*?engineAtHome\(a, /);
  assert.match(away, /engineIdle\.verdict\(away = false, inUse = playing, onScreen = onScreen\)/);
});

test("the phone's player, home again, plays its queue from home: every away address is moved", () => {
  assert.match(read("Store.kt"), /Route\.awayBases\(viaEngine\(context\), ServerAddress\("127\.0\.0\.1", TailscaleEngine\.PORT\)\.baseUrl, awayAddress\(context\)\?\.baseUrl\)[\s\S]*?others = others\)/);
});
