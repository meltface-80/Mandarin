using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The pages, the deep links and /api/health, answered by the C# server (v0.8.48, stage 5 part 7;
/// Pages.cs, HealthRoutes.cs), held since v0.8.50 to what the Node server answered:
///   - /login (open) and /display, /display/: the files as they are, with a tag, a time and sendFile's
///     caching; signed out, the wall display sent to sign in;
///   - a deep link (any address the page opens): the page, the Android app's form of it too, HEAD as GET;
///   - a folder of public/ without its slash: sent there (301), as express.static;
///   - /api/health; an /api/ address that isn't one, as Express said it; a renderer's event.
/// (test/pages-csharp.test.js, in C#.)
/// </summary>
public sealed class PagesCsharpTests
{
    private sealed record Asked(int Status, string By, string? Type, string? Tag, string? Modified, string? Cache, string? Vary,
        string? Location, string? Ranges, string? Csp, string? Nosniff, string Body);

    private static async Task<Asked> Ask(string url, IDictionary<string, string>? headers = null, HttpMethod? method = null, HttpContent? content = null)
    {
        var r = await Http.Send(method ?? HttpMethod.Get, url, content, headers, Http.Browserlike);
        return new Asked(r.Status, r.Header("x-mandarin-answered") ?? "Node", r.Header("content-type"), r.Header("etag"), r.Header("last-modified"),
            r.Header("cache-control"), r.Header("vary"), r.Header("location"), r.Header("accept-ranges"), r.Header("content-security-policy"),
            r.Header("x-content-type-options"), r.Text);
    }

    [Test]
    public async Task The_pages_the_deep_links_and_api_health_by_the_CSharp_server_as_the_Node_server_answered_them()
    {
        Needs.Server();
        var lib = Fixtures.MakeLibrary();
        await using var srv = await new TestServer(Ports.Port(), lib.Music, lib.Data, new Dictionary<string, object?>
            { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>(), ["upnpMulticast"] = false, ["identify"] = false }).Start();
        var b = srv.Base;
        var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + await Session.SignIn(b) };
        var appH = new Dictionary<string, string>(h) { ["User-Agent"] = "Mozilla/5.0 (Linux; Android 15; wv) MusicDAndroid/0.8.48" };
        await Session.Until(async () => (await Http.Get(b + "/api/status", h)).J.Num("index_count") >= 3, 15000, "the first scan");

        // Answered here, an HTML page.
        async Task<Asked> Page(string p, IDictionary<string, string>? headers, string? what = null)
        {
            what ??= p;
            var c = await Ask(b + p, headers);
            Assert.True(c.By == "C#", what + ": answered by C#");
            Assert.True(c.Status == 200, what);
            Assert.True(Regex.IsMatch(c.Type ?? "", "^text/html; charset=utf-8$", RegexOptions.IgnoreCase), what + ": its type");
            Assert.True(c.Body.Contains("<title>", StringComparison.Ordinal), what);
            return c;
        }

        // The sign-in page, open, and the wall display's: the files, as sendFile sends them.
        foreach (var (p, headers) in new (string, IDictionary<string, string>?)[] { ("/login", null), ("/login", h), ("/display", h), ("/display/", h) })
        {
            var c = await Page(p, headers);
            Assert.True(c.Tag != null && c.Modified != null, $"{p}: a tag and a time");
            Assert.True((c.Cache, c.Ranges) == ("public, max-age=0", "bytes"), p);
            Assert.Matches("(?i)<html", c.Body);
        }
        var tag = (await Ask(b + "/display", h)).Tag!;
        Assert.True((await Ask(b + "/display", new Dictionary<string, string>(h) { ["If-None-Match"] = tag })).Status == 304, "a copy still current");
        // Signed out, the wall display is sent to sign in, and back.
        var signedOut = await Ask(b + "/display");
        Assert.Equal((302, "C#", "/login?next=%2Fdisplay"), (signedOut.Status, signedOut.By, signedOut.Location));

        // Deep links: the page for any address it opens, its form chosen by who asks.
        var index = (await Ask(b + "/", h)).Body;
        foreach (var p in new[] { "/library", "/album/12?from=home", "/settings/audio-devices", "/no-such-file.html", "/icons/", "/stream", "/.hidden" })
        {
            var c = await Page(p, h);
            Assert.True(c.Body == index, p + ": the page itself");
            Assert.True(c.Vary == "User-Agent, Accept-Encoding", p + ": vary");
            Assert.True(c.Cache == "public, max-age=0", p);
        }
        // The Android app's: its own form of the page, never kept stale.
        {
            var c = await Page("/library", appH, "the app's deep link");
            Assert.Equal(("no-cache", "User-Agent, Accept-Encoding"), (c.Cache, c.Vary));
            static string Viewport(string body) => Regex.Match(body, "<meta name=\"viewport\" content=\"([^\"]*)\">").Groups[1].Value;
            Assert.True((Viewport(index), Viewport(c.Body)) == ("width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover",
                "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"), "the app's page leaves the room around it to the app");
            Assert.NotEqual(index, c.Body);
        }
        // HEAD as GET, without the body.
        {
            var c = await Ask(b + "/library", h, HttpMethod.Head);
            Assert.Equal((200, "C#", ""), (c.Status, c.By, c.Body));
            Assert.Matches("(?i)^text/html", c.Type ?? "");
        }
        // Signed out, a deep link is sent to sign in, and back to it.
        var deep = await Ask(b + "/album/12?from=home");
        Assert.Equal((302, "C#", "/login?next=%2Falbum%2F12%3Ffrom%3Dhome"), (deep.Status, deep.By, deep.Location));
        // A folder of public/ without its slash: sent there, as express.static sends it.
        foreach (var (p, to) in new[] { ("/icons", "/icons/"), ("/fonts?a=1&b=<x>", "/fonts/?a=1&b=%3Cx%3E") })
        {
            var c = await Ask(b + p, h);
            Assert.True((c.Status, c.By, c.Location, c.Csp, c.Nosniff) == (301, "C#", to, "default-src 'none'", "nosniff"), p + ": " + c);
            Assert.Contains("Redirecting to", c.Body, StringComparison.Ordinal);
        }

        // /api/health, open.
        var hc = await Http.Get(b + "/api/health");
        Assert.Equal("C#", hc.Header("x-mandarin-answered"));
        var jc = hc.J;
        var version = (string?)JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(ServerProcess.Root, "package.json")))!["version"];
        Assert.Equal((true, version, 3.0, 0.0), (jc.Bool("ok") ?? false, jc.Str("version"), jc.Num("albums") ?? -1, jc.Num("rooms") ?? -1));
        Assert.True(jc["ffmpeg"] is JsonValue f && f.TryGetValue<bool>(out _), "ffmpeg: a boolean");
        Assert.Equal(["bytes", "files", "queued", "running"], jc["transcode_cache"]!.AsObject().Select(kv => kv.Key).Order(StringComparer.Ordinal));
        Assert.True(jc["csharp"] == null, "no Node server to bring to its version");

        // An /api/ address that isn't one, as Express said it. A renderer's event is the hub's (v0.8.49).
        var none = await Ask(b + "/api/no-such-thing", h);
        Assert.Equal((404, "C#"), (none.Status, none.By));
        JsonAssert.Same("""{"error":"No such endpoint: GET /no-such-thing"}""", JsonNode.Parse(none.Body));
        var ev = await Ask(b + "/upnp/event/uuid:nobody", new Dictionary<string, string> { ["NT"] = "upnp:event", ["NTS"] = "upnp:propchange", ["SID"] = "uuid:x" },
            new HttpMethod("NOTIFY"), new StringContent("<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"/>", Encoding.UTF8, "text/xml"));
        Assert.Equal((200, "C#"), (ev.Status, ev.By));
    }
}
