// SpotifyCatalogue.cs — Spotify as a service of Mandarin's, beside Qobuz and Tidal (bug list item 497): the account,
// the saved albums brought into the library by the import those two use (Import.cs, Rows.cs), each album and its
// tracks in the plain shape those rows are written from. Signing in is SpotifySignIn.cs.
//
// What Spotify serves is decided by the account, up to lossless (FLAC, 24-bit/44.1 kHz): the rows say that ceiling, as
// Spotify's own apps do. Playing is item 499 (Soloist on the server); until then a Spotify track says so when asked.
// Browsing (the side menu's page, item 498) is SpotifyBrowse.cs.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed partial class SpotifyCatalogue : Catalogue
{
    public SpotifyApi Api { get; }

    public SpotifyCatalogue(string? baseUrl, string? accountsUrl, int busyWaitMs = 5000, int intervalMs = 2000) : base("spotify", "Spotify")
    {
        Api = new SpotifyApi(baseUrl, accountsUrl, Account, OnToken) { BusyWaitMs = busyWaitMs, IntervalMs = intervalMs };
    }

    /* In use: signed in, or with albums here. Clean up and the prune count Spotify only then (their answers as before for everyone else). */
    public bool InUse()
    {
        if (Connected()) return true;
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM albums WHERE key LIKE 'spotify:%' LIMIT 1";
        return cmd.ExecuteScalar() != null;
    }

    /* A refreshed token kept at once (Spotify's old refresh token stops working), the rest of the account as it was. */
    private void OnToken(JsObj t)
    {
        if (Account() is not JsObj a) return;
        a["token"] = t;
        Extras.SavedSettings.SetSetting(Id, a);
    }

    // ------------------------------------------------------------ Spotify's shapes, as the rows want them

    private static object? Largest(object? images) =>
        Items(images).OrderByDescending(i => NumOr(P(i, "width"), 0)).Select(i => P(i, "url")).FirstOrDefault(u => Js.Truthy(u));

    private static object? FirstArtist(object? x) => Items(P(x, "artists")).FirstOrDefault();

    public static JsObj? NormAlbum(object? a)
    {
        if (!Js.Truthy(a) || Js.IsNullish(P(a, "id"))) return null;
        var date = Js.Str(Or(P(a, "release_date"), ""));
        var art = FirstArtist(a);
        var genres = Items(P(a, "genres"));
        return Obj(
            ("id", Js.Str(P(a, "id"))), ("title", Or(P(a, "name"), "")), ("version", ""), ("artist", Or(AndP(art, "name"), "")),
            ("artist_id", Js.Str(Or(AndP(art, "id"), ""))), ("image", Largest(P(a, "images"))), ("year", Slice(date, 4)), ("date", date),
            ("label", Or(P(a, "label"), "")), ("genre", genres.Count > 0 ? genres[0] : ""), ("genres", genres), ("upc", Or(AndP(P(a, "external_ids"), "upc"), null)),
            ("rate", 44100.0), ("bits", 24.0), ("tracks_count", NumOr(P(a, "total_tracks"), 0)), ("duration", 0.0),
            ("hires", false), ("quality", "24/44.1"), ("streamable", !(P(a, "is_playable") is false)), ("kept", false), ("favourited", false),
            ("release_date", date), ("in_library", false));
    }

    public static JsObj NormTrack(object? t, object? al)
    {
        var art = FirstArtist(t) ?? FirstArtist(al);
        return Obj(
            ("id", Js.Str(P(t, "id"))), ("title", Or(P(t, "name"), "")), ("artist", Or(AndP(art, "name"), "")),
            ("duration", Math.Round(NumOr(P(t, "duration_ms"), 0) / 1000)),
            ("track_no", NumOr(P(t, "track_number"), double.NaN) is var n && !double.IsNaN(n) ? n : null),
            ("disc_no", NumOr(P(t, "disc_number"), 1)), ("rate", 44100.0), ("bits", 24.0),
            ("streamable", !(P(t, "is_playable") is false)), ("isrc", Or(AndP(P(t, "external_ids"), "isrc"), null)));
    }

    // ------------------------------------------------------------ the catalogue (item 498 browses it)

    /*
     * The saved albums' ids, as the library keeps them with its import on (item 500): the page's marks and an album page's reconciling
     * ask Spotify nothing. Spotify's allowance is small and shared by everything Mandarin asks of it; reading the whole
     * saved list for every page, and every two minutes for the watch, used a day's in hours. The import brings them up
     * to date (every six hours, Update library now), and saving from Mandarin's Spotify page at once.
     */
    public override async Task<HashSet<string>> FavouriteIdSet(Ask ask, bool fresh = false) =>
        Settings().Import
            ? KeptSet().Where(k => k.StartsWith(Key, StringComparison.Ordinal)).Select(k => k[Key.Length..]).ToHashSet(StringComparer.Ordinal)
            // Not in the library: the saved list itself, read once a minute at most.
            : (await Saved()).Select(x => Js.Str(Or(AndP(SpotifyApi.Inner(x, "album"), "id"), ""))).Where(id => id.Length > 0).ToHashSet(StringComparer.Ordinal);

    /* What the import keeps, as Spotify lists it now: the listing the import read a moment ago (kept the minute). */
    public override async Task<Dictionary<string, string>> WantedIds(Ask ask, bool fresh = false)
    {
        var o = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var x in await Saved(fresh: false, patient: true))
            if (Js.Str(Or(AndP(SpotifyApi.Inner(x, "album"), "id"), "")) is { Length: > 0 } id) o[id] = "favourite";
        return o;
    }

    /* Imported within [ms] (a rescan's import left out then, item 500). */
    public bool ImportedWithin(double ms) => Extras.SavedSettings.Setting(Id + "LastImport") is JsObj li && NowMs() - NumOr(li["at"], 0) < ms;

    private readonly object savedGate = new();
    private (double At, Task<List<object?>> Task)? saved;
    /* The saved albums, one reading shared by everyone asking within the minute; [fresh] (the import) read anew. */
    internal Task<List<object?>> Saved(bool fresh = false, bool patient = false)
    {
        lock (savedGate)
        {
            if (!fresh && saved is { } s && NowMs() - s.At < 60_000 && !s.Task.IsFaulted) return s.Task;
            var t = Api.SavedAlbums(patient);
            saved = (NowMs(), t);
            return t;
        }
    }

    // The browser's lists, search, artists and albums: SpotifyBrowse.cs (item 498).

    // ------------------------------------------------------------ rows in the library

    /* The albums the import's listing gave, whole (each with its tracks' first page), as Spotify sent them (item 499). */
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, object?> listed = new(StringComparer.Ordinal);

    /*
     * The album and its tracks; the cover (the largest Spotify has) kept beside the database, side by side with the
     * tracks. In the import (item 519, as Music Assistant brings a library in), an album is taken as the saved list gave
     * it and Spotify is asked nothing more of it: its tracks as listed, and where the list gave none or only the first
     * page, what is missing is fetched once, when the album is opened (Opened). Asked for any other way (a favourite saved
     * from the page, the watch, an album opened), it is asked for whole: one or two requests.
     */
    protected override async Task<(JsObj Album, List<JsObj> Tracks)> FullAlbum(string id, object? hint)
    {
        if (listed.TryRemove(id, out var given) && given is JsObj g)
        {
            var listedAlbum = NormAlbum(g) ?? throw new ServiceError("Spotify has no such album", 404);
            var page = AndP(g, "tracks");
            var items = Items(AndP(page, "items")).Where(t => Js.Truthy(t) && !(P(t, "is_playable") is false)).ToList();
            Owed(id, items.Count == 0 || AndP(page, "next") is string n && n.Length > 0);
            try { await FetchArt(id, listedAlbum["image"]); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* asked again by EnsureAlbum */ }
            listedAlbum["duration"] = items.Sum(t => Math.Round(NumOr(P(t, "duration_ms"), 0) / 1000));
            return (listedAlbum, items.Select(t => NormTrack(t, g)).ToList());
        }
        var patient = !onDemand.Value;
        var a = await Api.Album(id, patient);
        var album = NormAlbum(a) ?? throw new ServiceError("Spotify has no such album", 404);
        var tracks = Api.AlbumTracks(a, patient);
        var art = FetchArt(id, album["image"]);
        var list = await tracks;
        try { await art; } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* asked again by EnsureAlbum */ }
        Owed(id, false);
        album["duration"] = list.Sum(t => Math.Round(NumOr(P(t, "duration_ms"), 0) / 1000));
        return (album, list.Where(t => Js.Truthy(t) && !(P(t, "is_playable") is false)).Select(t => NormTrack(t, a)).ToList());
    }

    // An album opened: asked for at once, not waited out in the background's way (a page waits six seconds).
    private readonly AsyncLocal<bool> onDemand = new();
    private const string OwedNs = "spotify-owed";

    /* Whether album [id]'s tracks are still owed (the import's list gave none, or only the first page): kept, or let go. */
    private static void Owed(string id, bool owed)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = owed ? "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, '1', $ts) ON CONFLICT(ns, key) DO NOTHING" : "DELETE FROM cache WHERE ns = $ns AND key = $k";
        cmd.Parameters.AddWithValue("$ns", OwedNs);
        cmd.Parameters.AddWithValue("$k", id);
        cmd.Parameters.AddWithValue("$ts", NowMs());
        cmd.ExecuteNonQuery();
    }

    private static bool IsOwed(string id)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM cache WHERE ns = $ns AND key = $k";
        cmd.Parameters.AddWithValue("$ns", OwedNs);
        cmd.Parameters.AddWithValue("$k", id);
        return cmd.ExecuteScalar() != null;
    }

    /* An album of the library opened: its tracks fetched now where the import's list left them owed, then kept. */
    public override async Task Opened(string id)
    {
        if (!IsOwed(id)) return;
        onDemand.Value = true;
        try { await EnsureAlbum(id); }
        catch (ServiceError e) { Server.Log($"[spotify] album {id}: its tracks couldn't be fetched yet ({e.Message})"); }
        finally { onDemand.Value = false; }
    }

    // ------------------------------------------------------------ the import

    protected override string[] Qualities { get; } = ["lossless", "high"];
    protected override string DefaultQuality => "lossless";

    /* Your saved albums, every one, each since when you saved it. */
    protected override async Task<List<(string Id, JsObj Hint)>> Wanted()
    {
        var order = new List<string>();
        var want = new Dictionary<string, JsObj>(StringComparer.Ordinal);
        listed.Clear();
        foreach (var x in await Saved(fresh: true, patient: true))
        {
            if (SpotifyApi.Inner(x, "album") is not JsObj a || Js.IsNullish(a["id"])) continue;
            listed[Js.Str(a["id"])] = a;
            var hint = NormAlbum(a)!;
            hint["kept_as"] = "favourite";
            var ms = DateMs(Js.Str(Or(P(x, "added_at"), "")));
            hint["kept_at"] = ms == 0 || double.IsNaN(ms) ? null : ms;
            var id = Js.Str(hint["id"]);
            if (!want.ContainsKey(id)) order.Add(id);
            want[id] = hint;
        }
        KeepList(order.Select(id => want[id]));   // "Your albums" answered from it (item 516, SpotifyYourAlbums.cs)
        return order.Select(id => (id, want[id])).ToList();
    }

    protected override void Describe(JsObj o)
    {
        var a = Or(Account(), new JsObj());
        var u = Or(P(a, "user"), new JsObj());
        o["user"] = Obj(("login", Or(P(u, "id"), "")), ("name", Or(Or(P(u, "display_name"), P(u, "id")), "")), ("id", P(a, "userId")), ("country", ""));
        o["lossless"] = true;
        o["hires"] = false;
    }

    protected override void ForgetAnswers()
    {
        Api.Cache.Clear();
        lock (savedGate) saved = null;
    }

    // ------------------------------------------------------------ playing (item 499)

    public override Task<Resolved> Resolve(StreamTrack t, JsObj p) =>
        throw new ServiceError("Playing Spotify comes with Mandarin's next Spotify update", 409);
}
