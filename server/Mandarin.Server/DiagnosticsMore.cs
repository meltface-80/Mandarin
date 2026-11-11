// DiagnosticsMore.cs — every log in one download, and the page's own errors kept beside the server's (logs, item 389).
//
//   GET  /api/diagnostics/zip   a zip of everything in <data>/Logs (the server's files, every Bridge's, the page's, the
//                               apps'), with about.txt: what this server is (LogHeader) and when the zip was made
//   POST /api/diagnostics/page  { lines: [{ level, text }] }: what went wrong in a browser's page (an error thrown, a
//                               promise refused), kept in Logs/Web/MandarinWeb_log.txt as "[browser name] text",
//                               scrubbed as the server's own lines; at most 20 lines a request and 600 a minute in all,
//                               each 2,000 characters at most, so a page in a loop can't fill the disk
//   POST /api/diagnostics/app   { text }: the Android app's newest log lines (its AppLog), each scrubbed again, added to
//                               Logs/Apps/<the phone's name>.txt (512K characters a request at most), rolled at 4 MB into .01 to .03
using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static class DiagnosticsMore
{
    public const int LinesPerRequest = 20, LinesPerMinute = 600, LineChars = 2000, WebFiles = 3, AppFiles = 3, AppBytes = 512 * 1024;
    private const long AppFileBytes = 4L * 1024 * 1024;
    private const long WebFileBytes = 2L * 1024 * 1024;
    private static readonly object gate = new();
    private static DateTime minute = DateTime.MinValue;
    private static int thisMinute;

    /* A zip of every file under Logs, and about.txt, written to [to]. */
    public static async Task Zip(Stream to)
    {
        using var mem = new MemoryStream();
        using (var zip = new ZipArchive(mem, ZipArchiveMode.Create, true))
        {
            var about = zip.CreateEntry("about.txt", CompressionLevel.Fastest);
            await using (var w = new StreamWriter(about.Open(), new UTF8Encoding(false)))
                await w.WriteAsync($"Mandarin's logs, made {DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)} UTC\n{LogHeader.Text()}");
            var dir = Diagnostics.Dir;
            if (dir.Length > 0 && Directory.Exists(dir))
                foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
                {
                    var entry = zip.CreateEntry(Path.GetRelativePath(dir, f).Replace('\\', '/'), CompressionLevel.Optimal);
                    await using var src = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                    await using var dst = entry.Open();
                    await src.CopyToAsync(dst);
                }
        }
        mem.Position = 0;
        await mem.CopyToAsync(to);
    }

    /* The page's lines from [body], said by [who] (its browser's name): how many were kept. */
    public static int Page(JsonNode? body, string who)
    {
        if (Diagnostics.Dir.Length == 0 || body?["lines"] is not JsonArray lines) return 0;
        var b = new StringBuilder();
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
                b.Append(Diagnostics.Stamp(level, LogScrub.Line($"[{who}] {text.Replace("\r", "").Replace("\n", "\n    ")}")));
                thisMinute++;
                kept++;
            }
            if (kept == 0) return 0;
            var web = Path.Combine(Diagnostics.Dir, "Web");
            Directory.CreateDirectory(web);
            var file = Path.Combine(web, "MandarinWeb_log.txt");
            if (File.Exists(file) && new FileInfo(file).Length > WebFileBytes)
            {
                string At(int n) => n == 0 ? file : Path.Combine(web, $"MandarinWeb_log.{n:00}.txt");
                File.Delete(At(WebFiles));
                for (var n = WebFiles - 1; n >= 0; n--)
                    if (File.Exists(At(n))) File.Move(At(n), At(n + 1), true);
            }
            File.AppendAllText(file, b.ToString());
        }
        return kept;
    }

    /* The app's lines in [text], sent by the phone named [device]: how many were kept. */
    public static int App(string text, string device)
    {
        if (Diagnostics.Dir.Length == 0) return 0;
        if (text.Length > AppBytes) text = text[^AppBytes..];
        var b = new StringBuilder();
        var kept = 0;
        foreach (var raw in text.Split('\n'))
        {
            var l = raw.TrimEnd('\r');
            if (l.Length == 0) continue;
            b.Append(LogScrub.Line(l.Length > LineChars ? l[..LineChars] + "…" : l)).Append('\n');
            kept++;
        }
        if (kept == 0) return 0;
        lock (gate)
        {
            var dir = Path.Combine(Diagnostics.Dir, "Apps");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, Admin.BridgeLogsKept.FileName(device) + ".txt");
            if (File.Exists(file) && new FileInfo(file).Length > AppFileBytes)
            {
                string At(int n) => n == 0 ? file : file[..^4] + $".{n:00}.txt";
                File.Delete(At(AppFiles));
                for (var n = AppFiles - 1; n >= 0; n--)
                    if (File.Exists(At(n))) File.Move(At(n), At(n + 1), true);
            }
            if (!File.Exists(file)) b.Insert(0, $"# The Mandarin app on {LogScrub.Line(device)}: its log, as it sends it (times in UTC)\n");
            File.AppendAllText(file, b.ToString());
        }
        return kept;
    }
}
