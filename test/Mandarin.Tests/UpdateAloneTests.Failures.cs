using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An update that fails part way (bug list item 180): a check whose answer is cut off ends in an error, and so
/// does the install that started it, every time it is asked again (it stayed "checking", every later ask turned
/// away); the new program is swapped in only once the bundle's files are laid in, so a failure laying them in
/// leaves the program as it was, and one once it is swapped in puts the one before back; an install any of whose
/// folders the bundle lays files in can't be written is refused before anything is changed.
/// </summary>
public sealed partial class UpdateAloneTests
{
    // An install apart from this checkout, its server started, GitHub stood in for (cut: the latest release's answer cut off half way).
    private sealed record Installed(ServerProcess Srv, FakeServer Gh, string App, string Bin, string Marker, string Tmp, Dictionary<string, string> H) : IAsyncDisposable
    {
        public async Task<(int Status, JsonNode Body)> Api(string p, bool post = false)
        {
            var r = post ? await Http.Post(Srv.Base + "/api/update/" + p, new { }, H) : await Http.Get(Srv.Base + "/api/update/" + p, H);
            return (r.Status, r.J);
        }

        public async ValueTask DisposeAsync() { await Srv.Stop(); await Gh.DisposeAsync(); }
    }

    private static async Task<Installed> Install(Fake fake, Func<bool> cut)
    {
        var gh = await FakeServer.Start(async ctx =>
        {
            var u = ctx.Request.Path.Value ?? "";
            async Task Send(int code, byte[] body, string type = "application/json") { ctx.Response.StatusCode = code; ctx.Response.ContentType = type; await ctx.Response.Body.WriteAsync(body); }
            if (u == "/repos/me/musicd/releases/latest" && cut())
            {
                // Its headers, a little of its body, then the connection gone.
                ctx.Response.StatusCode = 200; ctx.Response.ContentType = "application/json"; ctx.Response.ContentLength = 4000;
                await ctx.Response.Body.WriteAsync("{\"tag_name\": \"v9.9"u8.ToArray());
                await ctx.Response.Body.FlushAsync();
                // Gone once the headers are read and the body is being waited for (gone before, it is the ask that fails).
                await Task.Delay(500);
                ctx.Abort();
                return;
            }
            if (u == "/repos/me/musicd/releases/latest") { await (fake.Latest != null ? Send(200, Encoding.UTF8.GetBytes(fake.Latest.ToJsonString())) : Send(fake.LatestStatus, "{}"u8.ToArray())); return; }
            if (u == "/repos/me/musicd/releases/tags/v9.9.9") { await (fake.Tag != null ? Send(200, Encoding.UTF8.GetBytes(fake.Tag.ToJsonString())) : Send(404, "{}"u8.ToArray())); return; }
            if (fake.Files.TryGetValue(u, out var f)) { await Send(200, f, "application/octet-stream"); return; }
            await Send(404, "{}"u8.ToArray());
        });
        fake.Gh = gh.Base;
        var dir = Directory.CreateTempSubdirectory("musicd-upd-fail-").FullName;
        var app = Path.Combine(dir, "app");
        Directory.CreateDirectory(app);
        File.Copy(Path.Combine(ServerProcess.Root, "package.json"), Path.Combine(app, "package.json"));
        CopyTree(Path.Combine(ServerProcess.Root, "public"), Path.Combine(app, "public"));
        var bin = Path.Combine(app, "server", "bin", "mandarin-server");
        Directory.CreateDirectory(Path.GetDirectoryName(bin)!);
        File.Copy(ServerProcess.Bin, bin);
        var lib = Fixtures.MakeLibrary();
        var srv = await ServerProcess.Start(Ports.Port(), lib.Music, lib.Data, new Dictionary<string, string> { ["MANDARIN_APP_DIR"] = app, ["UPDATE_API"] = gh.Base, ["UPDATE_REPO"] = "me/musicd" }, bin);
        var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + await Session.SignIn(srv.Base) };
        return new Installed(srv, gh, app, bin, Path.Combine(dir, "started"), Path.Combine(dir, "tmp"), h);
    }

    private static string[] Beside(string bin) => [.. Directory.GetFileSystemEntries(Path.GetDirectoryName(bin)!).Select(Path.GetFileName).OfType<string>().Order(StringComparer.Ordinal)];

    [Test]
    public async Task A_check_whose_answer_is_cut_off_ends_in_an_error_and_so_does_the_install_each_time_it_is_asked()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (Build == null) Assert.Skip("no C# server is built for this machine");
        await using var i = await Install(new Fake(), () => true);
        // The install asked for first: it checks, and the check's failure is its own, every time.
        for (var n = 1; n <= 2; n++)
        {
            var r = await i.Api("apply", true);
            Assert.True(r.Status == 409, $"ask {n}: refused, saying why: {r.Status} {r.Body.ToJsonString()}");
            Assert.Equal("error", r.Body["status"]?["apply"].Str("phase"));
            Assert.Equal(r.Body.Str("error"), r.Body["status"]?["apply"].Str("error"));
            Assert.False(string.IsNullOrEmpty(r.Body.Str("error")), r.Body.ToJsonString());
        }
        Assert.Equal("error", (await i.Api("status")).Body["apply"].Str("phase"));
        // The check asked for by itself: it says why too.
        var c = await i.Api("check", true);
        Assert.True(c.Status == 200 && c.Body.Bool("checking") == false && c.Body.Str("error") is { Length: > 0 }, "the check says why: " + c.Status + " " + c.Body.ToJsonString());
        Assert.True(i.Srv.Exited == null, "still running");
    }

    [Test]
    public async Task The_new_program_is_swapped_in_last_and_the_one_before_put_back_when_the_update_fails_after()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (Build == null) Assert.Skip("no C# server is built for this machine");
        var fake = new Fake();
        await using var i = await Install(fake, () => false);
        Directory.CreateDirectory(i.Tmp);
        Bundle(fake, i.Tmp);
        var prog = Program(fake, i.Marker);
        var was = await File.ReadAllBytesAsync(i.Bin);

        // The bundle's README.md can't be laid in (a folder of that name there): the program as it was, nothing beside it.
        var readme = Path.Combine(i.App, "README.md");
        Directory.CreateDirectory(readme);
        var r = await i.Api("apply", true);
        Assert.True(r.Status == 409, r.Status + " " + r.Body.ToJsonString());
        Assert.Equal(("error", "9.9.9"), (r.Body["status"]?["apply"].Str("phase"), r.Body["status"]?["apply"].Str("version")));
        Assert.True((await File.ReadAllBytesAsync(i.Bin)).AsSpan().SequenceEqual(was), "the program as it was");
        Assert.Equal(["mandarin-server"], Beside(i.Bin));
        Assert.True(i.Srv.Exited == null, "still running");

        // Laid in, then the program's .version can't be written (a folder of that name): the one before put back.
        Directory.Delete(readme);
        Directory.CreateDirectory(i.Bin + ".version");
        r = await i.Api("apply", true);
        Assert.True(r.Status == 409, r.Status + " " + r.Body.ToJsonString());
        Assert.True((await File.ReadAllBytesAsync(i.Bin)).AsSpan().SequenceEqual(was), "the program before put back");
        Assert.Equal(["mandarin-server", "mandarin-server.version"], Beside(i.Bin));
        Assert.True(i.Srv.Exited == null, "still running");

        // Nothing in the way: the new program in place, the one before kept beside it.
        Directory.Delete(i.Bin + ".version");
        r = await i.Api("apply", true);
        Assert.True(r.Status == 200, r.Body.ToJsonString());
        await i.Srv.Proc.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
        Assert.True((await File.ReadAllBytesAsync(i.Bin)).AsSpan().SequenceEqual(prog), "the new program in place");
        Assert.True((await File.ReadAllBytesAsync(i.Bin + ".prev")).AsSpan().SequenceEqual(was), "the one before kept");
        Assert.Equal("9.9.9\n", await File.ReadAllTextAsync(i.Bin + ".version"));
    }

    [Test]
    public async Task An_install_that_can_t_be_written_is_refused_with_nothing_changed()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (Build == null || OperatingSystem.IsWindows()) { Assert.Skip("no C# server is built for this machine"); return; }
        // Root writes anywhere: a folder can't be made unwritable for it.
        var probe = Directory.CreateTempSubdirectory("musicd-ro-").FullName;
        File.SetUnixFileMode(probe, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        var privileged = true;
        try { File.WriteAllText(Path.Combine(probe, "x"), ""); } catch (UnauthorizedAccessException) { privileged = false; }
        if (privileged) Assert.Skip("this user writes to any folder (root)");

        var fake = new Fake();
        await using var i = await Install(fake, () => false);
        Directory.CreateDirectory(i.Tmp);
        Bundle(fake, i.Tmp);
        Program(fake, i.Marker);
        var was = await File.ReadAllBytesAsync(i.Bin);
        // The install's pages read only (the staging folder can still be made beside them); the program's folder still writable.
        var pages = Path.Combine(i.App, "public");
        File.SetUnixFileMode(pages, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        try
        {
            var r = await i.Api("apply", true);
            Assert.True(r.Status == 409, r.Status + " " + r.Body.ToJsonString());
            var again = OperatingSystem.IsMacOS() ? "run the install line again (README, Install on a Mac)" : "pull the image again (docker pull)";
            Assert.Equal($"{pages} can't be written to; {again} instead", r.Body.Str("error"));
            Assert.True((await File.ReadAllBytesAsync(i.Bin)).AsSpan().SequenceEqual(was), "the program as it was");
            Assert.True((string?)JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(i.App, "package.json")))!["version"] != "9.9.9", "nothing of the bundle laid in");
            Assert.False(File.Exists(Path.Combine(i.App, "README.md")));
            Assert.Equal(["mandarin-server"], Beside(i.Bin));
            Assert.True(i.Srv.Exited == null, "still running");
        }
        finally { File.SetUnixFileMode(pages, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute); }
    }
}
