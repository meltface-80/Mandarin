// SpotifyYourAlbums.cs — Spotify's "Your albums" list (bug list item 516) from what Mandarin keeps, never Spotify.
// It read every saved album from Spotify each time it was opened, fifty at a time: an owner's thousand took longer
// than the app waits (six seconds), so the list said "Couldn't load: timeout", and each opening spent twenty of the
// day's requests again. With the import on, the import's own reading of the saved list is kept (its albums as Spotify
// gave them, covers and all, newest saved first) and the list is answered from it at once: what is no longer kept is
// left out, and an album saved since (from Mandarin's page) is put first, as the library has it until the next import.
// An album the reading doesn't hold (saved since, or kept before any reading was) shows the cover the library keeps of it
// (item 521: 3,555 albums with none, until an import Spotify had Mandarin wait for).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

internal sealed partial class SpotifyCatalogue
{
    /// <summary>Where the import's reading of the saved albums is kept: the cache's namespace and key.</summary>
    public const string ListNs = "spotify-your-albums", ListKey = "list";

    /* The import's reading of the saved albums, newest saved first, kept for "Your albums". */
    private static void KeepList(IEnumerable<JsObj> albums)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
        cmd.Parameters.AddWithValue("$ns", ListNs);
        cmd.Parameters.AddWithValue("$k", ListKey);
        cmd.Parameters.AddWithValue("$v", Js.Json(albums.Cast<object?>().ToList()));
        cmd.Parameters.AddWithValue("$ts", NowMs());
        cmd.ExecuteNonQuery();
    }

    /* "Your albums" as kept: the import's reading, less what is no longer kept, and what was saved since first. */
    private List<object?> YourAlbums(Snapshot? library)
    {
        var kept = KeptSet();
        var fromList = new List<object?>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        using var c = Db.Open();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT value FROM cache WHERE ns = $ns AND key = $k";
            cmd.Parameters.AddWithValue("$ns", ListNs);
            cmd.Parameters.AddWithValue("$k", ListKey);
            if (cmd.ExecuteScalar() is string v && Mandarin.Server.Scan.JsJson.Parse(v) is List<object?> all)
                foreach (var a in all)
                    if (a is JsObj o && Js.Str(o["id"]) is { Length: > 0 } id && kept.Contains(Key + id) && seen.Add(id)) fromList.Add(o);
        }
        // Kept but not in the reading (saved from Mandarin's page since, or kept before the reading was): the library's row.
        var since = new List<(double At, JsObj Album)>();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = @"SELECT a.key, a.title, a.artist, a.year, a.date, k.value, a.id, a.art_hash FROM albums a JOIN cache k ON k.ns = $ns AND k.key = a.key WHERE a.key LIKE 'spotify:%'";
            cmd.Parameters.AddWithValue("$ns", Id + "-kept");
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var id = r.GetString(0)["spotify:".Length..];
                if (seen.Contains(id)) continue;
                var at = Mandarin.Server.Scan.JsJson.Parse(r.IsDBNull(5) ? "{}" : r.GetString(5)) is JsObj k ? NumOr(k["at"], 0) : 0;
                since.Add((at, Obj(("id", id), ("title", r.IsDBNull(1) ? "" : r.GetString(1)), ("version", ""), ("artist", r.IsDBNull(2) ? "" : r.GetString(2)),
                    ("artist_id", ""), ("image", CoverOf(library, r.GetInt64(6), r.IsDBNull(7) ? null : r.GetString(7))), ("year", r.IsDBNull(3) ? "" : Convert.ToString(r.GetValue(3), System.Globalization.CultureInfo.InvariantCulture)),
                    ("date", r.IsDBNull(4) ? "" : r.GetString(4)), ("rate", 44100.0), ("bits", 24.0), ("hires", false), ("quality", "24/44.1"),
                    ("streamable", true), ("kept", true), ("favourited", true), ("in_library", true))));
            }
        }
        // Newest saved first, whatever order Spotify listed them in.
        return [.. since.OrderByDescending(x => x.At).Select(x => (object?)x.Album),
            .. fromList.OrderByDescending(a => NumOr(((JsObj)a!)["kept_at"], 0))];
    }

    /* The cover the library keeps of album [id], as its walls show it: the server's own address of it. */
    private static string CoverOf(Snapshot? library, long id, string? artHash)
    {
        var key = library != null && library.ById.TryGetValue(id, out var al) ? al.ImageKey : $"al-{id}-{artHash ?? "0"}";
        return "/api/image/" + Uri.EscapeDataString(key) + "?size=640";
    }
}
