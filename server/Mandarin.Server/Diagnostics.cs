// Diagnostics.cs — the server's side of the Android app's logging (bug list item 121; the app's
// Settings → Setup → Logging). Off unless switched on there; while on, each line the server logs is
// kept as well, without what is the owner's alone (item 235), for the app to fetch when the log is
// saved. Off again, what was kept is deleted.
//
// What is kept of a line (LogLine.cs, LogScrub.cs, item 235): all of it but what is the owner's alone (keys, tokens
// and passwords, email addresses, account names and logins, internet and Tailscale addresses, their own home folder).
// Home-network addresses, rooms' and devices' names, titles and error messages stay, so a log says what went wrong.
//
//   GET  /api/diagnostics        { on, bytes }
//   POST /api/diagnostics        { on }: switched on or off (off deletes what was kept)
//   GET  /api/diagnostics/log    what was kept, a line each (times in UTC)
//   POST /api/diagnostics/clear  what was kept deleted
//   GET  /api/diagnostics/bridges  every Mandarin Bridge's own log, scrubbed as these lines are (Admin/BridgeLogs.cs)
//
// Kept in the data folder (diagnostics-on, diagnostics.log and .old, a megabyte each), so a restart
// or an update doesn't lose them.
using System.Globalization;

namespace Mandarin.Server;

internal static class Diagnostics
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
