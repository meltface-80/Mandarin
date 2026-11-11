// Diagnostics.cs — the server's log, kept on disk as Roon keeps its own: always on, with no way to switch it off,
// in plain-text files that roll (logs, item 389). Before, it was the Android app's to switch (items 121, 334), and
// switching off deleted it, so a fault seen once was gone before anyone thought to look.
//
// Kept in <data>/Logs: MandarinServer_log.txt the newest, then MandarinServer_log.01.txt … .20.txt, older each,
// 8 MB a file, so 168 MB at most. Each file opens with what this server is (LogHeader.cs). A line:
//
//   2026-11-11 21:14:03.123 UTC  INFO   [auth] signed in: test (android) from 192.168.1.20
//
// What is kept of a line (LogLine.cs, LogScrub.cs, item 235): all of it but what is the owner's alone (keys, tokens
// and passwords, email addresses, account names and logins, internet and Tailscale addresses, their own home folder).
// Home-network addresses, rooms' and devices' names, titles and error messages stay, so a log says what went wrong.
// Lines logged before the data folder is known (the start) are held, and written first once it is.
//
//   GET  /api/diagnostics          { on: true, bytes }
//   POST /api/diagnostics          { on }: answered { on: true } whatever is asked; the log stays on
//   GET  /api/diagnostics/log      the newest 4 MB kept, oldest first (times in UTC)
//   POST /api/diagnostics/clear    what was kept deleted; a new file begun
//   GET  /api/diagnostics/bridges  every Mandarin Bridge's own log, scrubbed as these lines are (Admin/BridgeLogs.cs)
using System.Globalization;
using System.Text;

namespace Mandarin.Server;

internal static class Diagnostics
{
    public const string Withheld = "[…]";
    public const string Name = "MandarinServer_log";
    public const int Kept = 20;
    private static long fileBytes = 8L * 1024 * 1024;
    public const int TextBytes = 4 * 1024 * 1024;
    private const int HeldMax = 2000;
    private static readonly object gate = new();
    private static readonly List<string> held = [];
    private static string dir = "";
    private static StreamWriter? writer;

    /* Always: the log can't be switched off (item 389). */
    public static bool On => true;

    /* The folder the files are kept in, "" until the data folder is known. */
    public static string Dir => dir;

    /* The file [n] back: 0 the newest. */
    public static string FileAt(int n) => Path.Combine(dir, n == 0 ? Name + ".txt" : $"{Name}.{n:00}.txt");

    /* Kept from now in [dataDir]/Logs: what was held written first. The old diagnostics files (the switch's flag, and
       diagnostics.log and .old, from before) let go, what they held kept as MandarinServer_before.txt. */
    public static void Start(string dataDir)
    {
        lock (gate)
        {
            dir = Path.Combine(dataDir, "Logs");
            // A file's size before the next is begun: 8 MB, or smaller for the tests (MANDARIN_LOG_BYTES).
            if (long.TryParse(Environment.GetEnvironmentVariable("MANDARIN_LOG_BYTES"), out var b) && b > 0) fileBytes = b;
            try
            {
                Directory.CreateDirectory(dir);
                Before(dataDir);
                Open();
                foreach (var l in held) writer!.Write(l);
                writer!.Flush();
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Console.Error.WriteLine($"[diagnostics] the log can't be kept in {dir}: {e.Message}"); }
            held.Clear();
        }
    }

    private static void Before(string dataDir)
    {
        File.Delete(Path.Combine(dataDir, "diagnostics-off"));
        var old = new[] { "diagnostics.old", "diagnostics.log" }.Select(f => Path.Combine(dataDir, f)).Where(File.Exists).ToList();
        if (old.Count == 0) return;
        File.WriteAllText(Path.Combine(dir, "MandarinServer_before.txt"), string.Concat(old.Select(File.ReadAllText)));
        foreach (var f in old) File.Delete(f);
    }

    /* The newest file opened to add to, begun with the header when it is new. */
    private static void Open()
    {
        var f = FileAt(0);
        var fresh = !File.Exists(f) || new FileInfo(f).Length == 0;
        writer = new StreamWriter(new FileStream(f, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete), new UTF8Encoding(false));
        if (fresh) writer.Write(LogHeader.Text());
    }

    /* The files moved one back (the oldest let go), and a new one begun. */
    private static void Roll()
    {
        writer?.Dispose();
        writer = null;
        File.Delete(FileAt(Kept));
        for (var n = Kept - 1; n >= 0; n--)
            if (File.Exists(FileAt(n))) File.Move(FileAt(n), FileAt(n + 1), true);
        Open();
    }

    /* What was kept deleted, and a new file begun. */
    public static void Clear()
    {
        lock (gate)
        {
            if (dir.Length == 0) return;
            writer?.Dispose();
            writer = null;
            for (var n = 0; n <= Kept; n++) File.Delete(FileAt(n));
            Open();
            writer!.Flush();
        }
    }

    /* How much is kept. */
    public static long Bytes()
    {
        lock (gate) return dir.Length == 0 ? 0 : Enumerable.Range(0, Kept + 1).Sum(n => Size(FileAt(n)));
    }

    private static long Size(string f) => File.Exists(f) ? new FileInfo(f).Length : 0;

    /* The newest [TextBytes] kept, oldest first. */
    public static string Text()
    {
        lock (gate)
        {
            writer?.Flush();
            if (dir.Length == 0) return "";
            var parts = new List<string>();
            long room = TextBytes;
            for (var n = 0; n <= Kept && room > 0; n++)
            {
                var f = FileAt(n);
                if (!File.Exists(f)) continue;
                var t = Tail(f, room);
                parts.Add(t.Text);
                room -= t.Bytes;
            }
            parts.Reverse();
            return string.Concat(parts);
        }
    }

    /* The last [room] bytes of [f], from the start of a line. */
    private static (string Text, long Bytes) Tail(string f, long room)
    {
        using var s = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var from = Math.Max(0, s.Length - room);
        s.Position = from;
        var bytes = new byte[s.Length - from];
        s.ReadExactly(bytes);
        var start = 0;
        if (from > 0) { var nl = Array.IndexOf(bytes, (byte)'\n'); start = nl < 0 ? bytes.Length : nl + 1; }
        return (Encoding.UTF8.GetString(bytes, start, bytes.Length - start), bytes.Length);
    }

    /* A line as written to the log: its time in UTC and its level put before it. */
    public static string Stamp(string level, string line) =>
        DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) + " UTC  " + level.PadRight(5) + "  " + line + "\n";

    /* A line kept ([line] scrubbed already), at [level]: INFO, WARN or ERROR. */
    public static void Record(string? line, string level = "INFO")
    {
        if (line == null) return;
        var text = Stamp(level, line);
        lock (gate)
        {
            if (dir.Length == 0)
            {
                if (held.Count < HeldMax) held.Add(text);
                return;
            }
            try
            {
                if (writer == null) Open();
                else if (writer.BaseStream.Length > fileBytes) Roll();
                writer!.Write(text);
                writer.Flush();
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or ObjectDisposedException) { writer = null; /* a full disk: the console has the line */ }
        }
    }

    /* A value put into a line, as kept (the whole line is scrubbed after, LogScrub.Line): an account's name or login as […]. */
    public static string Hole<T>(T value) => value switch
    {
        null => "",
        Personal => Withheld,
        bool b => b ? "true" : "false",
        PathString p => p.Value ?? "",
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? ""
    };
}
