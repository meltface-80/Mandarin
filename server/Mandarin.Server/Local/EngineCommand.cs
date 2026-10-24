// EngineCommand.cs — the audio engine's driver (EngineOutput.cs, AudioEngine.cs)
// run from a script, through `mandarin-server score` (Identify/ScoreCommand.cs,
// RulesCommand.cs), so test/Mandarin.Tests/EngineTests.cs can play to a device step by step
// as lib/local/engine.js's tests did (v0.8.50, stage 7 part 5):
//
//   { fn: "engine", steps: [step, …] } → { results: [one a step] }
//
//   { find: true }                     AudioEngine.Find: { bin, version } or null (AUDIO_ENGINE as this process has it)
//   { probe: bin }, { plays: location } AudioEngine.Probe, Plays
//   { open: { location, bin, volume } } an output, the one the steps after it play
//   { set: uri }, { next: uri }, { play: true }, { pause: true }, { seek: secs }, { halt: true }
//   { kill: true }                     this process's engine killed (SIGKILL), as when it dies mid-track
//   { until: { state | track | above | between: [a, b] | error | size: [file, n] }, ms }
//                                      true once it holds (an error: its words), false when [ms] have gone
//   { state: true }, { position: true }, { sink: true }, { next_uri: true }, { take_error: true }, { wait: ms }
using System.Diagnostics;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Local;

using TJs = Mandarin.Server.Tags.Js;

internal static class EngineCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();
    private static string S(object? v) => TJs.IsNullish(v) ? "" : TJs.Str(v);
    private static double N(object? v) => TJs.IsNullish(v) ? 0 : TJs.ToNumber(v);

    public static async Task<JsObj> Run(JsObj job)
    {
        var results = new List<object?>();
        EngineOutput? o = null;
        try
        {
            foreach (var step0 in L(job["steps"]))
            {
                var st = O(step0);
                results.Add(await Step(st, o, made => { o?.Halt(); o = made; }));
            }
        }
        finally { o?.Halt(); }
        return new JsObj { ["results"] = results };
    }

    private static async Task<object?> Step(JsObj st, EngineOutput? o, Action<EngineOutput> opened)
    {
        if (st.Has("find")) return AudioEngine.Find() is { } f ? new JsObj { ["bin"] = f.Bin, ["version"] = f.Version } : null;
        if (st.Has("probe")) return AudioEngine.Probe(S(st["probe"]));
        if (st.Has("plays")) return AudioEngine.Plays(S(st["plays"]));
        if (st.Has("wait")) { await Task.Delay((int)N(st["wait"])); return null; }
        if (st["open"] is JsObj op)
        {
            var made = new EngineOutput("Test", S(op["location"]), S(op["bin"]), Environment.GetEnvironmentVariable("FFMPEG_PATH") is { Length: > 0 } ff ? ff : "ffmpeg",
                _ => { }, TJs.IsNullish(op["volume"]) ? 100 : N(op["volume"]), () => false, u => u);
            opened(made);
            return null;
        }
        if (o == null) throw new JsError("no output open");
        if (st.Has("set")) { await o.SetUri(S(st["set"])); return null; }
        if (st.Has("next")) { await o.SetNextUri(S(st["next"])); return null; }
        if (st.Has("play")) { await o.Play(); return null; }
        if (st.Has("pause")) { await o.Pause(); return null; }
        if (st.Has("seek")) { await o.SeekTime(N(st["seek"])); return null; }
        if (st.Has("halt")) { o.Halt(); return null; }
        if (st.Has("kill")) return KillEngine();
        if (st.Has("state")) return State(o);
        if (st.Has("position")) return o.Seconds;
        if (st.Has("next_uri")) return o.NextUri;
        if (st.Has("sink")) return o.Sink is { } k ? new JsObj { ["rate"] = k.Rate, ["channels"] = k.Channels } : null;
        if (st.Has("take_error")) return o.TakeError()?.Message;
        if (st["until"] is JsObj u)
        {
            var end = Environment.TickCount64 + (long)(TJs.IsNullish(st["ms"]) ? 15000 : N(st["ms"]));
            for (;;)
            {
                if (await Holds(o, u) is { } held) return held;
                if (Environment.TickCount64 >= end) return false;
                await Task.Delay(20);
            }
        }
        throw new JsError("unknown step");
    }

    private static string State(EngineOutput o) => S(o.GetTransportInfo().GetAwaiter().GetResult()["CurrentTransportState"]);

    /* What the step waits for, once it holds (true, or the error's words); null until then. */
    private static async Task<object?> Holds(EngineOutput o, JsObj u)
    {
        bool held;
        if (u.Has("error")) return o.TakeError()?.Message;
        if (u.Has("state")) held = State(o) == S(u["state"]);
        else if (u.Has("track")) held = S((await o.GetPositionInfo())["TrackURI"]) == S(u["track"]);
        else if (u.Has("above")) held = o.Seconds > N(u["above"]);
        else if (u["between"] is List<object?> b) held = o.Seconds >= N(b[0]) && o.Seconds < N(b[1]);
        else if (u["size"] is List<object?> sz) held = File.Exists(S(sz[0])) && new FileInfo(S(sz[0])).Length >= (long)N(sz[1]);
        else throw new JsError("unknown until");
        return held ? true : null;
    }

    /* This process's engine: its children that are the audio engine, killed as a crash would. */
    private static bool KillEngine()
    {
        var me = Environment.ProcessId;
        // A Mac has no /proc (item 153): pkill finds this process's own engine instead.
        if (!OperatingSystem.IsLinux())
        {
            using var pk = Process.Start(new ProcessStartInfo("pkill", ["-KILL", "-P", me.ToString(System.Globalization.CultureInfo.InvariantCulture), "mandarin-audio"]) { UseShellExecute = false })!;
            pk.WaitForExit(10000);
            return pk.ExitCode == 0;
        }
        var killed = false;
        foreach (var dir in Directory.EnumerateDirectories("/proc"))
        {
            if (!int.TryParse(Path.GetFileName(dir), out var pid)) continue;
            string stat;
            try { stat = File.ReadAllText(Path.Combine(dir, "stat")); } catch (IOException) { continue; } catch (UnauthorizedAccessException) { continue; }
            var rest = stat[(stat.LastIndexOf(')') + 2)..].Split(' ');
            if (rest.Length < 2 || rest[1] != me.ToString(System.Globalization.CultureInfo.InvariantCulture)) continue;
            try { using var p = Process.GetProcessById(pid); if (p.ProcessName.Contains("mandarin-audio", StringComparison.Ordinal) || stat.Contains("(mandarin-audio)", StringComparison.Ordinal)) { p.Kill(); killed = true; } }
            catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { /* gone */ }
        }
        return killed;
    }
}
