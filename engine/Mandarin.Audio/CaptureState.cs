// CaptureState.cs — a capture (item 412, Capture.cs) asked and answered over the engine's stdin and stdout: its
// commands (capture, capture_stop, capture_drop) each answered with where it is, in the words of the Android Bridge's
// GET /capture, which Mandarin Bridge for Linux answers with: idle, armed (no stream yet), recording, finishing,
// done, failed, and why; the frames so far and their format; "parts", the parts done and not yet let go.
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Mandarin.Audio;

internal sealed partial class Capture
{
    /* Command [c] ("capture", "capture_stop", "capture_drop"), done and answered. */
    public void Command(string cmd, JsonElement c)
    {
        bool ok;
        string answer;
        switch (cmd)
        {
            case "capture":
                answer = "start";
                var into = Str(c, "dir");
                var said = c.TryGetProperty("about", out var a) && a.ValueKind == JsonValueKind.Object ? JsonNode.Parse(a.GetRawText()) as JsonObject ?? [] : [];
                ok = into.Length > 0 && Start(into, Int(c, "seconds", 30), Int(c, "part", 0), c.TryGetProperty("after_flush", out var f) && f.ValueKind == JsonValueKind.True,
                    Str(c, "tool") is { Length: > 0 } t ? t : "mandarin-audio " + Program.Version, said);
                break;
            case "capture_stop": answer = "stop"; Stop(); ok = true; break;
            default: answer = "drop"; ok = Drop(Int(c, "n", 0)); break;
        }
        JsonObject s;
        lock (gate) s = StatusLocked();
        s["ev"] = "capture"; s["answer"] = answer; s["ok"] = ok;
        emit(s.ToJsonString());
    }

    /* Where it is (lock held). */
    private JsonObject StatusLocked()
    {
        var o = stream;
        var parts = new JsonArray();
        foreach (var (n, frames) in waiting)
            parts.Add((JsonNode)new JsonObject { ["n"] = n, ["wav"] = $"/capture/{n}.wav", ["sidecar"] = $"/capture/{n}.wav.json", ["frames"] = frames });
        var one = state == "done" && partSeconds == 0;
        return new JsonObject
        {
            ["state"] = state, ["reason"] = why, ["seconds"] = seconds, ["part_seconds"] = partSeconds,
            ["frames"] = o != null ? taken / o.FrameBytes : 0, ["rate"] = o?.Rate, ["channels"] = o?.Channels,
            ["container_bits"] = o != null ? 32 : null, ["kind"] = o?.Kind,
            ["wav"] = one ? "/capture.wav" : null, ["sidecar"] = one ? "/capture.wav.json" : null, ["parts"] = parts,
        };
    }

    private static string Str(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static int Int(JsonElement e, string k, int otherwise) =>
        e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) ? (int)Math.Clamp(d, int.MinValue, int.MaxValue) : otherwise;
}
