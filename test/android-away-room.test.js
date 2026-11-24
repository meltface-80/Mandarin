"use strict";
/*
 * Away from home, every screen follows and plays in this phone's room (bug list item 487). In the owner's log of
 * 19 November, away over the app's own Tailscale, Now playing and an album page's mini player (both opened at home, in
 * the Bridge's room) went on asking the server for the Bridge's room and were refused, 403 "Away from home, only this
 * phone plays": they showed the Bridge, and their buttons did nothing, until the phone was chosen in Play on, on each
 * screen in turn. Since item 485 kept the phone's answers out of the server's rooms, nothing else was shown there.
 *
 * What decides is tested where it can be run (android/core: AwayRoomTest, RoomFollowedTest). Here: that the list of a
 * room's requests the app sends for the phone is the server's own, and that the app (built only by CI) is wired to it.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");
const core = fs.readFileSync(path.join(ROOT, "android/core/src/main/kotlin/com/musicd/server/client/AwayRoom.kt"), "utf8");
const routes = fs.readFileSync(path.join(ROOT, "server/Mandarin.Server/PlaybackRoutes.cs"), "utf8");

const strings = text => [...text.matchAll(/"([^"]+)"/g)].map(m => m[1]);
/** The strings of the server's list [name] (`… name = [ … ];`). */
const serverList = name => strings(routes.match(new RegExp("\\b" + name + " = \\[([\\s\\S]*?)\\];"))[1]);
/** The strings of the app's set [name] (`val name = setOf( … )`). */
const appSet = name => strings(core.match(new RegExp("val " + name + " = setOf\\(([\\s\\S]*?)\\)\\n"))[1]);

test("the requests sent for the phone's room away are the server's playback requests, but those that aren't one room's", () => {
  const all = new Set([...serverList("Gets"), ...serverList("Posts")]);
  assert.ok(all.size > 30 && all.has("/api/zone-state") && all.has("/api/play"), "the server's lists were read");
  // Kept for home by the server; the lists of rooms; a speaker's own switches; SQ-tool's, which measure a room that is named.
  const notOneRooms = [...serverList("HomeOnly").map(p => "/api" + p), "/api/zones", "/api/outputs", "/api/shortcut/zones",
    "/api/output/standby", "/api/output/convenience-switch", "/api/sq-tool/zones", "/api/sq-tool/record"];
  for (const p of notOneRooms) assert.ok(all.delete(p), p + " is one of the server's playback requests");
  // A request added to the server's lists is to be put on one side or the other here.
  assert.deepStrictEqual(appSet("PATHS").sort(), [...all].sort());
});

test("the fields that name the room are the server's, but a move's from and to", () => {
  const moves = ["from", "to", "from_zone", "to_zone"];
  assert.deepStrictEqual(appSet("FIELDS").sort(), serverList("PhoneFields").filter(f => !moves.includes(f)).sort());
});

test("the server refuses another room away, as the app takes it to", () => {
  assert.match(routes, /if \(req\.Away && \(HomeOnly\.Contains\(path\["\/api"\.Length\.\.\]\) \|\| ids\.Any\(id => id != own\)\)\)\s+\{\s+await Auth\.Json\(req\.Ctx, 403, new JsonObject \{ \["error"\] = "Away from home, only this phone plays", \["away"\] = true \}\);/);
});

test("the screens' client sends a room's requests for the phone's while away; the services' doesn't", () => {
  const store = read("Store.kt");
  assert.match(store, /fun awayRoom\(context: Context\): String\? \{\s+if \(!isAway\(context\)\) return null\s+return prefs\(context\)\.getString\("phone_zone", null\)\?\.takeIf \{ it\.isNotEmpty\(\) \}\s+\}/);
  // Only once away has stood (AwayStood): in the moment before, a room left at home is still asked for by name.
  assert.match(store, /if \(!OfflineNow\.on\) return client\(context\) \{ com\.musicd\.server\.client\.AwayRoom\(it\) \{ if \(NativeShell\.away\.value\) awayRoom\(app\) else null \} \}/);
  assert.match(store, /fun client\(context: Context\): ServerClient\? = client\(context\) \{ it \}/);
  assert.match(store, /transport = over\(com\.musicd\.server\.client\.KeptTransport\(/);
});

test("away is acted on once it has stood, looked at when the way or the screen changes and when the count is up", () => {
  assert.match(read("NativeShell.kt"), /val away = mutableStateOf\(false\)/);
  const reach = read("ServerReach.kt");
  assert.match(reach, /private val stood = AwayStood\(\)\s+private val awayAgain = Runnable \{ awayLook\(\) \}/);
  assert.match(reach, /private fun awayLook\(\) \{\s+val left = stood\.at\(Store\.isAway\(a\), onScreen, SystemClock\.elapsedRealtime\(\)\)\s+if \(NativeShell\.away\.value != stood\.stood\) \{\s+AppLog\.line\([^\n]*\n\s+NativeShell\.away\.value = stood\.stood\s+\}\s+main\.removeCallbacks\(awayAgain\)\s+if \(left != null\) main\.postDelayed\(awayAgain, left\)\s+\}/);
  assert.match(reach, /fun resumed\(\) \{\s+onScreen = true\s+awayLook\(\)/);
  assert.match(reach, /fun paused\(\) \{ onScreen = false; live\.stop\(\); waitOver\(\); awayLook\(\) \}/);
  assert.match(reach, /fun moved\(\) \{\s+AppLog\.line\("REACH", "the way to the server changed: [^\n]*\n\s+awayLook\(\)/);
  // The room followed is the phone's only on that say-so.
  assert.match(read("RoomFollow.kt"), /val away = NativeShell\.away\.value/);
});

test("Play on marks the room followed, and a tap refused says why", () => {
  const follow = read("RoomFollow.kt");
  assert.match(follow, /internal class RoomState\(val id: String = ""\)/);
  assert.match(follow, /internal fun CoroutineScope\.sendTap\(context: Context, c: ServerClient, block: \(ServerClient\) -> Unit\) \{\s+launch\(Dispatchers\.IO\) \{\s+val refused = runCatching \{ block\(c\) \}\.exceptionOrNull\(\)\s+val said = \(refused as\? ServerClient\.ServerException\)\?\.message\?\.takeIf \{ it == PhoneRoom\.LOOKING \|\| it == AwayRooms\.REFUSED \}\s+if \(said != null\) withContext\(Dispatchers\.Main\) \{ Toast\.makeText\(context, said, Toast\.LENGTH_SHORT\)\.show\(\) \}/);
  // The server's words for it, as the app knows them.
  assert.ok(routes.includes(`["error"] = "${core.match(/const val REFUSED = "([^"]+)"/)[1]}"`), "the app's words for the refusal are the server's");
  for (const f of ["NowPlayingScreen.kt", "MiniPlayer.kt"]) {
    const src = read(f);
    assert.match(src, /fun act\(block: \(ServerClient\) -> Unit\) \{\s+val c = client\(\) \?: return\s+scope\.sendTap\(context, c, block\)\s+\}/, f);
    assert.match(src, /PlayOnMenu\(room\.id, client, ::act, onRoom/, f);
    assert.match(src, /val context = LocalContext\.current/, f);
  }
});
