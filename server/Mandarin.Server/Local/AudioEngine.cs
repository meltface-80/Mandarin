// AudioEngine.cs — Mandarin's audio engine for sound devices on the server
// (engine/Mandarin.Audio), as lib/local/engine.js finds it (v0.8.49, stage 6
// part 4): AUDIO_ENGINE_BIN, the image's (engine/bin/mandarin-audio beside the
// app), or one in the data folder; the first that answers "<version> protocol
// 1". None with AUDIO_ENGINE=0, or off Linux (ALSA). One found is remembered;
// none is looked for again a minute on.
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Local;

internal static partial class AudioEngine
{
    private const int Protocol = 1;
    private static readonly object Gate = new();
    private static Found? found;
    private static long lookedAt;

    public sealed record Found(string Bin, string Version);

    public static string? Version() => Find()?.Version;

    private static bool Off => (Environment.GetEnvironmentVariable("AUDIO_ENGINE") ?? "").Trim() == "0" || !OperatingSystem.IsLinux();
    private static string DownloadedBin(string dataDir) => Path.Combine(dataDir, "bin", "mandarin-audio");

    /* The engine to use, or null. Decided once (and again a minute on when there was none). */
    public static Found? Find(string? dataDir = null)
    {
        if (Off) return null;
        lock (Gate)
        {
            if (found != null) return found;
            if (Environment.TickCount64 - lookedAt < 60000 && lookedAt != 0) return null;
            lookedAt = Environment.TickCount64;
            var app = Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Server.FindAppDir();
            var data = dataDir is { Length: > 0 } ? dataDir : Server.DataDir;
            var tries = new[] { Environment.GetEnvironmentVariable("AUDIO_ENGINE_BIN"), Path.Combine(app, "engine", "bin", "mandarin-audio"), data.Length > 0 ? DownloadedBin(data) : null };
            foreach (var b in tries)
                if (!string.IsNullOrEmpty(b) && Probe(b) is { } v) return found = new Found(b, v);
            return null;
        }
    }

    /* A location the engine can play: an ALSA device, or the tests' file. */
    public static bool Plays(string? location) => Regex.IsMatch(location ?? "", "^(alsa|file):");

    private static bool Executable(string f)
    {
        if (OperatingSystem.IsWindows()) return false;
        try { return File.Exists(f) && (File.GetUnixFileMode(f) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) != 0; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { return false; }
    }

    /* "0.8.0 protocol 1" from the program, or null if it isn't one that can be driven. */
    public static string? Probe(string bin)
    {
        if (Off || !Executable(bin)) return null;
        try
        {
            using var p = Process.Start(new ProcessStartInfo(bin, "--version") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false })!;
            var outText = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(5000)) { try { p.Kill(); } catch (InvalidOperationException) { /* gone */ } return null; }
            var m = Regex.Match(outText.Result, @"^(\S+) protocol ([0-9]+)");
            return m.Success && int.TryParse(m.Groups[2].Value, out var n) && n == Protocol ? m.Groups[1].Value : null;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or UnauthorizedAccessException or InvalidOperationException) { return null; }
    }
}
