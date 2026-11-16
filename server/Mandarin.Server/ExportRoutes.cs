// ExportRoutes.cs — the library's own files as a CSV, for Mandarin Migration to add to a Qobuz account (item 436).
//
//   GET /api/export/library.csv   one row per track of every album of files on this server: a service's (Qobuz's,
//                                 Tidal's, imported to the walls) never. What the migration app reads
//                                 (musicd-migrate's docs/library-csv.md): album_artist, album, disc, track, title, artist,
//                                 barcode, isrc, duration, year, comma-separated, UTF-8, a header first, quoted RFC 4180.
//
// Its album and album artist are the album's as Mandarin shows it (your edits included), the same on every row of it,
// which is how the migration app groups rows into albums. Its barcode, the strongest evidence of a release there is, is
// the album's version's (Edit album's own, else the match applied's, else the files' tags'), else the first a track's
// tags carry; the same on every row. A track's title is its corrected one where you corrected it. The migration app
// groups by title and artist alone, so two albums of this library with one title and one artist (versions of one
// record: three Moanin's) would become one album there, one barcode lost: each of those has its version's words added
// to its title ("Moanin' (Blue Note Tone Poet)"), which that app's matching takes as an edition's, never as a
// different record. How many albums, tracks and barcodes went in is said in X-Mandarin-Export, for the page and the app
// to say after the download.
using System.Globalization;
using System.Text;

namespace Mandarin.Server;

internal static partial class Library
{
    private const string ExportHeader = "album_artist,album,disc,track,title,artist,barcode,isrc,duration,year";

    /* GET /api/export/library.csv: true when answered here. */
    private static async Task<bool> ExportRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        var get = HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method);
        if (!(get && p == "/api/export/library.csv")) return false;
        if (await CurrentState() is not var (s, _)) return await Http.Error(ctx, 503, "The library isn't ready yet: try again in a moment.");
        var (csv, albums, tracks, barcodes) = ExportCsv(s);
        Server.Log($"[export] library.csv: {albums} albums, {tracks} tracks, {barcodes} with a barcode");
        var h = ctx.Response.Headers;
        h.ContentDisposition = $"attachment; filename=\"mandarin-library-{DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.csv\"";
        h.CacheControl = "no-store";
        h["X-Mandarin-Export"] = $"albums={albums}; tracks={tracks}; barcodes={barcodes}";
        h.AccessControlExposeHeaders = "X-Mandarin-Export";
        return await Http.Send(ctx, Encoding.UTF8.GetBytes(csv), "text/csv; charset=utf-8");
    }

    /* The CSV of every album of files in [s], and how many albums, tracks and albums with a barcode it holds. */
    internal static (string Csv, int Albums, int Tracks, int Barcodes) ExportCsv(Snapshot s)
    {
        var local = s.Albums.Where(a => a.Service == null).ToList();
        // Albums the migration app would take for one (one title, one artist): told apart by their versions' words.
        var titles = ExportTitles(local.Select(a => (a.Title, a.Artist, a.VersionEdition ?? (a.ReleaseYear ?? a.Year)?.ToString(CultureInfo.InvariantCulture))).ToList());
        var sb = new StringBuilder(ExportHeader).Append("\r\n");
        int albums = 0, tracks = 0, barcodes = 0;
        using var c = Db.Open();
        for (var n = 0; n < local.Count; n++)
        {
            var al = local[n];
            var rows = Rows(c, "SELECT title, artist, disc_no, track_no, duration, isrc, barcode FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id);
            if (rows.Count == 0) continue;
            s.TrackEdits.TryGetValue(al.Key, out var edits);
            var version = VersionBase(c, al);
            var code = ExportBarcode(al.VersionOwn?.GetValueOrDefault("barcode") ?? version["barcode"].Value)
                ?? rows.Select(r => ExportBarcode(Text(r[6]))).FirstOrDefault(b => b != null) ?? "";
            albums++;
            if (code.Length > 0) barcodes++;
            var year = al.Year?.ToString(CultureInfo.InvariantCulture) ?? "";
            for (var i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                string? edited = null;
                edits?.TryGetValue(Identify.Identifier.TrackPos(r[2], r[3], i), out edited);
                var artist = Text(r[1]) ?? al.Artist;
                var seconds = r[4] is double d ? Math.Round(d).ToString(CultureInfo.InvariantCulture) : "";
                ExportRow(sb, al.Artist, titles[n], Num(r[2]) ?? "1", Num(r[3]) ?? "", edited ?? Text(r[0]) ?? "", artist, code, Text(r[5]) ?? "", seconds, year);
                tracks++;
            }
        }
        return (sb.ToString(), albums, tracks, barcodes);
    }

    /*
     * Each album's title as exported, by its index in [albums] ((title, artist, its version's words)): its own, but for
     * two or more of one title and one artist as the migration app compares them, each then with its version's words
     * added, and a number after any that are still alike.
     */
    internal static List<string> ExportTitles(List<(string Title, string Artist, string? Version)> albums)
    {
        var groups = albums.Select((a, i) => (Key: ExportCanon(a.Title) + "|" + ExportCanon(a.Artist), i)).GroupBy(g => g.Key).ToList();
        var titles = albums.Select(a => a.Title).ToList();
        foreach (var g in groups.Where(g => g.Count() > 1))
        {
            var taken = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (_, i) in g)
            {
                var (title, _, version) = albums[i];
                var t = string.IsNullOrWhiteSpace(version) ? title : $"{title} ({version})";
                for (var k = 2; !taken.Add(ExportCanon(t)); k++) t = (string.IsNullOrWhiteSpace(version) ? title : $"{title} ({version})") + $" ({k})";
                titles[i] = t;
            }
        }
        return titles;
    }

    /* A name as the migration app compares names (its Canon.canon): lower case, no accents nor apostrophes, & as and, the rest of what isn't a letter or digit a space. */
    internal static string ExportCanon(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s.ToLowerInvariant().Normalize(NormalizationForm.FormKD))
        {
            if (ch is >= '̀' and <= 'ͯ' or '\'' or '‘' or '’' or 'ʼ') continue;
            if (ch == '&') sb.Append(" and ");
            else if (ch is >= 'a' and <= 'z' or >= '0' and <= '9') sb.Append(ch);
            else sb.Append(' ');
        }
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /* A barcode as its digits, where they are one (8 to 14 of them, as the migration app takes them); else null. */
    internal static string? ExportBarcode(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var d = new string(raw.Where(char.IsAsciiDigit).ToArray());
        return d.Length is >= 8 and <= 14 ? d : null;
    }

    private static string? Num(object? v) => v is long l && l > 0 ? l.ToString(CultureInfo.InvariantCulture) : v is double d && d > 0 ? ((long)d).ToString(CultureInfo.InvariantCulture) : null;

    /* One row, each cell quoted where it holds a comma, a quote or a line break (RFC 4180). */
    private static void ExportRow(StringBuilder sb, params string[] cells)
    {
        for (var i = 0; i < cells.Length; i++)
        {
            if (i > 0) sb.Append(',');
            var v = cells[i];
            if (v.IndexOfAny([',', '"', '\r', '\n']) >= 0) sb.Append('"').Append(v.Replace("\"", "\"\"")).Append('"');
            else sb.Append(v);
        }
        sb.Append("\r\n");
    }
}
