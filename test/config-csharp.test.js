"use strict";
/*
 * config-csharp.test.js — the C# server's configuration from the environment
 * (v0.8.50, stage 7 part 1 of docs/specs/csharp-migration.md): `mandarin-server
 * config` says what the server would be set up with, in the shape the
 * hand-over carried (index.js /internal/front/runs, "config"), read from the
 * names index.js read with the defaults index.js had. Nothing else is started;
 * the program alone, so it runs with or without the suite behind C#.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = !fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)";

// Every name read: left out of the program's environment, so only what a test gives counts.
const NAMES = ["MUSIC_DIR", "SERVER_IP", "BRIDGE_IP", "SONOS_HOSTS", "UPNP_HOSTS", "UPNP_DISCOVERY", "INCLUDE_ZONES", "EXCLUDE_ZONES",
  "SCAN_INTERVAL_HOURS", "MUSICDNET_BIN", "MUSICBRAINZ_URL", "ITUNES_URL", "MBPACK_URL", "MBPACK_DIR", "AUTOEQ_URL", "DISCOGS_URL",
  "FANART_URL", "DEEZER_URL", "WIKIPEDIA_URL", "PITCHFORK_URL", "QOBUZ_WEB_URL", "LASTFM_URL", "LASTFM_KEY", "IDENTIFY", "IDENTIFY_TICK_MS",
  "LOUDNESS_TICK_MS", "LOCAL_AUDIO", "MUSICD_VIA_LAUNCHER", "UPDATE_REPO", "UPDATE_API", "UPDATE_CHECK", "QOBUZ_URL", "TIDAL_URL",
  "TIDAL_AUTH_URL", "TIDAL_IMAGES_URL", "MANDARIN_CONFIG"];

function run(env) {
  const e = Object.assign({}, process.env);
  for (const k of NAMES) delete e[k];
  Object.assign(e, { DATA_DIR: "/tmp/mandarin-config-test", PORT: "3511" }, env);
  return spawnSync(BIN, ["config"], { env: e, encoding: "utf8" });
}
function config(env) {
  const r = run(env);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const DEFAULTS = {
  identify: true, identify_tick_ms: 5000, musicbrainz_url: null, itunes_url: null, mbpack_url: null, mbpack_dir: null,
  loudness_tick_ms: 5000, discogs_url: null, fanart_url: null, deezer_url: null, logo_pause_ms: null,
  wikipedia_url: null, pitchfork_url: null, qobuz_web_url: null,
  tailscale_bin: "/usr/local/bin/musicdnet", tailscale_dir: "/tmp/mandarin-config-test/tailscale", tailscale_port: 3511, tailscale_watchdog: null,
  via_launcher: false, update_repo: null, update_api: null, update_check: true,
  cpu_dsp: 0, lastfm_url: null, lastfm_key: null, autoeq_url: null,
  music_dir: "/music", mass_removal: 500, scan_hours: 6, scan_program: true,
  sonos_hosts: [], server_ip: null, sonos_include: [], sonos_exclude: [], upnp_hosts: [], upnp_multicast: true, upnp_offline_ms: null,
  local_audio: true, local_devices: null,
  qobuz_url: null, tidal_url: null, tidal_images_url: null, tidal_auth_url: null, service_sync_delay_ms: null, service_watch_ms: null
};

test("the defaults, as index.js had them", { skip }, () => {
  assert.deepEqual(config({}), DEFAULTS);
});

test("every name index.js read, read here the same way", { skip }, () => {
  const c = config({
    MUSIC_DIR: "/srv/music", SERVER_IP: "10.0.0.5", SONOS_HOSTS: " 10.0.0.9, 10.0.0.10 ,", UPNP_HOSTS: "10.0.0.20", UPNP_DISCOVERY: "0",
    INCLUDE_ZONES: "Kitchen,Study", EXCLUDE_ZONES: "Loft", SCAN_INTERVAL_HOURS: "12", MUSICDNET_BIN: "/opt/musicdnet",
    MUSICBRAINZ_URL: "http://127.0.0.1:9/mb", ITUNES_URL: "http://127.0.0.1:9/it", MBPACK_URL: "http://127.0.0.1:9/pack", MBPACK_DIR: "/packs",
    AUTOEQ_URL: "http://127.0.0.1:9/eq", DISCOGS_URL: "http://127.0.0.1:9/dc", FANART_URL: "http://127.0.0.1:9/fa", DEEZER_URL: "http://127.0.0.1:9/dz",
    WIKIPEDIA_URL: "http://127.0.0.1:9/wp", PITCHFORK_URL: "http://127.0.0.1:9/pf", QOBUZ_WEB_URL: "http://127.0.0.1:9/qw",
    LASTFM_URL: "http://127.0.0.1:9/fm", LASTFM_KEY: "k1", IDENTIFY: "0", IDENTIFY_TICK_MS: "250", LOUDNESS_TICK_MS: "300", LOCAL_AUDIO: "0",
    MUSICD_VIA_LAUNCHER: "1", UPDATE_REPO: "someone/elsewhere", UPDATE_API: "http://127.0.0.1:9/gh", UPDATE_CHECK: "false",
    QOBUZ_URL: "http://127.0.0.1:9/qb", TIDAL_URL: "http://127.0.0.1:9/td", TIDAL_AUTH_URL: "http://127.0.0.1:9/ta", TIDAL_IMAGES_URL: "http://127.0.0.1:9/ti/"
  });
  assert.deepEqual(c, Object.assign({}, DEFAULTS, {
    music_dir: "/srv/music", server_ip: "10.0.0.5", sonos_hosts: ["10.0.0.9", "10.0.0.10"], upnp_hosts: ["10.0.0.20"], upnp_multicast: false,
    sonos_include: ["Kitchen", "Study"], sonos_exclude: ["Loft"], scan_hours: 12, tailscale_bin: "/opt/musicdnet",
    musicbrainz_url: "http://127.0.0.1:9/mb", itunes_url: "http://127.0.0.1:9/it", mbpack_url: "http://127.0.0.1:9/pack", mbpack_dir: "/packs",
    autoeq_url: "http://127.0.0.1:9/eq", discogs_url: "http://127.0.0.1:9/dc", fanart_url: "http://127.0.0.1:9/fa", deezer_url: "http://127.0.0.1:9/dz",
    wikipedia_url: "http://127.0.0.1:9/wp", pitchfork_url: "http://127.0.0.1:9/pf", qobuz_web_url: "http://127.0.0.1:9/qw",
    lastfm_url: "http://127.0.0.1:9/fm", lastfm_key: "k1", identify: false, identify_tick_ms: 250, loudness_tick_ms: 300, local_audio: false,
    via_launcher: true, update_repo: "someone/elsewhere", update_api: "http://127.0.0.1:9/gh", update_check: false,
    qobuz_url: "http://127.0.0.1:9/qb", tidal_url: "http://127.0.0.1:9/td", tidal_auth_url: "http://127.0.0.1:9/ta", tidal_images_url: "http://127.0.0.1:9/ti/"
  }));
  // BRIDGE_IP, the older name, behind SERVER_IP; a number that isn't one, or 0, is the default (Number(v) || d).
  assert.equal(config({ BRIDGE_IP: "10.0.0.6" }).server_ip, "10.0.0.6");
  assert.equal(config({ SERVER_IP: "10.0.0.5", BRIDGE_IP: "10.0.0.6" }).server_ip, "10.0.0.5");
  assert.deepEqual([config({ SCAN_INTERVAL_HOURS: "soon" }).scan_hours, config({ IDENTIFY_TICK_MS: "0" }).identify_tick_ms], [6, 5000]);
});

test("the tests' stand-ins laid over the whole (MANDARIN_CONFIG)", { skip }, () => {
  const over = { logo_pause_ms: 0, upnp_offline_ms: 1500, tailscale_watchdog: { rebindMs: 5000, restartMs: 10000 }, service_sync_delay_ms: 1e9,
    service_watch_ms: 1e9, mass_removal: 2, local_devices: { platform: "linux", devices: [{ id: "LOCAL_x", kind: "local" }], hidden: 0, off: false }, music_dir: "/over" };
  assert.deepEqual(config({ MUSIC_DIR: "/under", MANDARIN_CONFIG: JSON.stringify(over) }), Object.assign({}, DEFAULTS, over));
  // Not JSON, or not an object: refused at the start, in words.
  for (const bad of ["{not json", "[1, 2]", "\"text\""]) {
    const r = run({ MANDARIN_CONFIG: bad });
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /MANDARIN_CONFIG isn't/, bad);
  }
});
