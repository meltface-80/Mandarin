namespace Mandarin.Tests;

/// <summary>
/// A track that leaves the library while its loudness is measured (bug list item 179): nothing is kept for it.
/// Tracks' ids are given out again, and a row kept under a gone track's id would be the next track's, which
/// would then count as measured and never be measured.
/// </summary>
public sealed class LoudnessGoneTrackTests
{
    [Test]
    public async Task A_track_gone_while_it_is_measured_has_nothing_kept_under_its_id()
    {
        Needs.Server(); Needs.Ffmpeg();
        if (OperatingSystem.IsWindows()) Assert.Skip("a shell script stands in for ffmpeg");
        var lib = Fixtures.MakeLibrary();
        // An ffmpeg that notes each measuring and holds it until told, then is the real one.
        var started = Path.Combine(lib.Root, "started.log");
        var go = Path.Combine(lib.Root, "go");
        var wrapper = Path.Combine(lib.Root, "ffmpeg-held");
        await File.WriteAllTextAsync(wrapper, $$"""
            #!/bin/sh
            case "$*" in *ebur128*) echo "$*" >> '{{started}}'; while [ ! -e '{{go}}' ]; do sleep 0.05; done;; esac
            exec "$REAL_FFMPEG" "$@"

            """);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(wrapper, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var real = Fixtures.Ffmpeg;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(':'))
            if (!Path.IsPathRooted(real) && File.Exists(Path.Combine(dir, real))) real = Path.Combine(dir, real);
        await using var s = await Session.Started(options: new Dictionary<string, object?> { ["loudnessTickMs"] = 100 }, lib: lib,
            env: new Dictionary<string, string> { ["FFMPEG_PATH"] = wrapper, ["REAL_FFMPEG"] = real });
        // Measuring at any hour (identification's schedule off), switched on.
        Assert.Equal(200, (await s.Api("identify/settings", new { schedule = false })).Status);
        Assert.Equal(200, (await s.Api("loudness", new { measure = true })).Status);
        await Session.Until(() => Task.FromResult(File.Exists(started) && File.ReadAllText(started).Contains(".flac", StringComparison.Ordinal)), 30000, "a measuring begun");

        // The first file being measured leaves the library meanwhile.
        var first = File.ReadAllLines(started)[0];
        var row = s.Server.Rows("SELECT id, path FROM tracks").First(r => first.Contains((string)r["path"]!, StringComparison.Ordinal));
        var id = (long)row["id"]!;
        SqliteDump.Exec(Path.Combine(lib.Data, "musicd.db"), $"DELETE FROM tracks WHERE id = {id}");
        File.WriteAllText(go, "");

        await Session.Until(async () => (await s.Api("loudness")).Json?["reason"]?.GetValue<string>() == "done", 60000, "the measuring done");
        Assert.Empty(s.Server.Rows($"SELECT track_id FROM track_loudness WHERE track_id = {id}"));
        Assert.NotEmpty(s.Server.Rows("SELECT track_id FROM track_loudness"));
    }
}
