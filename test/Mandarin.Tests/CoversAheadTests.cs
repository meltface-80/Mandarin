using System.Globalization;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The covers Home asks for, ready before it does (Covers.Ahead.cs): after a scan, the tiles' two sizes (120, 300) of
/// every album not drawn yet are drawn in the background, and a cover asked for then is sent as drawn, ffmpeg not run
/// for it; and covers asked for at once are drawn as many at a time as there are cores, two to four (two before).
/// ffmpeg stood in for by a script that writes down each drawing it runs, then runs the real one.
/// </summary>
public sealed class CoversAheadTests
{
    // ffmpeg behind a script: each drawing (a JPEG written out) noted as it starts and ends, held [hold] seconds.
    private static (string Bin, string Log) Ffmpeg(string dir, double hold = 0)
    {
        Directory.CreateDirectory(dir);
        var bin = Path.Combine(dir, "ffmpeg");
        var log = Path.Combine(dir, "draws.log");
        var real = Fixtures.Ffmpeg;
        var wait = hold > 0 ? "sleep " + hold.ToString(CultureInfo.InvariantCulture) : "true";
        File.WriteAllText(bin, $"""
            #!/bin/sh
            case " $* " in *" mjpeg "*) draw=1; echo "start $$ $(date +%s%N)" >> "{log}"; {wait};; esac
            "{real}" "$@"
            code=$?
            [ -n "$draw" ] && echo "end $$ $(date +%s%N)" >> "{log}"
            exit $code
            """.Replace("\r", "", StringComparison.Ordinal) + "\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(bin, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        return (bin, log);
    }

    private static string[] Lines(string log) => File.Exists(log) ? File.ReadAllLines(log) : [];

    // The most drawings running at once, from the notes.
    private static int MostAtOnce(string log)
    {
        var marks = Lines(log).Select(l => l.Split(' ')).Select(p => (At: long.Parse(p[2], CultureInfo.InvariantCulture), Up: p[0] == "start" ? 1 : -1))
            .OrderBy(m => m.At).ThenBy(m => m.Up);
        int now = 0, most = 0;
        foreach (var m in marks) most = Math.Max(most, now += m.Up);
        return most;
    }

    [Test]
    public async Task After_a_scan_the_tiles_covers_are_drawn_ahead_and_sent_as_drawn_without_running_ffmpeg()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (!OperatingSystem.IsLinux()) Assert.Skip("ffmpeg stood in for by a shell script");
        var lib = Fixtures.MakeLibrary();
        var (bin, log) = Ffmpeg(Path.Combine(lib.Root, "bin"));
        await using var s = await Session.Started(new Dictionary<string, object?> { ["coversAhead"] = true }, lib, new Dictionary<string, string> { ["FFMPEG_PATH"] = bin });
        var albums = (await s.Api("library/albums?count=100")).J["albums"].Items().ToList();
        Assert.Equal(3, albums.Count);
        var art = Path.Combine(lib.Data, "art");
        string Kept(JsonNode? al, int size) => Path.Combine(art, al.Str("image_key") + "@" + size + ".jpg");
        // Album One's own cover, the other two their placeholders: each at both sizes, without being asked.
        await Session.Until(() => Task.FromResult(albums.All(al => File.Exists(Kept(al, 120)) && File.Exists(Kept(al, 300)))), 60000, "the covers drawn ahead");
        File.Delete(log);
        foreach (var al in albums)
            foreach (var size in new[] { 120, 300 })
            {
                var r = await Bytes.Get(s.Base + "/api/image/" + al.Str("image_key") + "?size=" + size, s.H);
                Assert.Equal(200, r.Status);
                Assert.Equal(await File.ReadAllBytesAsync(Kept(al, size)), r.Body);
            }
        Assert.True(Lines(log).Length == 0, "ffmpeg ran for a cover drawn ahead: " + string.Join("; ", Lines(log)));
    }

    [Test]
    public async Task Covers_asked_for_at_once_are_drawn_as_many_at_a_time_as_there_are_cores_two_to_four()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (!OperatingSystem.IsLinux()) Assert.Skip("ffmpeg stood in for by a shell script");
        var lib = Fixtures.MakeLibrary();
        var (bin, log) = Ffmpeg(Path.Combine(lib.Root, "bin"), hold: 1);
        await using var s = await Session.Started(lib: lib, env: new Dictionary<string, string> { ["FFMPEG_PATH"] = bin });
        var one = (await s.Album("Album One"))!;
        File.Delete(log);
        // Six sizes of one cover, each its own drawing, asked for together.
        var asked = new[] { 120, 200, 300, 400, 600, 800 }.Select(size => Bytes.Get(s.Base + "/api/image/" + one.Str("image_key") + "?size=" + size, s.H)).ToList();
        foreach (var r in await Task.WhenAll(asked)) Assert.Equal(200, r.Status);
        Assert.Equal(12, Lines(log).Length);
        Assert.Equal(Math.Clamp(Environment.ProcessorCount, 2, 4), MostAtOnce(log));
    }
}
