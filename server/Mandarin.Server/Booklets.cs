// Booklets.cs — an album's booklets: the PDFs that came with it (v0.8.33),
// found in its folder, and their pages drawn as pictures for the album page's
// book button (BookletRoutes.cs). Drawn here because the Android app's page
// can't show a PDF itself; a phone fetches only the pages it shows.
//
// Where a booklet is looked for: the album's folder, the folder of each of its
// tracks, the folder above a disc's ("CD 1", "Disc 2"), and the folders one
// level inside any of those that hold no music ("Scans", "Booklet", "Artwork").
// A folder with music in it is another album's, so a single loose in an
// artist's folder never shows the booklets of the artist's albums; nor is a
// music folder itself looked through. Twenty at most.
//
// Drawn with poppler (pdfinfo for the page count, pdftoppm for a page), as
// covers are drawn with ffmpeg: two at a time, in the background's place
// (Cpu.cs), each page at a width kept in data/booklets, the least lately
// shown let go past half a gigabyte. Where poppler isn't installed nothing is
// offered (the album page shows no button), and it's looked for again every
// five minutes, so a Mac given it later needn't be restarted.
using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Mandarin.Server;

internal static partial class Booklets
{
    public sealed record Booklet(string Id, string Name, string Path, int Pages);

    // The widths a page is drawn at: a phone's, a tablet's, a desktop's.
    private static readonly int[] Widths = [480, 720, 960, 1280, 1600, 2048];
    private const int Most = 20;
    // Past this many folders inside one, it's no album's folder: not looked through.
    private const int MostFolders = 50;
    private const long KeepBytes = 512L << 20, PruneTo = 384L << 20;
    private static long prunedAt;
    private static readonly HashSet<string> Music = new(StringComparer.OrdinalIgnoreCase)
    {
        ".flac", ".mp3", ".m4a", ".m4b", ".mp4", ".aac", ".alac", ".wav", ".aif", ".aiff", ".aifc",
        ".ogg", ".oga", ".opus", ".wma", ".dsf", ".dff", ".wv", ".ape", ".mpc",
    };
    private static readonly SemaphoreSlim Drawing = new(2);
    private static readonly ConcurrentDictionary<string, Task<string?>> Inflight = new();
    // A PDF's page count, by its path, size and time: asked once.
    private static readonly ConcurrentDictionary<string, int> PageCounts = new();
    private static string dir = "";

    public static void Init(string dataDir) => dir = System.IO.Path.Combine(dataDir, "booklets");

    [GeneratedRegex(@"^(cd|disc|disk)\s*[-_.]?\s*\d+$", RegexOptions.IgnoreCase)]
    private static partial Regex DiscFolder();
    [GeneratedRegex(@"^Pages:\s+(\d+)\s*$", RegexOptions.Multiline)]
    private static partial Regex PagesLine();

    /* poppler's two programs, where they are: PDFTOPPM_PATH, beside ffmpeg, the PATH, Homebrew's;
       when they aren't anywhere, looked for again five minutes on. */
    private static (string Draw, string Info)? tools;
    private static long toolsAt;   // 0: not looked for yet
    private static (string Draw, string Info)? Tools
    {
        get
        {
            var now = Environment.TickCount64;
            if (tools == null && (toolsAt == 0 || now - toolsAt > 300_000)) { toolsAt = Math.Max(1, now); tools = FindTools(); }
            return tools;
        }
    }
    private static (string Draw, string Info)? FindTools()
    {
        var tried = new List<string>();
        if (Environment.GetEnvironmentVariable("PDFTOPPM_PATH") is { Length: > 0 } env) tried.Add(env);
        if (Environment.GetEnvironmentVariable("FFMPEG_PATH") is { Length: > 0 } ff && System.IO.Path.IsPathRooted(ff))
            tried.Add(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(ff)!, "pdftoppm"));
        tried.AddRange(["pdftoppm", "/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"]);
        foreach (var draw in tried)
        {
            var info = draw.Contains('/') ? System.IO.Path.Combine(System.IO.Path.GetDirectoryName(draw)!, "pdfinfo") : "pdfinfo";
            if (Runs(draw) && Runs(info)) return (draw, info);
        }
        return null;
    }

    private static bool Runs(string bin)
    {
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo(bin, "-v") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            using var p = System.Diagnostics.Process.Start(psi)!;
            _ = p.StandardOutput.ReadToEndAsync();
            _ = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(10000)) { try { p.Kill(); } catch (Exception) { /* gone */ } return false; }
            return p.ExitCode == 0;
        }
        catch (Exception) { return false; }
    }

    /* Whether pages can be drawn here at all. */
    public static bool Ready => Tools != null;

    /* An album's booklets, looked for afresh (a folder's PDFs can come and go between scans); `roots`: the music folders. */
    public static async Task<List<Booklet>> Of(Album al, IEnumerable<string> roots)
    {
        if (!Ready || al.Service != null) return [];
        var places = new List<string>();
        using (var c = Db.Open())
        {
            using (var a = c.CreateCommand())
            {
                a.CommandText = "SELECT dir FROM albums WHERE id = $id";
                a.Parameters.AddWithValue("$id", al.Id);
                if (a.ExecuteScalar() is string d && d.Length > 0) places.Add(d);
            }
            using var t = c.CreateCommand();
            t.CommandText = "SELECT DISTINCT path FROM tracks WHERE album_id = $id";
            t.Parameters.AddWithValue("$id", al.Id);
            using var r = t.ExecuteReader();
            while (r.Read())
            {
                if (r.IsDBNull(0) || System.IO.Path.GetDirectoryName(r.GetString(0)) is not { Length: > 0 } folder) continue;
                places.Add(folder);
                // A disc's folder: its booklet is usually beside the discs.
                if (DiscFolder().IsMatch(System.IO.Path.GetFileName(folder)) && System.IO.Path.GetDirectoryName(folder) is { Length: > 0 } up) places.Add(up);
            }
        }
        var music = roots.Select(Same).ToHashSet(StringComparer.Ordinal);
        var pdfs = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var place in places.Select(Same).Distinct(StringComparer.Ordinal))
        {
            if (music.Contains(place)) continue;
            Pdfs(place, pdfs, false);
            try
            {
                var subs = Directory.EnumerateDirectories(place).Take(MostFolders + 1).ToList();
                if (subs.Count <= MostFolders) foreach (var sub in subs) Pdfs(sub, pdfs, true);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* gone, or not ours to read */ }
        }
        var found = new List<Booklet>();
        foreach (var path in pdfs.OrderBy(p => p, StringComparer.OrdinalIgnoreCase).Take(Most))
        {
            FileInfo f;
            try { f = new FileInfo(path); if (!f.Exists) continue; }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { continue; }
            var pages = await PageCount(f);
            if (pages < 1) continue;
            found.Add(new Booklet(IdOf(f), System.IO.Path.GetFileNameWithoutExtension(path), path, pages));
        }
        return found;
    }

    /* A folder's PDFs; `notMusic`: none at all if it holds music (another album's folder). */
    private static void Pdfs(string folder, ISet<string> into, bool notMusic)
    {
        try
        {
            var found = new List<string>();
            foreach (var f in Directory.EnumerateFiles(folder))
            {
                if (notMusic && Music.Contains(System.IO.Path.GetExtension(f))) return;
                if (f.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) && !System.IO.Path.GetFileName(f).StartsWith("._", StringComparison.Ordinal)) found.Add(f);
            }
            foreach (var f in found) into.Add(f);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* gone, or not ours to read */ }
    }

    /* A folder's path as one, however it was written. */
    private static string Same(string folder)
    {
        try { return System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(folder)); }
        catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException) { return folder; }
    }

    /* A booklet's id: its path, size and time, so a changed file has a new one (and a new address). */
    private static string IdOf(FileInfo f) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{f.FullName}\n{f.Length}\n{f.LastWriteTimeUtc.Ticks}")))[..16];

    private static async Task<int> PageCount(FileInfo f)
    {
        var key = $"{f.FullName}\n{f.Length}\n{f.LastWriteTimeUtc.Ticks}";
        if (PageCounts.TryGetValue(key, out var n)) return n;
        var (code, output, _) = await Covers.Run(Tools!.Value.Info, [f.FullName], null, 1 << 20, TimeSpan.FromSeconds(20));
        n = code == 0 && PagesLine().Match(Encoding.UTF8.GetString(output)) is { Success: true } m
            && int.TryParse(m.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var p) ? p : 0;
        // A PDF poppler can't read counts as none (0), and is asked again only once it changes.
        PageCounts[key] = n;
        return n;
    }

    /* The width a page is drawn at: the first kept width at least as wide as asked, else the widest. */
    public static int Snap(double asked) => Widths.FirstOrDefault(w => w >= asked, Widths[^1]);

    /* A page (1 on) of a booklet at a width, drawn if it isn't yet: its file, or null when it can't be drawn. */
    public static Task<string?> Page(Booklet b, int page, int width)
    {
        var file = System.IO.Path.Combine(dir, $"{b.Id}-{page}@{width}.jpg");
        if (File.Exists(file))
        {
            // Shown again: the last to be let go when the folder is trimmed.
            try { File.SetLastWriteTimeUtc(file, DateTime.UtcNow); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* kept as it was */ }
            return Task.FromResult<string?>(file);
        }
        var mine = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var running = Inflight.GetOrAdd(file, mine.Task);
        if (running != mine.Task) return running;
        _ = Task.Run(async () =>
        {
            string? made = null;
            try { made = await Draw(b, page, width, file); }
            catch (Exception e) { Front.Log($"[booklet] {b.Name} page {page}: {e.GetType().Name}: {e.Message}"); }
            finally { Inflight.TryRemove(file, out _); mine.TrySetResult(made); }
        });
        return mine.Task;
    }

    private static async Task<string?> Draw(Booklet b, int page, int width, string file)
    {
        await Drawing.WaitAsync();
        try
        {
            var p = page.ToString(CultureInfo.InvariantCulture);
            var (code, jpg, err) = await Covers.Run(Tools!.Value.Draw,
                ["-f", p, "-l", p, "-scale-to-x", width.ToString(CultureInfo.InvariantCulture), "-scale-to-y", "-1", "-jpeg", "-jpegopt", "quality=85", b.Path],
                null, 32 << 20, TimeSpan.FromSeconds(60));
            if (code != 0 || jpg.Length < 4 || jpg[0] != 0xFF || jpg[1] != 0xD8)
            {
                Front.Log($"[booklet] {b.Name} page {page}: pdftoppm couldn't draw it ({(err.Trim().Length > 0 ? err.Trim().Split('\n')[^1] : "exit " + code)})");
                return null;
            }
            Directory.CreateDirectory(dir);
            var tmp = $"{file}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
            await File.WriteAllBytesAsync(tmp, jpg);
            try { File.Move(tmp, file, overwrite: true); }
            catch (IOException) { try { File.Delete(tmp); } catch (IOException) { /* gone */ } throw; }
            Prune();
            return file;
        }
        finally { Drawing.Release(); }
    }

    /* Past half a gigabyte, the pages least lately shown let go, down to three eighths; a minute apart at most. */
    private static void Prune()
    {
        var now = Environment.TickCount64;
        if (now - Interlocked.Read(ref prunedAt) < 60_000) return;
        Interlocked.Exchange(ref prunedAt, now);
        try
        {
            var files = new DirectoryInfo(dir).GetFiles("*.jpg");
            var total = files.Sum(f => f.Length);
            if (total <= KeepBytes) return;
            foreach (var f in files.OrderBy(f => f.LastWriteTimeUtc))
            {
                if (total <= PruneTo) break;
                try { var n = f.Length; f.Delete(); total -= n; } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* in use: next */ }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* not ours to trim */ }
    }
}
