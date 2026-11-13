using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// dev's builds (item 405, Admin/Updater.Channel.cs): with MANDARIN_CHANNEL=dev, Settings → Updates offers the newest of
/// dev's builds, the "test-server" pre-release (its version its bundle's, its files its own, checked as a release's are),
/// and never a release or a tag; without it, the latest release, as before. GitHub stood in for, holding both: a release
/// v9.9.8 and dev's 9.9.9.
/// </summary>
public sealed partial class UpdateAloneTests
{
    // An install apart from this checkout on [channel] (null: none said), GitHub's every ask written down in [asked].
    private static async Task<Installed> OnChannel(Fake fake, Func<JsonNode?> dev, ConcurrentQueue<string> asked, string? channel)
    {
        var gh = await FakeServer.Start(async ctx =>
        {
            var u = ctx.Request.Path.Value ?? "";
            asked.Enqueue(u);
            async Task Send(int code, byte[] body, string type = "application/json") { ctx.Response.StatusCode = code; ctx.Response.ContentType = type; await ctx.Response.Body.WriteAsync(body); }
            if (u == "/repos/me/musicd/releases/latest")
            {
                await Send(200, Encoding.UTF8.GetBytes(Http.Json(new { tag_name = "v9.9.8", html_url = fake.Gh + "/r", body = "- New - the release",
                    assets = new[] { new { name = "musicd-server-9.9.8.tar.gz", browser_download_url = fake.Gh + "/dl/release" } } })));
                return;
            }
            if (u == "/repos/me/musicd/releases/tags/test-server") { await (dev() is { } d ? Send(200, Encoding.UTF8.GetBytes(d.ToJsonString())) : Send(404, "{}"u8.ToArray())); return; }
            if (u == "/repos/me/musicd/tags") { await Send(200, """[{"name":"v9.9.7"}]"""u8.ToArray()); return; }
            if (fake.Files.TryGetValue(u, out var f)) { await Send(200, f, "application/octet-stream"); return; }
            await Send(404, "{}"u8.ToArray());
        });
        fake.Gh = gh.Base;
        var dir = Directory.CreateTempSubdirectory("musicd-upd-channel-").FullName;
        var app = Path.Combine(dir, "app");
        Directory.CreateDirectory(app);
        File.Copy(Path.Combine(ServerProcess.Root, "package.json"), Path.Combine(app, "package.json"));
        CopyTree(Path.Combine(ServerProcess.Root, "public"), Path.Combine(app, "public"));
        var bin = Path.Combine(app, "server", "bin", "mandarin-server");
        Directory.CreateDirectory(Path.GetDirectoryName(bin)!);
        File.Copy(ServerProcess.Bin, bin);
        var lib = Fixtures.MakeLibrary();
        var env = new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = app, ["UPDATE_API"] = gh.Base, ["UPDATE_REPO"] = "me/musicd",
            ["UPDATE_KEY"] = Convert.ToBase64String(Key.ExportSubjectPublicKeyInfo()) };
        if (channel != null) env["MANDARIN_CHANNEL"] = channel;
        var srv = await ServerProcess.Start(Ports.Port(), lib.Music, lib.Data, env, bin);
        var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + await Session.SignIn(srv.Base) };
        Directory.CreateDirectory(Path.Combine(dir, "tmp"));
        return new Installed(srv, gh, app, bin, Path.Combine(dir, "started"), Path.Combine(dir, "tmp"), h);
    }

    // dev's pre-release as GitHub answers /releases/tags/test-server: [fake]'s files (Bundle's and Program's), its notes the changelog's Unreleased.
    private static JsonNode DevRelease(Fake fake) => new JsonObject
    {
        ["tag_name"] = "test-server", ["prerelease"] = true, ["html_url"] = fake.Gh + "/dev", ["body"] = "Mandarin Server as dev is now.\n\n- Fixed - dev's newest",
        ["assets"] = fake.Release()!["assets"]!.DeepClone()
    };

    [Test]
    public async Task The_latest_channel_offers_the_release_and_the_dev_channel_offers_devs_newest_build_from_its_own_files()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (Build == null) Assert.Skip("no C# server is built for this machine");

        // No channel said: the latest release, as before, even with a newer build of dev's out.
        var fake = new Fake();
        var asked = new ConcurrentQueue<string>();
        JsonNode? dev = null;
        await using (var i = await OnChannel(fake, () => dev, asked, null))
        {
            Bundle(fake, i.Tmp);
            Program(fake, i.Marker);
            dev = DevRelease(fake);
            var c = (await i.Api("check", true)).Body;
            Assert.Equal(("9.9.8", true, "latest", "• New - the release"), (c.Str("latest"), c.Bool("available") ?? false, c.Str("channel"), c.Str("notes")));
            Assert.DoesNotContain("/repos/me/musicd/releases/tags/test-server", asked);
        }

        // dev's builds: none out yet, nothing on offer and no error, and no tag nor release offered in its place.
        fake = new Fake();
        asked = new ConcurrentQueue<string>();
        dev = null;
        await using var d = await OnChannel(fake, () => dev, asked, "dev");
        var r = (await d.Api("check", true)).Body;
        Assert.True((r.Str("latest"), r.Bool("available"), r.Str("error"), r.Str("channel")) == (null, false, null, "dev"), "nothing on offer: " + r.ToJsonString());
        Assert.DoesNotContain("/repos/me/musicd/releases/latest", asked);
        Assert.DoesNotContain("/repos/me/musicd/tags", asked);

        // Out: offered as its bundle's version, with its notes.
        Bundle(fake, d.Tmp);
        var prog = Program(fake, d.Marker);
        dev = DevRelease(fake);
        r = (await d.Api("check", true)).Body;
        Assert.Equal(("9.9.9", "v9.9.9", true, "• Fixed - dev's newest", "release"), (r.Str("latest"), r.Str("latestTag"), r.Bool("available") ?? false, r.Str("notes"), r.Str("source")));

        // Its files checked as a release's: its bundle without a signature refused, nothing changed.
        dev!["assets"] = new JsonArray([.. dev["assets"]!.AsArray().Where(a => a.Str("name") != "musicd-server-9.9.9.tar.gz.sig").Select(a => a!.DeepClone())]);
        var refused = await d.Api("apply", true);
        Assert.True(refused.Status == 409 && refused.Body.Str("error") == "release v9.9.9 carries no signature for musicd-server-9.9.9.tar.gz", refused.Status + " " + refused.Body.ToJsonString());
        Assert.True(d.Srv.Exited == null, "still running");

        // Signed: installed from dev's pre-release alone, and started again from the new program.
        dev = DevRelease(fake);
        var applied = await d.Api("apply", true);
        Assert.True(applied.Status == 200, applied.Body.ToJsonString());
        await d.Srv.Proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
        Assert.True(d.Srv.Proc.ExitCode == 3, $"the new program started (left with {d.Srv.Proc.ExitCode})");
        Assert.True((await File.ReadAllBytesAsync(d.Bin)).AsSpan().SequenceEqual(prog), "the new program in place");
        Assert.Equal("9.9.9", (string?)JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(d.App, "package.json")))!["version"]);
        Assert.DoesNotContain("/repos/me/musicd/releases/tags/v9.9.9", asked);
        Assert.DoesNotContain("/repos/me/musicd/releases/latest", asked);
    }
}
