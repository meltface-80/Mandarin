namespace Mandarin.Tests;

/// <summary>
/// A cover that can't be had (Images.cs): its 404 tells the phone not to ask again for five minutes, and asked
/// again it is answered at once, kept, ffmpeg not run for it a second time; the library scanned again (a cover put
/// right, or one that failed to draw), it is found. ffmpeg stood in for by a script that writes down each drawing.
/// </summary>
public sealed class CoverMissTests
{
    [Test]
    public async Task A_missing_cover_is_remembered_answered_at_once_and_found_once_put_right()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (!OperatingSystem.IsLinux()) Assert.Skip("ffmpeg stood in for by a shell script");
        var lib = Fixtures.MakeLibrary();
        // Hi Res's cover is no picture at all: ffmpeg can't draw it.
        var cover = Path.Combine(lib.Music, "Artist B", "Hi Res", "cover.jpg");
        await File.WriteAllTextAsync(cover, "not a picture");
        var dir = Path.Combine(lib.Root, "bin");
        Directory.CreateDirectory(dir);
        var bin = Path.Combine(dir, "ffmpeg");
        var log = Path.Combine(dir, "draws.log");
        // While [broken] is there, every drawing fails, as one would on a machine short of memory.
        var broken = Path.Combine(dir, "broken");
        await File.WriteAllTextAsync(bin, $"""
            #!/bin/sh
            case " $* " in *" mjpeg "*) echo "draw" >> "{log}"; [ -e "{broken}" ] && exit 1;; esac
            exec "{Fixtures.Ffmpeg}" "$@"
            """.Replace("\r", "", StringComparison.Ordinal) + "\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(bin, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        int Draws() => File.Exists(log) ? File.ReadAllLines(log).Length : 0;
        await using var s = await Session.Started(lib: lib, env: new Dictionary<string, string> { ["FFMPEG_PATH"] = bin });
        var key = (await s.Album("Hi Res")).Str("image_key");

        var first = await Bytes.Get(s.Base + "/api/image/" + key + "?size=300", s.H);
        Assert.Equal(404, first.Status);
        Assert.Equal("max-age=300", first.Header("Cache-Control"));
        Assert.Null(first.Header("X-Mandarin-Kept"));
        var tried = Draws();
        Assert.True(tried > 0, "the cover was tried");

        // Asked again, at this size and another: missed still, without the work.
        foreach (var size in new[] { 300, 120 })
        {
            var again = await Bytes.Get(s.Base + "/api/image/" + key + "?size=" + size, s.H);
            Assert.Equal((404, "1", "max-age=300"), (again.Status, again.Header("X-Mandarin-Kept"), again.Header("Cache-Control")));
        }
        Assert.True(Draws() == tried, "ffmpeg ran again for a cover missed a moment ago");

        // A cover whose drawing failed (its address the same once it can be drawn): missed still until the
        // library is scanned again, then found.
        await File.WriteAllTextAsync(broken, "");
        var one = (await s.Album("Album One")).Str("image_key");
        Assert.Equal(404, (await Bytes.Get(s.Base + "/api/image/" + one + "?size=300", s.H)).Status);
        File.Delete(broken);
        Assert.Equal("1", (await Bytes.Get(s.Base + "/api/image/" + one + "?size=300", s.H)).Header("X-Mandarin-Kept"));

        // Hi Res's put right; the library scanned again: both found, Hi Res under its new address and the old one.
        Fixtures.Run(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=400x400", "-frames:v", "1", cover]);
        Assert.Equal(200, (await s.Api("library/rescan", new { force = true })).Status);
        await Session.Until(async () => (await s.Album("Hi Res")).Str("image_key") != key, 30000, "the new cover scanned");
        Assert.Equal(one, (await s.Album("Album One")).Str("image_key"));
        await Session.Until(async () => (await Bytes.Get(s.Base + "/api/image/" + one + "?size=300", s.H)).Status == 200, 30000, "Album One's cover found after the scan");
        var now = (await s.Album("Hi Res")).Str("image_key");
        Assert.Equal(200, (await Bytes.Get(s.Base + "/api/image/" + now + "?size=300", s.H)).Status);
        Assert.Equal(200, (await Bytes.Get(s.Base + "/api/image/" + key + "?size=120", s.H)).Status);
    }
}
