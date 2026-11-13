// LogsOne.cs — every log Mandarin keeps as one plain-text file, merged in time order (item 392): the server's own,
// every Bridge's, every app's and the page's (everything under <data>/Logs), as Settings → Logs → Download all logs gives
// it, where a zip of many files was hard to read on a phone and to send. Each line says where it came from; a line with
// no time of its own (a stack trace's, ffmpeg's) stays under the line before it; at its head, what this server is
// (LogHeader) and each file's own header. Every time is UTC. Mandarin OS's system page makes the same file for its box
// (os/…/system-page/logs_one.py), with the system's own logs too.
//
//   GET  /api/diagnostics/logs.txt   (DiagnosticsRoutes.cs)
//
// Times read: the server's, the apps' and the page's ("2026-11-12 17:30:06.502 UTC  INFO   …"), an older Bridge's
// ("2026-11-12 17:30:08 [http] …") and Android's logcat ("2026-11-12 17:30:06.502  4242  4250 W Tag: …").
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class LogsOne
{
    [GeneratedRegex(@"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})? UTC  (INFO|WARN|ERROR|DEBUG)\s+(.*)$")]
    private static partial Regex Ours();

    [GeneratedRegex(@"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})\s+\d+\s+\d+ ([VDIWEF]) (.*)$")]
    private static partial Regex Logcat();

    [GeneratedRegex(@"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(\.\d{3})? (.*)$")]
    private static partial Regex Plain();

    [GeneratedRegex(@"\.(\d\d)\.txt$")]
    private static partial Regex Rolled();

    private sealed record Entry(string At, int Seq, string Source, string Level, List<string> Text);

    /* (time "YYYY-MM-DD HH:MM:SS.mmm", level, text) for a line with a time of its own; null for one without. */
    public static (string At, string Level, string Text)? Parse(string line)
    {
        if (Ours().Match(line) is { Success: true } o) return (o.Groups[1].Value + (o.Groups[2].Success ? o.Groups[2].Value : ".000"), o.Groups[3].Value, o.Groups[4].Value);
        if (Logcat().Match(line) is { Success: true } l)
            return (l.Groups[1].Value + l.Groups[2].Value, l.Groups[3].Value switch { "W" => "WARN", "E" or "F" => "ERROR", "I" => "INFO", _ => "DEBUG" }, l.Groups[4].Value);
        if (Plain().Match(line) is { Success: true } p) return (p.Groups[1].Value + (p.Groups[2].Success ? p.Groups[2].Value : ".000"), "INFO", p.Groups[3].Value);
        return null;
    }

    /* Every log under [dir] as one text, headed by [header]. */
    public static string Text(string dir, IEnumerable<string> header)
    {
        var heads = new List<string>();
        var entries = new List<Entry>();
        var seq = 0;
        var files = dir.Length > 0 && Directory.Exists(dir)
            ? Directory.EnumerateFiles(dir, "*.txt", SearchOption.AllDirectories)
                .OrderBy(f => Rolled().Replace(f, ".txt"), StringComparer.Ordinal)
                .ThenBy(f => Rolled().Match(f) is { Success: true } m ? -int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0)
            : Enumerable.Empty<string>();
        foreach (var f in files)
        {
            var source = Rolled().Replace(Path.GetRelativePath(dir, f).Replace('\\', '/'), ".txt");
            source = source[..^4].Replace("_log", "", StringComparison.Ordinal);
            string[] lines;
            try
            {
                using var s = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var r = new StreamReader(s, Encoding.UTF8);
                lines = r.ReadToEnd().Split('\n');
            }
            catch (IOException) { continue; }
            catch (UnauthorizedAccessException) { continue; }
            Entry? last = null;
            foreach (var raw in lines)
            {
                var line = raw.TrimEnd('\r');
                if (line.Trim().Length == 0) continue;
                if (line.StartsWith("# ", StringComparison.Ordinal)) { heads.Add($"[{source}] {line[2..]}"); continue; }
                if (Parse(line) is not { } p) { last?.Text.Add(line); continue; }
                last = new Entry(p.At, ++seq, source, p.Level, [p.Text]);
                entries.Add(last);
            }
        }
        var width = Math.Max(8, entries.Count == 0 ? 0 : entries.Max(e => e.Source.Length));
        var b = new StringBuilder();
        foreach (var h in header.Concat(heads)) b.Append("# ").Append(h).Append('\n');
        b.Append('\n');
        foreach (var e in entries.OrderBy(e => e.At, StringComparer.Ordinal).ThenBy(e => e.Seq))
        {
            b.Append(e.At).Append("  ").Append(e.Source.PadRight(width)).Append("  ").Append(e.Level.PadRight(5)).Append("  ").Append(e.Text[0]).Append('\n');
            foreach (var more in e.Text.Skip(1)) b.Append("    ").Append(more).Append('\n');
        }
        return b.ToString();
    }

    /* The file Settings → Logs gives: every log under the server's Logs folder, headed by what this server is. */
    public static string Text() =>
        Text(Diagnostics.Dir, new[] { $"Mandarin — every log, merged in time order (UTC); made {DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)} UTC" }
            .Concat(LogHeader.Text().Split('\n').Select(l => l.TrimStart('#', ' ')).Where(l => l.Length > 0)));
}
