// Mpd.cs — a renderer's own player, where it is MPD (bug list item 306). A Chord Poly answers UPnP's AVTransport and,
// at port 6600 of the same address, MPD 0.21 — the player its own app plays its library with. MPD plays one track of
// its queue into the next by itself, gapless, as it plays that library; a track given it next by UPnP ended and the
// next started a moment later, or the device named the first all through the second (items 233, 299, 305).
//
// With a device's Player set to its own player, Mandarin drives MPD through the same calls as a UPnP renderer
// (IRenderer): the track set is the queue cleared and that track added; the next, added after the one playing, which
// MPD goes on into; what it plays and how far in, from MPD's own status and current song. MPD's protocol is open and
// plain text: a command a line, each answered by "key: value" lines and OK, or by ACK and why.
using System.Globalization;
using System.Net.Sockets;
using System.Text;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal static class Mpd
{
    /* The port MPD is looked for at, beside a renderer: 6600, MPD's own; MPD_PORT for a test's. */
    public static int Port => int.TryParse(Environment.GetEnvironmentVariable("MPD_PORT"), out var p) && p > 0 ? p : 6600;

    /* MPD's version where it answers at [host]:[port] within [ms], its greeting "OK MPD 0.21.11"; else null. */
    public static async Task<string?> Probe(string host, int port, int ms = 800)
    {
        if (host.Length == 0) return null;
        try
        {
            using var cts = new CancellationTokenSource(ms);
            using var tcp = new TcpClient();
            await tcp.ConnectAsync(host, port, cts.Token);
            using var reader = new StreamReader(tcp.GetStream(), Encoding.UTF8);
            var line = await reader.ReadLineAsync(cts.Token);
            return line != null && line.StartsWith("OK MPD ", StringComparison.Ordinal) ? line[7..].Trim() : null;
        }
        catch (Exception e) when (e is SocketException or IOException or OperationCanceledException) { return null; }
    }

    /* [s] as an argument of MPD's: in double quotes, its quotes and backslashes escaped. */
    public static string Quote(string s) => "\"" + s.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";

    /* Seconds as UPnP's H:MM:SS.fff, the way the players read a renderer's position (Didl.ToSeconds). */
    public static string Hms(double s)
    {
        s = Math.Max(0, double.IsFinite(s) ? s : 0);
        var h = Math.Floor(s / 3600);
        var m = Math.Floor(s % 3600 / 60);
        return string.Create(CultureInfo.InvariantCulture, $"{h}:{m:00}:{s % 60:00.000}");
    }
}

/* MPD at [host]:[port] as a renderer, named [name]; [unanswered] told of each call it didn't answer. */
internal sealed class MpdRenderer(string name, string host, int port, Action? unanswered = null) : IRenderer
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private TcpClient? tcp;
    private StreamReader? reader;
    private Stream? stream;
    private double? beforeMute;

    public string Name => name;

    /* [commands] sent as one list, each answered: every "key: value" pair said, in order. An ACK is a RendererError. */
    private async Task<List<(string Key, string Value)>> Run(params string[] commands)
    {
        await gate.WaitAsync();
        try
        {
            using var cts = new CancellationTokenSource(5000);
            try
            {
                if (tcp is not { Connected: true } || reader == null || stream == null) await Connect(cts.Token);
                var text = commands.Length == 1 ? commands[0] + "\n" : "command_list_begin\n" + string.Join("\n", commands) + "\ncommand_list_end\n";
                await stream!.WriteAsync(Encoding.UTF8.GetBytes(text), cts.Token);
                var pairs = new List<(string, string)>();
                for (;;)
                {
                    var line = await reader!.ReadLineAsync(cts.Token) ?? throw new IOException("MPD closed the connection");
                    if (line == "OK") return pairs;
                    if (line.StartsWith("ACK ", StringComparison.Ordinal)) throw new RendererError($"{name}: MPD said {line[4..]}", double.NaN);
                    var at = line.IndexOf(": ", StringComparison.Ordinal);
                    if (at > 0) pairs.Add((line[..at], line[(at + 2)..]));
                }
            }
            catch (Exception e) when (e is SocketException or IOException or OperationCanceledException)
            {
                Close();
                unanswered?.Invoke();
                throw new RendererError($"{name}'s own player (MPD at {host}:{port}) is not answering: {e.Message}", double.NaN);
            }
        }
        finally { gate.Release(); }
    }

    private async Task Connect(CancellationToken ct)
    {
        Close();
        tcp = new TcpClient();
        await tcp.ConnectAsync(host, port, ct);
        stream = tcp.GetStream();
        reader = new StreamReader(stream, Encoding.UTF8);
        var hello = await reader.ReadLineAsync(ct);
        if (hello == null || !hello.StartsWith("OK MPD ", StringComparison.Ordinal)) throw new IOException("not MPD: " + hello);
    }

    private void Close()
    {
        try { tcp?.Dispose(); } catch (ObjectDisposedException) { /* gone */ }
        tcp = null; reader = null; stream = null;
    }

    private static string? Of(List<(string Key, string Value)> pairs, string key) => pairs.FirstOrDefault(p => p.Key == key).Value;
    private static double Num(string? v) => double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : 0;

    /* The track set: the queue cleared and that track added, MPD's own repeat, random, single and consume off (the room's are Mandarin's). */
    public Task SetUri(string uri, string meta = "") => Run("random 0", "repeat 0", "single 0", "consume 0", "clear", "add " + Mpd.Quote(uri));

    /* The next: what follows the track playing taken off, this one added after it, which MPD goes on into; none, nothing after it. */
    public async Task SetNextUri(string uri, string meta = "")
    {
        var st = await Run("status");
        var song = Of(st, "song") is { } s ? (int)Num(s) : -1;
        var length = (int)Num(Of(st, "playlistlength"));
        var commands = new List<string>();
        if (length > song + 1) commands.Add(string.Create(CultureInfo.InvariantCulture, $"delete {song + 1}:{length}"));
        if (uri.Length > 0) commands.Add("add " + Mpd.Quote(uri));
        if (commands.Count > 0) await Run([.. commands]);
    }

    /* Play: from pause, on; else from the queue's track where it is (the one set, or the first). */
    public async Task Play()
    {
        var state = Of(await Run("status"), "state");
        await Run(state == "pause" ? "pause 0" : "play");
    }

    public Task Pause() => Run("pause 1");
    public Task Stop() => Run("stop");
    public Task SeekTime(double seconds) => Run(string.Create(CultureInfo.InvariantCulture, $"seekcur {Math.Max(0, seconds):0.###}"));

    /* As AVTransport's GetTransportInfo: MPD's state in UPnP's words. */
    public async Task<JsObj> GetTransportInfo()
    {
        var st = await Run("status");
        var state = Of(st, "state") switch { "play" => "PLAYING", "pause" => "PAUSED_PLAYBACK", _ => "STOPPED" };
        if (Num(Of(st, "playlistlength")) == 0) state = "NO_MEDIA_PRESENT";
        return Jv.Obj(("CurrentTransportState", state), ("CurrentTransportStatus", "OK"), ("CurrentSpeed", "1"));
    }

    /* As GetPositionInfo: the URI of the song playing (exactly as it was added), how far in, its length where MPD knows it. */
    public async Task<JsObj> GetPositionInfo()
    {
        var both = await Run("status", "currentsong");
        var file = Of(both, "file") ?? "";
        return Jv.Obj(("Track", file.Length > 0 ? "1" : "0"), ("TrackURI", file), ("TrackMetaData", ""),
            ("RelTime", Mpd.Hms(Num(Of(both, "elapsed")))), ("TrackDuration", Mpd.Hms(Num(Of(both, "duration")))));
    }

    /* Its volume, 0–100; one without a mixer says -1, read as full. */
    public async Task<double> GetVolume()
    {
        var v = Num(Of(await Run("status"), "volume"));
        return v < 0 ? 100 : v;
    }

    public Task SetVolume(double v) => Run(string.Create(CultureInfo.InvariantCulture, $"setvol {(int)Math.Round(Math.Clamp(v, 0, 100))}"));

    /* MPD has no mute of its own: the volume taken to 0 and given back. */
    public Task<bool> GetMute() => Task.FromResult(beforeMute != null);

    public async Task SetMute(bool m)
    {
        if (m && beforeMute == null) { beforeMute = await GetVolume(); await SetVolume(0); }
        else if (!m && beforeMute is { } was) { beforeMute = null; await SetVolume(was); }
    }

    public void Halt() { gate.Wait(); try { Close(); } finally { gate.Release(); } }
}
