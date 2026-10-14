using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// A library behind the C# program, for the tests of the library itself (test/library-server.js, in
/// C#): the program started on a music folder, its first scan waited for; then its albums as every list
/// shows them, an album's page, a scan asked for (Rescan) and its result, the database to hand, and the
/// program started again.
/// </summary>
public sealed class LibraryServer : IAsyncDisposable
{
    /// <summary>The server.</summary>
    public required TestServer Server { get; init; }

    /// <summary>The device's bearer token.</summary>
    public required string Token { get; init; }

    /// <summary>"http://127.0.0.1:port".</summary>
    public string B => Server.Base;

    private Dictionary<string, string> H => new() { ["Authorization"] = "Bearer " + Token };

    /// <summary>The program on <paramref name="lib"/>'s folders, signed in, its first scan made.</summary>
    public static async Task<LibraryServer> Start(Fixtures.Library lib, IDictionary<string, object?>? options = null, IDictionary<string, string>? env = null)
    {
        Needs.Server();
        var o = new Dictionary<string, object?> { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>(), ["upnpMulticast"] = false, ["identify"] = false };
        foreach (var (k, v) in options ?? new Dictionary<string, object?>()) o[k] = v;
        var srv = await new TestServer(Ports.Port(), lib.Music, lib.Data, o, env).Start();
        try
        {
            var s = new LibraryServer { Server = srv, Token = await Session.SignIn(srv.Base) };
            await s.Settled();
            return s;
        }
        catch { await srv.Stop(); throw; }
    }

    /// <summary>GET a path: its JSON; fails unless it answers 200.</summary>
    public async Task<JsonNode> GetJ(string path)
    {
        var r = await Http.Get(B + path, H);
        if (r.Status != 200) throw new InvalidOperationException(path + ": " + r.Status + " " + r.Text);
        return r.J;
    }

    /// <summary>POST JSON to a path: its status and JSON.</summary>
    public async Task<(int Status, JsonNode? J)> PostJ(string path, object? body = null)
    {
        var r = await Http.Post(B + path, body ?? new { }, H);
        return (r.Status, r.Json);
    }

    /// <summary>/api/status.</summary>
    public Task<JsonNode> Status() => GetJ("/api/status");

    /// <summary>Every album as the lists show it (offset, title, subtitle, favourite, year, discs, box…).</summary>
    public async Task<List<JsonNode>> Albums() => [.. (await GetJ("/api/library/albums?count=100000"))["albums"].Items().Select(a => a!)];

    /// <summary>An album's page: { album, tracks, box_albums, … }.</summary>
    public Task<JsonNode> Album(object id) => GetJ("/api/album?offset=" + id);

    /// <summary>A scan asked for (Settings → Rescan), its result once made (scan.last).</summary>
    public async Task<JsonNode> Scan(bool force = false)
    {
        var (status, j) = await PostJ("/api/library/rescan", new { force });
        if (status != 200) throw new InvalidOperationException("rescan: " + status + " " + j?.ToJsonString());
        if (j?["scan_status"] is { } st) { var o = j.DeepClone(); o["status"] = st.DeepClone(); return o; }
        return await Settled();
    }

    /// <summary>The program started again (Settings → Restart), its first scan made.</summary>
    public Task<string> Restart() => Server.Restart(Token);

    /// <summary>The library read again after the database was changed by hand.</summary>
    public Task<Http.Answer> Reload() => Server.Reload();

    /// <summary>The program stopped.</summary>
    public Task Stop() => Server.Stop();

    /// <inheritdoc/>
    public async ValueTask DisposeAsync() => await Server.Stop();

    // The scan made, as the program starts or after a Rescan: the last one known, none running.
    private async Task<JsonNode> Settled()
    {
        for (int i = 0; i < 600; i++)
        {
            try
            {
                var s = await Status();
                if (s["scan"]?["last"] is { } last && s["scan"]!.Bool("running") != true && s.Bool("library_importing") != true) return last.DeepClone();
            }
            catch (InvalidOperationException) { }
            catch (HttpRequestException) { }
            await Task.Delay(100);
        }
        throw new TimeoutException("the scan didn't end");
    }
}
