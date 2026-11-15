// Diagnostics.cs — Mandarin's one log (item 425): every line of the server's, of the Android app's and the page's (sent
// here, DiagnosticsMore.cs) and of every Mandarin Bridge's (fetched, Admin/BridgeLogsKept.cs), in one plain-text file,
// a line an event in the order they come, each saying where it came from:
//
//   2026-11-15 09:43:12.345 UTC  INFO   [server] [scan] 12 albums added
//   2026-11-15 09:43:14.002 UTC  WARN   [app Pixel 8] [NET] server GET /api/zones → HTTP 500 after 40 ms
//
// On Mandarin OS (from 0.1.8, which sets MANDARIN_LOG=journal) the server writes its lines to standard output alone:
// journald has them, and the OS's one writer (mandarin-log) puts them in /data/Logs with the OS's own and its Bridge's,
// so a crash of the server loses none. Anywhere else the server writes the one log itself, in <data>/Logs:
// Mandarin_log.txt the newest; at 8 MB it becomes Mandarin_log.01.txt (the one before .02, and so on) and a new one is
// begun, ten files at most, the oldest let go. A file holds whole lines only: a roll comes between two of them.
// The per-component logs before it (MandarinServer_log, Logs/Bridges, Logs/Apps, Logs/Web) are let go as it starts.
//
// What is kept of a line (LogLine.cs, LogScrub.cs, item 235): all of it but what is the owner's alone (keys, tokens
// and passwords, email addresses, account names and logins, internet and Tailscale addresses, their own home folder).
// Lines logged before the data folder is known (the start) are held, and written first once it is.
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Diagnostics
{
    public const string Withheld = "[…]";
    public const string Name = "Mandarin_log";
    /* The files kept: the newest and nine numbered. */
    public const int Files = 10;
    private const int HeldMax = 2000;
    private static long fileBytes = 8L * 1024 * 1024;
    private static readonly object gate = new();
    private static readonly List<string> held = [];
    private static string dir = "";
    private static FileStream? file;

    /* Mandarin OS writes the one log (MANDARIN_LOG=journal): the server's lines go to standard output alone. */
    public static bool Journal => Environment.GetEnvironmentVariable("MANDARIN_LOG") == "journal";

    /* The folder the files are kept in, "" until the data folder is known (and always, with Mandarin OS writing it). */
    public static string Dir => dir;

    /* The file [n] back: 0 the newest. */
    public static string FileAt(int n) => Path.Combine(dir, n == 0 ? Name + ".txt" : $"{Name}.{n:00}.txt");

    /* Kept from now in [dataDir]/Logs, what was held written first, and the logs from before let go; with Mandarin OS
       writing it, nothing kept here. */
    public static void Start(string dataDir)
    {
        lock (gate)
        {
            if (Journal) { held.Clear(); return; }
            dir = Path.Combine(dataDir, "Logs");
            // A file's size before the next is begun: 8 MB, or smaller for the tests (MANDARIN_LOG_BYTES).
            if (long.TryParse(Environment.GetEnvironmentVariable("MANDARIN_LOG_BYTES"), out var b) && b > 0) fileBytes = b;
            try
            {
                Directory.CreateDirectory(dir);
                Retire(dataDir);
                foreach (var l in held) Append(l);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Console.Error.WriteLine($"[diagnostics] the log can't be kept in {dir}: {e.Message}"); }
            held.Clear();
        }
    }

    /* The logs from before the one log (items 121 to 392): the server's own files, the Bridges', the apps' and the page's
       folders, and the old diagnostics files. Nothing in them is carried over. */
    private static void Retire(string dataDir)
    {
        foreach (var f in Directory.EnumerateFiles(dir, "MandarinServer_*.txt")) Try(() => File.Delete(f));
        foreach (var d in new[] { "Bridges", "Apps", "Web" }.Select(d => Path.Combine(dir, d)).Where(Directory.Exists)) Try(() => Directory.Delete(d, true));
        foreach (var f in new[] { "diagnostics-off", "diagnostics.log", "diagnostics.old" }) Try(() => File.Delete(Path.Combine(dataDir, f)));
    }

    private static void Try(Action a)
    {
        try { a(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* left: tried again at the next start */ }
    }

    /* [text] (whole lines) added to the newest file; a new one begun first where it would pass the size. */
    private static void Append(string text)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        if (file == null) Open();
        if (file!.Length > 0 && file.Length + bytes.Length > fileBytes) Roll();
        file!.Write(bytes);
        file.Flush();
    }

    private static void Open() =>
        file = new FileStream(FileAt(0), FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);

    /* The files moved one back (the oldest let go), and a new one begun. */
    private static void Roll()
    {
        file?.Dispose();
        file = null;
        File.Delete(FileAt(Files - 1));
        for (var n = Files - 2; n >= 0; n--)
            if (File.Exists(FileAt(n))) File.Move(FileAt(n), FileAt(n + 1), true);
        Open();
    }

    /* A line as the log has it: its time in UTC, its level, where it came from, and what it says. */
    public static string Stamp(DateTime at, string level, string source, string text) =>
        at.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) + " UTC  " + level.PadRight(5) + "  [" + source + "] " + text + "\n";

    /* [text]'s lines, each stamped (a stack trace's too, so every line of the log says when and where). */
    private static string Lines(DateTime at, string level, string source, string text)
    {
        var b = new StringBuilder();
        foreach (var raw in text.Split('\n'))
        {
            var l = raw.TrimEnd('\r');
            if (l.Trim().Length > 0) b.Append(Stamp(at, level, source, l));
        }
        return b.ToString();
    }

    /* A line said by [source] ("server", "app Pixel 8", "bridge Kitchen", "web Mac · Chrome"), at [level] (INFO, WARN or
       ERROR): [kept] (scrubbed already) to the log and, but where Mandarin OS writes it, [shown] to the console (the line
       as written, for whoever runs the server by hand). [at]: when it was said, now where not given. */
    public static void Write(string source, string level, string kept, string? shown = null, DateTime? at = null)
    {
        var when = at ?? DateTime.UtcNow;
        var text = Lines(when, level, source, kept);
        if (text.Length == 0) return;
        lock (gate)
        {
            Console.Out.Write(Journal || shown == null ? text : Lines(when, level, source, shown));
            if (Journal) return;
            if (dir.Length == 0)
            {
                if (held.Count < HeldMax) held.Add(text);
                return;
            }
            try { Append(text); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or ObjectDisposedException)
            {
                file?.Dispose();
                file = null;   // a full disk: the console has the line, and the next is tried again
            }
        }
    }

    [GeneratedRegex(@"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})? UTC  (INFO|WARN|ERROR|DEBUG)\s+(.*)$")]
    private static partial Regex Ours();

    [GeneratedRegex(@"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})\s+\d+\s+\d+ ([VDIWEF]) (.*)$")]
    private static partial Regex Logcat();

    [GeneratedRegex(@"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})? (.*)$")]
    private static partial Regex Plain();

    /* A line sent from elsewhere read for when it was said, its level and what it says: Mandarin's own ("2026-11-12
       17:30:06.502 UTC  INFO   …", the app's and a Bridge's), Android's logcat ("2026-11-12 17:30:06.502  4242  4250 W
       Tag: …") and an older Bridge's ("2026-11-12 17:30:08 [http] …"); null for a line with no time of its own. */
    public static (DateTime At, string Level, string Text)? Parse(string line)
    {
        string at, level, text;
        if (Ours().Match(line) is { Success: true } o) (at, level, text) = (o.Groups[1].Value + Ms(o.Groups[2]), o.Groups[3].Value, o.Groups[4].Value);
        else if (Logcat().Match(line) is { Success: true } l)
            (at, level, text) = (l.Groups[1].Value + l.Groups[2].Value, l.Groups[3].Value switch { "W" => "WARN", "E" or "F" => "ERROR", "I" => "INFO", _ => "DEBUG" }, l.Groups[4].Value);
        else if (Plain().Match(line) is { Success: true } p) (at, level, text) = (p.Groups[1].Value + Ms(p.Groups[2]), "INFO", p.Groups[3].Value);
        else return null;
        return DateTime.TryParseExact(at, "yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t)
            ? (t, level, text) : null;
    }

    private static string Ms(Group g) => g.Success ? g.Value : ".000";

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
