// DiagnosticsMore.cs — lines from elsewhere, into the one log (Diagnostics.cs, item 425), each under where it came from.
//
//   POST /api/diagnostics/page  { lines: [{ level, text }] }: what went wrong in a browser's page (an error thrown, a
//                               promise refused), as "[web <browser name>] text", scrubbed as the server's own lines;
//                               at most 20 lines a request and 600 a minute in all, each 2,000 characters at most, so a
//                               page in a loop can't fill the disk
//   POST /api/diagnostics/app   { text }: the Android app's newest lines (its AppLog sends them as they come; it keeps
//                               none itself), each as "[app <the phone's name>] text" with the time and level it was said
//                               at, scrubbed again (512K characters a request at most)
//
// A Bridge's lines come the same way (Relay), fetched from it (Admin/BridgeLogsKept.cs).
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static class DiagnosticsMore
{
    public const int LinesPerRequest = 20, LinesPerMinute = 600, LineChars = 2000, AppBytes = 512 * 1024;
    private static readonly object gate = new();
    private static DateTime minute = DateTime.MinValue;
    private static int thisMinute;

    /* The page's lines from [body], said by [who] (its browser's name): how many were kept. */
    public static int Page(JsonNode? body, string who)
    {
        if (body?["lines"] is not JsonArray lines) return 0;
        var source = Source("web", who);
        var kept = 0;
        lock (gate)
        {
            if (DateTime.UtcNow - minute >= TimeSpan.FromMinutes(1)) { minute = DateTime.UtcNow; thisMinute = 0; }
            foreach (var l in lines.Take(LinesPerRequest))
            {
                if (thisMinute >= LinesPerMinute) break;
                var text = (l?["text"] as JsonValue)?.TryGetValue<string>(out var t) == true ? t : null;
                if (string.IsNullOrWhiteSpace(text)) continue;
                if (text.Length > LineChars) text = text[..LineChars] + "…";
                var level = (l?["level"] as JsonValue)?.TryGetValue<string>(out var v) == true && v is "WARN" or "ERROR" ? v : "ERROR";
                Diagnostics.Write(source, level, LogScrub.Line(text));
                thisMinute++;
                kept++;
            }
        }
        return kept;
    }

    /* The app's lines in [text], sent by the phone named [device]: how many were kept. */
    public static int App(string text, string device)
    {
        if (text.Length > AppBytes) text = text[^AppBytes..];
        return Relay(Source("app", device), text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0)
            .Select(l => l.Length > LineChars ? l[..LineChars] + "…" : l));
    }

    /* Lines said elsewhere ([source]: "app Pixel 8", "bridge Kitchen"), each into the one log scrubbed, with the time and
       level it says it was said at (Diagnostics.Parse); a line with none of its own (a stack trace's) with the line
       before's, or now's. How many were kept. */
    public static int Relay(string source, IEnumerable<string> lines)
    {
        DateTime? at = null;
        var level = "INFO";
        var n = 0;
        foreach (var l in lines)
        {
            string text;
            if (Diagnostics.Parse(l) is { } p) (at, level, text) = (p.At, p.Level, p.Text);
            else text = l;
            Diagnostics.Write(source, level, LogScrub.Line(text), at: at);
            n++;
        }
        return n;
    }

    /* Where a line came from, as the log says it: [kind] and a name, scrubbed, on one line, without brackets. */
    public static string Source(string kind, string name)
    {
        var s = new string([.. LogScrub.Line(name).Select(c => char.IsControl(c) ? ' ' : c is '[' ? '(' : c is ']' ? ')' : c)]).Trim();
        if (s.Length > 60) s = s[..60];
        return s.Length == 0 ? kind : kind + " " + s;
    }
}
