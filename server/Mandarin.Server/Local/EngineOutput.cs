// EngineOutput.cs — a sound device on the server, played by Mandarin's audio
// engine (lib/local/engine.js EngineOutput, v0.8.49, stage 6 part 4):
// engine/Mandarin.Audio, a native program. The engine owns the whole path from
// the decoder to the device: ffmpeg decodes each track straight into the
// engine's own buffer, and a thread of its own — on the core kept for
// playback (Cpu.Engine.cs), at a raised priority where the system allows —
// writes it to the device through ALSA. Where the device is in a track comes
// from ALSA itself, not a clock.
//
// This class answers in the renderer's shape (IRenderer: setUri, setNextUri,
// play, pause, seek, the transport and position reads, volume), so the
// renderer family keeps its queue, gapless next track, DSP and Volume
// Levelling for it as before. The engine is told what to do over its stdin and
// says what happened on its stdout, one JSON object a line.
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Local;

using TJs = Mandarin.Server.Tags.Js;

/* What the engine said went wrong, or that it went away: its words, for the room's error. */
internal sealed class EngineError(string message) : Exception(message);

internal sealed class EngineOutput : IRenderer
{
    private const double RangeDb = 50;   // lib/local/output.js RANGE_DB: the taper's span
    private sealed class Proc { public Process? P; public volatile bool Dead; }

    private readonly string location, bin, ffmpeg;
    private readonly Action<string> log;
    private readonly Func<bool> fixedVolume;
    private readonly Func<string, string> source;
    private readonly object gate = new();
    private readonly object writing = new();
    private Proc? proc;
    private string state = "STOPPED", uri = "", nextUri = "";
    private string? pending;
    private double offset, seconds, ahead, volume;
    private bool muted;
    private Exception? error;
    // What the engine was given → the URI the player knows, the last 64.
    private readonly List<(string Src, string Uri)> fetched = [];

    public string Name { get; }
    /* { rate, channels } while the device is open; what was sent to it. */
    public (double Rate, double Channels)? Sink { get; private set; }
    public (double Rate, double Bits)? Sent { get; private set; }
    public double Volume { get { lock (gate) return volume; } }

    public EngineOutput(string name, string location, string bin, string ffmpeg, Action<string> log, double volume, Func<bool> fixedVolume, Func<string, string> source)
    {
        Name = name; this.location = location; this.bin = bin; this.ffmpeg = ffmpeg; this.log = log;
        this.volume = volume; this.fixedVolume = fixedVolume; this.source = source;
    }

    /* output.js amplitude(): the volume slider on an audio taper — 100% untouched, 50% −25 dB, 10% −45 dB, under 10% straight down to silence. */
    public static double Amplitude(double pct, bool muted)
    {
        var v = Math.Max(0, Math.Min(100, double.IsNaN(pct) ? 0 : pct));
        if (muted || v <= 0) return 0;
        if (v >= 100) return 1;
        double Db(double p) => (p - 100) / 100 * RangeDb;
        if (v >= 10) return Math.Pow(10, Db(v) / 20);
        return Math.Pow(10, Db(10) / 20) * v / 10;
    }

    // ------------------------------------------------------------ the engine process

    private Proc EnsureProc()
    {
        lock (gate) { if (proc is { Dead: false } live) return live; }
        var psi = new ProcessStartInfo(bin) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        psi.ArgumentList.Add("--device"); psi.ArgumentList.Add(location);
        psi.ArgumentList.Add("--ffmpeg"); psi.ArgumentList.Add(ffmpeg);
        if (Cpu.Core is { } core) { psi.ArgumentList.Add("--core"); psi.ArgumentList.Add(core.ToString(CultureInfo.InvariantCulture)); }
        // The whole engine on playback's cores, the decoder it starts with it; its playback thread on the one core playback always has.
        Cpu.PlaceRealtime(psi);
        var p = new Proc();
        lock (gate) proc = p;
        try { p.P = Process.Start(psi)!; }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or InvalidOperationException)
        {
            p.Dead = true;
            Lost(p, "couldn't be started (" + e.Message + ")");
            return p;
        }
        Cpu.Adopt(p.P, CpuKind.Playback);
        p.P.StandardInput.AutoFlush = true;
        _ = ReadLines(p.P.StandardOutput, OnLine);
        _ = ReadLines(p.P.StandardError, l => { if (l.Trim().Length > 0) log($"[engine] {Name}: {l}"); });
        _ = p.P.WaitForExitAsync().ContinueWith(_ =>
        {
            p.Dead = true;
            int code;
            try { code = p.P.ExitCode; } catch (InvalidOperationException) { code = -1; }
            Lost(p, code >= 128 ? $"stopped (signal {code - 128})" : $"exited ({code})");
            Cpu.Forget(p.P);
        }, TaskScheduler.Default);
        return p;
    }

    private static async Task ReadLines(StreamReader r, Action<string> onLine)
    {
        try { while (await r.ReadLineAsync() is { } line) onLine(line); }
        catch (Exception e) when (e is IOException or ObjectDisposedException or InvalidOperationException) { /* the pipe closed */ }
    }

    /* The engine went away while it had work: said once, and stopped. */
    private void Lost(Proc p, string why)
    {
        lock (gate)
        {
            if (!ReferenceEquals(proc, p)) return;
            proc = null;
            Sink = null;
            if (state == "STOPPED") return;
            error = new EngineError("the audio engine " + why);
            state = "STOPPED";
        }
        log($"[local] {Name}: the audio engine {why}");
    }

    private void Send(JsonObject cmd)
    {
        var p = EnsureProc();
        lock (writing)
        {
            try { p.P?.StandardInput.WriteLine(cmd.ToJsonString()); }
            catch (Exception e) when (e is IOException or ObjectDisposedException or InvalidOperationException) { p.Dead = true; }
        }
    }

    private void OnLine(string line)
    {
        JsonObject? ev;
        try { ev = JsonNode.Parse(line) as JsonObject; } catch (System.Text.Json.JsonException) { return; }
        if (ev == null) return;
        static double Num(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) ? d : 0;
        static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
        string? say = null;
        lock (gate)
        {
            switch (Str(ev["ev"]))
            {
                case "hello":
                    say = $"[local] {Name}: played by Mandarin's audio engine {Str(ev["version"])}";
                    break;
                case "pos":
                {
                    var src = Str(ev["uri"]);
                    var known = fetched.FirstOrDefault(f => f.Src == src).Uri;
                    var u = known is { Length: > 0 } ? known : src;
                    var st = Str(ev["state"]);
                    // The engine went on to the next track by itself (gapless).
                    if (u.Length > 0 && nextUri.Length > 0 && u == nextUri) { uri = nextUri; nextUri = ""; offset = 0; }
                    else if (u.Length > 0 && u != uri && st != "STOPPED") uri = u;
                    seconds = Num(ev["seconds"]);
                    ahead = Num(ev["ahead"]);
                    if (Num(ev["rate"]) > 0) { Sink = (Num(ev["rate"]), Num(ev["channels"])); Sent = (Num(ev["rate"]), 32); }
                    // Ours only where the engine has caught up with what it was told.
                    if (pending != null && st == pending) pending = null;
                    if (pending == null && st.Length > 0) state = st;
                    break;
                }
                case "format":
                    Sink = (Num(ev["rate"]), Num(ev["channels"]));
                    Sent = (Num(ev["rate"]), 32);
                    break;
                case "ended":
                    pending = null;
                    state = "STOPPED"; offset = 0; seconds = 0; Sink = null;
                    break;
                case "xrun":
                    say = $"[local] {Name}: the device ran dry (ALSA xrun #{TJs.Num(Num(ev["count"]))}); {ahead.ToString("F1", CultureInfo.InvariantCulture)} s were held ahead";
                    break;
                case "error":
                    pending = null;
                    error = new EngineError(Str(ev["message"]));
                    say = $"[local] {Name}: {Str(ev["message"])}";
                    state = "STOPPED";
                    Sink = null;
                    break;
            }
        }
        if (say != null) log(say);
    }

    private string FetchUri(string u)
    {
        var src = source(u);
        lock (gate)
        {
            var i = fetched.FindIndex(f => f.Src == src);
            if (i >= 0) fetched[i] = (src, u); else fetched.Add((src, u));
            if (fetched.Count > 64) fetched.RemoveAt(0);
        }
        return src;
    }

    private double Gain() { lock (gate) return fixedVolume() ? 1 : Amplitude(volume, muted); }
    private void SendGain() => Send(new JsonObject { ["cmd"] = "gain", ["value"] = Gain() });
    private bool HasProc { get { lock (gate) return proc != null; } }

    // ------------------------------------------------------------ the renderer's shape

    public Task SetUri(string u, string meta = "")
    {
        if (HasProc) Send(new JsonObject { ["cmd"] = "stop" });
        lock (gate) { uri = u ?? ""; nextUri = ""; offset = 0; seconds = 0; state = "STOPPED"; pending = "STOPPED"; }
        return Task.CompletedTask;
    }

    public Task SetNextUri(string u, string meta = "")
    {
        bool tell;
        lock (gate) { nextUri = u ?? ""; tell = proc != null && state != "STOPPED"; }
        if (tell) Send(new JsonObject { ["cmd"] = "next", ["uri"] = nextUri.Length > 0 ? FetchUri(nextUri) : "" });
        return Task.CompletedTask;
    }

    public Task Play()
    {
        lock (gate)
        {
            if (state == "PAUSED_PLAYBACK" && proc != null) { state = "PLAYING"; pending = "PLAYING"; goto resume; }
            if (state is "PLAYING" or "TRANSITIONING") return Task.CompletedTask;
            if (uri.Length == 0) throw new RendererError($"{Name}: nothing to play", 0);
        }
        Begin(offset, false);
        return Task.CompletedTask;
    resume:
        Send(new JsonObject { ["cmd"] = "resume" });
        return Task.CompletedTask;
    }

    private void Begin(double at, bool paused)
    {
        string u, n;
        lock (gate) { error = null; u = uri; n = nextUri; }
        SendGain();
        Send(new JsonObject { ["cmd"] = "play", ["uri"] = FetchUri(u), ["offset"] = at, ["paused"] = paused });
        if (n.Length > 0) Send(new JsonObject { ["cmd"] = "next", ["uri"] = FetchUri(n) });
        lock (gate)
        {
            seconds = at;
            state = paused ? "PAUSED_PLAYBACK" : "TRANSITIONING";
            pending = paused ? "PAUSED_PLAYBACK" : "PLAYING";
        }
    }

    public Task Pause()
    {
        lock (gate)
        {
            if (state is not ("PLAYING" or "TRANSITIONING")) return Task.CompletedTask;
            state = "PAUSED_PLAYBACK"; pending = "PAUSED_PLAYBACK";
        }
        Send(new JsonObject { ["cmd"] = "pause" });
        return Task.CompletedTask;
    }

    public Task Stop()
    {
        if (HasProc) Send(new JsonObject { ["cmd"] = "stop" });
        lock (gate) { offset = 0; seconds = 0; state = "STOPPED"; pending = "STOPPED"; }
        return Task.CompletedTask;
    }

    public Task SeekTime(double secs)
    {
        var s = Math.Max(0, double.IsNaN(secs) ? 0 : secs);
        string was;
        lock (gate)
        {
            if (uri.Length == 0) return Task.CompletedTask;
            was = state;
            if (was is not ("PLAYING" or "TRANSITIONING" or "PAUSED_PLAYBACK")) { offset = s; seconds = s; return Task.CompletedTask; }
        }
        Begin(s, was == "PAUSED_PLAYBACK");
        return Task.CompletedTask;
    }

    public Task<JsObj> GetTransportInfo() { lock (gate) return Task.FromResult(Jv.Obj(("CurrentTransportState", state))); }
    public Task<JsObj> GetPositionInfo() { lock (gate) return Task.FromResult(Jv.Obj(("TrackURI", uri), ("RelTime", Didl.Hms(Position())), ("TrackDuration", "0:00:00"))); }

    public Task<double> GetVolume() { lock (gate) return Task.FromResult(volume); }
    public Task SetVolume(double v)
    {
        bool tell;
        lock (gate) { volume = Math.Max(0, Math.Min(100, Math.Floor((double.IsNaN(v) ? 0 : v) + 0.5))); tell = proc != null; }
        if (tell) SendGain();
        return Task.CompletedTask;
    }
    public Task<bool> GetMute() { lock (gate) return Task.FromResult(muted); }
    public Task SetMute(bool m)
    {
        bool tell;
        lock (gate) { muted = m; tell = proc != null; }
        if (tell) SendGain();
        return Task.CompletedTask;
    }

    /* Where the device is: the offset it will start at when stopped, else what ALSA says. */
    private double Position() => state == "STOPPED" ? offset : seconds;
    /* Where it is in the track, in seconds; the next track waiting to follow ("" when none). */
    public double Seconds { get { lock (gate) return Position(); } }
    public string NextUri { get { lock (gate) return nextUri; } }
    public Exception? TakeError() { lock (gate) { var e = error; error = null; return e; } }

    /* Everything stopped and let go, the engine with it. */
    public void Halt()
    {
        Proc? p;
        lock (gate) { p = proc; proc = null; Sink = null; state = "STOPPED"; }
        if (p is not { Dead: false } || p.P == null) return;
        var pr = p.P;
        lock (writing)
        {
            try { pr.StandardInput.WriteLine(new JsonObject { ["cmd"] = "quit" }.ToJsonString()); pr.StandardInput.Close(); }
            catch (Exception e) when (e is IOException or ObjectDisposedException or InvalidOperationException) { /* gone */ }
        }
        _ = Task.Delay(2000).ContinueWith(_ => { try { if (!pr.HasExited) pr.Kill(); } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { /* gone */ } }, TaskScheduler.Default);
    }
}
