// SpotifyBrowse.cs — Spotify's page in the side menu (bug list item 498), as the browser Qobuz and Tidal share asks it
// (ServiceRoutes.cs): two lists, search, an artist's albums, an album with its tracks, and an album saved or unsaved on
// Spotify itself.
//
//   - New from artists you follow (the new-releases list): Spotify took its own New Releases away from apps like this
//     one in February 2026, so this is built here: the artists you follow, then each one's latest albums and singles,
//     one artist at a time (Development Mode's quota is small). Kept in the database, so
//     the page opens on what was found; read again in the background once it is twelve hours old (a second apart, item
//     499: four a second ran into Spotify's limit). The first time, the page waits four seconds at most (the phone
//     gives up after six) and is given what has been found so far, with that it is still being gathered.
//   - Your albums: your saved albums, as the import reads them.
//   - Search: albums and artists, ten a page (Spotify's most since February 2026).
//   - Saving an album: Spotify's one library call for everything (PUT or DELETE /me/library with the album's URI).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed partial class SpotifyCatalogue
{
    private const double FollowedFreshMs = 12 * 3600e3, FollowedKeptMs = 30 * 86400e3, FollowedWithinDays = 120;
    private const int Page = 10;
    /* The gap between two artists' asks while the followed list is read (the tests make it short). */
    public int PaceMs { get; init; } = 1000;
    /* How long the page waits the first time, before it is given what has been found so far. */
    public int FirstWaitMs { get; init; } = 4_000;
    private readonly object followedGate = new();
    private Task? building;

    private string FollowedKey => Js.Str(Or(P(Account(), "userId"), ""));

    /* Still gathering the list the first time, or after a partial one (item 499): the page says so rather than "none". */
    public bool Gathering
    {
        get
        {
            lock (followedGate) if (building is not { IsCompleted: false }) return false;
            return FollowedKept() is not { } k || k["partial"] is true;
        }
    }

    /* The kept list: { at, albums }, or null. */
    private JsObj? FollowedKept() => Extras.Taste.CacheGet("spotify-followed-new", FollowedKey, FollowedKeptMs) as JsObj;

    /* The list read again in the background, once at a time. */
    private Task Refresh()
    {
        lock (followedGate)
        {
            if (building is { IsCompleted: false } b) return b;
            return building = Task.Run(BuildFollowed);
        }
    }

    private async Task BuildFollowed()
    {
        var key = FollowedKey;
        if (key.Length == 0) return;
        try
        {
            var artists = await Api.All("me/following?type=artist&limit=50", "artists", patient: true);
            var since = DateTime.UtcNow.AddDays(-FollowedWithinDays).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
            var found = new Dictionary<string, JsObj>(StringComparer.Ordinal);
            var done = 0;
            foreach (var ar in artists)
            {
                if (Js.Str(Or(P(ar, "id"), "")) is not { Length: > 0 } id) continue;
                if (done++ > 0) await Task.Delay(PaceMs);
                object? j;
                try { j = await Api.GetJson("artists/" + Uri.EscapeDataString(id) + "/albums?include_groups=album,single&limit=" + Page, FollowedFreshMs, patient: true); }
                catch (ServiceError e) when (e.Status is 404 or 403) { continue; }
                foreach (var a in Items(P(j, "items")))
                    if (NormAlbum(a) is { } n && string.CompareOrdinal(Js.Str(n["date"]), since) >= 0) found[Js.Str(n["id"])] = n;
                if (done % 10 == 0) KeepFollowed(key, found, done < artists.Count);
            }
            KeepFollowed(key, found, false);
            Server.Log($"[spotify] new from {artists.Count} artists you follow: {found.Count} releases");
        }
        catch (Exception e) when (e is ServiceError or JsError or HttpRequestException) { Server.Log("[spotify] new from the artists you follow: " + e.Message); }
    }

    private static void KeepFollowed(string key, Dictionary<string, JsObj> found, bool partial)
    {
        var list = found.Values.OrderByDescending(a => Js.Str(a["date"]), StringComparer.Ordinal).Select(a => (object?)a).ToList();
        Extras.Taste.CachePut("spotify-followed-new", key, Obj(("at", NowMs()), ("partial", partial), ("albums", list)));
    }

    /* New from artists you follow, released within [days], newest first. */
    public override async Task<List<object?>> NewReleases(double days, Ask ask)
    {
        var kept = FollowedKept();
        if (kept == null || kept["partial"] is true || NowMs() - NumOr(kept["at"], 0) > FollowedFreshMs)
        {
            var b = Refresh();
            if (kept == null) { await Task.WhenAny(b, Task.Delay(FirstWaitMs)); kept = FollowedKept(); }
        }
        var since = DateTime.UtcNow.AddDays(-days).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var albums = Items(AndP(kept, "albums")).Where(a => string.CompareOrdinal(Js.Str(P(a, "date")), since) >= 0)
            .Select(a => (object?)Copy(a)).ToList();
        return await Marked(albums, ask);
    }

    private static JsObj Copy(object? a)
    {
        var o = new JsObj();
        if (a is JsObj j) foreach (var k in j.Keys) o[k] = j[k];
        return o;
    }

    /* Your albums: the saved albums, newest saved first. */
    public override async Task<List<object?>> Featured(string type, Ask ask)
    {
        if (type != "your-albums") throw new ServiceError("Spotify has no such list", 404);
        // With the import on, from what it keeps, at once (item 516, SpotifyYourAlbums.cs); else the saved list itself.
        var albums = Settings().Import ? YourAlbums()
            : (await Saved()).Select(x => NormAlbum(SpotifyApi.Inner(x, "album"))).Where(a => a != null).Select(a => (object?)a).ToList();
        return await Marked(albums, ask);
    }

    private JsObj NormArtist(object? a) => Obj(("id", Js.Str(P(a, "id"))), ("name", Or(P(a, "name"), "")), ("image", Largest(P(a, "images"))));

    /* Albums and artists for [query], ten a page. */
    public override async Task<JsObj> Search(string query, double offset, Ask ask, double limit = 50)
    {
        var j = await Api.GetJson("search?type=album,artist&limit=" + Page + "&offset=" + (int)offset + "&q=" + Uri.EscapeDataString(query));
        var albums = Items(AndP(P(j, "albums"), "items")).Select(a => NormAlbum(a)).Where(a => a != null).Select(a => (object?)a).ToList();
        var total = NumOr(AndP(P(j, "albums"), "total"), albums.Count);
        var artists = offset != 0 ? [] : Items(AndP(P(j, "artists"), "items")).Take(12).Select(a => (object?)NormArtist(a)).ToList();
        return Obj(("albums", await Marked(albums, ask)), ("artists", artists), ("total", total), ("has_more", offset + albums.Count < total), ("limit", (double)Page));
    }

    /* An artist and their albums and singles, ten a page, newest first. */
    public override async Task<JsObj> ArtistAlbums(string artistId, double offset, Ask ask, double limit = 50)
    {
        var id = Uri.EscapeDataString(artistId);
        var ar = await Api.GetJson("artists/" + id, FollowedFreshMs);
        var j = await Api.GetJson("artists/" + id + "/albums?include_groups=album,single&limit=" + Page + "&offset=" + (int)offset);
        var albums = Items(P(j, "items")).Select(a => NormAlbum(a)).Where(a => a != null).Select(a => (object?)a).ToList();
        var total = NumOr(P(j, "total"), albums.Count);
        return Obj(("artist", NormArtist(ar)), ("albums", await Marked(albums, ask)), ("total", total), ("has_more", offset + albums.Count < total), ("limit", (double)Page));
    }

    /* An album and its tracks, as the browser opens it. */
    public override async Task<JsObj> AlbumDetail(string id, Ask ask)
    {
        var a = await Api.Album(id);
        var tracks = await Api.AlbumTracks(a);
        return Obj(("album", (await Marked([NormAlbum(a)], ask))[0]), ("tracks", tracks.Select(t => (object?)NormTrack(t, a)).ToList()), ("description", ""));
    }

    /* Saved or unsaved on Spotify itself; the saved albums read afresh next time. */
    protected override async Task ApiFavourite(string id, bool on)
    {
        await Api.Call(on ? "PUT" : "DELETE", "me/library?uris=" + Uri.EscapeDataString("spotify:album:" + id));
        ForgetAnswers();
    }
}
