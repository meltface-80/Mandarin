using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// A server for a test, by the options test/server.js's createServer took (the names Node's
/// createServer had), given to the program as its environment, and what the tests reach into it for:
/// its database file, its private addresses, a restart, a speaker's signed address.
/// </summary>
public sealed class TestServer : IAsyncDisposable
{
    // The options, as the environment the program reads them from (Config.cs).
    private static readonly Dictionary<string, string> Env = new()
    {
        ["serverIp"] = "SERVER_IP", ["sonosHosts"] = "SONOS_HOSTS", ["upnpHosts"] = "UPNP_HOSTS", ["include"] = "INCLUDE_ZONES",
        ["exclude"] = "EXCLUDE_ZONES", ["scanHours"] = "SCAN_INTERVAL_HOURS", ["tailscaleBin"] = "MUSICDNET_BIN",
        ["mbBaseUrl"] = "MUSICBRAINZ_URL", ["itunesBaseUrl"] = "ITUNES_URL", ["mbpackUrl"] = "MBPACK_URL", ["mbpackDir"] = "MBPACK_DIR",
        ["autoeqBaseUrl"] = "AUTOEQ_URL", ["discogsBaseUrl"] = "DISCOGS_URL", ["fanartBaseUrl"] = "FANART_URL", ["deezerBaseUrl"] = "DEEZER_URL",
        ["wikipediaBaseUrl"] = "WIKIPEDIA_URL", ["pitchforkBaseUrl"] = "PITCHFORK_URL", ["qobuzWebUrl"] = "QOBUZ_WEB_URL",
        ["lastfmBaseUrl"] = "LASTFM_URL", ["lastfmKey"] = "LASTFM_KEY", ["identifyTickMs"] = "IDENTIFY_TICK_MS",
        ["loudnessTickMs"] = "LOUDNESS_TICK_MS", ["qobuzBaseUrl"] = "QOBUZ_URL", ["tidalBaseUrl"] = "TIDAL_URL",
        ["tidalAuthUrl"] = "TIDAL_AUTH_URL", ["tidalImagesUrl"] = "TIDAL_IMAGES_URL", ["appDir"] = "MANDARIN_APP_DIR"
    };
    // On or off ("0" is off).
    private static readonly Dictionary<string, string> Flags = new() { ["upnpMulticast"] = "UPNP_DISCOVERY", ["identify"] = "IDENTIFY", ["localAudio"] = "LOCAL_AUDIO" };
    // The rest laid over the configuration (MANDARIN_CONFIG).
    private static readonly Dictionary<string, string> Config = new()
    {
        ["qobuzSyncDelayMs"] = "service_sync_delay_ms", ["serviceWatchMs"] = "service_watch_ms", ["logoPauseMs"] = "logo_pause_ms",
        ["upnpOfflineMs"] = "upnp_offline_ms", ["localDevices"] = "local_devices", ["massRemoval"] = "mass_removal", ["tailscaleWatchdog"] = "tailscale_watchdog"
    };

    /// <summary>Every job's name: the C# server makes them all (Jobs.Names).</summary>
    public static readonly string[] Jobs = ["identify", "mbpack", "loudness", "labels", "days", "taste", "tailscale", "scan", "prune", "import", "services", "update", "cpu", "playback"];

    private readonly Dictionary<string, string> env = [];
    private ServerProcess? srv;
    private SqliteConnection? raw;

    /// <summary>Its port.</summary>
    public int Port { get; }

    /// <summary>"http://127.0.0.1:port".</summary>
    public string Base => "http://127.0.0.1:" + Port;

    /// <summary>The music folder and data folder it was given.</summary>
    public string MusicDir { get; }

    /// <inheritdoc cref="MusicDir"/>
    public string DataDir { get; }

    /// <summary>The running program (after Start).</summary>
    public ServerProcess Process => srv ?? throw new InvalidOperationException("not started");

    /// <summary>The program's printed lines.</summary>
    public IReadOnlyList<string> Logs => srv?.Logs ?? [];

    /// <summary>
    /// A server on <paramref name="port"/> over the folders, with options by createServer's names, and
    /// <paramref name="extraEnv"/> laid over its environment (a quiet shortened, say).
    /// </summary>
    public TestServer(int port, string musicDir, string dataDir, IDictionary<string, object?>? options = null, IDictionary<string, string>? extraEnv = null)
    {
        Port = port; MusicDir = musicDir; DataDir = dataDir;
        foreach (var (k, v) in extraEnv ?? new Dictionary<string, string>()) env[k] = v;
        var cfg = new JsonObject();
        foreach (var (k, v) in options ?? new Dictionary<string, object?>())
        {
            if (v == null) continue;
            if (Env.TryGetValue(k, out var name)) env[name] = v is IEnumerable<string> list ? string.Join(",", list) : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)!;
            else if (Flags.TryGetValue(k, out var flag)) env[flag] = v is true ? "1" : "0";
            else if (Config.TryGetValue(k, out var key)) cfg[key] = JsonNode.Parse(Http.Json(v));
            else throw new ArgumentException($"TestServer: the C# server has no reading of \"{k}\"");
        }
        if (cfg.Count > 0) env["MANDARIN_CONFIG"] = cfg.ToJsonString();
    }

    /// <summary>Started and answering.</summary>
    public async Task<TestServer> Start()
    {
        srv = await ServerProcess.Start(Port, MusicDir, DataDir, env);
        return this;
    }

    /// <summary>Stopped, its database let go.</summary>
    public async Task Stop()
    {
        CloseDb();
        if (srv != null) await srv.Stop();
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync() => await Stop();

    /// <summary>The database file, open (and opened again after <see cref="CloseDb"/>).</summary>
    public SqliteConnection Db
    {
        get
        {
            if (raw != null) return raw;
            raw = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(DataDir, "musicd.db"), Mode = SqliteOpenMode.ReadWrite, Pooling = false }.ToString());
            raw.Open();
            return raw;
        }
    }

    /// <summary>Let go, to be opened again on the next use (after a restore put another file in its place).</summary>
    public void CloseDb() { raw?.Dispose(); raw = null; }

    /// <summary>The rows <paramref name="sql"/> gives, each a column → value map ($1, $2 … for the arguments).</summary>
    public List<Dictionary<string, object?>> Rows(string sql, params object?[] args)
    {
        using var c = Command(sql, args);
        using var r = c.ExecuteReader();
        var rows = new List<Dictionary<string, object?>>();
        while (r.Read())
        {
            var row = new Dictionary<string, object?>();
            for (int i = 0; i < r.FieldCount; i++) row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    /// <summary>The first row's first column, or null.</summary>
    public object? Scalar(string sql, params object?[] args) { using var c = Command(sql, args); return c.ExecuteScalar() is var v and not DBNull ? v : null; }

    /// <summary>A statement run: the rows it changed.</summary>
    public int Exec(string sql, params object?[] args) { using var c = Command(sql, args); return c.ExecuteNonQuery(); }

    private SqliteCommand Command(string sql, object?[] args)
    {
        var c = Db.CreateCommand();
        c.CommandText = sql;
        for (int i = 0; i < args.Length; i++) c.Parameters.AddWithValue("$" + (i + 1), args[i] ?? DBNull.Value);
        return c;
    }

    /// <summary>A setting as the server stores it (JSON), or null.</summary>
    public JsonNode? Setting(string key)
    {
        using var c = Db.CreateCommand();
        c.CommandText = "SELECT value FROM settings WHERE key = $k";
        c.Parameters.AddWithValue("$k", key);
        return c.ExecuteScalar() is string s ? JsonNode.Parse(s) : null;
    }

    /// <summary>A setting written as the server writes one.</summary>
    public void SetSetting(string key, object value)
    {
        using var c = Db.CreateCommand();
        c.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        c.Parameters.AddWithValue("$k", key);
        c.Parameters.AddWithValue("$v", Http.Json(value));
        c.ExecuteNonQuery();
    }

    /// <summary>One of its private addresses asked (POST, the front key): the status and its JSON.</summary>
    public Task<Http.Answer> Internal(string path, object? body = null) =>
        Http.Post(Base + path, body ?? new { }, new Dictionary<string, string> { ["X-Mandarin-Front-Key"] = Process.Key });

    /// <summary>The library read again, edits included (POST /internal/library/changed).</summary>
    public Task<Http.Answer> Reload() => Internal("/internal/library/changed", new { edits = true });

    /// <summary>A speaker's address signed under the install's secret (Playback/Signing.cs).</summary>
    public string SignUrl(string url)
    {
        int i = url.IndexOf("://", StringComparison.Ordinal);
        int from = i >= 0 ? url.IndexOf('/', i + 3) : 0;
        var path = url[from..].Split('?')[0];
        var secret = (string?)Setting("authSecret") ?? "";
        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(path));
        var sig = Convert.ToBase64String(mac).TrimEnd('=').Replace('+', '-').Replace('/', '_')[..22];
        return url + (url.Contains('?') ? "&" : "?") + "s=" + sig;
    }

    /// <summary>Settings → Restart, and the next run waited for: a new boot id, its first scan done.</summary>
    public async Task<string> Restart(string token)
    {
        async Task<string?> Boot() { try { return (string?)(await Http.Get(Base + "/server-info")).Json?["boot"]; } catch (HttpRequestException) { return null; } }
        var before = await Boot();
        var r = await Http.Post(Base + "/api/system/restart", new { }, new Dictionary<string, string> { ["Authorization"] = "Bearer " + token });
        if (r.Status != 200) throw new InvalidOperationException("restart refused: " + r.Status + " " + r.Text);
        string? now = null;
        for (int i = 0; i < 300 && now == null; i++) { var b = await Boot(); if (b != null && b != before) now = b; else await Task.Delay(100); }
        if (now == null) throw new InvalidOperationException("the server didn't start again");
        for (int i = 0; i < 600; i++)
        {
            try
            {
                var s = (await Http.Get(Base + "/api/status", new Dictionary<string, string> { ["Authorization"] = "Bearer " + token })).Json?["scan"];
                if (s?["last"] != null && s["running"]?.GetValue<bool>() != true) return now;
            }
            catch (HttpRequestException) { }
            await Task.Delay(100);
        }
        throw new InvalidOperationException("the server's first scan after starting again didn't end");
    }

    /// <summary>A play written as the server writes one (features' insertPlay).</summary>
    public void InsertPlay(object? albumId, object? trackId, string title, string artist, string album, string zone, long ts)
    {
        using var c = Db.CreateCommand();
        c.CommandText = "INSERT INTO plays(album_id, track_id, title, artist, album, zone, ts) VALUES($a,$t,$ti,$ar,$al,$z,$ts)";
        c.Parameters.AddWithValue("$a", albumId ?? DBNull.Value);
        c.Parameters.AddWithValue("$t", trackId ?? DBNull.Value);
        c.Parameters.AddWithValue("$ti", title);
        c.Parameters.AddWithValue("$ar", artist);
        c.Parameters.AddWithValue("$al", album);
        c.Parameters.AddWithValue("$z", zone);
        c.Parameters.AddWithValue("$ts", ts);
        c.ExecuteNonQuery();
    }
}
