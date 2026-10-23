using System.Formats.Tar;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Spotify Lossless through Spotify Soloist (bug list item 142, server/Mandarin.Server/Spotify): the key given in
/// Settings, Soloist downloaded (from a stand-in for Spotify's CDN), started with its own PulseAudio, signed in by a
/// phone, asked for lossless and started again to take it up; the sound proven lossless 24-bit from its samples, and
/// served as FLAC at 24 bits (16 when asked); the key never shown back nor logged. Soloist and PulseAudio are the
/// stand-ins' (test/StandIns: Soloist.cs, PulseAudio.cs).
/// </summary>
public sealed class SpotifyTests
{
    private const string Key = "sk-standin-0123456789abcdef";

    // Spotify's archive, as the CDN serves it: a folder with the soloist program in it (here the stand-in's script).
    private static byte[] Archive()
    {
        var script = System.Text.Encoding.UTF8.GetBytes($"#!/bin/sh\nexec dotnet \"{StandIn.Dll}\" soloist \"$0\" \"$@\"\n");
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.Fastest, leaveOpen: true))
        using (var tar = new TarWriter(gz, TarEntryFormat.Pax, leaveOpen: true))
        {
            var e = new PaxTarEntry(TarEntryType.RegularFile, "soloist_release/soloist") { DataStream = new MemoryStream(script), Mode = (UnixFileMode)0b111_101_101 };
            tar.WriteEntry(e);
        }
        return ms.ToArray();
    }

    private static async Task<JsonNode> State(Session s) => (await s.Api("settings/spotify")).J;

    // The first bytes of Spotify's stream: FLAC's marker and its STREAMINFO (rate, bits per sample).
    private static async Task<(string Marker, int Rate, int Bits)> StreamHead(Session s, string query = "")
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + "/stream/spotify/live.flac" + query);
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", s.Token);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var r = await Http.Client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(200, (int)r.StatusCode);
        Assert.Equal("audio/flac", r.Content.Headers.ContentType?.MediaType);
        await using var body = await r.Content.ReadAsStreamAsync(cts.Token);
        var b = new byte[42];
        await body.ReadExactlyAsync(b, cts.Token);
        var rate = (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
        var bits = (((b[20] & 0x01) << 4) | (b[21] >> 4)) + 1;
        return (System.Text.Encoding.ASCII.GetString(b, 0, 4), rate, bits);
    }

    // The stream read as fast as it comes for [ms]: how many seconds of sound came, decoded by ffmpeg, and how long it took.
    private static async Task<(double Seconds, long Ms)> StreamFor(Session s, int ms)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + "/stream/spotify/live.flac");
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", s.Token);
        var file = Path.Combine(Directory.CreateTempSubdirectory("mandarin-spotify-heard-").FullName, "heard.flac");
        var watch = System.Diagnostics.Stopwatch.StartNew();
        using (var cts = new CancellationTokenSource(ms))
        await using (var to = File.Create(file))
        {
            try
            {
                using var r = await Http.Client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                await (await r.Content.ReadAsStreamAsync(cts.Token)).CopyToAsync(to, cts.Token);
            }
            catch (OperationCanceledException) { /* as long as asked */ }
        }
        var took = watch.ElapsedMilliseconds;
        var psi = new System.Diagnostics.ProcessStartInfo("ffmpeg") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-v", "quiet", "-i", file, "-f", "s32le", "-ac", "2", "-ar", "44100", "pipe:1" }) psi.ArgumentList.Add(a);
        using var ff = System.Diagnostics.Process.Start(psi)!;
        _ = ff.StandardError.ReadToEndAsync();
        using var pcm = new MemoryStream();
        await ff.StandardOutput.BaseStream.CopyToAsync(pcm);
        await ff.WaitForExitAsync();
        return (pcm.Length / 8.0 / 44100, took);
    }

    // The stream's first four bytes and its type.
    private static async Task<(string Marker, string? Type)> StreamStart(Session s, string query)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + "/stream/spotify/live.flac" + query);
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", s.Token);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var r = await Http.Client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        var b = new byte[4];
        await (await r.Content.ReadAsStreamAsync(cts.Token)).ReadExactlyAsync(b, cts.Token);
        return (System.Text.Encoding.ASCII.GetString(b), r.Content.Headers.ContentType?.MediaType);
    }

    [Test]
    public async Task Spotify_plays_lossless_through_Soloist_from_its_key_to_the_rooms_stream()
    {
        if (!OperatingSystem.IsLinux()) Assert.Skip("Spotify Soloist runs on Linux only");
        var bin = Directory.CreateTempSubdirectory("mandarin-spotify-bin-").FullName;
        StandIn.Script("pulseaudio", Path.Combine(bin, "pulseaudio"));
        var archive = Archive();
        await using var cdn = await FakeServer.Start(async ctx => { ctx.Response.ContentType = "application/gzip"; await ctx.Response.Body.WriteAsync(archive); });
        await using var s = await Session.Started(env: new Dictionary<string, string>
        {
            ["PATH"] = bin + ":" + Environment.GetEnvironmentVariable("PATH"), ["SOLOIST_URL"] = cdn.Base + "/soloist_release_x86_64.tar.gz"
        });

        var before = await State(s);
        Assert.False(before["has_key"]!.GetValue<bool>());
        Assert.Equal("Mandarin", (string?)before["device_name"]);
        Assert.Equal("download", (string?)before["soloist"]!["plan"]);
        Assert.True(before["pulseaudio"]!.GetValue<bool>(), "the stand-in PulseAudio is on the PATH");

        // The key given: never sent back. Soloist downloaded and started on it.
        var saved = await s.Api("settings/spotify", new { api_key = Key, device_name = "Lounge" });
        Assert.Equal(200, saved.Status);
        Assert.DoesNotContain(Key, saved.Text);
        Assert.True(saved.J["has_key"]!.GetValue<bool>());

        // A phone chose it (the account appears): lossless asked for in the account's prefs, and Soloist started again to take it up.
        var dir = Path.Combine(s.Lib.Data, "spotify", "soloist");
        var prefsLog = Path.Combine(dir, "prefs.log");
        await Session.Until(() => Task.FromResult(File.Exists(prefsLog) && File.ReadAllLines(prefsLog).Length >= 2), 90000, "Soloist started again with lossless asked for");
        var prefs = File.ReadAllLines(prefsLog);
        Assert.Equal("none", prefs[0]);
        foreach (var want in new[] { "audio.play_bitrate_enumeration=5", "audio.play_bitrate_non_metered_enumeration=5", "audio.normalize_v2=false" })
            Assert.Contains(want, prefs[1]);
        Assert.Equal(Key, await File.ReadAllTextAsync(Path.Combine(dir, "key.txt")));

        // Playing, the samples proven lossless 24-bit; the build's date and when it runs out.
        await Session.Until(async () => await State(s) is var st && (string?)st["playback"] == "playing" && (string?)st["quality"] == "Spotify · Lossless 24-bit/44.1 kHz",
            30000, "playing, the sound proven lossless");
        var now = await State(s);
        Assert.Equal("playing", (string?)now["playback"]);
        Assert.Equal("Lounge", (string?)now["device_name"]);
        var made = DateTime.UtcNow.AddDays(-10);
        Assert.StartsWith("soloist 1.3.9 (", (string?)now["soloist"]!["version"]);
        Assert.Equal(DateOnly.FromDateTime(made).AddDays(90).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), (string?)now["soloist"]!["expires"]);
        Assert.Equal("use", (string?)now["soloist"]!["plan"]);

        // The room's stream: FLAC at 44.1 kHz, 24 bits; 16 when asked. Without a device, or a signature, not served.
        Assert.Equal(("fLaC", 44100, 24), await StreamHead(s));
        Assert.Equal(("fLaC", 44100, 16), await StreamHead(s, "?bits=16"));
        Assert.Equal(401, (await Http.Get(s.Base + "/stream/spotify/live.flac")).Status);

        // At the speed it plays (item 146): a player reading as fast as it can (a phone fetches minutes ahead) gets no
        // more than real time and the lead, so Spotify isn't run ahead of what is heard; away, as Opus when asked.
        var (heard, took) = await StreamFor(s, 4000);
        Assert.True(heard > 2 && heard < took / 1000.0 + 4.5, $"{heard:F1} s of sound in {took} ms");
        Assert.Equal(("OggS", "audio/ogg"), await StreamStart(s, "?q=opus"));

        // Another stream quality chosen (item 145): Soloist started again, its prefs asking Spotify for it; one not offered refused.
        Assert.Equal(400, (await s.Api("settings/spotify", new { quality = "best" })).Status);
        var high = await s.Api("settings/spotify", new { quality = "high" });
        Assert.Equal("high", (string?)high.J["quality"]);
        await Session.Until(() => Task.FromResult(File.ReadAllLines(prefsLog) is var l && l.Length >= 3 && l[^1].Contains("audio.play_bitrate_enumeration=3", StringComparison.Ordinal)), 60000, "Soloist started again asking for high");
        Assert.Equal("high", (string?)(await State(s))["account"]!["quality"]);

        // The key, said by Soloist, taken out before it is logged or kept.
        var logs = string.Join("\n", s.Server.Logs);
        Assert.Contains("started with api key [key]", logs);
        Assert.DoesNotContain(Key, logs);
        Assert.DoesNotContain(Key, await File.ReadAllTextAsync(Path.Combine(s.Lib.Data, "spotify", "soloist.log")));
    }
}
