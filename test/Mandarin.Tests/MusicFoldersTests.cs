namespace Mandarin.Tests;

/// <summary>
/// Settings → Music folders: the library read from any number of folders, added and removed in the app
/// (as Roon does) rather than only through the container's -v lines (test/music-folders.test.js, in C#).
/// </summary>
public sealed class MusicFoldersTests
{
    [Test]
    public async Task Music_folders_are_added_browsed_and_removed_in_Settings()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        // Artist B lives somewhere else, not in the server's own music folder.
        var other = Path.Combine(lib.Root, "nas", "Music");
        Directory.CreateDirectory(other);
        Directory.Move(Path.Combine(lib.Music, "Artist B"), Path.Combine(other, "Artist B"));
        await using var srv = await new TestServer(Ports.Port(), lib.Music, lib.Data, new Dictionary<string, object?> { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>() }).Start();
        var token = await Session.SignIn(srv.Base);
        var h = new Dictionary<string, string> { ["Authorization"] = "Bearer " + token };
        async Task<System.Text.Json.Nodes.JsonNode> Get(string p) => (await Http.Get(srv.Base + p, h)).J;
        async Task<Http.Answer> Post(string p, object body) => await Http.Post(srv.Base + p, body, h);
        async Task<double?> Count() => (await Get("/api/library-stats")).Num("albums");

        await Session.Until(async () => await Count() == 2 && (await Get("/api/status")).Bool("library_importing") != true, 20000);
        // Away from home (over Tailscale) the folders are still yours to see and change.
        var away = await Http.Get(srv.Base + "/api/library/folders", new Dictionary<string, string>(h) { ["X-Forwarded-For"] = "100.101.102.103" });
        Assert.Equal(200, away.Status);
        Assert.Single(away.J["folders"].Items());

        var f = await Get("/api/library/folders");
        Assert.Equal([(lib.Music, true)], f["folders"].Items().Select(x => (x.Str("path"), x.Bool("default") ?? false)).ToArray());

        // Browse to it, as the folder picker does.
        var up = await Get("/api/library/browse?path=" + Uri.EscapeDataString(Path.Combine(lib.Root, "nas")));
        Assert.Equal(["Music"], up["dirs"].Items().Select(d => d.Str("name") ?? "").ToArray());
        Assert.Equal(lib.Root, up.Str("parent"));

        // Added: read at once, its albums join the library.
        var r = await Post("/api/library/folders", new { add = other });
        Assert.True(r.Status == 200, r.Text);
        await Session.Until(async () => await Count() == 3, 20000);
        f = await Get("/api/library/folders");
        string[] both = [.. new[] { lib.Music, other }.Order(StringComparer.Ordinal)];
        Assert.Equal(both, f["folders"].Items().Select(x => x.Str("path")).ToArray());
        Assert.Equal(2, f["folders"].Items().First(x => x.Str("path") == other).Num("tracks"));
        Assert.Equal(both, (await Get("/api/status")).Strs("music_dirs").ToArray());

        // Inside one already there, the data folder, somewhere unreadable: said why.
        r = await Post("/api/library/folders", new { add = Path.Combine(other, "Artist B") });
        Assert.Equal(400, r.Status); Assert.Matches("Already in the library", r.J.Str("error"));
        r = await Post("/api/library/folders", new { add = lib.Data });
        Assert.Equal(400, r.Status); Assert.Matches("data folder", r.J.Str("error"));
        r = await Post("/api/library/folders", new { add = Path.Combine(lib.Root, "nowhere") });
        Assert.Equal(400, r.Status); Assert.Matches("Can't read", r.J.Str("error"));
        r = await Post("/api/library/folders", new { add = "/proc" });
        Assert.Equal(400, r.Status);

        // Removed: its albums leave with it. The last one can't be.
        await Session.Until(async () => (await Get("/api/status")).Bool("library_importing") != true, 20000);
        r = await Post("/api/library/folders", new { remove = other });
        Assert.True(r.Status == 200, r.Text);
        Assert.Equal(2, r.J.Num("removed"));
        Assert.Equal(2, await Count());
        r = await Post("/api/library/folders", new { remove = lib.Music });
        Assert.Equal(400, r.Status); Assert.Matches("only music folder", r.J.Str("error"));
    }
}
