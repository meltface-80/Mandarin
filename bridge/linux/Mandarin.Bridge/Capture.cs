// Capture.cs — a recording of exactly what the DAC is fed, for Mandarin's bit-perfect check (item 412): the server (and
// SQ-tool's check, at /sq-tool/) asks it of the Bridge as it asks Mandarin Bridge for Android (its Capture.kt: the same
// API, the same WAV and sidecar), and compares it sample by sample with what it sent. Made only when asked.
//
// The audio engine records it (engine/Mandarin.Audio/Capture.cs): a tap in front of its ALSA device, so the bytes are
// those it hands ALSA for the DAC, after every conversion it makes (its 32-bit words, DoP, native DSD). The Bridge
// tells the engine what was asked, keeps what it last said of the recording, and serves the files it writes in the
// Bridge's own data folder ([data]/capture: on Mandarin OS and the Pi image its state directory), emptied as it starts
// and as each recording starts; a part is let go once fetched.
//
//   POST   /capture {"seconds": 30}   start, from the next byte the DAC is handed (409 while one runs); up to two minutes
//   POST   /capture {"seconds": 221, "part": 60, "after_flush": true}
//                                     the whole of a track (item 286): from the first byte after the stream is next
//                                     flushed or opened afresh (the track played again from its start), in parts
//   GET    /capture                   where it is: idle, armed, recording, finishing, done, failed; and "parts"
//   GET    /capture.wav, .wav.json    a recording in one part, once done; its sidecar
//   GET    /capture/N.wav, .wav.json  part N, once done
//   DELETE /capture/N                 part N let go (fetched)
//   DELETE /capture                   stop; what was recorded is kept and finished
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Bridge;

internal sealed partial class Capture
{
    private const string Json = "application/json";

    private readonly Player player;
    private readonly string dir;
    private readonly Func<bool> dacThere;
    private readonly Func<JsonObject> about;
    private readonly object gate = new(), asking = new();
    private JsonObject last = new() { ["state"] = "idle", ["reason"] = "", ["parts"] = new JsonArray() };
    private string? awaited;
    private JsonObject? answered;

    /* Recorded by [player]'s engine into [data]/capture; [dacThere], whether a DAC is there to record; [about], what a recording says of where it was made. */
    public Capture(Player player, string data, Func<bool> dacThere, Func<JsonObject> about)
    {
        (this.player, this.dacThere, this.about) = (player, dacThere, about);
        dir = Path.Combine(data, "capture");
        // What an earlier run left: never kept past a start.
        try { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* let go when a recording starts */ }
        player.Captured += Heard;
    }

    [GeneratedRegex(@"^/capture/(\d+)(\.wav(\.json)?)?$")]
    private static partial Regex PartPath();

    /* Whether [path] is the recording's. */
    public static bool Is(string path) => path == "/capture" || path.StartsWith("/capture.", StringComparison.Ordinal) || path.StartsWith("/capture/", StringComparison.Ordinal);

    public Http.Response Route(Http.Request r)
    {
        var p = r.Path;
        if (p == "/capture")
            return r.Method switch
            {
                "POST" => Start(r),
                "GET" => Said(200, Status()),
                "DELETE" => Said(200, Ask(new JsonObject { ["cmd"] = "capture_stop" }, "stop").Said ?? Status()),
                _ => Http.Response.Text(405, ""),
            };
        if (r.Method == "GET" && p is "/capture.wav" or "/capture.wav.json") return Served(Path.Combine(dir, p[1..]));
        if (PartPath().Match(p) is not { Success: true } m || !int.TryParse(m.Groups[1].Value, out var n)) return Http.Response.Text(404, "");
        if (r.Method == "GET" && m.Groups[2].Length > 0) return Served(Path.Combine(dir, $"capture-{n}{m.Groups[2].Value}"));
        if (r.Method == "DELETE" && m.Groups[2].Length == 0 && Ask(new JsonObject { ["cmd"] = "capture_drop", ["n"] = n }, "drop") is { Said: { } said, Ok: true })
            return Said(200, said);
        return Http.Response.Text(404, "");
    }

    private Http.Response Start(Http.Request r)
    {
        if (!dacThere() || !player.IsOpen) return Said(409, new JsonObject { ["error"] = "no DAC on the port" });
        if (!player.CanCapture) return Said(409, new JsonObject { ["error"] = "this Bridge's audio engine can't record what it hands the DAC" });
        JsonObject ask;
        try { ask = JsonNode.Parse(r.Text is { Length: > 0 } t ? t : "{}") as JsonObject ?? []; }
        catch (System.Text.Json.JsonException) { ask = []; }
        var (said, ok) = Ask(new JsonObject
        {
            ["cmd"] = "capture", ["dir"] = dir, ["seconds"] = Whole(ask["seconds"], 30), ["part"] = Whole(ask["part"], 0),
            ["after_flush"] = ask["after_flush"] is JsonValue f && f.TryGetValue<bool>(out var flush) && flush,
            ["tool"] = Bridge.Model + " " + Program.Version, ["about"] = about(),
        }, "start");
        if (said == null) return Said(409, new JsonObject { ["error"] = "the audio engine didn't answer" });
        if (!ok) { said["error"] = "a capture is running"; return Said(409, said); }
        return Said(202, said);
    }

    /* Where the recording is, as the engine last said. */
    public JsonObject Status() { lock (gate) return (JsonObject)last.DeepClone(); }

    // [cmd] told the engine, and its answer [answer] waited for (three seconds at most): where it is then (null for no
    // answer), and whether it was done.
    private (JsonObject? Said, bool Ok) Ask(JsonObject cmd, string answer)
    {
        lock (asking)
        {
            lock (gate) { awaited = answer; answered = null; }
            player.Tell(cmd);
            lock (gate)
            {
                var until = DateTime.UtcNow.AddSeconds(3);
                while (answered == null && DateTime.UtcNow < until) Monitor.Wait(gate, 100);
                awaited = null;
                if (answered is not { } a) return (null, false);
                var ok = a["ok"] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
                a.Remove("ok");
                return (a, ok);
            }
        }
    }

    // What the engine said of the recording; null, that the engine went (with any recording it was making).
    private void Heard(JsonObject? ev)
    {
        lock (gate)
        {
            if (ev == null)
            {
                if ((string?)last["state"] is "armed" or "recording" or "finishing") { last["state"] = "failed"; last["reason"] = "the audio engine stopped"; }
                return;
            }
            var said = (JsonObject)ev.DeepClone();
            var answer = (string?)said["answer"];
            said.Remove("ev"); said.Remove("answer");
            var ok = said["ok"]?.DeepClone();
            said.Remove("ok");
            last = said;
            if (answer != null && answer == awaited)
            {
                answered = (JsonObject)said.DeepClone();
                answered["ok"] = ok;
                Monitor.PulseAll(gate);
            }
        }
    }

    private static int Whole(JsonNode? n, int otherwise) =>
        n is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) ? (int)Math.Clamp(d, int.MinValue, int.MaxValue) : otherwise;

    private static Http.Response Said(int status, JsonObject o) => Http.Response.Text(status, o.ToJsonString(), Json);

    private static Http.Response Served(string path) =>
        File.Exists(path) ? Http.Response.Of(path, path.EndsWith(".json", StringComparison.Ordinal) ? Json : "audio/wav") : Http.Response.Text(404, "");
}
