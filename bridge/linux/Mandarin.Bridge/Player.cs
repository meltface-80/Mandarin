// Player.cs — the Bridge's player: Mandarin's own audio engine (engine/, mandarin-audio), the program the server plays
// a sound device on its own computer with. It decodes each track with ffmpeg into its buffer and writes it to the DAC
// through ALSA, at the track's own rate, untouched (no mixer, no resampling, no gain), gapless into the next; DSF
// goes as native DSD where the DAC takes it, else as DoP. It is told what to do on its stdin and says what happened
// on its stdout, a JSON object a line (Program.cs of the engine lists them); started again should it go.
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace Mandarin.Bridge;

internal sealed class Player(string engine, string ffmpeg, Action<string> log)
{
    private readonly object gate = new();
    private Process? proc;
    private string device = "", dsd = "";

    /* What the engine last said: its state, the track it is on, where in it, and the format the DAC is open at. */
    public string State { get; private set; } = "STOPPED";
    public string Uri { get; private set; } = "";
    public double Seconds { get; private set; }
    public double Rate { get; private set; }
    public string Format { get; private set; } = "";
    public string? Error { get; private set; }

    /* Told whenever the engine says something new (the state, the track, the format). */
    public Action? Changed;

    /* The engine on [location] (alsa:plughw:…, or file:… in the tests), with the DAC's native DSD [nativeDsd] ("" for DoP only). */
    public void Open(string location, string nativeDsd)
    {
        lock (gate)
        {
            if (proc != null && !proc.HasExited && location == device && nativeDsd == dsd) return;
            Close();
            (device, dsd) = (location, nativeDsd);
            var psi = new ProcessStartInfo(engine) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            foreach (var a in new[] { "--device", location, "--ffmpeg", ffmpeg }) psi.ArgumentList.Add(a);
            if (nativeDsd.Length > 0) { psi.ArgumentList.Add("--dsd-native"); psi.ArgumentList.Add(nativeDsd); }
            try { proc = Process.Start(psi); }
            catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { Error = "the audio engine couldn't start: " + e.Message; log("[player] " + Error); return; }
            var p = proc!;
            new Thread(() => ReadEvents(p)) { IsBackground = true, Name = "engine-out" }.Start();
            new Thread(() => { string? l; while ((l = p.StandardError.ReadLine()) != null) log("[engine] " + l); }) { IsBackground = true, Name = "engine-err" }.Start();
            Send(new JsonObject { ["cmd"] = "gain", ["value"] = 1 });
            log($"[player] the engine on {location}" + (nativeDsd.Length > 0 ? $", native DSD {nativeDsd}" : ""));
        }
    }

    public void Close()
    {
        lock (gate)
        {
            var p = proc;
            proc = null;
            if (p == null) return;
            try { p.StandardInput.WriteLine("{\"cmd\":\"quit\"}"); p.StandardInput.Flush(); if (!p.WaitForExit(2000)) p.Kill(true); }
            catch (Exception e) when (e is IOException or InvalidOperationException) { /* gone */ }
            p.Dispose();
            State = "STOPPED"; Rate = 0; Format = ""; device = "";
        }
    }

    /* Why a track isn't played with no DAC to play it to (the Android app's word). */
    public const string NoDac = "No USB DAC plugged in";

    /* Whether the engine is open on a DAC. */
    public bool IsOpen { get { lock (gate) return proc != null && !proc.HasExited; } }

    public void Play(string uri, double offset, bool paused = false)
    {
        Uri = uri; Seconds = offset;
        // No DAC: not played, and said (STOPPED, ERROR_OCCURRED), as the Android app says it; played when one is plugged in.
        bool none;
        lock (gate) none = device.Length == 0;
        if (none) { Error = NoDac; State = "STOPPED"; Changed?.Invoke(); return; }
        Error = null; State = paused ? "PAUSED_PLAYBACK" : "TRANSITIONING";
        Send(new JsonObject { ["cmd"] = "play", ["uri"] = uri, ["offset"] = offset, ["paused"] = paused });
    }
    public void Next(string uri) => Send(new JsonObject { ["cmd"] = "next", ["uri"] = uri });
    public void Pause() { State = "PAUSED_PLAYBACK"; Send(new JsonObject { ["cmd"] = "pause" }); }
    public void Resume() { State = "PLAYING"; Send(new JsonObject { ["cmd"] = "resume" }); }
    public void Stop() { State = "STOPPED"; Seconds = 0; Send(new JsonObject { ["cmd"] = "stop" }); }

    private void Send(JsonObject cmd)
    {
        lock (gate)
        {
            if (proc == null || proc.HasExited) { if (device.Length > 0) { var (d, n) = (device, dsd); device = ""; Open(d, n); } }
            try { proc?.StandardInput.WriteLine(cmd.ToJsonString()); proc?.StandardInput.Flush(); }
            catch (Exception e) when (e is IOException or InvalidOperationException) { log("[player] the engine went: " + e.Message); }
        }
    }

    private void ReadEvents(Process p)
    {
        string? line;
        while ((line = p.StandardOutput.ReadLine()) != null)
        {
            if (JsonNode.Parse(line) is not JsonObject ev) continue;
            var said = Str(ev["ev"]);
            switch (said)
            {
                case "pos":
                    if (Str(ev["uri"]) is { Length: > 0 } u) Uri = u;
                    if (Str(ev["state"]) is { Length: > 0 } s) State = s;
                    Seconds = Num(ev["seconds"]);
                    if (Num(ev["rate"]) > 0) Rate = Num(ev["rate"]);
                    break;
                case "format": Rate = Num(ev["rate"]); Format = Str(ev["format"]); log($"[player] the DAC open at {Rate.ToString(CultureInfo.InvariantCulture)} Hz, {Format}"); break;
                case "ended": State = "STOPPED"; Seconds = 0; Rate = 0; Format = ""; break;
                case "error": Error = Str(ev["message"]); State = "STOPPED"; log("[player] " + Error); break;
                case "xrun": log("[player] the DAC ran dry (xrun #" + Num(ev["count"]).ToString(CultureInfo.InvariantCulture) + ")"); break;
                default: continue;
            }
            Changed?.Invoke();
        }
        lock (gate) { if (proc == p) { State = "STOPPED"; Rate = 0; } }
        Changed?.Invoke();
    }

    private static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
    private static double Num(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;

    /* What the DAC is fed, as /dac.json's "now" says it: the rate, and for DSD the multiple (native words or DoP); null while nothing plays. */
    public (double Rate, string Kind, int Dsd)? Now()
    {
        if (State is not ("PLAYING" or "PAUSED_PLAYBACK") || Rate <= 0) return null;
        if (Format.StartsWith("DSD_U32", StringComparison.Ordinal)) return (Rate, "dsd", (int)Math.Round(Rate * 32 / 44100));
        if (Format.StartsWith("DSD_U16", StringComparison.Ordinal)) return (Rate, "dsd", (int)Math.Round(Rate * 16 / 44100));
        if (Format.Contains("(DoP)", StringComparison.Ordinal)) return (Rate, "dop", (int)Math.Round(Rate * 16 / 44100));
        return (Rate, "pcm", 0);
    }
}
