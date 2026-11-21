"use strict";
/*
 * Mandarin's own AcoustID and FanArt.tv keys (item 491). Each service means its key to be its developer's, registered
 * once and carried in the program; Mandarin asked everyone who ran it to make and paste their own (Settings → API
 * Keys). Now they are put in at build time from the repository's secrets (server/build.sh, .github/server-assets.sh,
 * the dev and release workflows), never written in the source, which is public; their fields are gone.
 *   - with none saved, the build's own key is the one used: AcoustID is asked with it, and the Album Scanner's page
 *     says how far matching by sound has got (it was said under the field);
 *   - a key saved on the server (one pasted before, or a test's) is still used first, and cleared, the build's again;
 *   - a build without them carries none, and says so (`mandarin-server --built-in-keys`, by name, never the key).
 * The build's own keys stand in here through the configuration (acoustid_built_in, fanart_built_in): a build with
 * them is made by CI, whose build fails where a key given isn't in it.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeAcoustId } = require("./fake-acoustid");
const { createServer, built, BIN } = require("./server");
const { until } = require("./helpers");
const http = require("http");

/* MusicBrainz and FanArt.tv stood in for an artist's page: the act found by name, its entry, and its picture, each
   FanArt.tv ask's key kept (item 492: the label settings that said a FanArt.tv key was there are gone). */
function standIn() {
  const fanartKeys = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = o => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/ws/2/artist/") {
      const name = (/artist:"([^"]*)"/.exec(u.searchParams.get("query") || "") || [])[1] || "";
      return send({ count: 1, artists: [{ id: "a1b2c3d4-0000-0000-0000-000000000001", name, "sort-name": name, score: 100 }] });
    }
    if (u.pathname.startsWith("/ws/2/artist/")) return send({ id: u.pathname.split("/").pop(), name: "Artist A", type: "Group", relations: [] });
    if (u.pathname.startsWith("/fanart/v3/music/")) { fanartKeys.push(u.searchParams.get("api_key")); return send({ artistthumb: [{ url: "https://assets.fanart.tv/a.jpg" }] }); }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ base: "http://127.0.0.1:" + server.address().port, fanartKeys, stop: () => server.close() })));
}

const ROOT = path.join(__dirname, "..");
const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

test("item 491: the build's own AcoustID and FanArt.tv keys, used where none is saved", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const aid = await new FakeAcoustId({ keys: ["mandarins-own", "pasted-before"] }).start();
  t.after(() => aid.stop());
  const web = await standIn();
  t.after(() => web.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    acoustidBaseUrl: aid.baseUrl, acoustidBuiltIn: "mandarins-own", fanartBuiltIn: "fanart-project-key",
    mbBaseUrl: web.base + "/ws/2", mbRestMs: 0, fanartBaseUrl: web.base + "/fanart", deezerBaseUrl: "http://127.0.0.1:9", wikipediaBaseUrl: "http://127.0.0.1:9" });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const H = { Authorization: "Bearer " + await signIn(base), "Content-Type": "application/json" };
  const get = async p => (await fetch(base + "/api/" + p, { headers: H })).json();
  const post = async (p, body) => (await fetch(base + "/api/" + p, { method: "POST", headers: H, body: JSON.stringify(body) })).json();
  const asked = () => aid.requests.map(r => r.client);

  // None saved: the build's own, checked with AcoustID, and the scanner's page told how far matching by sound has got.
  const k = await get("settings/acoustid-key");
  assert.deepEqual([k.set, k.check], [true, "ok"], JSON.stringify(k));
  assert.deepEqual([...new Set(asked())], ["mandarins-own"]);
  const scan = await until(async () => { const s = await get("album-scanner"); return s.sound_tally && s; }, 15000, "the scanner's tally");
  assert.deepEqual(Object.keys(scan.sound_tally).sort(), ["held", "matched", "waiting"]);
  assert.equal(ctx.db.setting("acoustidKey") || "", "", "nothing written of it");
  // FanArt.tv's too: an artist's page asks for its picture with the build's own key.
  const act = await until(async () => { const a = await get("artist?name=Artist%20A"); return a && a.photo_source && a; }, 30000, "the act's picture");
  assert.equal(act.photo_source, "fanart.tv", JSON.stringify(act));
  assert.deepEqual([...new Set(web.fanartKeys)], ["fanart-project-key"]);
  assert.equal(ctx.db.setting("fanartKey") || "", "", "nothing written of it");

  // A key saved before item 491 is still the one used; cleared, the build's again.
  const n = aid.requests.length;
  assert.equal((await post("settings/acoustid-key", { key: "pasted-before" })).check, "ok");
  assert.deepEqual([...new Set(aid.requests.slice(n).map(r => r.client))], ["pasted-before"]);
  ctx.db.setSetting("acoustidKey", "");
  const m = aid.requests.length;
  assert.equal((await post("settings/acoustid-key", { key: "" })).check, "ok");
  assert.deepEqual([...new Set(aid.requests.slice(m).map(r => r.client))], ["mandarins-own"]);
});

test("item 491: a build without them carries none, and the API Keys page asks for neither", { skip: built() }, () => {
  assert.equal(execFileSync(BIN, ["--built-in-keys"], { encoding: "utf8" }).trim(), "acoustid=no fanart=no", "this build was made without them");
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  for (const gone of ["acoustid-key-input", "fanart-key-input", "acoustid-sound", "FanArt.tv key", "AcoustID key"]) assert.ok(!html.includes(gone), gone);
  const kt = fs.readFileSync(path.join(ROOT, "android/core/src/main/kotlin/com/musicd/server/client/Settings.kt"), "utf8");
  assert.doesNotMatch(kt, /ApiKeySpec\("(acoustid|fanart)-key"/);
});

test("item 491: the keys go in from the build's secrets, never the source, and a build given one that lacks it fails", () => {
  const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
  assert.match(read("server/build.sh"), /-p:AcoustIdKey="\$\{MANDARIN_ACOUSTID_KEY:-\}" -p:FanartKey="\$\{MANDARIN_FANART_KEY:-\}"/);
  const proj = read("server/Mandarin.Server/Mandarin.Server.csproj");
  assert.match(proj, /<AssemblyMetadata Include="AcoustIdKey" Value="\$\(AcoustIdKey\)" Condition="'\$\(AcoustIdKey\)' != ''" \/>/);
  assert.match(proj, /<AssemblyMetadata Include="FanartKey" Value="\$\(FanartKey\)" Condition="'\$\(FanartKey\)' != ''" \/>/);
  const assets = read(".github/server-assets.sh");
  assert.match(assets, /keys="\$\(server\/bin\/linux-x64\/mandarin-server --built-in-keys\)"/);
  assert.match(assets, /if \[ -n "\$\{MANDARIN_ACOUSTID_KEY:-\}" \] && ! echo "\$keys" \| grep -q "acoustid=yes"; then [^\n]*exit 1; fi/);
  assert.match(assets, /if \[ -n "\$\{MANDARIN_FANART_KEY:-\}" \] && ! echo "\$keys" \| grep -q "fanart=yes"; then [^\n]*exit 1; fi/);
  // Both builds that are published: dev's test builds and the releases.
  for (const wf of ["server-dev.yml", "release.yml"]) {
    const y = read(".github/workflows/" + wf);
    assert.match(y, /MANDARIN_ACOUSTID_KEY: \$\{\{ secrets\.MANDARIN_ACOUSTID_KEY \}\}\n\s+MANDARIN_FANART_KEY: \$\{\{ secrets\.MANDARIN_FANART_KEY \}\}[\s\S]*?\.github\/server-assets\.sh program/, wf);
  }
});
