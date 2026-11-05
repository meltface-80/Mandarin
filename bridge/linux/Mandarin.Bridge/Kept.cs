// Kept.cs — the Bridge's own log, its last lines kept in memory for Mandarin's (item 291): GET /log, which the server
// fetches when the Mandarin app's log is saved (Settings → Setup → Logging), each line put through its LogScrub there.
// What it logs goes to standard error as well, for journald, as it always has.
using System.Globalization;
using System.Text;

namespace Mandarin.Bridge;

internal static class Kept
{
    /* The most lines kept: the oldest go first. */
    public const int Most = 2000;
    private static readonly Queue<string> lines = new();

    /* [line] kept, stamped with when (UTC, the date in it). */
    public static void Add(string line)
    {
        var at = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
        lock (lines)
        {
            lines.Enqueue(at + " " + line);
            while (lines.Count > Most) lines.Dequeue();
        }
    }

    /* The lines kept, the oldest first, a line each. */
    public static string Text()
    {
        lock (lines)
        {
            var b = new StringBuilder();
            foreach (var l in lines) b.Append(l).Append('\n');
            return b.ToString();
        }
    }
}
