// HealthRoutes.cs — GET /api/health (v0.8.48, stage 5 part 7 of
// docs/specs/csharp-migration.md), from index.js, in the same shape. Open, as
// it was: Docker's health check asks it every minute.
//
//   { ok, version, albums, rooms, ffmpeg, soxr,
//     transcode_cache: { files, bytes, running, queued }, audio_engine, csharp }
//
// The rooms the Node server has found (playback is its until stage 6) and how
// bringing this server to its version went (lib/server/csharp-update.js) come
// with its state (/internal/library); the rest is this server's own: the
// library's count, ffmpeg, the conversions (made here since v0.8.40), and the
// audio engine, found where lib/local/engine.js looks for it.
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static partial class Library
{
    private static Task<bool> Health(HttpContext ctx, Snapshot s, LibState st)
    {
        var (files, bytes, running, queued) = Transcoder.CacheStats();
        return Send(ctx, new JsonObject
        {
            ["ok"] = true,
            ["version"] = Front.Version,
            ["albums"] = s.Count,
            // The rooms found: the hub's own once this server holds playback (v0.8.49), else as the Node server says them.
            ["rooms"] = Playback.Hub.Current is { } hub ? hub.RoomCount : st.Said["rooms"] is JsonValue r && r.TryGetValue<double>(out var rooms) ? rooms : 0,
            ["ffmpeg"] = Transcoder.FfOk,
            ["soxr"] = Transcoder.Soxr,
            ["transcode_cache"] = new JsonObject { ["files"] = files, ["bytes"] = bytes, ["running"] = running, ["queued"] = queued },
            ["audio_engine"] = AudioEngine.Version(),
            ["csharp"] = st.Said["csharp_update"]?.DeepClone()
        });
    }
}

/*
 * Mandarin's audio engine for sound devices on the server, as lib/local/engine.js
 * finds it: AUDIO_ENGINE_BIN, the image's (engine/bin/mandarin-audio beside the
 * app), or the one downloaded into the data folder; the first that answers
 * "<version> protocol 1". None with AUDIO_ENGINE=0, or off Linux (it plays
 * through ALSA). One found is remembered; none is looked for again a minute on
 * (the Node server downloads it in the background where it may).
 */
internal static class AudioEngine
{
    private const int Protocol = 1;
    private static string? found;
    private static long lookedAt;
    private static readonly object Gate = new();

    public static string? Version()
    {
        if ((Environment.GetEnvironmentVariable("AUDIO_ENGINE") ?? "").Trim() == "0") return null;
        if (!OperatingSystem.IsLinux()) return null;
        lock (Gate)
        {
            if (found != null) return found;
            if (Environment.TickCount64 - lookedAt < 60000 && lookedAt != 0) return null;
            lookedAt = Environment.TickCount64;
            var app = Environment.GetEnvironmentVariable("MANDARIN_APP_DIR") ?? Front.FindAppDir();
            var tries = new[]
            {
                Environment.GetEnvironmentVariable("AUDIO_ENGINE_BIN"),
                Path.Combine(app, "engine", "bin", "mandarin-audio"),
                Front.DataDir.Length > 0 ? Path.Combine(Front.DataDir, "bin", "mandarin-audio") : null
            };
            foreach (var b in tries)
                if (!string.IsNullOrEmpty(b) && Probe(b) is { } v) return found = v;
            return null;
        }
    }

    /* "0.8.0 protocol 1" from the program, or null if it isn't one that can be driven. */
    private static string? Probe(string bin)
    {
        if (!OperatingSystem.IsLinux()) return null;
        try
        {
            if (!File.Exists(bin) || (File.GetUnixFileMode(bin) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) == 0) return null;
            using var p = Process.Start(new ProcessStartInfo(bin, "--version") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false })!;
            var outText = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(5000)) { try { p.Kill(); } catch (InvalidOperationException) { /* gone */ } return null; }
            var m = System.Text.RegularExpressions.Regex.Match(outText.Result, @"^(\S+) protocol (\d+)");
            return m.Success && int.TryParse(m.Groups[2].Value, out var n) && n == Protocol ? m.Groups[1].Value : null;
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or UnauthorizedAccessException or InvalidOperationException) { return null; }
    }
}
