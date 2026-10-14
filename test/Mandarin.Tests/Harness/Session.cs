using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Signing in from the tests the way a device does (test/auth-helper.js), and a server ready to test
/// (test/helpers.js's started): a fresh copy of the fixture library, the server on it, signed in, its
/// first scan done, stopped when the test ends.
/// </summary>
public sealed class Session : IAsyncDisposable
{
    /// <summary>The account the tests make: iterations kept low so the tests stay quick.</summary>
    public const string User = "tester", Pass = "correct horse battery staple";

    /// <inheritdoc cref="User"/>
    public const int Iterations = 1000;

    /// <summary>The fixture library the server reads.</summary>
    public required Fixtures.Library Lib { get; init; }

    /// <summary>The server.</summary>
    public required TestServer Server { get; init; }

    /// <summary>The device's bearer token.</summary>
    public required string Token { get; init; }

    /// <summary>"http://127.0.0.1:port".</summary>
    public string Base => Server.Base;

    /// <summary>The Authorization header, for a request of the test's own.</summary>
    public Dictionary<string, string> H => new() { ["Authorization"] = "Bearer " + Token };

    /// <summary>GET /api/<paramref name="path"/>, signed in.</summary>
    public Task<Http.Answer> Api(string path) => Http.Get(Base + "/api/" + path, H);

    /// <summary>POST <paramref name="body"/> as JSON to /api/<paramref name="path"/>, signed in.</summary>
    public Task<Http.Answer> Api(string path, object body) => Http.Post(Base + "/api/" + path, body, H);

    /// <summary>The library's album of this title (from the album list), or null.</summary>
    public async Task<JsonNode?> Album(string title) =>
        ((await Api("library/albums?sort=album")).Json?["albums"]?.AsArray() ?? []).FirstOrDefault(a => (string?)a?["title"] == title);

    /// <summary>
    /// A server on a fresh copy of the fixture library (or <paramref name="lib"/>), signed in, its first
    /// scan done. No speakers, no discovery, no identification unless <paramref name="options"/> says
    /// otherwise (TestServer's names); <paramref name="env"/> laid over its environment.
    /// </summary>
    public static async Task<Session> Started(IDictionary<string, object?>? options = null, Fixtures.Library? lib = null, IDictionary<string, string>? env = null)
    {
        Needs.Server();
        Needs.Ffmpeg();
        lib ??= Fixtures.MakeLibrary();
        var o = new Dictionary<string, object?> { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>(), ["upnpMulticast"] = false, ["identify"] = false };
        foreach (var (k, v) in options ?? new Dictionary<string, object?>()) o[k] = v;
        var srv = await new TestServer(Ports.Port(), lib.Music, lib.Data, o, env).Start();
        try
        {
            var token = await SignIn(srv.Base);
            var s = new Session { Lib = lib, Server = srv, Token = token };
            await Until(async () =>
            {
                var st = (await s.Api("status")).Json;
                return st != null && (st["index_count"]?.GetValue<int>() ?? 0) > 0 && st["scan"]?["running"]?.GetValue<bool>() != true;
            }, 30000, "the first scan");
            return s;
        }
        catch { await srv.Stop(); throw; }
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync() => await Server.Stop();

    /// <summary>The account made (or signed in to, if it is there): a bearer token.</summary>
    public static async Task<string> SignIn(string @base, string username = User, string password = Pass, int iterations = Iterations, bool create = true)
    {
        var st = (await Again(() => Http.Get(@base + "/api/auth/status"))).Json!;
        if (st["setup_required"]?.GetValue<bool>() == true)
        {
            if (!create) throw new InvalidOperationException("no account");
            var (salt, verifier) = Srp.MakeVerifier(username, password, iterations);
            var r = (await Again(() => Http.Post(@base + "/api/auth/setup", new { username, salt, verifier, iterations, want_token = true, kind = "android", device_name = "test" }))).Json;
            return (string?)r?["token"] ?? throw new InvalidOperationException("setup failed: " + r?.ToJsonString());
        }
        var ch = (await Again(() => Http.Post(@base + "/api/auth/challenge", new { username }))).Json!;
        var start = Srp.ClientStart();
        var proof = Srp.ClientProof(username, password, (string)ch["salt"]!, ch["iterations"]!.GetValue<int>(), start, (string)ch["B"]!);
        var v = (await Again(() => Http.Post(@base + "/api/auth/verify", new { id = (string?)ch["id"], A = start.A, M1 = proof.M1, want_token = true, kind = "android", device_name = "test" }))).Json;
        var token = (string?)v?["token"] ?? throw new InvalidOperationException("sign in failed: " + v?.ToJsonString());
        if ((string?)v!["M2"] != proof.ExpectM2) throw new InvalidOperationException("server proof wrong");
        return token;
    }

    /// <summary>
    /// Until <paramref name="fn"/> answers true. A throw or false is "not yet"; past <paramref name="ms"/>
    /// it fails, saying what it waited for and, when it threw, the last error.
    /// </summary>
    public static async Task Until(Func<Task<bool>> fn, int ms = 15000, string what = "")
    {
        var t0 = Stopwatch.StartNew();
        Exception? last = null;
        for (; ; )
        {
            try { if (await fn()) return; } catch (Exception e) when (e is not OutOfMemoryException) { last = e; }
            if (t0.ElapsedMilliseconds > ms) throw new TimeoutException("timed out waiting" + (what.Length > 0 ? " for " + what : "") + (last != null ? " (last: " + last.Message + ")" : ""));
            await Task.Delay(100);
        }
    }

    // Tests start one server after another on a port: a request may first reach a kept connection to
    // the one that has gone. Once more on a fresh one then.
    private static async Task<Http.Answer> Again(Func<Task<Http.Answer>> send)
    {
        try { return await send(); }
        catch (HttpRequestException) { await Task.Delay(150); return await send(); }
    }
}
