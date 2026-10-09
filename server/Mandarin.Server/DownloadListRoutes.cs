// DownloadListRoutes.cs — the phone's download lists (v0.8.26): the routes of
// lib/server/downloads.js that say what to download, in the same shapes (the
// files themselves were already made here, Downloads.cs).
//
//   GET  /api/download/album?offset=&quality=   an album's tracks, their sizes and ReplayGain
//   GET  /api/download/auto?picks=&aotd=&recent= what the phone keeps by itself
//   POST /api/download/albums { ids }            the phone's albums as they are now
//   POST /api/phone/plays { plays }              plays made with no server, written to history
//
// A cover's address for the phone is signed as the Node server signs it
// (auth.js signUrl), at the address it gives speakers (its baseUrl, told with
// the library's state). Answered here once the Node server has handed over its
// work; until then (and the picks while it makes them), by it.
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static readonly string[] DownloadQualities = ["original", "opus"];
    private const int DownloadOpusKbps = 256;

    /* auth.signUrl: the path signed with the install's secret, its signature added as ?s= (or &s=). */
    private static string? SignUrl(SqliteConnection c, string url)
    {
        if (Db.Setting(c, "authSecret") is not { } sv || Js.Str(sv) is not { Length: > 0 } secret) return null;
        var i = url.IndexOf("://", StringComparison.Ordinal);
        var start = i >= 0 ? url.IndexOf('/', i + 3) : 0;
        var path = start < 0 ? "" : url[start..].Split('?')[0];
        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(path));
        var sig = Convert.ToBase64String(mac).TrimEnd('=').Replace('+', '-').Replace('/', '_')[..22];
        return url + (url.Contains('?') ? "&" : "?") + "s=" + sig;
    }
    private static string? ArtUrl(SqliteConnection c, LibState st, Album al) =>
        SignUrl(c, $"{st.BaseUrl}/api/image/{Js.EncodeURIComponent(al.ImageKey)}?size=1200");

    // ------------------------------------------------------------ ReplayGain's four numbers

    private const double Ref = -18;
    // num(v): a finite number, or null.
    private static double? FiniteOr(object? v) => v is double d && double.IsFinite(d) ? d : null;
    private static double? Dbl(object? v) => v == null || v is DBNull ? null : Convert.ToDouble(v, CultureInfo.InvariantCulture);

    /* loudness.js combine: the tracks' energy, weighted by length. */
    private static double? Combine(List<(double Lufs, double Seconds)> parts)
    {
        double e = 0, w = 0;
        foreach (var (lufs, seconds) in parts)
        {
            var d = seconds > 0 ? seconds : 1;
            e += d * Math.Pow(10, lufs / 10);
            w += d;
        }
        return w > 0 && e > 0 ? 10 * Math.Log10(e / w) : null;
    }

    /* loudness.js albumOf: the album's gain and peak, once every track's loudness is known. */
    private static (double Gain, double? Peak)? AlbumLoudness(SqliteConnection c, long albumId)
    {
        var rows = Rows(c, @"SELECT t.id, t.duration, t.rg_track_gain, t.rg_track_peak, l.lufs, l.peak
        FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id WHERE t.album_id = $1", albumId);
        if (rows.Count == 0) return null;
        var parts = new List<(double, double)>();
        double? peak = null;
        foreach (var r in rows)
        {
            var tg = Dbl(r[2]);
            var lufs = tg != null ? Ref - tg.Value : Dbl(r[4]);
            if (lufs == null) return null;
            parts.Add((lufs.Value, Dbl(r[1]) ?? 0));
            var p = tg != null ? Dbl(r[3]) : Dbl(r[5]);
            if (p != null) peak = Math.Max(peak ?? 0, p.Value);
        }
        var all = Combine(parts);
        return all == null ? null : (Ref - all.Value, peak);
    }

    /* loudness.js infoOf: a track's four numbers, from its tags or what was measured. */
    private static JsObj ReplaygainOf(SqliteConnection c, long id, long albumId, double? tg, double? tp, double? ag, double? ap,
        Dictionary<long, (double Gain, double? Peak)?> albums)
    {
        if (tg == null)
        {
            var m = Rows(c, "SELECT lufs, peak FROM track_loudness WHERE track_id = $1 AND lufs IS NOT NULL", id);
            if (m.Count > 0) { tg = Ref - Dbl(m[0][0])!.Value; tp = Dbl(m[0][1]); }
        }
        if (ag == null)
        {
            if (!albums.TryGetValue(albumId, out var a)) albums[albumId] = a = AlbumLoudness(c, albumId);
            if (a is { } got) { ag = got.Gain; ap = got.Peak; }
        }
        var o = new JsObj();
        o["track_gain"] = FiniteOr(tg);
        o["track_peak"] = FiniteOr(tp);
        o["album_gain"] = FiniteOr(ag);
        o["album_peak"] = FiniteOr(ap);
        return o;
    }

    // ------------------------------------------------------------ the routes

    private static string DownloadQuality(string? q) => q != null && DownloadQualities.Contains(q) ? q : "original";

    /* GET /api/download/album?offset=&quality= */
    private static async Task<bool> DownloadAlbum(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || st.BaseUrl.Length == 0) return false;
        var al = s.Find(Num(Q(ctx, "offset")));
        if (al == null) return await JsError(ctx, 404, "That album is no longer in the library");
        // A streamed album's tracks have no file here: the Node server's.
        if (al.Service != null) return false;
        var q = DownloadQuality(Q(ctx, "quality"));
        using var c = Db.Open();
        const string sql = "SELECT * FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path";
        var col = Columns(c, sql, al.Id);
        object? F(object?[] r, string name) => col.TryGetValue(name, out var i) ? r[i] : null;
        long N(object? v) => v == null || v is DBNull ? 0 : (long)Math.Floor(Convert.ToDouble(v, CultureInfo.InvariantCulture));
        s.TrackEdits.TryGetValue(al.Key, out var edits);
        var rows = Rows(c, sql, al.Id);
        var albums = new Dictionary<long, (double Gain, double? Peak)?>();
        var tracks = new List<object?>();
        double size = 0;
        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var id = (long)F(r, "id")!;
            var disc = Long(F(r, "disc_no"));
            var no = Long(F(r, "track_no"));
            var title = Convert.ToString(F(r, "title"), CultureInfo.InvariantCulture) ?? "";
            if (edits != null && edits.TryGetValue($"{disc ?? 1}-{(no != null ? no.Value.ToString(CultureInfo.InvariantCulture) : "p" + (i + 1))}", out var et) && et.Length > 0) title = et;
            var artist = Text(F(r, "artist")) ?? "";
            var duration = Dbl(F(r, "duration")) ?? 0;
            var track = new Downloads.Track(id, Convert.ToString(F(r, "path"), CultureInfo.InvariantCulture) ?? "", Text(F(r, "codec")) ?? "",
                N(F(r, "sample_rate")), N(F(r, "bits")), N(F(r, "channels")), N(F(r, "mtime")), N(F(r, "size")));
            var p = Downloads.PlanFor(track, q);
            // Exact for a file sent as it is; an estimate for a conversion.
            double bytes = p.File != null ? Dbl(F(r, "size")) ?? 0 : Math.Floor(duration * (p.Convert == "opus" ? DownloadOpusKbps * 125 : 110000) + 0.5);
            var o = new JsObj();
            o["id"] = (double)id;
            o["title"] = title;
            o["artist"] = artist.Length > 0 ? artist : al.Artist;
            o["disc_no"] = disc is long d && d != 0 ? (double)d : 1.0;
            o["track_no"] = no is long n && n != 0 ? (double)n : null;
            o["duration"] = duration;
            o["ext"] = p.Ext;
            o["size"] = bytes;
            o["path"] = $"/api/download/t{id}?quality={q}";
            // ReplayGain's numbers, for the app to apply offline as its setting says.
            o["replaygain"] = ReplaygainOf(c, id, al.Id, Dbl(F(r, "rg_track_gain")), Dbl(F(r, "rg_track_peak")), Dbl(F(r, "rg_album_gain")), Dbl(F(r, "rg_album_peak")), albums);
            size += bytes;
            tracks.Add(o);
        }
        var outer = new JsObj();
        outer["id"] = (double)al.Id;
        outer["title"] = al.Title;
        outer["artist"] = al.Artist;
        outer["year"] = al.Year is long y && y != 0 ? (double)y : null;
        outer["genres"] = al.Genres.Select(g => (object?)g).ToList();
        outer["image_key"] = al.ImageKey;
        outer["art_url"] = ArtUrl(c, st, al);
        outer["quality"] = q;
        outer["tracks"] = tracks;
        outer["size"] = size;
        return await SendJs(ctx, outer);
    }

    /* GET /api/download/auto?picks=1&aotd=1&recent=<n, up to 50>: today's Smart Picks, the Album of the day, the newest additions. */
    private static async Task<bool> DownloadAuto(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || st.Day.Length == 0) return false;
        static bool On(string? v) => v is "1" or "true";
        var picks = On(Q(ctx, "picks")) && TJs.Truthy(Extras.Taste.SmartSettings().Enabled);
        // The picks are made here only while this server holds the taste work.
        if (picks && HeldTaste == null) return false;
        var outList = new List<(Album Al, List<object?> Sources)>();
        void Add(Album? al, string source)
        {
            if (al == null) return;
            var i = outList.FindIndex(x => x.Al.Id == al.Id);
            if (i < 0) outList.Add((al, [source]));
            else if (!outList[i].Sources.Contains(source)) outList[i].Sources.Add(source);
        }
        if (picks && HeldTaste is { } taste && taste.PicksJson(s)["picks"] is List<object?> list)
            foreach (var p in list.OfType<JsObj>()) Add(s.Find(TJs.ToNumber(p["offset"])), "picks");
        using var c = Db.Open();
        if (On(Q(ctx, "aotd"))) Add(DayAlbum(c, s, st), "aotd");
        var recent = (int)Math.Max(0, Math.Min(50, PInt(Q(ctx, "recent")) ?? 0));
        if (recent > 0)
            foreach (var al in View(n => n == "sort" ? ["added"] : n == "dir" ? ["desc"] : null, s).Take(recent)) Add(al, "recent");
        var o = new JsObj();
        o["albums"] = outList.Select(x =>
        {
            var e = new JsObj();
            e["id"] = (double)x.Al.Id;
            e["title"] = x.Al.Title;
            e["artist"] = x.Al.Artist;
            e["sources"] = x.Sources;
            return (object?)e;
        }).ToList();
        return await SendJs(ctx, o);
    }

    /* POST /api/download/albums { ids }: titles, covers and edits change; the phone asks now and then for its albums. */
    private static async Task<bool> DownloadAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || st.BaseUrl.Length == 0) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var given = (FromNode(b) as JsObj ?? new JsObj())["ids"];
        // Anything but a list (or nothing) is the Node server's to refuse as it does.
        if (given is not List<object?> && TJs.Truthy(given)) return false;
        var ids = given as List<object?> ?? [];
        using var c = Db.Open();
        var albums = new List<object?>();
        foreach (var id in ids.Select(TJs.ToNumber).Where(double.IsFinite).Take(2000))
        {
            var al = s.Find(id);
            var o = new JsObj();
            o["id"] = id;
            o["exists"] = al != null;
            if (al != null)
            {
                o["title"] = al.Title;
                o["artist"] = al.Artist;
                o["year"] = al.Year is long y && y != 0 ? (double)y : null;
                o["image_key"] = al.ImageKey;
                o["art_url"] = ArtUrl(c, st, al);
                // The album as every other list has it, for the app's Home row.
                o["album"] = FromNode(AlbumJson(s, al));
            }
            albums.Add(o);
        }
        var outer = new JsObj();
        outer["albums"] = albums;
        return await SendJs(ctx, outer);
    }

    /* POST /api/phone/plays { plays }: plays made with no server, so history, "Not played" and Smart Picks stay right. */
    private static async Task<bool> PhonePlays(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held) return false;
        using var c = Db.Open();
        var dev = Auth.DeviceOf(ctx, c);
        if (dev == null || dev.Kind != "android") return await JsError(ctx, 403, "Only the Mandarin Android app sends offline plays");
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var given = (FromNode(b) as JsObj ?? new JsObj())["plays"];
        var plays = (given as List<object?> ?? []).Take(5000).ToList();
        var now = (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var n = 0;
        using var tx = c.BeginTransaction();
        foreach (var p in plays)
        {
            var pj = p as JsObj;
            var tid = TJs.ToNumber(pj != null ? pj["track_id"] : Undef.V);
            if (!double.IsFinite(tid) || tid != Math.Floor(tid)) continue;
            var t = PlayTrack(c, s, (long)tid);
            if (t == null) continue;
            s.ById.TryGetValue(t.Value.AlbumId, out var al);
            var given_ts = TJs.ToNumber(pj != null ? pj["ts"] : Undef.V);
            var ts = Math.Min(now, Math.Max(now - 90 * 86400000.0, given_ts is var g && g != 0 && !double.IsNaN(g) ? g : now));
            using var cmd = c.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "INSERT INTO plays(album_id, track_id, title, artist, album, zone, ts) VALUES($a, $t, $ti, $ar, $al, $z, $ts)";
            cmd.Parameters.AddWithValue("$a", al != null ? al.Id : DBNull.Value);
            cmd.Parameters.AddWithValue("$t", t.Value.Id);
            cmd.Parameters.AddWithValue("$ti", t.Value.Title);
            cmd.Parameters.AddWithValue("$ar", t.Value.Artist);
            cmd.Parameters.AddWithValue("$al", al != null ? al.Title : (object?)t.Value.Album ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$z", "PHONE_" + dev.Id);
            cmd.Parameters.AddWithValue("$ts", ts == Math.Floor(ts) ? (object)(long)ts : ts);
            cmd.ExecuteNonQuery();
            n++;
        }
        tx.Commit();
        var o = new JsObj();
        o["ok"] = true;
        o["recorded"] = (double)n;
        return await SendJs(ctx, o);
    }

    /* library.track(id): its title as corrected, where it was. */
    private static (long Id, long AlbumId, string Title, string Artist, string? Album)? PlayTrack(SqliteConnection c, Snapshot s, long id)
    {
        var rows = Rows(c, "SELECT id, album_id, title, artist, album, disc_no, track_no FROM tracks WHERE id = $1", id);
        if (rows.Count == 0) return null;
        var r = rows[0];
        var albumId = Convert.ToInt64(r[1], CultureInfo.InvariantCulture);
        var title = Convert.ToString(r[2], CultureInfo.InvariantCulture) ?? "";
        if (s.ById.TryGetValue(albumId, out var al) && s.TrackEdits.TryGetValue(al.Key, out var edits) && edits.Count > 0)
        {
            var disc = Long(r[5]);
            var no = Long(r[6]);
            // Its place among the album's tracks: needed only when the number is missing.
            var i = 0;
            if (no is null or 0)
            {
                var order = Rows(c, "SELECT id FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", albumId);
                i = order.FindIndex(x => Convert.ToInt64(x[0], CultureInfo.InvariantCulture) == id);
            }
            if (edits.TryGetValue($"{disc ?? 1}-{(no is long n && n != 0 ? n.ToString(CultureInfo.InvariantCulture) : "p" + (i + 1))}", out var et) && et.Length > 0) title = et;
        }
        return (id, albumId, title, Text(r[3]) ?? "", r[4] is null or DBNull ? null : Convert.ToString(r[4], CultureInfo.InvariantCulture));
    }
}
