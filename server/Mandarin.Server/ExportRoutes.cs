// ExportRoutes.cs — the library's own files as a CSV, for Mandarin Migration to add to a Qobuz account (item 436).
//
//   GET /api/export/library.csv   one row per track of every album of files on this server: a service's (Qobuz's,
//                                 Tidal's, imported to the walls) never. What the migration app reads
//                                 (musicd-migrate's docs/library-csv.md): album_artist, album, disc, track, title, artist,
//                                 barcode, isrc, duration, year, comma-separated, UTF-8, a header first, quoted RFC 4180.
//
//                                 Two columns more, which that app passes over: from_path (what a folder's name gave, no tag
//                                 saying it: album_artist, album, title, artist) and stripped (the notes taken off the
//                                 album's title or artist, for the tags to be put right where they are wrong).
//
// Each album as its files say it (Export/ExportAlbums.cs, item 442): the album-artist tag as tagged, the album tag with
// its notes stripped (Export/ExportNotes.cs), one copy of a record merged twice into one album, the barcode however the
// files carry it. The migration app groups rows by album title and artist: one album a title and artist is written, a
// set ripped a disc an album made one again, and any other of one title and artist left out and said in the log. How
// many albums, tracks and barcodes went in, and what was left out, is said in X-Mandarin-Export, for the page and the app
// to say after the download; the export's own checks of what it wrote are said in the log.
using System.Globalization;
using System.Text;

namespace Mandarin.Server;

internal static partial class Library
{
    private const string ExportHeader = "album_artist,album,disc,track,title,artist,barcode,isrc,duration,year,from_path,stripped";

    /* GET /api/export/library.csv: true when answered here. */
    private static async Task<bool> ExportRoute(HttpContext ctx)
    {
        var p = ctx.Request.Path.Value ?? "";
        var get = HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method);
        if (!(get && p == "/api/export/library.csv")) return false;
        if (await CurrentState() is not var (s, _)) return await Http.Error(ctx, 503, "The library isn't ready yet: try again in a moment.");
        var (csv, said) = ExportCsv(s);
        Server.Log($"[export] library.csv: {said.Albums} albums, {said.Tracks} tracks, {said.Barcodes} with a barcode; {said.LeftOut} left out as another of one title and artist, "
            + $"{said.CopiesLeftOut} with a second copy left out, {said.FromPath} with a value from a folder's name, {said.Stripped} with notes stripped; its checks: {said.Checks}");
        var h = ctx.Response.Headers;
        h.ContentDisposition = $"attachment; filename=\"mandarin-library-{DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.csv\"";
        h.CacheControl = "no-store";
        h["X-Mandarin-Export"] = said.Header;
        h.AccessControlExposeHeaders = "X-Mandarin-Export";
        return await Http.Send(ctx, Encoding.UTF8.GetBytes(csv), "text/csv; charset=utf-8");
    }

    /* The CSV of every album of files in [s] (ExportAlbums.cs), and what went in. */
    internal static (string Csv, ExportSaid Said) ExportCsv(Snapshot s)
    {
        using var c = Db.Open();
        var edits = Rows(c, "SELECT key, title, artist FROM album_edits").ToDictionary(r => (string)r[0]!, r => (Text(r[1]), Text(r[2])));
        var pack = Jobs.Packs?.Get();
        var all = s.Albums.Where(a => a.Service == null).Select(a => ExportOne(c, s, a, edits, pack)).OfType<ExportAlbum>().ToList();

        // One album a title and artist, as the migration app groups rows: a set ripped a disc an album ("… CD1", "… CD2")
        // one album again, its discs in the disc column; else the copy with a barcode, then the most tracks, kept.
        var albums = new List<ExportAlbum>();
        var leftOut = new List<ExportAlbum>();
        foreach (var g in all.GroupBy(a => ExportCanon(a.Title) + "|" + ExportCanon(a.Artist)))
        {
            var best = g.OrderByDescending(a => a.Barcode.Length > 0).ThenBy(a => a.NumberedCopy).ThenByDescending(a => a.Tracks.Count).ThenBy(a => a.Al.Id).ToList();
            if (g.All(a => a.Disc != null) && g.Select(a => a.Disc).Distinct().Count() > 1)
            {
                var discs = best.GroupBy(a => a.Disc).Select(d => d.First()).OrderBy(a => a.Disc).ToList();
                var set = discs.FirstOrDefault(a => a.Barcode.Length > 0) ?? discs[0];
                var one = new ExportAlbum { Al = set.Al, Artist = set.Artist, Title = set.Title, Year = discs.Select(a => a.Year).FirstOrDefault(y => y.Length > 0) ?? "",
                    Barcode = set.Barcode, Tracks = [.. discs.SelectMany(a => a.Tracks)], FromPath = [.. discs.SelectMany(a => a.FromPath).Distinct()],
                    Stripped = [.. discs.SelectMany(a => a.Stripped).Distinct()], CopyLeftOut = discs.Sum(a => a.CopyLeftOut) };
                albums.Add(one);
                leftOut.AddRange(best.Except(discs));
            }
            else
            {
                albums.Add(best[0]);
                leftOut.AddRange(best.Skip(1));
            }
        }

        var sb = new StringBuilder(ExportHeader).Append("\r\n");
        var said = new ExportSaid();
        foreach (var x in albums)
        {
            // Each disc and number once: a repeat left is another copy's.
            var seen = new HashSet<(int, int)>();
            var tracks = x.Tracks.Where(t => t.No is not int n || seen.Add((t.Disc, n))).OrderBy(t => t.Disc).ThenBy(t => t.No ?? int.MaxValue).ToList();
            said.Albums++;
            if (x.Barcode.Length > 0) said.Barcodes++;
            if (x.FromPath.Count > 0) said.FromPath++;
            if (x.Stripped.Count > 0) said.Stripped++;
            said.CopiesLeftOut += x.CopyLeftOut + x.Tracks.Count - tracks.Count > 0 ? 1 : 0;
            var stripped = string.Join("; ", x.Stripped);
            foreach (var t in tracks)
            {
                var from = string.Join(' ', x.FromPath.Concat(t.FromPath.Length > 0 ? [t.FromPath] : []));
                ExportRow(sb, x.Artist, x.Title, t.Disc.ToString(CultureInfo.InvariantCulture), t.No?.ToString(CultureInfo.InvariantCulture) ?? "", t.Title, t.Artist,
                    x.Barcode, t.Isrc, t.Seconds, x.Year, from, stripped);
                said.Tracks++;
            }
            ExportCheck(said, x.Artist, x.Title);
        }
        said.LeftOut = leftOut.Count;
        foreach (var x in leftOut) Server.Log($"[export] left out, the same title and artist as an album exported: {x.Al.Artist} — {x.Al.Title} ({x.Tracks.Count} tracks, {x.Al.Dir})");
        return (sb.ToString(), said);
    }

    /* What an export held, and what its own checks found (each 0 where it is right). */
    internal sealed class ExportSaid
    {
        public int Albums, Tracks, Barcodes, FromPath, Stripped, LeftOut, CopiesLeftOut, ArtistTwice, TitleNoted;
        public string Header => $"albums={Albums}; tracks={Tracks}; barcodes={Barcodes}; left_out={LeftOut}; copies={CopiesLeftOut}; from_path={FromPath}; stripped={Stripped}";
        public string Checks => $"an act twice in the album artist {ArtistTwice}, a note in the title or a folder's word in either {TitleNoted}";
    }

    /* The export's own checks of an album as written: no act twice in its artist; no note left in its title. */
    private static void ExportCheck(ExportSaid said, string artist, string title)
    {
        var acts = Names.SplitArtists(artist).Select(Names.ArtistKey).Where(k => k.Length > 0).ToList();
        if (acts.Count != acts.Distinct(StringComparer.Ordinal).Count()) said.ArtistTwice++;
        if (Export.ExportNotes.Noted(title) || artist.Contains("Discography", StringComparison.OrdinalIgnoreCase) || artist.Contains("_ ", StringComparison.Ordinal)) said.TitleNoted++;
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
