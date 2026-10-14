using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The server's configuration from the environment (v0.8.50, stage 7 part 1 of
/// docs/specs/csharp-migration.md): `mandarin-server config` says what the server would be set up
/// with, in the shape the hand-over carried, read from the names index.js read with the defaults
/// index.js had. Nothing else is started (test/config-csharp.test.js, in C#).
/// </summary>
public sealed class ConfigCsharpTests
{
    // Every name read: left out of the program's environment, so only what a test gives counts.
    private static readonly string[] Names = ["MUSIC_DIR", "SERVER_IP", "BRIDGE_IP", "SONOS_HOSTS", "UPNP_HOSTS", "UPNP_DISCOVERY", "INCLUDE_ZONES", "EXCLUDE_ZONES",
        "SCAN_INTERVAL_HOURS", "MUSICDNET_BIN", "MUSICBRAINZ_URL", "ITUNES_URL", "MBPACK_URL", "MBPACK_DIR", "AUTOEQ_URL", "DISCOGS_URL",
        "FANART_URL", "DEEZER_URL", "WIKIPEDIA_URL", "PITCHFORK_URL", "QOBUZ_WEB_URL", "LASTFM_URL", "LASTFM_KEY", "IDENTIFY", "IDENTIFY_TICK_MS",
        "LOUDNESS_TICK_MS", "LOCAL_AUDIO", "UPDATE_REPO", "UPDATE_API", "UPDATE_CHECK", "QOBUZ_URL", "TIDAL_URL",
        "TIDAL_AUTH_URL", "TIDAL_IMAGES_URL", "MANDARIN_CONFIG"];

    private static Task<ServerCommand.Result> Run(Dictionary<string, string> env)
    {
        var e = new Dictionary<string, string> { ["DATA_DIR"] = "/tmp/mandarin-config-test", ["PORT"] = "3511" };
        foreach (var (k, v) in env) e[k] = v;
        return ServerCommand.Run(["config"], e, Names);
    }

    private static async Task<JsonObject> Config(Dictionary<string, string> env)
    {
        var r = await Run(env);
        Assert.True(r.Code == 0, r.Err);
        return JsonNode.Parse(r.Out)!.AsObject();
    }

    private const string Defaults = """
        { "identify": true, "identify_tick_ms": 5000, "musicbrainz_url": null, "itunes_url": null, "mbpack_url": null, "mbpack_dir": null,
          "loudness_tick_ms": 5000, "discogs_url": null, "fanart_url": null, "deezer_url": null, "logo_pause_ms": null,
          "wikipedia_url": null, "pitchfork_url": null, "qobuz_web_url": null,
          "tailscale_bin": "/usr/local/bin/musicdnet", "tailscale_dir": "/tmp/mandarin-config-test/tailscale", "tailscale_port": 3511, "tailscale_watchdog": null,
          "update_repo": null, "update_api": null, "update_check": true,
          "lastfm_url": null, "lastfm_key": null, "autoeq_url": null,
          "music_dir": "/music", "mass_removal": 500, "scan_hours": 6,
          "sonos_hosts": [], "server_ip": null, "sonos_include": [], "sonos_exclude": [], "upnp_hosts": [], "upnp_multicast": true, "upnp_offline_ms": null,
          "local_audio": true, "local_devices": null,
          "qobuz_url": null, "tidal_url": null, "tidal_images_url": null, "tidal_auth_url": null, "service_sync_delay_ms": null, "service_watch_ms": null }
        """;

    // The defaults with <paramref name="over"/>'s keys laid over them (Object.assign).
    private static string Over(string over)
    {
        var d = JsonNode.Parse(Defaults)!.AsObject();
        foreach (var (k, v) in JsonNode.Parse(over)!.AsObject()) d[k] = v?.DeepClone();
        return d.ToJsonString();
    }

    [Test]
    public async Task The_defaults_as_index_js_had_them() => JsonAssert.Same(Defaults, await Config([]));

    [Test]
    public async Task Every_name_index_js_read_read_here_the_same_way()
    {
        var c = await Config(new()
        {
            ["MUSIC_DIR"] = "/srv/music", ["SERVER_IP"] = "10.0.0.5", ["SONOS_HOSTS"] = " 10.0.0.9, 10.0.0.10 ,", ["UPNP_HOSTS"] = "10.0.0.20", ["UPNP_DISCOVERY"] = "0",
            ["INCLUDE_ZONES"] = "Kitchen,Study", ["EXCLUDE_ZONES"] = "Loft", ["SCAN_INTERVAL_HOURS"] = "12", ["MUSICDNET_BIN"] = "/opt/musicdnet",
            ["MUSICBRAINZ_URL"] = "http://127.0.0.1:9/mb", ["ITUNES_URL"] = "http://127.0.0.1:9/it", ["MBPACK_URL"] = "http://127.0.0.1:9/pack", ["MBPACK_DIR"] = "/packs",
            ["AUTOEQ_URL"] = "http://127.0.0.1:9/eq", ["DISCOGS_URL"] = "http://127.0.0.1:9/dc", ["FANART_URL"] = "http://127.0.0.1:9/fa", ["DEEZER_URL"] = "http://127.0.0.1:9/dz",
            ["WIKIPEDIA_URL"] = "http://127.0.0.1:9/wp", ["PITCHFORK_URL"] = "http://127.0.0.1:9/pf", ["QOBUZ_WEB_URL"] = "http://127.0.0.1:9/qw",
            ["LASTFM_URL"] = "http://127.0.0.1:9/fm", ["LASTFM_KEY"] = "k1", ["IDENTIFY"] = "0", ["IDENTIFY_TICK_MS"] = "250", ["LOUDNESS_TICK_MS"] = "300", ["LOCAL_AUDIO"] = "0",
            ["UPDATE_REPO"] = "someone/elsewhere", ["UPDATE_API"] = "http://127.0.0.1:9/gh", ["UPDATE_CHECK"] = "false",
            ["QOBUZ_URL"] = "http://127.0.0.1:9/qb", ["TIDAL_URL"] = "http://127.0.0.1:9/td", ["TIDAL_AUTH_URL"] = "http://127.0.0.1:9/ta", ["TIDAL_IMAGES_URL"] = "http://127.0.0.1:9/ti/"
        });
        JsonAssert.Same(Over("""
            { "music_dir": "/srv/music", "server_ip": "10.0.0.5", "sonos_hosts": ["10.0.0.9", "10.0.0.10"], "upnp_hosts": ["10.0.0.20"], "upnp_multicast": false,
              "sonos_include": ["Kitchen", "Study"], "sonos_exclude": ["Loft"], "scan_hours": 12, "tailscale_bin": "/opt/musicdnet",
              "musicbrainz_url": "http://127.0.0.1:9/mb", "itunes_url": "http://127.0.0.1:9/it", "mbpack_url": "http://127.0.0.1:9/pack", "mbpack_dir": "/packs",
              "autoeq_url": "http://127.0.0.1:9/eq", "discogs_url": "http://127.0.0.1:9/dc", "fanart_url": "http://127.0.0.1:9/fa", "deezer_url": "http://127.0.0.1:9/dz",
              "wikipedia_url": "http://127.0.0.1:9/wp", "pitchfork_url": "http://127.0.0.1:9/pf", "qobuz_web_url": "http://127.0.0.1:9/qw",
              "lastfm_url": "http://127.0.0.1:9/fm", "lastfm_key": "k1", "identify": false, "identify_tick_ms": 250, "loudness_tick_ms": 300, "local_audio": false,
              "update_repo": "someone/elsewhere", "update_api": "http://127.0.0.1:9/gh", "update_check": false,
              "qobuz_url": "http://127.0.0.1:9/qb", "tidal_url": "http://127.0.0.1:9/td", "tidal_auth_url": "http://127.0.0.1:9/ta", "tidal_images_url": "http://127.0.0.1:9/ti/" }
            """), c);
        // BRIDGE_IP, the older name, behind SERVER_IP; a number that isn't one, or 0, is the default (Number(v) || d).
        Assert.Equal("10.0.0.6", (await Config(new() { ["BRIDGE_IP"] = "10.0.0.6" })).Str("server_ip"));
        Assert.Equal("10.0.0.5", (await Config(new() { ["SERVER_IP"] = "10.0.0.5", ["BRIDGE_IP"] = "10.0.0.6" })).Str("server_ip"));
        Assert.Equal(6, (await Config(new() { ["SCAN_INTERVAL_HOURS"] = "soon" })).Num("scan_hours"));
        Assert.Equal(5000, (await Config(new() { ["IDENTIFY_TICK_MS"] = "0" })).Num("identify_tick_ms"));
    }

    [Test]
    public async Task The_tests_stand_ins_laid_over_the_whole()
    {
        const string over = """
            { "logo_pause_ms": 0, "upnp_offline_ms": 1500, "tailscale_watchdog": { "rebindMs": 5000, "restartMs": 10000 }, "service_sync_delay_ms": 1e9,
              "service_watch_ms": 1e9, "mass_removal": 2, "local_devices": { "platform": "linux", "devices": [{ "id": "LOCAL_x", "kind": "local" }], "hidden": 0, "off": false }, "music_dir": "/over" }
            """;
        JsonAssert.Same(Over(over), await Config(new() { ["MUSIC_DIR"] = "/under", ["MANDARIN_CONFIG"] = JsonNode.Parse(over)!.ToJsonString() }));
        // Not JSON, or not an object: refused at the start, in words.
        foreach (var bad in new[] { "{not json", "[1, 2]", "\"text\"" })
        {
            var r = await Run(new() { ["MANDARIN_CONFIG"] = bad });
            Assert.True(r.Code != 0, bad);
            Assert.True(r.Err.Contains("MANDARIN_CONFIG isn't", StringComparison.Ordinal), bad + ": " + r.Err);
        }
    }
}
