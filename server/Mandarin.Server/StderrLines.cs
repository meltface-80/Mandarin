// StderrLines.cs — what a program the server runs says on its standard error, into the server's log line by line
// (logs, item 389): the built-in Tailscale engine and the upsampler kept it to themselves (the engine its last twenty
// chunks in memory, the upsampler the whole of it, read only when it failed), so a fault of theirs was in no log.
// Each line is put in as "[tag] line". A program that says a great deal is kept to [PerMinute] lines a minute, and the
// log says how many were left out, so the engine's chatter can't push the server's own lines out of the files.
using System.Text;

namespace Mandarin.Server;

internal static class StderrLines
{
    public const int PerMinute = 60;
    private const int KeptChars = 64 * 1024;

    /* [r] read to its end, each line logged as "[tag] line" and handed to [each]: the whole of it (its last 64K chars). */
    public static async Task<string> Read(StreamReader r, string tag, Action<string>? each = null)
    {
        var all = new StringBuilder();
        var minute = DateTime.UtcNow;
        int said = 0, left = 0;
        try
        {
            while (await r.ReadLineAsync() is { } line)
            {
                all.Append(line).Append('\n');
                if (all.Length > KeptChars) all.Remove(0, all.Length - KeptChars);
                each?.Invoke(line + "\n");
                if (line.Trim().Length == 0) continue;
                if (DateTime.UtcNow - minute >= TimeSpan.FromMinutes(1))
                {
                    if (left > 0) Server.Log($"[{tag}] {left} more line(s) in that minute left out of the log");
                    minute = DateTime.UtcNow;
                    said = left = 0;
                }
                if (said++ < PerMinute) Server.Log($"[{tag}] {line}");
                else left++;
            }
        }
        catch (Exception e) when (e is IOException or ObjectDisposedException or InvalidOperationException) { /* closed */ }
        if (left > 0) Server.Log($"[{tag}] {left} more line(s) left out of the log");
        return all.ToString();
    }
}
