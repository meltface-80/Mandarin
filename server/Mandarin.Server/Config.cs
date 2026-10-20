// Config.cs — the server's configuration from the environment (v0.8.50, stage
// 7 part 1 of old/csharp-migration.md): what index.js read from it, in
// the shape the Node server's hand-over carried it (index.js
// /internal/front/runs, "config"), which Jobs.cs and everything under it take.
// `mandarin-server config` prints it (Program.cs), as the tests read it.
//
// The names index.js read, with its defaults: MUSIC_DIR (/music), SERVER_IP
// or BRIDGE_IP, SONOS_HOSTS, UPNP_HOSTS, UPNP_DISCOVERY (0: no multicast),
// INCLUDE_ZONES, EXCLUDE_ZONES, SCAN_INTERVAL_HOURS (6), MUSICDNET_BIN
// (/usr/local/bin/musicdnet), MUSICBRAINZ_URL, ITUNES_URL, MBPACK_URL,
// MBPACK_DIR, AUTOEQ_URL, DISCOGS_URL, FANART_URL, DEEZER_URL, WIKIPEDIA_URL,
// PITCHFORK_URL, QOBUZ_WEB_URL, LASTFM_URL, LASTFM_KEY, IDENTIFY (0: the
// identification scan off), IDENTIFY_TICK_MS (5000), LOUDNESS_TICK_MS (5000),
// LOCAL_AUDIO (0: no sound devices on this computer), UPDATE_REPO,
// UPDATE_API, UPDATE_CHECK (false: never by itself). PORT and
// DATA_DIR are Program.cs's. The tests' stand-ins, which index.js took as
// createServer's overrides: QOBUZ_URL, TIDAL_URL, TIDAL_AUTH_URL,
// TIDAL_IMAGES_URL, and MANDARIN_CONFIG, a JSON object laid over the whole
// (logo_pause_ms, upnp_offline_ms, tailscale_watchdog, service_sync_delay_ms,
// service_watch_ms, local_devices, mass_removal…).
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static class Config
{
    /* index.js's list(v): comma-separated, trimmed, the empty left out. */
    public static List<string> List(string? v) => (v ?? "").Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();

    /* The configuration, from [env] (the process's own by default). */
    public static JsonObject FromEnvironment(string dataDir, int port, Func<string, string?>? env = null)
    {
        env ??= Environment.GetEnvironmentVariable;
        string? S(string name) => env(name) is { Length: > 0 } s ? s : null;
        // Number(v) || d: anything that isn't a number, and 0, is the default.
        double N(string name, double d) => double.TryParse(env(name), NumberStyles.Float, CultureInfo.InvariantCulture, out var x) && x != 0 && !double.IsNaN(x) ? x : d;
        static JsonArray Strings(List<string> xs) => new(xs.Select(x => (JsonNode)x).ToArray());
        var cfg = new JsonObject
        {
            ["identify"] = env("IDENTIFY") != "0", ["identify_tick_ms"] = N("IDENTIFY_TICK_MS", 5000),
            ["musicbrainz_url"] = S("MUSICBRAINZ_URL"), ["itunes_url"] = S("ITUNES_URL"),
            ["mbpack_url"] = S("MBPACK_URL"), ["mbpack_dir"] = S("MBPACK_DIR"),
            ["loudness_tick_ms"] = N("LOUDNESS_TICK_MS", 5000),
            ["discogs_url"] = S("DISCOGS_URL"), ["fanart_url"] = S("FANART_URL"),
            ["deezer_url"] = S("DEEZER_URL"), ["logo_pause_ms"] = null,
            ["wikipedia_url"] = S("WIKIPEDIA_URL"), ["pitchfork_url"] = S("PITCHFORK_URL"), ["qobuz_web_url"] = S("QOBUZ_WEB_URL"),
            ["tailscale_bin"] = S("MUSICDNET_BIN") ?? "/usr/local/bin/musicdnet", ["tailscale_dir"] = Path.Combine(dataDir, "tailscale"), ["tailscale_port"] = port,
            ["tailscale_watchdog"] = null,
            ["update_repo"] = S("UPDATE_REPO"),
            ["update_api"] = S("UPDATE_API"), ["update_check"] = env("UPDATE_CHECK") != "false",
            ["lastfm_url"] = S("LASTFM_URL"), ["lastfm_key"] = S("LASTFM_KEY"),
            ["autoeq_url"] = S("AUTOEQ_URL"),
            ["music_dir"] = S("MUSIC_DIR") ?? "/music", ["mass_removal"] = 500, ["scan_hours"] = N("SCAN_INTERVAL_HOURS", 6),
            ["sonos_hosts"] = Strings(List(env("SONOS_HOSTS"))), ["server_ip"] = S("SERVER_IP") ?? S("BRIDGE_IP"),
            ["sonos_include"] = Strings(List(env("INCLUDE_ZONES"))), ["sonos_exclude"] = Strings(List(env("EXCLUDE_ZONES"))),
            ["upnp_hosts"] = Strings(List(env("UPNP_HOSTS"))), ["upnp_multicast"] = env("UPNP_DISCOVERY") != "0", ["upnp_offline_ms"] = null,
            ["local_audio"] = env("LOCAL_AUDIO") != "0", ["local_devices"] = null,
            ["qobuz_url"] = S("QOBUZ_URL"), ["tidal_url"] = S("TIDAL_URL"), ["tidal_images_url"] = S("TIDAL_IMAGES_URL"), ["tidal_auth_url"] = S("TIDAL_AUTH_URL"),
            ["service_sync_delay_ms"] = null, ["service_watch_ms"] = null
        };
        if (S("MANDARIN_CONFIG") is { } over)
        {
            JsonObject? o;
            try { o = JsonNode.Parse(over) as JsonObject; }
            catch (JsonException e) { throw new InvalidOperationException("MANDARIN_CONFIG isn't JSON: " + e.Message); }
            if (o == null) throw new InvalidOperationException("MANDARIN_CONFIG isn't a JSON object");
            foreach (var (k, v) in o.ToList()) cfg[k] = v?.DeepClone();
        }
        return cfg;
    }
}
