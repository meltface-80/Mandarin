// BridgeLogsKept.cs — every Mandarin Bridge's log, kept on the server too (logs, item 389): every five minutes each Bridge
// Mandarin knows is asked for its newest lines (BridgeLogs.Read, scrubbed as the server's own), and what is new since the
// last time is added to Logs/Bridges/<its name>.txt, rolled at 4 MB into .01 to .05. A Bridge keeps its own log too
// (its Kept.cs, BridgeLog.kt); this is so every device's log is in one place, the server's Logs folder, without fetching
// any by hand. A Bridge that isn't answering is tried again next time; nothing is lost while its own files hold it.
using System.Text;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Admin;

internal static class BridgeLogsKept
{
    public const int Files = 5;
    private const long FileBytes = 4L * 1024 * 1024;
    private static readonly Dictionary<string, string> last = [];
    private static readonly SemaphoreSlim busy = new(1, 1);
    private static Timer? timer;

    /* Every five minutes from a minute after the start (every MANDARIN_BRIDGE_LOGS_EVERY seconds, for the tests). */
    public static void Start()
    {
        var every = int.TryParse(Environment.GetEnvironmentVariable("MANDARIN_BRIDGE_LOGS_EVERY"), out var s) && s > 0 ? TimeSpan.FromSeconds(s) : TimeSpan.FromMinutes(5);
        timer ??= new Timer(_ => _ = Safe(), null, every < TimeSpan.FromMinutes(1) ? every : TimeSpan.FromMinutes(1), every);
    }

    private static async Task Safe()
    {
        try { await Keep(); }
        catch (Exception e) { Server.Log($"[bridges] their logs couldn't be kept: {e.GetType().Name}: {e.Message}"); }
    }

    /* Each Bridge's lines new since the last time, added to its file: how many lines were added in all. */
    public static async Task<int> Keep()
    {
        if (Diagnostics.Dir.Length == 0) return 0;
        await busy.WaitAsync();
        try
        {
            var n = 0;
            foreach (var rec in BridgeUpdates.Bridges()) n += await KeepOne(rec);
            return n;
        }
        finally { busy.Release(); }
    }

    private static async Task<int> KeepOne(DeviceRecord rec)
    {
        var (head, lines, _) = await BridgeLogs.Read(rec);
        if (lines == null || lines.Length == 0) return 0;
        var dir = Path.Combine(Diagnostics.Dir, "Bridges");
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, FileName(BridgeUpdates.Name(rec)) + ".txt");
        if (!last.TryGetValue(file, out var was)) was = LastLine(file);
        var from = 0;
        var gap = false;
        if (was != null)
        {
            var at = Array.LastIndexOf(lines, was);
            if (at >= 0) from = at + 1;
            else gap = true;   // restarted, or more was said than one answer holds
        }
        if (from >= lines.Length) return 0;
        var b = new StringBuilder();
        if (!File.Exists(file) || new FileInfo(file).Length == 0) b.Append("# ").Append(head).Append('\n');
        if (gap) b.Append("# ").Append(head).Append(": lines may be missing before these\n");
        for (var i = from; i < lines.Length; i++) b.Append(lines[i]).Append('\n');
        if (File.Exists(file) && new FileInfo(file).Length > FileBytes) Roll(file);
        await File.AppendAllTextAsync(file, b.ToString());
        last[file] = lines[^1];
        return lines.Length - from;
    }

    /* A Bridge's name as a file's: letters, figures, spaces, dots, dashes and brackets kept, the rest "_". */
    public static string FileName(string name)
    {
        var s = new string([.. name.Select(c => char.IsLetterOrDigit(c) || c is ' ' or '-' or '.' or '(' or ')' or '_' ? c : '_')]).Trim().Trim('.');
        return s.Length == 0 ? "bridge" : s.Length > 64 ? s[..64] : s;
    }

    private static string? LastLine(string file)
    {
        if (!File.Exists(file)) return null;
        var l = File.ReadLines(file).LastOrDefault(x => x.Length > 0 && !x.StartsWith('#'));
        return l;
    }

    private static void Roll(string file)
    {
        string At(int n) => n == 0 ? file : file[..^4] + $".{n:00}.txt";
        File.Delete(At(Files));
        for (var n = Files - 1; n >= 0; n--)
            if (File.Exists(At(n))) File.Move(At(n), At(n + 1), true);
    }
}
