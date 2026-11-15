// BridgeLogs.cs — each Mandarin Bridge's own lines, read for the one log (item 291, then 425): a Bridge keeps its last
// lines and answers them at the path its /dac.json names ("log": the Linux Bridge's Kept.cs, the Android one's
// BridgeLog.kt), and BridgeLogsKept.cs puts what is new in them into the one log as "[bridge <its name>]", each line put
// through LogScrub as the server's own are, so what is the owner's alone stays out of it. A Bridge whose lines reach the
// one log another way (the Linux Bridge on Mandarin OS, through the journal) names no "log", and isn't read.
using System.Text;
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers;

namespace Mandarin.Server.Admin;

internal static class BridgeLogs
{
    /* The most of a Bridge's log read: a megabyte, its newest lines. */
    public const int MostBytes = 1024 * 1024;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    /* Bridge [rec]'s heading ("— Mandarin Bridge: name (platform version, build c) —"), and its newest lines, scrubbed,
       or null and why it has none ("(it isn't answering: its log isn't here)"). */
    public static async Task<(string Head, string[]? Lines, string? Why)> Read(DeviceRecord rec)
    {
        var at = BridgeUpdates.Base(rec);
        var dac = await MandarinBridge.Probe(at);
        var head = new StringBuilder("— Mandarin Bridge: ").Append(BridgeUpdates.Name(rec));
        if (dac != null)
        {
            head.Append(" (").Append(BridgeUpdates.Said(dac["platform"]) is { Length: > 0 } p ? p : "android");
            if (BridgeUpdates.Said(dac["version"]) is { Length: > 0 } v) head.Append(' ').Append(v);
            if (BridgeUpdates.Said(dac["commit"]) is { Length: > 0 } c) head.Append(", build ").Append(c);
            head.Append(')');
        }
        head.Append(" —");
        var h = head.ToString();
        if (dac == null) return (h, null, "(it isn't answering: its log isn't here)");
        // Only a path on the Bridge itself: never another address, its /dac.json being anyone's to answer.
        if (BridgeUpdates.Said(dac["log"]) is not { Length: > 1 } path || path[0] != '/' || path.StartsWith("//", StringComparison.Ordinal))
            return (h, null, "(its app is older and keeps no log for Mandarin)");
        try
        {
            using var r = await Http.GetAsync(at + path, HttpCompletionOption.ResponseHeadersRead);
            if (!r.IsSuccessStatusCode) return (h, null, $"(it didn't give its log: HTTP {(int)r.StatusCode})");
            var text = await Newest(await r.Content.ReadAsStreamAsync());
            return (h, [.. text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).Select(LogScrub.Line)], null);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
        {
            return (h, null, "(it didn't give its log: " + e.Message + ")");
        }
    }

    // What [s] holds, its last [MostBytes] where it holds more, from the first whole line in them.
    private static async Task<string> Newest(Stream s)
    {
        var buf = new MemoryStream();
        await s.CopyToAsync(buf);
        var all = buf.GetBuffer().AsSpan(0, (int)buf.Length);
        if (all.Length <= MostBytes) return Encoding.UTF8.GetString(all);
        var tail = all[^MostBytes..];
        var nl = tail.IndexOf((byte)'\n');
        return Encoding.UTF8.GetString(nl < 0 ? tail : tail[(nl + 1)..]);
    }
}
