// Rows.cs — Qobuz's and Tidal's albums as rows in the library (v0.8.44, stage
// 4.2 of docs/specs/csharp-migration.md), from lib/services/streaming.js, rule
// for rule:
//
//   - an album opened or favourited, written as the Node server writes it: a
//     row in `albums` keyed "<service>:<id>" with no folder, its tracks rows
//     whose path is "<service>://track/<id>", the same columns and the same
//     values, in one transaction; its cover kept beside the database
//     (<data>/<service>/art/<id>.jpg, the address it came from beside it);
//   - kept and let go: the cache table, ns <service>-kept, with why and since
//     when ({ why, at });
//   - why an album is in the library, for its page, and its favourite brought
//     into line with the service's as the page opens (reconcile);
//   - Clean up (the albums no longer wanted, with their edits, hearts and
//     Listen later) and the month's prune (albums only ever played from the
//     browser, a month unplayed: a job handed over, Jobs.cs).
//
// Each change is told to the Node server (POST /internal/library/changed,
// { services }), which reads its library again as each service's own
// afterChange does there (index.js); this server's copy follows its version.
// Its import, the favourites' watch and the service playlists stay its own
// (stage 4.3), and so does playing.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

/* How an album is kept (keptInfo): why ("favourite", "purchase"; null for a row from before v0.7.3) and since when. */
internal sealed record Kept(object? Why, object? At);

internal abstract partial class Catalogue
{
    /* The Node server's data folder: the covers are kept beside its database. */
    public string DataDir { get; init; } = "";
    private string NsHeld => Id + "-held";
    private string TrackPath => Id + "://track/";

    // ------------------------------------------------------------ what each service brings

    /* fullAlbum(id): the album and its tracks in the plain shape, asked of the service. */
    protected abstract Task<(JsObj Album, List<JsObj> Tracks)> FullAlbum(string id);
    /* apiFavourite(id, on): the favourite on the service itself. */
    protected abstract Task ApiFavourite(string id, bool on);

    /* wantedIds(): the ids the account wants kept, as id → why; the favourites here (Qobuz adds its purchases). */
    public virtual async Task<Dictionary<string, string>> WantedIds(Ask ask, bool fresh = false)
    {
        var o = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var id in await FavouriteIdSet(ask, fresh)) o[id] = "favourite";
        return o;
    }

    // ------------------------------------------------------------ the database, as the Node server writes it

    /* A connection that deletes as the Node server's does (foreign_keys on): an album's tracks go with it, and theirs with them. */
    private static SqliteConnection OpenRows()
    {
        var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "PRAGMA foreign_keys = ON";
        cmd.ExecuteNonQuery();
        return c;
    }

    /*
     * A JavaScript value as better-sqlite3 binds it: every number as a double
     * (a column of integers keeps a whole one as an integer, as SQLite does),
     * a string, null; anything else refused, in its words.
     */
    private static object Bound(object? v) => v switch
    {
        null or Undef => DBNull.Value,
        string s => s,
        double d => d,
        _ => throw new JsError("SQLite3 can only bind numbers, strings, bigints, buffers, and null")
    };

    private static int Run(SqliteConnection c, string sql, params (string Name, object? Value)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, Bound(v));
        return cmd.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection c, string sql, params (string Name, object? Value)[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, Bound(v));
        var r = cmd.ExecuteScalar();
        return r is DBNull ? null : r;
    }

    /* A number SQLite gave, as better-sqlite3 gives it to JavaScript. */
    private static double? Num(object? v) => v switch { long l => l, double d => d, _ => null };

    /* The albums a playlist or a favourite track needs (streaming.js heldSet). */
    public HashSet<string> HeldSet()
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT key FROM cache WHERE ns = $ns";
        cmd.Parameters.AddWithValue("$ns", NsHeld);
        var set = new HashSet<string>(StringComparer.Ordinal);
        using var r = cmd.ExecuteReader();
        while (r.Read()) if (!r.IsDBNull(0)) set.Add(r.GetString(0));
        return set;
    }

    /* The service's album in the library (streaming.js inLibrary). */
    public bool InLibrary(string albumId) => AlbumRow(albumId) != null;

    /* db.cacheGet(ns, key): the value as JSON.parse reads it; undefined when there's none, or it won't parse. */
    private static object? CacheGet(SqliteConnection c, string ns, string key)
    {
        if (Scalar(c, "SELECT value FROM cache WHERE ns = $ns AND key = $k", ("$ns", ns), ("$k", key)) is not string v) return Undef.V;
        try { return JsJson.Parse(v); } catch (JsError) { return Undef.V; }
    }

    /* db.setting(key): the value as JSON.parse reads it; undefined when there's none, or it won't parse. */
    private static object? SettingOf(SqliteConnection c, string key)
    {
        if (Scalar(c, "SELECT value FROM settings WHERE key = $k", ("$k", key)) is not string v) return Undef.V;
        try { return JsJson.Parse(v); } catch (JsError) { return Undef.V; }
    }

    /* db.cachePut(ns, key, value): JSON.stringify's text, stamped now. */
    private static void CachePut(SqliteConnection c, string ns, string key, object? value) =>
        Run(c, "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts",
            ("$ns", ns), ("$k", key), ("$v", Js.Json(value)), ("$ts", NowMs()));

    // ------------------------------------------------------------ the Node server told

    /*
     * The Node server's afterChange: it reads its library again and draws the
     * covers ahead ("changed"); "opened" reads it again only, as opening an
     * album there did. [favourite]: a favourite changed here, so the service's
     * answers it kept are forgotten there too, as its own setFavourite forgets
     * them.
     */
    public async Task Changed(string what = "changed", bool favourite = false)
    {
        var o = new JsonObject { ["services"] = what };
        if (favourite) o["favourite"] = Id;
        await Library.Tell(o);
    }

    // ------------------------------------------------------------ an album's rows

    /*
     * The album's cover, kept beside the database (the art reader wants a
     * file): asked again only when the address it came from changed; one that
     * can't be had now is the one kept from before, if any.
     */
    protected async Task<(string? Path, string? Hash)> FetchArt(string albumId, object? url)
    {
        if (!Js.Truthy(url)) return (null, null);
        var u = Js.Str(url);
        var dir = NodePath.Join(DataDir, Id, "art");
        Directory.CreateDirectory(dir);
        var hash = Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(u))).ToLowerInvariant()[..12];
        var file = NodePath.Join(dir, albumId + ".jpg");
        var marker = file + ".url";
        try { if (NodeFs.Exists(file) && File.ReadAllText(marker) == u) return (file, hash); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* fetched */ }
        try
        {
            var (status, body) = await GetBytes(u, 15000);
            if (status is < 200 or > 299) throw new JsError("HTTP " + status);
            await File.WriteAllBytesAsync(file, body);
            await File.WriteAllTextAsync(marker, u);
            return (file, hash);
        }
        catch (Exception e) when (e is JsError or IOException or UnauthorizedAccessException)
        {
            Front.Log($"[{Id}] cover for {albumId}: {e.Message}");
            var have = NodeFs.Exists(file);
            return (have ? file : null, have ? hash : null);
        }
    }

    /* JavaScript's x <= y, for what a service answers with: strings by their code units, the rest as numbers. */
    protected static bool LessEq(object? x, object? y)
    {
        if (x is string a && y is string b) return string.CompareOrdinal(a, b) <= 0;
        double nx = Js.ToNumber(x), ny = Js.ToNumber(y);
        return !double.IsNaN(nx) && !double.IsNaN(ny) && nx <= ny;
    }

    /* Math.max(0, ...xs): NaN when any of them is. */
    private static double Max0(IEnumerable<object?> xs)
    {
        double m = 0;
        foreach (var x in xs)
        {
            var n = Js.ToNumber(x);
            if (double.IsNaN(n)) return double.NaN;
            if (n > m) m = n;
        }
        return m;
    }

    /*
     * The album (and its tracks) as library rows, written or brought up to
     * date (streaming.js ensureAlbum): the library's id of it.
     */
    public async Task<long> EnsureAlbum(string id)
    {
        var t0 = NowMs();
        var (a, tracks) = await FullAlbum(id);
        var t1 = NowMs();
        var art = await FetchArt(id, P(a, "image"));
        var t2 = NowMs();
        if (t2 - t0 > 1500) Front.Log($"[{Id}] album {id}: {Name} answered in {Js.Num(t1 - t0)} ms, the cover in {Js.Num(t2 - t1)} ms more");
        var artist = Or(P(a, "artist"), "Unknown artist");
        var date = Or(P(a, "date"), null);
        object? year = null;
        if (Js.Truthy(date)) { var y = Js.ToNumber(Slice(date, 4)); year = y == 0 || double.IsNaN(y) ? null : y; }
        var label = Or(P(a, "label"), null);
        var genres = Js.Json(Or(P(a, "genres"), new List<object?>()));
        var version = P(a, "version");
        var title = Cat(P(a, "title"), Js.Truthy(version) ? Cat(" (", version, ")") : "");
        var rate = Max0(tracks.Select(t => t["rate"]));
        var bits = Max0(tracks.Select(t => t["bits"]));
        double duration = 0;
        foreach (var t in tracks) duration += Js.ToNumber(t["duration"]);
        var artistText = Js.Str(artist);
        // The sort names as normalize.js makes them: the scanner's port (Scan/ScanNames.cs), held to it
        // character for character (JavaScript's \s and line terminators), as the library's Names.cs isn't quite.
        (string, object?)[] row =
        [
            ("$key", Key + id), ("$title", title), ("$artist", artist),
            ("$sort_title", ScanNames.SortName(Js.Str(Or(P(a, "title"), "")))), ("$sort_artist", ScanNames.SortName(artistText)),
            ("$year", year), ("$date", date), ("$label", label), ("$genres", genres), ("$dir", Id + "://album/" + id),
            ("$art_path", art.Path), ("$art_hash", art.Hash), ("$track_count", (double)tracks.Count), ("$duration", duration),
            ("$max_rate", Or(Or(rate == 0 || double.IsNaN(rate) ? null : rate, P(a, "rate")), 44100.0)),
            ("$max_bits", Or(Or(bits == 0 || double.IsNaN(bits) ? null : bits, P(a, "bits")), 16.0)),
            ("$compilation", Ascii.EqualsIgnoreCase(artistText, "various artists") ? 1.0 : 0.0), ("$now", NowMs()), ("$barcode", Or(P(a, "upc"), null))
        ];
        using var c = OpenRows();
        using var tx = c.BeginTransaction();
        long albumId;
        if (Scalar(c, "SELECT id FROM albums WHERE key = $key", ("$key", Key + id)) is long was)
        {
            albumId = was;
            Run(c, @"UPDATE albums SET title=$title, artist=$artist, sort_title=$sort_title, sort_artist=$sort_artist, year=$year, date=$date,
                     label=$label, genres=$genres, art_path=$art_path, art_hash=$art_hash, track_count=$track_count, duration=$duration,
                     max_rate=$max_rate, max_bits=$max_bits, compilation=$compilation, updated_at=$now, barcode=$barcode WHERE id=$id",
                row.Where(x => x.Item1 != "$key" && x.Item1 != "$dir").Append(("$id", (double)albumId)).ToArray());
            Run(c, "DELETE FROM tracks WHERE album_id = $id", ("$id", (double)albumId));
        }
        else
        {
            Run(c, @"INSERT INTO albums(key, title, artist, sort_title, sort_artist, year, date, label, genres, dir, art_path, art_hash,
                     track_count, duration, max_rate, max_bits, lossless, container, compilation, added_at, updated_at, barcode)
                     VALUES($key, $title, $artist, $sort_title, $sort_artist, $year, $date, $label, $genres, $dir, $art_path, $art_hash,
                     $track_count, $duration, $max_rate, $max_bits, 1, 'flac', $compilation, $now, $now, $barcode)", row);
            albumId = (long)Scalar(c, "SELECT last_insert_rowid()")!;
        }
        foreach (var t in tracks)
        {
            Run(c, @"INSERT INTO tracks(album_id, path, mtime, size, title, artist, album_artist, album, track_no, disc_no, duration,
                     codec, container, sample_rate, bits, channels, lossless, year, date, label, genres, has_picture, isrc)
                     VALUES($album_id, $path, 0, 0, $title, $artist, $album_artist, $album, $track_no, $disc_no, $duration,
                     'flac', 'flac', $sample_rate, $bits, 2, 1, $year, $date, $label, $genres, 0, $isrc)",
                ("$album_id", (double)albumId), ("$path", TrackPath + Js.Str(t["id"])), ("$title", t["title"]),
                ("$artist", Or(t["artist"], artist)), ("$album_artist", artist), ("$album", title),
                ("$track_no", t["track_no"]), ("$disc_no", Or(t["disc_no"], 1.0)), ("$duration", t["duration"]),
                ("$sample_rate", t["rate"]), ("$bits", t["bits"]), ("$year", year), ("$date", date), ("$label", label), ("$genres", genres),
                ("$isrc", Or(t["isrc"], null)));
        }
        tx.Commit();
        return albumId;
    }

    // ------------------------------------------------------------ kept, and why

    /* Kept (on), with why and since when, or let go (streaming.js keep). */
    private void Keep(SqliteConnection c, string albumId, bool on, string why = "favourite")
    {
        if (on)
        {
            var v = new JsObj();
            v["why"] = why;
            v["at"] = NowMs();
            CachePut(c, NsKept, Key + albumId, v);
        }
        else Run(c, "DELETE FROM cache WHERE ns = $ns AND key = $k", ("$ns", NsKept), ("$k", Key + albumId));
    }
    private void Keep(string albumId, bool on)
    {
        using var c = Db.Open();
        Keep(c, albumId, on);
    }

    /* How it is kept (streaming.js keptInfo): null when it isn't; a row from before v0.7.3 held 1, kept for no reason known. */
    public Kept? KeptInfo(string albumId)
    {
        using var c = Db.Open();
        var v = CacheGet(c, NsKept, Key + albumId);
        if (v is Undef) return null;
        return Js.Truthy(v) && Js.IsObject(v) ? new Kept(Or(P(v, "why"), "favourite"), Or(P(v, "at"), null)) : new Kept(null, null);
    }

    /*
     * Why the album is in the library, for its page (streaming.js why): kept
     * (and as what, since when), held by a playlist or favourite track, and
     * when it was last played.
     */
    public JsObj Why(string albumId)
    {
        var key = Key + albumId;
        var row = AlbumRow(albumId);
        var kept = KeptInfo(albumId);
        double last = 0;
        if (row is long r)
        {
            using var c = Db.Open();
            last = Num(Scalar(c, "SELECT MAX(ts) AS last FROM plays WHERE album_id = $id", ("$id", (double)r))) ?? 0;
        }
        var o = new JsObj();
        o["service"] = Id;
        o["name"] = Name;
        o["kept"] = kept != null ? Or(kept.Why, "unknown") : null;
        o["since"] = kept?.At;
        o["held"] = HeldSet().Contains(key);
        o["last_played"] = last == 0 ? null : last;
        return o;
    }

    /*
     * The album's page opened (streaming.js reconcile): what the service says
     * of its favourite is what the library goes by, there and then. Kept as a
     * favourite but no longer one on the service, let go; a favourite there
     * but not kept here, kept. A purchase stays, whatever the favourite.
     */
    public async Task<bool> Reconcile(string albumId, Ask ask)
    {
        var fav = await IsFavourite(albumId, ask);
        var kept = KeptInfo(albumId);
        if (kept != null && !Js.StrictEq(kept.Why, "purchase") && !fav)
        {
            var bought = false;
            try { bought = (await WantedIds(ask)).TryGetValue(albumId, out var why) && why == "purchase"; }
            catch (Exception e) when (e is ServiceError or JsError) { /* not known: a favourite's rules */ }
            if (!bought)
            {
                Keep(albumId, false);
                Front.Log($"[{Id}] {albumId}: no longer a favourite on {Name}, let go");
                await Changed();
            }
        }
        else if (kept == null && fav && InLibrary(albumId))
        {
            Keep(albumId, true);
            await Changed();
        }
        return fav;
    }

    /* The favourite on the service (streaming.js setFavourite's first step): nothing written here yet. */
    public Task SetFavouriteThere(string albumId, bool on) => ApiFavourite(albumId, on);

    /* And then in the library (its rest): kept (its rows written first) or let go, the Node server told. */
    public async Task SetFavouriteHere(string albumId, bool on)
    {
        if (on) await EnsureAlbum(albumId);
        Keep(albumId, on);
        await Changed(favourite: true);
    }

    // ------------------------------------------------------------ Clean up, and the prune

    private sealed record OwnRow(long Id, string Key, object? UpdatedAt);

    /* streaming.js ownAlbums: this service's albums (LIKE, as the Node server asks: case aside). */
    private List<OwnRow> OwnAlbums(SqliteConnection c)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, key, updated_at FROM albums WHERE key LIKE $p";
        cmd.Parameters.AddWithValue("$p", Key + "%");
        var list = new List<OwnRow>();
        using var r = cmd.ExecuteReader();
        while (r.Read()) list.Add(new OwnRow(r.GetInt64(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetValue(2)));
        return list;
    }

    /* Which service a user playlist came from, if any (streaming.js serviceOfPlaylist; v0.6.23 wrote `qobuz: true`). */
    private static object? ServiceOfPlaylist(object? p)
    {
        if (!Js.Truthy(p)) return null;
        if (Js.Truthy(P(p, "service"))) return P(p, "service");
        if (Js.Truthy(P(p, "qobuz"))) return "qobuz";
        return null;
    }

    /*
     * Clean up can be made here as the Node server makes it: false where the
     * playlists it would rewrite (signed out) aren't a list — there it fails
     * in its own words, so it is its to answer.
     */
    public bool CleanUpFits()
    {
        if (Connected()) return true;
        using var c = Db.Open();
        var v = SettingOf(c, "userPlaylists");
        return v is Undef || !Js.Truthy(v) || v is List<object?>;
    }

    /*
     * Albums no longer wanted (streaming.js stale and cleanUp): signed out,
     * every one; signed in, those neither kept nor held. Removed with their
     * edits, hearts and Listen later (plays stay, as text); signed out, the
     * kept and held marks go too, and the service's playlists. How many went;
     * the Node server is told after (Changed) when any did.
     */
    public int CleanUp()
    {
        using var c = OpenRows();
        var kept = KeptSet();
        var held = HeldSet();
        var on = Connected();
        var rows = OwnAlbums(c).Where(r => !on || (!kept.Contains(r.Key) && !held.Contains(r.Key))).ToList();
        using var tx = c.BeginTransaction();
        foreach (var r in rows)
        {
            foreach (var t in new[] { "album_edits", "favourites", "listen_later", "track_edits" }) Run(c, $"DELETE FROM {t} WHERE key = $k", ("$k", r.Key));
            Run(c, "DELETE FROM albums WHERE id = $id", ("$id", (double)r.Id));
        }
        if (!Connected())
        {
            Run(c, "DELETE FROM cache WHERE ns = $ns", ("$ns", NsKept));
            Run(c, "DELETE FROM cache WHERE ns = $ns", ("$ns", NsHeld));
            var v = SettingOf(c, "userPlaylists");
            if (v is Undef) v = new List<object?>();
            var all = (Js.Truthy(v) ? v as List<object?> ?? throw new InvalidOperationException("userPlaylists isn't a list") : [])
                .Where(x => Js.Truthy(x) && Js.Truthy(P(x, "id")) && Js.Truthy(P(x, "name")) && !Js.StrictEq(ServiceOfPlaylist(x), Id)).ToList();
            Run(c, "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ("$k", "userPlaylists"), ("$v", Js.Json(all)));
        }
        tx.Commit();
        return rows.Count;
    }

    /*
     * Transient albums nobody has played in a month (streaming.js
     * pruneTransient): their rows go — neither kept nor held, and neither
     * played nor read from the service within [days]. How many went.
     */
    public async Task<int> PruneTransient(double days = 30)
    {
        var n = 0;
        using (var c = OpenRows())
        {
            var kept = KeptSet();
            var held = HeldSet();
            foreach (var r in OwnAlbums(c))
            {
                if (kept.Contains(r.Key) || held.Contains(r.Key)) continue;
                var last = Num(Scalar(c, "SELECT MAX(ts) AS last FROM plays WHERE album_id = $id", ("$id", (double)r.Id))) ?? 0;
                var updated = Num(r.UpdatedAt) is { } u && u != 0 ? u : 0;
                if (Math.Max(last, updated) > NowMs() - days * 86400e3) continue;
                Run(c, "DELETE FROM albums WHERE id = $id", ("$id", (double)r.Id));
                n++;
            }
        }
        if (n > 0) await Changed();
        return n;
    }
}

/*
 * The month's prune (index.js's daily timer): albums only ever played from a
 * service's browser, a month unplayed, let go — once a day, the first a few
 * minutes after the work is handed over, while the Node server has handed
 * it over ("prune", Jobs.cs).
 */
internal static class Prune
{
    private static readonly object Gate = new();
    private static Timer? timer;

    public static void Start()
    {
        lock (Gate) timer ??= new Timer(_ => _ = Run(), null, TimeSpan.FromMinutes(10), TimeSpan.FromDays(1));
    }

    public static void Stop()
    {
        lock (Gate) { timer?.Dispose(); timer = null; }
    }

    /* Each service's prune now: how many of each went, or null when the work isn't this server's. */
    public static async Task<JsObj?> Run()
    {
        if (!Jobs.Holds("prune")) return null;
        var o = new JsObj();
        foreach (var svc in new Catalogue?[] { Jobs.Qobuz, Jobs.Tidal })
        {
            if (svc == null) continue;
            try { o[svc.Id] = (double)await svc.PruneTransient(); }
            catch (Exception e) when (e is SqliteException or JsError or IOException) { Front.Log($"[{svc.Id}] prune: {e.Message}"); /* the next day */ }
        }
        return o;
    }
}
