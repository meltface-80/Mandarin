// Discography.cs — an artist's albums on the service chosen as the default (bug list item 522): the artist's page
// shows what the library holds of them, and after it what else the default service has of theirs, so the
// Discography is the artist's whole catalogue, not only what is a favourite somewhere.
//
// The artist is found on the service by name (its search's artists, the first whose name folds the same as the
// page's), and their albums read a page at a time (Spotify's ten a page, at most five pages: its allowance is small;
// the others' fifty, at most two). Left out: what the library has (the album itself, or another edition of it:
// AlbumEditions.Key), and all but one edition of each album (the plain one first, else the first given). Kept for a
// day by service and name, so an artist's page opened again asks the service nothing.
using Mandarin.Server.Extras;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

internal static class Discography
{
    /* The setting: the id of the default service (qobuz, tidal, spotify), absent for none. */
    public const string Setting = "defaultService";
    public static readonly string[] Ids = ["qobuz", "tidal", "spotify"];
    public const double KeptMs = 24 * 3600 * 1000.0;
    private const string Ns = "discography";

    /* The default service's id, "" for none. */
    public static string Default()
    {
        using var c = Db.Open();
        return Db.Setting(c, Setting) is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<string>(out var id) && Ids.Contains(id) ? id : "";
    }

    /*
     * [artist]'s albums on [svc] the library doesn't have, newest first. [library]: the library's albums by them, each
     * its key and title. { service, name, artist: { id, name } | null, albums }.
     */
    public static async Task<JsObj> Of(Catalogue svc, string artist, IReadOnlyCollection<(string Key, string Title)> library, Ask ask)
    {
        var key = svc.Id + "\n" + Similar.Normalize(artist);
        if (Taste.CacheGet(Ns, key, KeptMs) is not JsObj kept)
        {
            kept = await Read(svc, artist, ask);
            Taste.CachePut(Ns, key, kept);
        }
        // What the library has: the album itself (by its key, kept marks being a day old), or another edition of it.
        var keys = library.Select(x => x.Key).ToHashSet(StringComparer.Ordinal);
        var have = library.Select(x => AlbumEditions.Key(x.Title)).ToHashSet(StringComparer.Ordinal);
        var shown = new HashSet<string>(StringComparer.Ordinal);
        var albums = new List<object?>();
        // The plain edition first, so it is the one kept of each album; then newest first.
        var all = (kept["albums"] as List<object?> ?? []).OfType<JsObj>()
            .OrderBy(a => AlbumEditions.Split(Str(a["title"])).Edition.Length > 0 || Str(a["version"]).Length > 0)
            .ToList();
        foreach (var a in all)
        {
            var k = AlbumEditions.Key(Str(a["title"]));
            if (keys.Contains(svc.Key + Str(a["id"])) || have.Contains(k) || !shown.Add(k)) continue;
            albums.Add(a);
        }
        albums = [.. albums.OfType<JsObj>().OrderByDescending(a => Str(a["date"]).Length > 0 ? Str(a["date"]) : Str(a["year"])).Select(a => (object?)a)];
        var o = new JsObj();
        o["service"] = svc.Id; o["name"] = svc.Name; o["artist"] = kept["artist"]; o["albums"] = albums;
        return o;
    }

    private static string Str(object? v) => v is null or Undef ? "" : Mandarin.Server.Tags.Js.Str(v);

    // What the service has of [artist]: the artist found by name, then their albums, a page at a time.
    private static async Task<JsObj> Read(Catalogue svc, string artist, Ask ask)
    {
        var o = new JsObj();
        o["artist"] = null; o["albums"] = new List<object?>();
        var found = await svc.Search(artist, 0, ask, 10);
        var want = Similar.Normalize(artist);
        if ((found["artists"] as List<object?> ?? []).OfType<JsObj>().FirstOrDefault(a => Similar.Normalize(Str(a["name"])) == want) is not { } ar) return o;
        var id = Str(ar["id"]);
        o["artist"] = Obj(("id", id), ("name", ar["name"]));
        var albums = new List<object?>();
        int pages = svc.Id == "spotify" ? 5 : 2;
        double offset = 0;
        for (int p = 0; p < pages; p++)
        {
            var page = await svc.ArtistAlbums(id, offset, ask);
            var got = page["albums"] as List<object?> ?? [];
            albums.AddRange(got);
            offset += got.Count;
            if (page["has_more"] is not true || got.Count == 0) break;
        }
        o["albums"] = albums;
        return o;
    }

    private static JsObj Obj(params (string Key, object? Value)[] kv)
    {
        var o = new JsObj();
        foreach (var (k, v) in kv) o[k] = v;
        return o;
    }
}
