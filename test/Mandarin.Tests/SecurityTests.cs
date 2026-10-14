using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// The audit's security hardening (v0.9.0, docs/specs/audit-b4-main.md, module 3), each finding held here:
///  - S2: every page that acts may be framed only by its own origin (frame-ancestors 'self',
///    X-Frame-Options), its type taken as named (nosniff) and no referrer sent elsewhere; the wall
///    display, which only shows, may be framed.
///  - S5: a cover from an address typed into the album editor is never fetched from this machine or its
///    link (loopback, link-local, 0.0.0.0), on any redirect hop, by its name or what DNS answers; LAN
///    addresses are. The tests' own world is loopback, so the route is held to the rest of it and the
///    rules (Addresses.cs) are asked directly.
///  - S6: a LinkPlay player's self-signed certificate is taken from a private network's address, and only there.
/// S1, a backup sealed with a passphrase: BackupSealedTests and the backup page's tests
/// (test/security.test.js, in C#).
/// </summary>
public sealed class SecurityTests
{
    // A web server on loopback: routes by path, else 404.
    private static Task<FakeServer> Serve(Dictionary<string, Func<HttpContext, Task>> routes) =>
        FakeServer.Start(ctx => routes.TryGetValue(ctx.Request.Path.Value ?? "", out var f) ? f(ctx) : Task.FromResult(ctx.Response.StatusCode = 404));

    [Test]
    public async Task S2_the_pages_files_carry_their_guards_the_wall_display_may_be_framed()
    {
        await using var s = await Session.Started();
        var app = new Dictionary<string, string>(s.H) { ["User-Agent"] = "Mozilla/5.0 (Linux; Android 15; wv) MusicDAndroid/0.9.0" };
        async Task<(int, string?, string?, string?, string?)> Guards(string p, IDictionary<string, string>? h)
        {
            var r = await Http.Get(s.Base + p, h);
            return (r.Status, r.Header("content-security-policy"), r.Header("x-frame-options"), r.Header("x-content-type-options"), r.Header("referrer-policy"));
        }
        var framedHere = (200, "frame-ancestors 'self'", "SAMEORIGIN", "nosniff", "same-origin");
        // The page and the pages that act: at their routes, as files, as a deep link, and the app's own form.
        foreach (var (p, h) in new (string, IDictionary<string, string>?)[] { ("/", s.H), ("/index.html", s.H), ("/library", s.H), ("/album/12", s.H), ("/library", app),
            ("/login", null), ("/login.html", null), ("/shelf", s.H), ("/shelf.html", s.H) })
            Assert.True(await Guards(p, h) == framedHere, p + (h == app ? " (the app's)" : "") + ": " + await Guards(p, h));
        // The wall display: shown, never acted on, so it may be framed.
        foreach (var p in new[] { "/display", "/display.html" })
            Assert.True(await Guards(p, s.H) == (200, null, null, "nosniff", "same-origin"), p);
        // The page's script and style: their type as named.
        foreach (var p in new[] { "/app.js", "/style.css" })
        {
            var g = await Guards(p, s.H);
            Assert.True((g.Item4, g.Item5) == ("nosniff", "same-origin"), p);
        }
    }

    [Test]
    public async Task S5_the_album_editor_never_fetches_a_cover_from_this_machines_link_or_0_0_0_0_on_any_hop()
    {
        await using var s = await Session.Started();
        var one = (await s.Album("Album One"))!;
        var cover = await File.ReadAllBytesAsync(Path.Combine(s.Lib.Music, "Artist A", "Album One", "cover.jpg"));
        static Func<HttpContext, Task> To(Func<string> where) => ctx => { ctx.Response.StatusCode = 302; ctx.Response.Headers.Location = where(); return Task.CompletedTask; };
        FakeServer? web = null;
        await using var w = web = await Serve(new()
        {
            ["/cover.jpg"] = async ctx => { ctx.Response.ContentType = "image/jpeg"; await ctx.Response.Body.WriteAsync(cover); },
            ["/to-metadata"] = To(() => "http://169.254.169.254/latest/meta-data/"),
            ["/to-zero"] = To(() => $"http://0.0.0.0:{web!.Port}/cover.jpg"),
            ["/to-link6"] = To(() => "http://[fe80::1]/cover.jpg")
        });
        var W = web.Base;
        async Task<(int, JsonNode?)> Edit(string artUrl) { var r = await s.Api("album/edit", new { offset = one.Num("offset"), art_url = artUrl }); return (r.Status, r.Json); }
        async Task Refused(string url, string host)
        {
            var (status, body) = await Edit(url);
            Assert.True(status == 502, url + ": " + status + " " + body?.ToJsonString());
            JsonAssert.Same(Http.Json(new { error = $"Couldn't download that image ({host} is this server's own address or its link's)" }), body, url);
        }

        // Named outright: a cloud's metadata service, IPv6's link, IPv4's inside IPv6, and 0.0.0.0, which reaches this machine.
        await Refused("http://169.254.169.254/latest/meta-data/", "169.254.169.254");
        await Refused("http://[fe80::1]/cover.jpg", "[fe80::1]");
        await Refused("http://[::ffff:169.254.169.254]/", "[::ffff:169.254.169.254]");
        await Refused($"http://0.0.0.0:{web.Port}/cover.jpg", "0.0.0.0");
        // Reached by a redirect from an address that is taken.
        await Refused(W + "/to-metadata", "169.254.169.254");
        await Refused(W + "/to-zero", "0.0.0.0");
        await Refused(W + "/to-link6", "[fe80::1]");
        // The tests' own loopback is taken (production refuses it: the rules below), and the cover is kept.
        var (ok, kept) = await Edit(W + "/cover.jpg");
        Assert.True(ok == 200, kept?.ToJsonString());
        Assert.True(kept?["art"].Bool("found"));
    }

    [Test]
    public async Task S5_S6_the_rules_of_where_the_server_may_go_asked_directly()
    {
        Needs.Server();
        string[] ips = ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "0.0.0.0", "0.1.2.3", "::", "169.254.169.254", "169.254.1.1", "fe80::1",
            "10.0.0.5", "172.15.0.1", "172.16.0.1", "172.31.255.255", "172.32.0.1", "192.168.1.20", "::ffff:192.168.1.1", "100.64.0.1",
            "fc00::1", "fd00::5", "8.8.8.8", "2001:db8::1"];
        await using var web = await Serve(new() { ["/cover.jpg"] = async ctx => await ctx.Response.WriteAsync("x") });
        var W = "127.0.0.1:" + web.Port;
        var o = await Score.Run(new
        {
            fn = "addresses", ips,
            hosts = new[] { "localhost", "192.168.1.20", "[fd00::5]", "8.8.8.8", "[2001:db8::1]", "" },
            art = new object[][] { ["http://localhost:9/a.jpg", false], ["http://localhost:9/a.jpg", true], ["http://127.0.0.1/a.jpg", false], ["http://127.0.0.1/a.jpg", true],
                ["http://[::1]/a.jpg", false], ["http://169.254.169.254/", true], ["http://192.168.1.20/a.jpg", false], ["http://[fd00::5]/a.jpg", false], ["http://8.8.8.8/a.jpg", false] },
            connect = new object[]
            {
                new { url = $"http://{W}/cover.jpg", loopbackTaken = false },
                new { url = $"http://localhost:{web.Port}/cover.jpg", loopbackTaken = false },
                new { url = $"http://{W}/cover.jpg", loopbackTaken = true },
                // Through a proxy (here, on loopback): the proxy reached, the address left to it.
                new { url = "http://covers.example/cover.jpg", loopbackTaken = false, proxy = "http://" + W }
            }
        });
        string By(string list, Func<string, bool> rule) => Http.Json(ips.Select((ip, i) => (ip, (bool)o[list]![i]!, rule(ip))).Where(x => x.Item2 != x.Item3).Select(x => x.ip));
        string[] inward = ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "0.0.0.0", "0.1.2.3", "::", "169.254.169.254", "169.254.1.1", "fe80::1"];
        Assert.True(By("inward", inward.Contains) == "[]", "this machine or its link, wrong for: " + By("inward", inward.Contains));
        string[] priv = ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1", "169.254.169.254", "169.254.1.1", "fe80::1",
            "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.20", "::ffff:192.168.1.1", "fc00::1", "fd00::5"];
        Assert.True(By("private", priv.Contains) == "[]", "a private network's, wrong for: " + By("private", priv.Contains));
        JsonAssert.Same("[true,true,true,false,false,false]", o["hosts"], "a host's addresses all private");
        static string No(string host) => $"{host} is this server's own address or its link's";
        JsonAssert.Same(Http.Json(new[] { No("localhost"), null, No("127.0.0.1"), null, No("[::1]"), No("169.254.169.254"), null, null, null }), o["art"], "a cover's address");
        JsonAssert.Same(Http.Json(new object[] { No("127.0.0.1"), No("localhost"), 200, 200 }), o["connect"], "a cover's connection");
    }

    [Test]
    public async Task S6_a_LinkPlay_players_own_certificate_taken_from_a_private_address()
    {
        Needs.Server();
        // Signed by itself, as a WiiM's is.
        using var key = RSA.Create(2048);
        var req = new CertificateRequest("CN=WiiM", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var made = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(2));
        using var cert = X509CertificateLoader.LoadPkcs12(made.Export(X509ContentType.Pfx), null);
        await using var wiim = await FakeServer.Start(async ctx =>
        {
            ctx.Response.ContentType = "application/json";
            await ctx.Response.WriteAsync(Http.Json(new { uuid = "FF31F09E-0000-0000-0000-000000000001", DeviceName = "Kitchen WiiM", project = "WiiM_Pro" }));
        }, cert: cert);
        var o = await Score.Run(new { fn = "addresses", linkplay = new[] { "https://127.0.0.1:" + wiim.Port } });
        Assert.True(o["linkplay"]?[0].Str("DeviceName") == "Kitchen WiiM", o["linkplay"]?.ToJsonString());
    }
}
