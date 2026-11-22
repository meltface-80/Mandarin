using System.Formats.Tar;
using System.Globalization;
using System.IO.Compression;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Spotify Connect through Spotify Soloist (bug list items 142, 501, server/Mandarin.Server/Connect): the key given
/// in Settings, Soloist downloaded (from a stand-in for Spotify's CDN), started with its own PulseAudio, signed in by
/// a phone, asked for lossless and started again to take it up; the sound proven lossless 24-bit from its samples, and
/// served as FLAC at 24 bits (16 when asked), or upsampled by Mandarin's upsampler for a room that upsamples; the key
/// never shown back nor logged. Soloist and PulseAudio are the stand-ins' (test/StandIns: Soloist.cs, PulseAudio.cs).
/// </summary>
public sealed class SpotifyConnectTests
{
    internal const string Key = "sk-standin-0123456789abcdef";

    // Spotify's archive, as the CDN serves it: a folder with the soloist program in it (here the stand-in's script).
    internal static byte[] Archive()
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

    private static async Task<JsonNode> State(Session s) => (await s.Api("settings/spotify-connect")).J;

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

    // Two seconds of the stream decoded at its own rate: its rate, and the frequency of its tone (by its zero crossings).
    private static async Task<(int Rate, double Hz)> Tone(Session s, string query)
    {
        var (_, rate, _) = await StreamHead(s, query);
        using var req = new HttpRequestMessage(HttpMethod.Get, s.Base + "/stream/spotify/live.flac" + query);
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", s.Token);
        var file = Path.Combine(Directory.CreateTempSubdirectory("mandarin-spotify-tone-").FullName, "tone.flac");
        using (var cts = new CancellationTokenSource(6000))
        await using (var to = File.Create(file))
        {
            try
            {
                using var r = await Http.Client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
                await (await r.Content.ReadAsStreamAsync(cts.Token)).CopyToAsync(to, cts.Token);
            }
            catch (OperationCanceledException) { /* as long as asked */ }
        }
        var psi = new System.Diagnostics.ProcessStartInfo("ffmpeg") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-v", "quiet", "-i", file, "-f", "s32le", "-ac", "1", "pipe:1" }) psi.ArgumentList.Add(a);
        using var ff = System.Diagnostics.Process.Start(psi)!;
        _ = ff.StandardError.ReadToEndAsync();
        using var pcm = new MemoryStream();
        await ff.StandardOutput.BaseStream.CopyToAsync(pcm);
        await ff.WaitForExitAsync();
        var b = pcm.ToArray();
        int n = b.Length / 4, crossings = 0, first = -1, last = -1;
        for (int i = 1; i < n; i++)
            if (BitConverter.ToInt32(b, (i - 1) * 4) < 0 && BitConverter.ToInt32(b, i * 4) >= 0) { crossings++; if (first < 0) first = i; last = i; }
        Assert.True(crossings > 100, $"{crossings} rising zero crossings in {n} samples");
        return (rate, (crossings - 1) / ((last - first) / (double)rate));
    }

    [Test]
    public async Task Spotify_Connect_plays_lossless_through_Soloist_from_its_key_to_the_rooms_stream_upsampled_where_the_room_upsamples()
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
        var saved = await s.Api("settings/spotify-connect", new { api_key = Key, device_name = "Lounge" });
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
        await Session.Until(async () => await State(s) is var st && (string?)st["playback"] == "playing" && (string?)st["quality"] == "Spotify · Lossless 24-bit/44.1 kHz, bit-perfect",
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

        // A room that upsamples (item 501): ×4 by Mandarin's upsampler, to 176.4 kHz, the tone still a 440 Hz tone.
        Assert.Equal(("fLaC", 176400, 24), await StreamHead(s, "?r=176400&b=24&u=4"));
        var (rate, peakHz) = await Tone(s, "?r=176400&b=24&u=4");
        Assert.Equal(176400, rate);
        Assert.InRange(peakHz, 430, 450);

        // The port the Spotify app reaches Soloist on, said in the log (item 502): its zeroconf server's, not its WebSocket's.
        await Session.Until(() => Task.FromResult(s.Server.Logs.Any(l => l.Contains("Soloist answers the Spotify app on TCP", StringComparison.Ordinal))), 15000, "Soloist's port said");
        var said = s.Server.Logs.First(l => l.Contains("Soloist answers the Spotify app on TCP", StringComparison.Ordinal));
        var port = int.Parse(System.Text.RegularExpressions.Regex.Match(said, @"TCP (\d+)").Groups[1].Value, CultureInfo.InvariantCulture);
        Assert.InRange(port, 1024, 65535);
        Assert.DoesNotContain(",", said[said.IndexOf("TCP", StringComparison.Ordinal)..].Split(';')[0]);   // one port: the WebSocket, on loopback, left out

        // The room's volume levelling switched on while Spotify plays (item 508): Soloist started again at once with Spotify's
        // loudness normalisation, and handed the account's playback back (activate, play), not left normalised until it
        // stopped; switched off, the same the other way.
        var commands = Path.Combine(dir, "commands.log");
        s.Server.Exec("INSERT INTO audio_devices(id, kind, network_name, settings, first_seen, last_seen) VALUES('lounge-1', 'upnp', 'Lounge', '{\"levelling\":{\"mode\":\"track\"}}', 1, 1)");
        Assert.Equal(200, (await s.Api("settings/spotify-connect", new { room = "lounge-1" })).Status);
        int Starts() => File.ReadAllLines(Path.Combine(dir, "starts.log")).Length;
        var startsBefore = Starts();
        await Session.Until(() => Task.FromResult(Starts() > startsBefore && File.ReadAllLines(prefsLog)[^1].Contains("audio.normalize_v2=true", StringComparison.Ordinal)), 30000, "Soloist started again, normalising");
        await Session.Until(() => Task.FromResult(File.Exists(commands) && File.ReadAllText(commands) is var c && c.Contains("\"activate\"", StringComparison.Ordinal) && c.Contains("\"play\"", StringComparison.Ordinal)), 30000, "playback handed back");
        Assert.Contains(s.Server.Logs, l => l.Contains("[spotify] the room's volume levelling is on: Soloist started again", StringComparison.Ordinal));
        File.Delete(commands);
        s.Server.Exec("UPDATE audio_devices SET settings = '{\"levelling\":{\"mode\":\"off\"}}' WHERE id = 'lounge-1'");
        startsBefore = Starts();
        await Session.Until(() => Task.FromResult(Starts() > startsBefore && File.ReadAllLines(prefsLog)[^1].Contains("audio.normalize_v2=false", StringComparison.Ordinal)), 30000, "Soloist started again, not normalising");
        await Session.Until(() => Task.FromResult(File.Exists(commands) && File.ReadAllText(commands).Contains("\"activate\"", StringComparison.Ordinal)), 30000, "playback handed back again");

        // The key, said by Soloist, taken out before it is logged or kept.
        var logs = string.Join("\n", s.Server.Logs);
        Assert.Contains("started with api key [key]", logs);
        Assert.DoesNotContain(Key, logs);
        Assert.DoesNotContain(Key, await File.ReadAllTextAsync(Path.Combine(s.Lib.Data, "spotify", "soloist.log")));
    }
}
