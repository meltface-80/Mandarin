// Diagnostics.cs — the server's side of the Android app's logging (bug list item 121; the app's
// Settings → Setup → Logging). Off unless switched on there; while on, each line the server logs is
// kept as well, without anything that could be someone's personal data, for the app to fetch when the
// log is saved. Off again, what was kept is deleted.
//
// What is kept of a line (LogLine.cs): the code's own words as they are; of the values put into them,
// numbers, the names of errors (FileNotFoundException), the server's own addresses (/api/...) and the
// streaming services' names; anything else (a name, an address, a file or folder, a message) as […].
// A line handed over already made keeps only its tag ("[sonos]"). So no IP address, name, title, path
// or account detail is ever kept.
//
//   GET  /api/diagnostics        { on, bytes }
//   POST /api/diagnostics        { on }: switched on or off (off deletes what was kept)
//   GET  /api/diagnostics/log    what was kept, a line each (times in UTC)
//   POST /api/diagnostics/clear  what was kept deleted
//
// Kept in the data folder (diagnostics-on, diagnostics.log and .old, a megabyte each), so a restart
// or an update doesn't lose them.
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Diagnostics
{
    public const string Withheld = "[…]";
    private const long FileBytes = 1024 * 1024;
    private static readonly object gate = new();
    private static bool? on;

    private static string Flag => Path.Combine(Server.DataDir, "diagnostics-on");
    private static string File1 => Path.Combine(Server.DataDir, "diagnostics.log");
    private static string File0 => Path.Combine(Server.DataDir, "diagnostics.old");

    /* Switched on (read from the data folder once it is known). */
    public static bool On
    {
        get
        {
            if (on is { } v) return v;
            if (Server.DataDir.Length == 0) return false;
            lock (gate)
            {
                on ??= File.Exists(Flag);
                return on.Value;
            }
        }
    }

    /* Switched on or off; off deletes what was kept. */
    public static void Switch(bool to)
    {
        lock (gate)
        {
            if (to) File.WriteAllText(Flag, "");
            else { File.Delete(Flag); DeleteKept(); }
            on = to;
        }
        if (to) Record("[diagnostics] on");
    }

    /* What was kept deleted. */
    public static void Clear() { lock (gate) DeleteKept(); }

    private static void DeleteKept() { File.Delete(File1); File.Delete(File0); }

    /* How much is kept. */
    public static long Bytes() { lock (gate) return Size(File0) + Size(File1); }

    private static long Size(string f) => File.Exists(f) ? new FileInfo(f).Length : 0;

    /* What was kept, oldest first. */
    public static string Text()
    {
        lock (gate) return (File.Exists(File0) ? File.ReadAllText(File0) : "") + (File.Exists(File1) ? File.ReadAllText(File1) : "");
    }

    /* A line kept (its time in UTC put before it), when on. */
    public static void Record(string? line)
    {
        if (line == null || !On) return;
        var text = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + " " + line + "\n";
        lock (gate)
        {
            try
            {
                if (Size(File1) > FileBytes) File.Move(File1, File0, true);
                File.AppendAllText(File1, text);
            }
            catch (IOException) { /* a full disk: the console has the line */ }
        }
    }

    /* A value put into a line, as kept: only what can't be anyone's personal data. */
    public static string Hole<T>(T value) => value switch
    {
        null => "",
        bool b => b ? "true" : "false",
        sbyte or byte or short or ushort or int or uint or long or ulong or float or double or decimal => Convert.ToString(value, CultureInfo.InvariantCulture) ?? Withheld,
        TimeSpan t => t.ToString("c", CultureInfo.InvariantCulture),
        PathString p => Word(p.Value ?? ""),
        string s => Word(s),
        _ => Withheld
    };

    /* A word kept: an error's name, a streaming service's, or one of the server's addresses (without what follows a "?"). */
    private static string Word(string s)
    {
        if (ErrorName().IsMatch(s) || s is "qobuz" or "tidal" or "spotify" or "lastfm") return s;
        if (s.StartsWith("/api/", StringComparison.Ordinal) || s.StartsWith("/stream/", StringComparison.Ordinal))
        {
            var q = s.IndexOf('?');
            var bare = q < 0 ? s : s[..q];
            return SafePath().IsMatch(bare) ? bare : Withheld;
        }
        return Withheld;
    }

    /* A line handed over already made: only its tag kept ("[sonos] …"). */
    public static string TagOnly(string line)
    {
        var m = Tag().Match(line);
        return (m.Success ? m.Value + " " : "") + Withheld;
    }

    [GeneratedRegex(@"\A[A-Z][A-Za-z0-9]*(Exception|Error)\z")]
    private static partial Regex ErrorName();
    [GeneratedRegex(@"\A/[a-z0-9/_.-]*\z")]
    private static partial Regex SafePath();
    [GeneratedRegex(@"\A\[[a-z][a-z0-9 _.-]{0,23}\]")]
    private static partial Regex Tag();
}
