// BridgeLogsKept.cs — every Mandarin Bridge's lines in the one log (item 389, then 425): every minute each Bridge Mandarin
// knows is asked for its newest lines (BridgeLogs.Read, scrubbed as the server's own), and those new since the last time
// go into the one log as "[bridge <its name>]", with the time each was said (DiagnosticsMore.Relay). A Bridge keeps its
// lines until asked (its Kept.cs, BridgeLog.kt), so one not answering is asked again next time and none is lost. The last
// line taken from each is kept in <data>/bridge-logs.json, so a restart of the server takes none twice; a Bridge seen for
// the first time gives what it said from ten minutes before the server started.
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Admin;

internal static class BridgeLogsKept
{
    private static readonly DateTime started = DateTime.UtcNow;
    private static readonly SemaphoreSlim busy = new(1, 1);
    private static Dictionary<string, string>? last;
    private static Timer? timer;

    private static string MarksFile => Path.Combine(Server.DataDir, "bridge-logs.json");

    /* Every minute from half a minute after the start (every MANDARIN_BRIDGE_LOGS_EVERY seconds, for the tests). */
    public static void Start()
    {
        var every = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_BRIDGE_LOGS_EVERY"), out var s) && s > 0 ? TimeSpan.FromSeconds(s) : TimeSpan.FromMinutes(1);
        timer ??= new Timer(_ => _ = Safe(), null, every < TimeSpan.FromSeconds(30) ? every : TimeSpan.FromSeconds(30), every);
    }

    private static async Task Safe()
    {
        try { await Keep(); }
        catch (Exception e) { Server.Log($"[bridges] their lines couldn't be fetched: {e.GetType().Name}: {e.Message}"); }
    }

    /* Each Bridge's lines new since the last time, into the one log: how many in all. */
    public static async Task<int> Keep()
    {
        await busy.WaitAsync();
        try
        {
            last ??= Load();
            var n = 0;
            foreach (var rec in BridgeUpdates.Bridges()) n += await KeepOne(rec);
            if (n > 0) Save();
            return n;
        }
        finally { busy.Release(); }
    }

    private static async Task<int> KeepOne(DeviceRecord rec)
    {
        var (_, lines, _) = await BridgeLogs.Read(rec);
        if (lines == null || lines.Length == 0) return 0;
        var name = BridgeUpdates.Name(rec);
        var from = New(lines, last!.GetValueOrDefault(name));
        if (from >= lines.Length) return 0;
        DiagnosticsMore.Relay(DiagnosticsMore.Source("bridge", name), lines.Skip(from));
        last![name] = lines[^1];
        return lines.Length - from;
    }

    /* Where the lines new since [mark] begin: after it where it is among them; where it isn't (the Bridge started again,
       or said more than one answer holds), at the first said after it; never seen, the first said from ten minutes
       before this server started. */
    public static int New(string[] lines, string? mark)
    {
        if (mark != null)
        {
            var at = Array.LastIndexOf(lines, mark);
            if (at >= 0) return at + 1;
        }
        var since = mark == null ? started.AddMinutes(-10) : Diagnostics.Parse(mark)?.At ?? DateTime.MinValue;
        for (var i = 0; i < lines.Length; i++)
            if (Diagnostics.Parse(lines[i]) is { } p && (mark == null ? p.At >= since : p.At > since)) return i;
        return lines.Length;
    }

    private static Dictionary<string, string> Load()
    {
        try
        {
            if (JsonNode.Parse(File.ReadAllText(MarksFile)) is JsonObject o)
                return o.Where(kv => kv.Value is JsonValue).ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<string>());
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException or InvalidOperationException) { /* none yet */ }
        return [];
    }

    private static void Save()
    {
        var o = new JsonObject();
        foreach (var (k, v) in last!) o[k] = v;
        try { File.WriteAllText(MarksFile + ".new", o.ToJsonString()); File.Move(MarksFile + ".new", MarksFile, true); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* asked again next time; a line may come twice */ }
    }
}
