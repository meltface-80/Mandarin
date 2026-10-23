// SpotifyCatalogue.cs — Spotify as the third streaming service (bug list item 143; docs/spotify-plan.md): your saved
// albums kept in the library as Qobuz's and Tidal's favourites are, your liked songs and your playlists as playlists,
// read from Spotify's Web API (SpotifyApi.cs). The rows, the import's runs and the switch are the services' own
// (Rows.cs, Import.cs); the sign-in is SpotifyAccounts.cs.
//
// What is played is never fetched track by track: Spotify's sound comes only from Mandarin's own Soloist (lossless,
// Spotify/), told what to play (Spotify/SpotifyPlay.cs). So a Spotify track's stream is refused here (Resolve).
// Since February 2026 Spotify lists no new releases nor featured lists, and searches ten at a time.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed partial class SpotifyCatalogue : Catalogue
{
    public SpotifyApi Api { get; }
    private HashSet<string>? saved;      // the saved albums' ids, kept ten minutes (the browser marks each list with them)
    private double savedAt;
    private const double SavedMs = 10 * 60_000;
    private const int OneAlbumMs = 5_000;   // an album's page waits no longer than this for Spotify

    public SpotifyCatalogue(string? baseUrl, string? accountsUrl) : base("spotify", "Spotify") =>
        Api = new SpotifyApi(baseUrl, accountsUrl, Account, OnToken);

    /* A refreshed token kept with the rest of the account (and Soloist's settings, which share the setting). */
    private void OnToken(JsObj t)
    {
        if (Account() is not JsObj a) return;
        a["token"] = t;
        Extras.Labels.SetSetting(Id, a);
    }

    // ------------------------------------------------------------ Spotify's shapes, as the services' plain ones

    /* The widest of an object's pictures. */
    private static object? Picture(object? x) =>
        Items(P(x, "images")).OrderByDescending(i => NumOr(P(i, "width"), 0)).Select(i => P(i, "url")).FirstOrDefault(Js.Truthy);

    private static string Names(object? x) => string.Join(", ", Items(P(x, "artists")).Select(a => Js.Str(Or(P(a, "name"), ""))).Where(n => n.Length > 0));

    // Spotify's lossless is FLAC up to 24-bit/44.1 kHz; it doesn't say which an album is, so it is said as CD's until heard.
    public static JsObj? NormAlbum(object? a)
    {
        if (!Js.Truthy(a) || !Js.Truthy(P(a, "id"))) return null;
        var first = Items(P(a, "artists")).FirstOrDefault() ?? new JsObj();
        var date = Js.Str(Or(P(a, "release_date"), ""));
        return Obj(
            ("id", Js.Str(P(a, "id"))), ("title", Or(P(a, "name"), "")), ("version", ""), ("artist", Or(P(first, "name"), "")),
            ("artist_id", Js.Str(Or(P(first, "id"), ""))), ("image", Picture(a)), ("year", Slice(date, 4)), ("date", date),
            ("label", ""), ("genre", ""), ("genres", new List<object?>()), ("upc", null), ("rate", 44100.0), ("bits", 16.0),
            ("tracks_count", NumOr(P(a, "total_tracks"), 0)), ("duration", 0.0), ("hires", false), ("quality", "Lossless"),
            ("streamable", true), ("kept", false), ("favourited", false), ("release_date", date), ("in_library", false));
    }

    public static JsObj NormTrack(object? t) => Obj(
        ("id", Js.Str(P(t, "id"))), ("title", Or(P(t, "name"), "")), ("artist", Names(t)),
        ("duration", Math.Round(NumOr(P(t, "duration_ms"), 0) / 1000)),
        ("track_no", NumOr(P(t, "track_number"), double.NaN) is var n && !double.IsNaN(n) ? n : null),
        ("disc_no", NumOr(P(t, "disc_number"), 1)), ("rate", 44100.0), ("bits", 16.0),
        ("streamable", !(P(t, "is_local") is true) && !(P(t, "is_playable") is false)), ("isrc", Or(P(Or(P(t, "external_ids"), new JsObj()), "isrc"), null)));

    private static JsObj NormArtist(object? a) => Obj(("id", Js.Str(P(a, "id"))), ("name", Or(P(a, "name"), "")), ("image", Picture(a)));

    // ------------------------------------------------------------ the catalogue

    public override async Task<HashSet<string>> FavouriteIdSet(Ask ask, bool fresh = false)
    {
        if (!fresh && saved != null && NowMs() - savedAt < SavedMs) return saved;
        var ids = (await Api.All("me/albums?limit=50")).Select(x => SpotifyApi.Inner(x, "album")).Where(Js.Truthy)
            .Select(a => Js.Str(P(a, "id"))).ToHashSet(StringComparer.Ordinal);
        (saved, savedAt) = (ids, NowMs());
        return ids;
    }

    /*
     * Whether one album is saved (an album's page opening, item 144): Spotify asked of that album alone, never the
     * whole list (a big library's pages, read one after another, kept the page waiting until the app gave up); the
     * list from the last import or listing while it is fresh. An answer that isn't a plain yes or no, or none in five
     * seconds, is unknown, never "not saved": that would let the album go from the library.
     */
    public override async Task<bool> IsFavourite(string albumId, Ask ask)
    {
        if (saved != null && NowMs() - savedAt < SavedMs) return saved.Contains(albumId);
        var asked = Api.GetJson("me/library/contains?uris=" + Component("spotify:album:" + albumId));
        if (await Task.WhenAny(asked, Task.Delay(OneAlbumMs)) != asked) throw new ServiceError("Spotify didn't answer in time", 504);
        return await asked is List<object?> { Count: 1 } l && l[0] is bool b ? b : throw new ServiceError("Spotify's answer unreadable", 502);
    }

    public override Task<List<object?>> NewReleases(double days, Ask ask) => Task.FromResult(new List<object?>());

    public override Task<List<object?>> Featured(string type, Ask ask) => throw new ServiceError("Spotify features no lists here", 404);

    public override async Task<JsObj> Search(string query, double offset, Ask ask, double limit = 50)
    {
        var j = await Api.GetJson("search?type=album,artist&limit=10&offset=" + Js.Num(offset) + "&q=" + Component(query));
        var albums = Items(P(P(j, "albums"), "items")).Select(a => (object?)NormAlbum(a)).Where(a => a != null).ToList();
        var total = NumOr(P(P(j, "albums"), "total"), albums.Count);
        var artists = offset != 0 ? [] : Items(P(P(j, "artists"), "items")).Select(a => (object?)NormArtist(a)).ToList();
        return Obj(("albums", await Marked(albums, ask)), ("artists", artists), ("total", total), ("has_more", offset + albums.Count < total), ("limit", 10.0));
    }

    public override async Task<JsObj> ArtistAlbums(string artistId, double offset, Ask ask, double limit = 50)
    {
        var ar = await Api.GetJson("artists/" + Component(artistId));
        var j = await Api.GetJson("artists/" + Component(artistId) + "/albums?include_groups=album,single,compilation&limit=50&offset=" + Js.Num(offset));
        var albums = Items(P(j, "items")).Select(a => (object?)NormAlbum(a)).Where(a => a != null).ToList();
        var total = NumOr(P(j, "total"), albums.Count);
        return Obj(("artist", NormArtist(ar)), ("albums", await Marked(albums, ask)), ("total", total), ("has_more", offset + albums.Count < total), ("limit", 50.0));
    }

    public override async Task<JsObj> AlbumDetail(string id, Ask ask)
    {
        var (album, tracks) = await FullAlbum(id, null);
        return Obj(("album", (await Marked([album], ask))[0]), ("tracks", tracks.Select(t => (object?)t).ToList()), ("description", ""));
    }

    // ------------------------------------------------------------ rows in the library

    /* The album and every track (an album's first page of tracks comes with it; the rest a page at a time). */
    protected override async Task<(JsObj Album, List<JsObj> Tracks)> FullAlbum(string id, object? hint)
    {
        var a = Js.Truthy(hint) && Js.Truthy(P(hint, "tracks")) ? hint : await Api.GetJson("albums/" + Component(id));
        var album = NormAlbum(a) ?? throw new ServiceError("Spotify has no such album", 404);
        var tracks = Items(P(P(a, "tracks"), "items"));
        if (P(P(a, "tracks"), "next") is string next && next.Length > 0) tracks.AddRange(await Api.All(next));
        var list = tracks.Where(Js.Truthy).Select(NormTrack).Where(t => t["streamable"] is true).ToList();
        album["duration"] = list.Sum(t => Js.ToNumber(t["duration"]));
        return (album, list);
    }

    /* Saved, or taken out of your library, on Spotify itself (the library endpoint of February 2026). */
    protected override async Task ApiFavourite(string id, bool on)
    {
        await Api.Call(on ? "PUT" : "DELETE", "me/library?uris=" + Component("spotify:album:" + id));
        saved = null;
    }

    // ------------------------------------------------------------ the import

    // Settings' Stream quality (item 145): Soloist's prefs ask Spotify for it (Spotify/Soloist.Prefs.cs); lossless unless chosen.
    protected override string[] Qualities { get; } = ["lossless", "very_high", "high", "normal"];
    protected override string DefaultQuality => "lossless";

    /* Your saved albums, every one, each since when you saved it; the listing (with its first tracks) kept as the hint. */
    protected override async Task<List<(string Id, JsObj Hint)>> Wanted()
    {
        var o = new List<(string, JsObj)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var x in await Api.All("me/albums?limit=50"))
        {
            if (SpotifyApi.Inner(x, "album") is not JsObj a || !Js.Truthy(a["id"]) || !seen.Add(Js.Str(a["id"]))) continue;
            a["kept_as"] = "favourite";
            var at = DateMs(P(x, "added_at"));
            a["kept_at"] = at == 0 || double.IsNaN(at) ? null : at;
            o.Add((Js.Str(a["id"]), a));
        }
        saved = seen;
        savedAt = NowMs();
        return o;
    }

    private static (string AlbumId, string TrackId)? Pair(object? t) =>
        Js.Truthy(t) && Js.Truthy(P(t, "id")) && !(P(t, "is_local") is true) && (P(t, "type") is null or Undef or "track") && Js.Truthy(P(t, "album")) && Js.Truthy(P(P(t, "album"), "id"))
            ? (Js.Str(P(P(t, "album"), "id")), Js.Str(P(t, "id"))) : null;

    /* Your liked songs, newest first, as Spotify keeps them. */
    protected override async Task<List<(string AlbumId, string TrackId)>> ListFavouriteTracks() =>
        (await Api.All("me/tracks?limit=50")).Select(x => Pair(SpotifyApi.Inner(x, "track"))).OfType<(string, string)>().ToList();

    /* Your playlists and their songs (one Spotify won't list, as it won't another's since 2026, is left empty). */
    protected override async Task<List<(object? Id, object? Name, List<(string AlbumId, string TrackId)> Tracks)>> ListPlaylists()
    {
        var o = new List<(object?, object?, List<(string, string)>)>();
        foreach (var p in await Api.All("me/playlists?limit=50"))
        {
            if (!Js.Truthy(p) || !Js.Truthy(P(p, "id"))) continue;
            List<object?> items;
            try { items = await Api.All("playlists/" + Component(Js.Str(P(p, "id"))) + "/items?limit=100"); }
            catch (ServiceError) { items = []; }
            o.Add((P(p, "id"), P(p, "name"), items.Select(i => Pair(SpotifyApi.Inner(i, "track"))).OfType<(string, string)>().ToList()));
        }
        return o;
    }

    /* Another quality chosen: Soloist started again, as it reads its prefs only as it starts. */
    public override Task SettingsWritten()
    {
        if (global::Mandarin.Server.Spotify.SpotifyLive.Player is { } p && p.Quality != Settings().Quality)
        {
            Server.Log("[spotify] another quality chosen: Soloist started again to take it up");
            p.Restart();
        }
        return Task.CompletedTask;
    }

    protected override void Describe(JsObj o)
    {
        var u = Or(P(Or(Account(), new JsObj()), "user"), new JsObj());
        var user = new JsObj();
        user["login"] = Or(P(u, "id"), "");
        user["name"] = Or(Or(P(u, "display_name"), P(u, "id")), "");
        user["id"] = P(u, "id");
        o["user"] = user;
        o["subscription"] = "";
        // Spotify's sound is Soloist's: lossless on a plan that has it (the samples say, Spotify/SoloistProof.cs).
        o["hires"] = false;
        o["lossless"] = true;
    }

    /* In use: signed in, or Spotify albums in the library still (Clean up and the prune count it only then). */
    public bool InUse => Connected() || AlbumRows() > 0;

    private static long AlbumRows()
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM albums WHERE key LIKE 'spotify:%'";
        return cmd.ExecuteScalar() is long n ? n : 0;
    }

    // ------------------------------------------------------------ Soloist, as the Web API knows it

    /* Mandarin's Soloist among the account's Connect devices ([name], as the Spotify app shows it): its id, or null. */
    public async Task<string?> DeviceId(string name)
    {
        var j = await Api.GetJson("me/player/devices");
        return Items(P(j, "devices")).Where(d => string.Equals(Js.Str(P(d, "name")), name, StringComparison.OrdinalIgnoreCase))
            .Select(d => P(d, "id")).OfType<string>().FirstOrDefault();
    }

    // ------------------------------------------------------------ never fetched track by track

    public override Task<Resolved> Resolve(StreamTrack t, JsObj p) =>
        throw new ServiceError("Spotify plays through Mandarin's Spotify Connect device (Soloist), not track by track", 409);
}
