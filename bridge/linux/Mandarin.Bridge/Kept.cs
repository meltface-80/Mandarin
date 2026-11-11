// Kept.cs — the Bridge's own log, kept as Mandarin's server keeps its own (item 389): always, in plain-text files in its
// data folder that roll, Logs/MandarinBridge_log.txt the newest, then .01 to .10 older, 4 MB each, so a restart, an
// update or a crash loses none of it. Each file opens with what this Bridge is; each line is dated in UTC with its level:
//
//   2026-11-11 21:14:03.123 UTC  INFO   [http] listening on 49494
//
// GET /log answers the newest lines (Mandarin's server fetches them, Admin/BridgeLogs.cs, each line put through its
// LogScrub there). Until the data folder is known, or where it can't be written, the last lines are kept in memory
// alone, as they were before (item 291). What it logs goes to standard error as well, for journald.
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace Mandarin.Bridge;

internal static class Kept
{
    /* The most lines kept in memory: the oldest go first. */
    public const int Most = 2000;
    public const string Name = "MandarinBridge_log";
    public const int Files = 10;
    /* The most of the files /log answers: the newest. */
    public const int TextBytes = 1024 * 1024;
    private static long fileBytes = 4L * 1024 * 1024;
    private static readonly Queue<string> lines = new();
    private static string dir = "";
    private static StreamWriter? writer;

    /* The folder the files are kept in, "" while they aren't. */
    public static string Dir => dir;

    /* The file [n] back: 0 the newest. */
    public static string FileAt(int n) => Path.Combine(dir, n == 0 ? Name + ".txt" : $"{Name}.{n:00}.txt");

    /* A line as written: its time (UTC, with the date) and its level before it. */
    public static string Stamp(string level, string line) =>
        DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) + " UTC  " + level.PadRight(5) + "  " + line;

    /* Kept from now in [data]/Logs, what was said before written first. */
    public static void Start(string data)
    {
        lock (lines)
        {
            if (long.TryParse(Environment.GetEnvironmentVariable("MANDARIN_LOG_BYTES"), out var b) && b > 0) fileBytes = b;
            try
            {
                dir = Path.Combine(data, "Logs");
                Directory.CreateDirectory(dir);
                Open();
                foreach (var l in lines) writer!.Write(l + "\n");
                writer!.Flush();
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                dir = "";
                writer = null;
                Console.Error.WriteLine($"the log can't be kept in {Path.Combine(data, "Logs")} ({e.Message}): in memory alone");
            }
        }
    }

    private static void Open()
    {
        var f = FileAt(0);
        var fresh = !File.Exists(f) || new FileInfo(f).Length == 0;
        writer = new StreamWriter(new FileStream(f, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete), new UTF8Encoding(false));
        if (fresh) writer.Write(Header());
    }

    private static void Roll()
    {
        writer?.Dispose();
        writer = null;
        File.Delete(FileAt(Files));
        for (var n = Files - 1; n >= 0; n--)
            if (File.Exists(FileAt(n))) File.Move(FileAt(n), FileAt(n + 1), true);
        Open();
    }

    /* What opens a file: which Bridge, on what, and the time zone, as every line is in UTC. */
    private static string Header()
    {
        var o = TimeZoneInfo.Local.GetUtcOffset(DateTime.UtcNow);
        string[] h =
        [
            $"Mandarin Bridge {Program.Version} (build {Program.Commit}) log, begun {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC",
            $"System: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture}), {Environment.ProcessorCount} cores",
            $"Time zone: {TimeZoneInfo.Local.Id} (UTC{(o < TimeSpan.Zero ? "-" : "+")}{o.ToString(@"hh\:mm", CultureInfo.InvariantCulture)}); every time below is UTC",
        ];
        return string.Concat(h.Select(l => "# " + l + "\n"));
    }

    /* [line] kept, at [level] (INFO, WARN or ERROR), stamped with when. */
    public static void Add(string line, string level = "INFO")
    {
        var stamped = Stamp(level, line);
        lock (lines)
        {
            lines.Enqueue(stamped);
            while (lines.Count > Most) lines.Dequeue();
            if (dir.Length == 0) return;
            try
            {
                if (writer == null) Open();
                else if (writer.BaseStream.Length > fileBytes) Roll();
                writer!.Write(stamped + "\n");
                writer.Flush();
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or ObjectDisposedException) { writer = null; /* a full card: memory and journald have it */ }
        }
    }

    /* The newest lines, oldest first, a line each: from the files where they are kept, else from memory. */
    public static string Text()
    {
        lock (lines)
        {
            if (dir.Length == 0)
            {
                var b = new StringBuilder();
                foreach (var l in lines) b.Append(l).Append('\n');
                return b.ToString();
            }
            writer?.Flush();
            var parts = new List<string>();
            long room = TextBytes;
            for (var n = 0; n <= Files && room > 0; n++)
            {
                if (!File.Exists(FileAt(n))) continue;
                var (text, bytes) = Tail(FileAt(n), room);
                parts.Add(text);
                room -= bytes;
            }
            parts.Reverse();
            return string.Concat(parts);
        }
    }

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
}
