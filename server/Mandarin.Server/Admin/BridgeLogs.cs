// BridgeLogs.cs — each Mandarin Bridge's own log, for the Mandarin app's (item 291): when the app's log is saved
// (Settings → Setup → Logging → Save log) it is the app's, the server's, then every Bridge Mandarin knows (Android,
// Linux, a Raspberry Pi), each under its name. A Bridge keeps its last lines and answers them at the path its
// /dac.json names ("log": the Linux Bridge's Kept.cs, the Android one's BridgeLog.kt); each line is put through
// LogScrub as the server's own are, so what is the owner's alone stays out of it.
//
//   GET /api/diagnostics/bridges   text: a heading for each Bridge, then its lines (times in UTC), or why there are none
using System.Text;
using Mandarin.Server.Playback;
using Mandarin.Server.Renderers;

namespace Mandarin.Server.Admin;

internal static class BridgeLogs
{
    /* The most of a Bridge's log read: a megabyte, its newest lines. */
    public const int MostBytes = 1024 * 1024;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    /* Every Bridge's log, each under its heading; a line saying so where Mandarin knows none. */
    public static async Task<string> Text()
    {
        var list = BridgeUpdates.Bridges();
        if (list.Count == 0) return "(Mandarin knows no Mandarin Bridge)\n";
        return string.Join("\n", await Task.WhenAll(list.Select(One)));
    }

    // Bridge [rec]'s heading and log, or why it has none.
    private static async Task<string> One(DeviceRecord rec)
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
        head.Append(" —\n");
        if (dac == null) return head + "(it isn't answering: its log isn't here)\n";
        // Only a path on the Bridge itself: never another address, its /dac.json being anyone's to answer.
        if (BridgeUpdates.Said(dac["log"]) is not { Length: > 1 } path || path[0] != '/' || path.StartsWith("//", StringComparison.Ordinal))
            return head + "(its app is older and keeps no log for Mandarin)\n";
        try
        {
            using var r = await Http.GetAsync(at + path, HttpCompletionOption.ResponseHeadersRead);
            if (!r.IsSuccessStatusCode) return head + $"(it didn't give its log: HTTP {(int)r.StatusCode})\n";
            var text = await Newest(await r.Content.ReadAsStreamAsync());
            var b = new StringBuilder(head.ToString());
            foreach (var line in text.Split('\n'))
                if (line.TrimEnd('\r') is { Length: > 0 } l) b.Append(LogScrub.Line(l)).Append('\n');
            return b.ToString();
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
        {
            return head + "(it didn't give its log: " + e.Message + ")\n";
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
