// Catalogue.cs — Qobuz's and Tidal's catalogue as the page browses it (v0.8.39,
// stage 4.1 of docs/specs/csharp-migration.md), from lib/qobuz/index.js,
// lib/tidal/index.js and lib/services/streaming.js, rule for rule: new
// releases, the featured lists, search, an artist's albums, an album and its
// tracks, and whether an album is in the account's favourites. Read-only:
// the account (signed in by the Node server), the albums kept and those in the
// library are read from the database it writes; nothing is written here.
//
// The favourites' ids are kept a minute, as api.js keeps them, and no longer
// than the Node server's library stays as it was: a favourite added or taken
// away there (POST /api/<s>/favorite, still its own) reads the library again,
// so the next list here asks the service afresh rather than show it stale.
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

/* What a list call is asked with, and of which state of the library. */
internal sealed record Ask(long? Version);

internal abstract class Catalogue(string id, string name)
{
    public string Id { get; } = id;
    public string Name { get; } = name;
    public string Key { get; } = id + ":";
    private string NsKept => Id + "-kept";

    // ------------------------------------------------------------ the account, as the Node server keeps it

    /* db.setting(<service>): the account, or undefined. */
    public object? Account() => Extras.Labels.Setting(Id);
    /* streaming.js connected(): a token and a user. */
    public bool Connected()
    {
        var a = Account();
        return Js.Truthy(a) && Js.Truthy(P(a, "token")) && Js.Truthy(P(a, "user"));
    }

    // ------------------------------------------------------------ the database, read

    private static SqliteConnection Open() => Db.Open();

    /* The albums kept from this service (streaming.js keptSet). */
    public HashSet<string> KeptSet()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT key FROM cache WHERE ns = $ns";
        cmd.Parameters.AddWithValue("$ns", NsKept);
        var set = new HashSet<string>(StringComparer.Ordinal);
        using var r = cmd.ExecuteReader();
        while (r.Read()) if (!r.IsDBNull(0)) set.Add(r.GetString(0));
        return set;
    }

    /* The library's id of this service's album, or null (albumByKey). */
    public long? AlbumRow(string albumId)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id FROM albums WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", Key + albumId);
        return cmd.ExecuteScalar() is long v ? v : null;
    }

    /* Every album of this service in the library, by key: inLibrary for a whole list at once. */
    private HashSet<string> LibraryKeys()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT key FROM albums WHERE key LIKE $p ESCAPE '\\'";
        cmd.Parameters.AddWithValue("$p", Key.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%");
        var set = new HashSet<string>(StringComparer.Ordinal);
        using var r = cmd.ExecuteReader();
        while (r.Read()) if (!r.IsDBNull(0)) set.Add(r.GetString(0));
        return set;
    }

    // ------------------------------------------------------------ the catalogue

    public abstract Task<HashSet<string>> FavouriteIdSet(Ask ask, bool fresh = false);
    public abstract Task<List<object?>> NewReleases(double days, Ask ask);
    public abstract Task<List<object?>> Featured(string type, Ask ask);
    public abstract Task<JsObj> Search(string query, double offset, Ask ask, double limit = 50);
    public abstract Task<JsObj> ArtistAlbums(string artistId, double offset, Ask ask, double limit = 50);
    public abstract Task<JsObj> AlbumDetail(string id, Ask ask);
    /* Tidal's lists, the browser's tabs; null for a service with none (Qobuz). */
    public virtual Task<List<object?>>? Lists(Ask ask) => null;

    /* In the account's favourites, as the service has them now (streaming.js isFavourite). */
    public async Task<bool> IsFavourite(string albumId, Ask ask) => (await FavouriteIdSet(ask)).Contains(albumId);

    /*
     * A list's albums, each marked whether it is in the account's favourites
     * (the service's own list), kept here, and in the library (streaming.js
     * marked). The favourites unknown (the service didn't say): unmarked.
     * Every album these routes give goes through here, so in_library (which
     * normAlbum also sets) is read here once for the list, not per album.
     */
    protected async Task<List<object?>> Marked(List<object?> albums, Ask ask)
    {
        HashSet<string> ids = [];
        try { ids = await FavouriteIdSet(ask); }
        catch (Exception e) when (e is not ToNode) { /* unmarked */ }
        var kept = KeptSet();
        var inLib = LibraryKeys();
        foreach (var a in albums)
        {
            var id = Js.Str(P(a, "id"));
            ((JsObj)a!)["favourited"] = ids.Contains(id);
            ((JsObj)a)["kept"] = kept.Contains(Js.Str(Key) + Js.Str(P(a, "id")));
            ((JsObj)a)["in_library"] = inLib.Contains(Key + id);
        }
        return albums;
    }

    protected static JsObj Obj(params (string Key, object? Value)[] kv)
    {
        var o = new JsObj();
        foreach (var (k, v) in kv) o[k] = v;
        return o;
    }

    /* JavaScript's x.slice(0, n) of a list. */
    protected static List<object?> Take(List<object?> l, int n) => l.Take(n).ToList();

    /* String(x).slice(0, n) */
    protected static string Slice(object? x, int n) { var s = Js.Str(x); return s.Length > n ? s[..n] : s; }

    /* "since": now less [days] days; a release dated before it is left out (an undated one is kept). */
    protected static bool Since(object? date, double days)
    {
        if (!Js.Truthy(date)) return true;
        return DateMs(date) >= NowMs() - days * 86400e3;
    }
}

/* Qobuz's catalogue (lib/qobuz/index.js). */
internal sealed class QobuzCatalogue : Catalogue
{
    public QobuzApi Api { get; }

    public QobuzCatalogue(string? baseUrl) : base("qobuz", "Qobuz")
    {
        // The signed-in account's token, read at each call: (account() || {}).token || null.
        Api = new QobuzApi(baseUrl, () => Or(P(Or(Account(), new JsObj()), "token"), null) is var t && Js.Truthy(t) ? Js.Str(t) : null);
    }

    /* The image Qobuz offers at a useful size. */
    private static object? ImageOf(object? img)
    {
        if (img is not JsObj) return "";
        foreach (var k in new[] { "large", "extralarge", "mega", "medium", "small", "thumbnail" })
            if (Js.Truthy(P(img, k))) return P(img, k);
        return "";
    }
    private static object? MainArtist(object? a)
    {
        if (Js.Truthy(a) && Js.Truthy(P(a, "artist")) && Js.Truthy(P(P(a, "artist"), "name"))) return P(P(a, "artist"), "name");
        if (Js.Truthy(a) && P(a, "artists") is List<object?> l && l.Count > 0) return Or(P(l[0], "name"), "");
        return "";
    }

    public JsObj? NormAlbum(object? a)
    {
        if (!Js.Truthy(a)) return null;
        var rate = NumOr(P(a, "maximum_sampling_rate"), 0);
        var bits = NumOr(P(a, "maximum_bit_depth"), 0);
        var art = P(a, "artist");
        var label = P(a, "label");
        var genre = P(a, "genre");
        var date = Or(Or(P(a, "release_date_original"), P(a, "release_date_stream")), "");
        return Obj(
            ("id", Js.Str(P(a, "id"))), ("title", Or(P(a, "title"), "")), ("version", Or(P(a, "version"), "")), ("artist", MainArtist(a)),
            ("artist_id", Js.Truthy(art) && Js.Truthy(P(art, "id")) ? Js.Str(P(art, "id")) : ""),
            ("image", ImageOf(P(a, "image"))),
            ("year", Or(Slice(date, 4), "")),
            ("date", date),
            ("label", Js.Truthy(label) && Js.Truthy(P(label, "name")) ? P(label, "name") : ""),
            ("genre", Js.Truthy(genre) && Js.Truthy(P(genre, "name")) ? P(genre, "name") : ""),
            ("genres", Js.Truthy(genre) && Js.Truthy(P(genre, "name")) ? new List<object?> { P(genre, "name") } : new List<object?>()),
            ("upc", Or(P(a, "upc"), null)),
            ("rate", NumOr(Js.Round(rate * 1000), 44100)), ("bits", bits == 0 ? 16 : bits),
            ("tracks_count", NumOr(P(a, "tracks_count"), 0)), ("duration", NumOr(P(a, "duration"), 0)),
            ("hires", Js.Truthy(P(a, "hires_streamable")) || bits > 16 || rate > 48),
            ("quality", bits != 0 && rate != 0 ? Js.Num(bits) + "/" + Js.Num(rate) : ""),
            ("streamable", !(P(a, "streamable") is false)), ("kept", false), ("favourited", false),
            ("release_date", Or(P(a, "release_date_original"), "")), ("in_library", false));
    }

    public static JsObj NormTrack(object? t, object? al)
    {
        var rate = NumOr(Or(P(t, "maximum_sampling_rate"), AndP(al, "maximum_sampling_rate")), 44.1);
        var bits = NumOr(Or(P(t, "maximum_bit_depth"), AndP(al, "maximum_bit_depth")), 16);
        var performer = P(t, "performer");
        var version = P(t, "version");
        return Obj(
            ("id", Js.Str(P(t, "id"))),
            ("title", Cat(Or(P(t, "title"), ""), Js.Truthy(version) ? Cat(" (", version, ")") : "")),
            ("artist", Or(Or(Js.Truthy(performer) ? P(performer, "name") : performer, MainArtist(al)), "")),
            ("duration", NumOr(P(t, "duration"), 0)),
            ("track_no", NumOr(P(t, "track_number"), double.NaN) is var n && !double.IsNaN(n) ? n : null),
            ("disc_no", NumOr(P(t, "media_number"), 1)),
            ("rate", Js.Round(rate * 1000)), ("bits", bits), ("streamable", !(P(t, "streamable") is false)), ("isrc", Or(P(t, "isrc"), null)));
    }

    public override async Task<HashSet<string>> FavouriteIdSet(Ask ask, bool fresh = false)
    {
        var j = await Api.FavouriteIds(fresh, ask.Version);
        return Items(Or(AndP(j, "albums"), new List<object?>())).Select(Js.Str).ToHashSet(StringComparer.Ordinal);
    }

    private List<object?> AlbumsOf(object? j) => Items(Or(AndP(P(j, "albums"), "items"), new List<object?>()));

    public override async Task<List<object?>> NewReleases(double days, Ask ask)
    {
        var j = await Api.Featured("new-releases-full", 100);
        var items = AlbumsOf(j).Where(a => Since(P(a, "release_date_original"), days)).ToList();
        return await Marked(items.Select(a => (object?)NormAlbum(a)).ToList(), ask);
    }

    private static readonly Dictionary<string, string> FeaturedTypes = new()
    {
        ["best-sellers"] = "best-sellers", ["most-streamed"] = "most-streamed", ["press-awards"] = "press-awards",
        ["editor-picks"] = "editor-picks", ["new-releases"] = "new-releases"
    };
    public override async Task<List<object?>> Featured(string type, Ask ask)
    {
        var j = await Api.Featured(FeaturedTypes.TryGetValue(type, out var t) ? t : type, 100);
        return await Marked(AlbumsOf(j).Select(a => (object?)NormAlbum(a)).ToList(), ask);
    }

    public override async Task<JsObj> Search(string query, double offset, Ask ask, double limit = 50)
    {
        var j = await Api.Search(query, limit, offset);
        var albums = AlbumsOf(j);
        var artists = Take(Items(Or(AndP(P(j, "artists"), "items"), new List<object?>())), 12)
            .Select(a => (object?)Obj(("id", Js.Str(P(a, "id"))), ("name", P(a, "name")), ("image", ImageOf(P(a, "image"))))).ToList();
        var total = AndP(P(j, "albums"), "total");
        return Obj(("albums", await Marked(albums.Select(a => (object?)NormAlbum(a)).ToList(), ask)), ("artists", artists),
            ("total", Or(total, (double)albums.Count)), ("has_more", offset + albums.Count < Js.ToNumber(Or(total, 0.0))), ("limit", limit));
    }

    public override async Task<JsObj> ArtistAlbums(string artistId, double offset, Ask ask, double limit = 50)
    {
        var j = await Api.Artist(artistId, limit, offset);
        var albums = AlbumsOf(j);
        var total = AndP(P(j, "albums"), "total");
        return Obj(("artist", Obj(("id", Js.Str(P(j, "id"))), ("name", P(j, "name")), ("image", ImageOf(P(j, "image"))))),
            ("albums", await Marked(albums.Select(a => (object?)NormAlbum(a)).ToList(), ask)),
            ("total", Or(total, (double)albums.Count)), ("has_more", offset + albums.Count < Js.ToNumber(Or(total, 0.0))), ("limit", limit));
    }

    public override async Task<JsObj> AlbumDetail(string id, Ask ask)
    {
        var a = await Api.Album(id);
        var tracks = await Api.AlbumTracks(id);
        return Obj(("album", (await Marked([NormAlbum(a)], ask))[0]), ("tracks", tracks.Select(t => (object?)NormTrack(t, a)).ToList()),
            ("description", Or(P(a, "description"), "")));
    }
}

/* Tidal's catalogue (lib/tidal/index.js). */
internal sealed partial class TidalCatalogue : Catalogue
{
    public TidalApi Api { get; }
    private bool listsLogged;

    public TidalCatalogue(string? baseUrl, string? imagesUrl) : base("tidal", "Tidal")
    {
        Api = new TidalApi(baseUrl, imagesUrl,
            () => Account() is var a && Js.Truthy(a) ? P(a, "token") : null,
            () => Or(P(Or(P(Or(Account(), new JsObj()), "user"), new JsObj()), "countryCode"), "US"));
    }

    private object? UserId() => Or(P(Or(Account(), new JsObj()), "userId"), null);

    private static object? MainArtist(object? a)
    {
        if (Js.Truthy(a) && Js.Truthy(P(a, "artist")) && Js.Truthy(P(P(a, "artist"), "name"))) return P(P(a, "artist"), "name");
        if (Js.Truthy(a) && P(a, "artists") is List<object?> l && l.Count > 0)
        {
            var m = l.FirstOrDefault(x => P(x, "type") is "MAIN") ?? l[0];
            return Or(P(m, "name"), "");
        }
        return "";
    }

    [GeneratedRegex("^HI_RES")]
    private static partial Regex HiRes();
    private static bool HiresTagged(object? x) =>
        (Js.Truthy(x) && Js.Truthy(P(x, "mediaMetadata")) && P(P(x, "mediaMetadata"), "tags") is List<object?> tags && tags.Any(t => t is "HIRES_LOSSLESS"))
        || (Js.Truthy(x) && HiRes().IsMatch(Js.Str(Or(P(x, "audioQuality"), ""))));

    public JsObj? NormAlbum(object? a)
    {
        if (!Js.Truthy(a)) return null;
        var hires = HiresTagged(a);
        var art = P(a, "artist");
        return Obj(
            ("id", Js.Str(P(a, "id"))), ("title", Or(P(a, "title"), "")), ("version", Or(P(a, "version"), "")), ("artist", MainArtist(a)),
            ("artist_id", Js.Truthy(art) && !Js.IsNullish(P(art, "id")) ? Js.Str(P(art, "id")) : ""),
            ("image", Api.Image(P(a, "cover"), "640x640")), ("year", Slice(Or(P(a, "releaseDate"), ""), 4)), ("date", Or(P(a, "releaseDate"), "")),
            ("label", ""), ("genre", ""), ("genres", new List<object?>()), ("upc", Or(P(a, "upc"), null)),
            ("rate", hires ? 96000.0 : 44100.0), ("bits", hires ? 24.0 : 16.0),
            ("tracks_count", NumOr(P(a, "numberOfTracks"), 0)), ("duration", NumOr(P(a, "duration"), 0)),
            ("hires", hires), ("quality", hires ? "24/96" : "16/44.1"),
            ("streamable", !(P(a, "allowStreaming") is false) && !(P(a, "streamReady") is false)), ("kept", false), ("favourited", false),
            ("release_date", Or(P(a, "releaseDate"), "")), ("in_library", false));
    }

    public static JsObj NormTrack(object? t, object? al)
    {
        var hires = HiresTagged(t) || HiresTagged(al);
        var version = P(t, "version");
        return Obj(
            ("id", Js.Str(P(t, "id"))),
            ("title", Cat(Or(P(t, "title"), ""), Js.Truthy(version) ? Cat(" (", version, ")") : "")),
            ("artist", Or(Or(MainArtist(t), MainArtist(al)), "")),
            ("duration", NumOr(P(t, "duration"), 0)),
            ("track_no", NumOr(P(t, "trackNumber"), double.NaN) is var n && !double.IsNaN(n) ? n : null),
            ("disc_no", NumOr(P(t, "volumeNumber"), 1)),
            ("rate", hires ? 96000.0 : 44100.0), ("bits", hires ? 24.0 : 16.0),
            ("streamable", !(P(t, "allowStreaming") is false) && !(P(t, "streamReady") is false)), ("isrc", Or(P(t, "isrc"), null)));
    }
    private JsObj NormArtist(object? a) => Obj(("id", Js.Str(P(a, "id"))), ("name", Or(P(a, "name"), "")), ("image", Api.Image(P(a, "picture"), "320x320")));

    public override async Task<HashSet<string>> FavouriteIdSet(Ask ask, bool fresh = false)
    {
        var j = await Api.FavouriteIds(UserId(), fresh, ask.Version);
        return Items(Or(AndP(j, "ALBUM"), new List<object?>())).Select(Js.Str).ToHashSet(StringComparer.Ordinal);
    }

    /*
     * A list's albums as Tidal gave them, kept as the answer to albums/<id>:
     * opening one from the browser then asks Tidal for its tracks only.
     */
    private List<object?> Listed(object? items)
    {
        var list = Items(Or(items, new List<object?>()));
        Api.Prime(list.Where(a => Js.Truthy(a) && !Js.IsNullish(P(a, "id")) && Js.Truthy(P(a, "title"))).Select(a => ($"albums/{Js.Str(P(a, "id"))}", a)), 30 * 86400e3);
        return list;
    }
    /* The list, with the favourites asked for beside it, not after it. */
    private async Task<object?> WithFavs(Task<object?> p, Ask ask)
    {
        var favs = FavouriteIdSet(ask);
        try { await favs; } catch (Exception e) when (e is not ToNode) { /* asked again when marking */ }
        return await p;
    }

    public override async Task<List<object?>> NewReleases(double days, Ask ask)
    {
        var j = await WithFavs(Api.NewReleases(100), ask);
        var items = Listed(P(j, "items")).Where(a => Since(P(a, "releaseDate"), days)).ToList();
        return await Marked(items.Select(a => (object?)NormAlbum(a)).ToList(), ask);
    }

    /* The lists Tidal features that hold albums, as the browser's tabs: { id, label }. */
    public override async Task<List<object?>>? Lists(Ask ask)
    {
        var all = Items(Or(P(await Api.Featured(), "items"), new List<object?>()))
            .Where(x => Js.Truthy(x) && Js.Truthy(P(x, "path")) && !(P(x, "path") is "new") && !(P(x, "hasAlbums") is false)).ToList();
        if (!listsLogged)
        {
            listsLogged = true;
            var named = string.Join(", ", all.Select(x => $"{Js.Str(P(x, "name"))} ({Js.Str(P(x, "path"))})"));
            Front.Log($"[tidal] featured lists: {(named.Length > 0 ? named : "none")}");
        }
        return all.Select(x => (object?)Obj(("id", Js.Str(P(x, "path"))), ("label", Js.Str(Or(P(x, "name"), P(x, "path")))))).ToList();
    }

    /* One of the lists Tidal features, by its path or its name there. */
    public override async Task<List<object?>> Featured(string type, Ask ask)
    {
        var want = type.ToLowerInvariant();
        var lists = Items(Or(P(await Api.Featured(), "items"), new List<object?>()));
        var l = lists.FirstOrDefault(x => Js.Str(Or(P(x, "path"), "")).ToLowerInvariant() == want)
            ?? lists.FirstOrDefault(x => Js.Str(Or(P(x, "name"), "")).ToLowerInvariant() == want);
        if (l == null || P(l, "hasAlbums") is false) throw new ServiceError("Tidal doesn't feature that list", 404);
        var j = await WithFavs(Api.FeaturedAlbums(P(l, "path"), 100), ask);
        return await Marked(Listed(P(j, "items")).Select(a => (object?)NormAlbum(a)).ToList(), ask);
    }

    public override async Task<JsObj> Search(string query, double offset, Ask ask, double limit = 50)
    {
        var j = await WithFavs(Api.Search(query, limit, offset), ask);
        var albums = Listed(Or(AndP(P(j, "albums"), "items"), new List<object?>()));
        var total = Or(AndP(P(j, "albums"), "totalNumberOfItems"), (double)albums.Count);
        var artists = offset != 0 ? [] : Take(Items(Or(AndP(P(j, "artists"), "items"), new List<object?>())), 12).Select(a => (object?)NormArtist(a)).ToList();
        return Obj(("albums", await Marked(albums.Select(a => (object?)NormAlbum(a)).ToList(), ask)), ("artists", artists),
            ("total", total), ("has_more", offset + albums.Count < Js.ToNumber(total)), ("limit", limit));
    }

    public override async Task<JsObj> ArtistAlbums(string artistId, double offset, Ask ask, double limit = 50)
    {
        var arTask = Api.Artist(artistId);
        var jTask = WithFavs(Api.ArtistAlbums(artistId, limit, offset), ask);
        await Task.WhenAll(arTask, jTask);
        var (ar, j) = (await arTask, await jTask);
        var albums = Listed(P(j, "items"));
        var total = NumOr(P(j, "totalNumberOfItems"), albums.Count);
        return Obj(("artist", NormArtist(ar)), ("albums", await Marked(albums.Select(a => (object?)NormAlbum(a)).ToList(), ask)),
            ("total", total), ("has_more", offset + albums.Count < total), ("limit", limit));
    }

    public override async Task<JsObj> AlbumDetail(string id, Ask ask)
    {
        var a = await Api.Album(id);
        var tracks = await Api.AlbumTracks(id);
        return Obj(("album", (await Marked([NormAlbum(a)], ask))[0]), ("tracks", tracks.Select(t => (object?)NormTrack(t, a)).ToList()), ("description", ""));
    }
}
