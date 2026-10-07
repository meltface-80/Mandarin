// PlaylistRoutes.cs — the playlists you make (v0.8.8), from
// lib/server/api-playlists.js, rule for rule: the list, one playlist, making,
// renaming and deleting one, and adding tracks or whole albums to one.
//
// They are kept as the Node server keeps them, in the setting userPlaylists,
// each entry naming an album and a track's place on it (MusicD Remote's own
// shape). A service's playlist (Qobuz, Tidal) shows only while signed in to the
// service with its import on, the sign-in being the service's setting with its
// token and user; hidden ones are kept as they are. Each change is one database
// transaction, so two saves never undo each other.
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Library
{
    private const int PlMax = 50, PlTracksMax = 500, PlAddMax = 200, PlAlbumAddMax = 30, PlNameMax = 60;

    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();

    /* share.js shareText: a string, its spaces collapsed, trimmed and cut to [max]. */
    private static string ShareText(JsonNode? v, int max = 500)
    {
        if (v is not JsonValue sv || !sv.TryGetValue<string>(out var s)) return "";
        s = Names.JsTrim(Spaces().Replace(s, " "));
        if (s.Length > max) s = s[..max];
        return Names.JsTrim(s);
    }
    /* share.js shareInt: parseInt within [min, max], or null. */
    private static long? ShareInt(JsonNode? v, long min, long max, bool present = true) =>
        PInt(present ? JsStr(v) : null) is long n && n >= min && n <= max ? n : null;
    private static long? ShareInt(JsonObject o, string key, long min, long max) => ShareInt(o[key], min, max, o.ContainsKey(key));

    // ------------------------------------------------------ which are shown

    private static string? ServiceOfPlaylist(JsonObject p)
    {
        if (Js.Truthy(p["service"])) return JsStr(p["service"]);
        if (Js.Truthy(p["qobuz"])) return "qobuz";
        return null;
    }
    private static bool Shown(SqliteConnection c, JsonObject p, Dictionary<string, bool> memo)
    {
        var s = ServiceOfPlaylist(p);
        if (s == null) return true;
        if (memo.TryGetValue(s, out var on)) return on;
        on = Services.Contains(s)
            && Setting(c, s, null) is JsonObject a && Js.Truthy(a["token"]) && Js.Truthy(a["user"])
            && Setting(c, s + "Settings", null) is JsonObject so && so["import"] is JsonValue iv && iv.TryGetValue<bool>(out var imp) && imp;
        return memo[s] = on;
    }
    private static List<JsonObject> AllPlaylists(SqliteConnection c) =>
        Setting(c, "userPlaylists", new JsonArray()) is JsonArray a
            ? a.OfType<JsonObject>().Where(p => Js.Truthy(p["id"]) && Js.Truthy(p["name"])).ToList() : [];
    private static List<JsonObject> LoadPlaylists(SqliteConnection c)
    {
        var memo = new Dictionary<string, bool>();
        return AllPlaylists(c).Where(p => Shown(c, p, memo)).ToList();
    }
    /* The shown ones as given (at most 50), then the hidden ones as they were. */
    private static void SavePlaylists(SqliteConnection c, List<JsonObject> list)
    {
        var memo = new Dictionary<string, bool>();
        var hidden = AllPlaylists(c).Where(p => !Shown(c, p, memo));
        SetSetting(c, "userPlaylists", new JsonArray(list.Take(PlMax).Concat(hidden).Select(p => (JsonNode)p.DeepClone()).ToArray()));
    }
    private static JsonArray TracksOf(JsonObject p) => p["tracks"] as JsonArray ?? [];

    private static JsonObject Summary(JsonObject p)
    {
        var keys = new List<string>();
        foreach (var t in TracksOf(p))
        {
            if (t is JsonObject to && Js.Truthy(to["image_key"]) && JsStr(to["image_key"]) is var k && !keys.Contains(k)) keys.Add(k);
            if (keys.Count == 4) break;
        }
        var s = ServiceOfPlaylist(p);
        return new JsonObject
        {
            ["id"] = p["id"]?.DeepClone(), ["name"] = p["name"]?.DeepClone(), ["track_total"] = TracksOf(p).Count,
            ["art_keys"] = new JsonArray(keys.Select(x => (JsonNode)x).ToArray()), ["updated_at"] = p["updated_at"]?.DeepClone(),
            ["service"] = p["service"] is { } sv && Js.Truthy(sv) ? sv.DeepClone() : s, ["qobuz"] = s == "qobuz"
        };
    }
    private static JsonArray Summaries(IEnumerable<JsonObject> list) => new(list.Select(p => (JsonNode)Summary(p)).ToArray());

    // ------------------------------------------------------ entries

    private static JsonObject? TrackRecord(JsonNode? tn)
    {
        if (tn is not JsonObject t) return null;
        var title = ShareText(t["title"]);
        var albumTitle = ShareText(t["album_title"]);
        var off = ShareInt(t, "album_offset", 0, 50000000);
        if (title.Length == 0 || albumTitle.Length == 0 || off == null) return null;
        var image = ShareText(t["image_key"], 200);
        return new JsonObject
        {
            ["album_offset"] = off, ["album_title"] = albumTitle, ["album_subtitle"] = ShareText(t["album_subtitle"]),
            ["track_index"] = ShareInt(t, "track_index", 0, 9999) is long ti && ti != 0 ? ti : 0, ["title"] = title,
            ["subtitle"] = ShareText(t["subtitle"]), ["image_key"] = image.Length > 0 ? image : null,
            ["track_no"] = ShareInt(t, "track_no", 1, 999)
        };
    }
    private static JsonObject RecordFor(Album al, TrackRow t, int index) => new()
    {
        ["album_offset"] = al.Id, ["album_title"] = al.Title, ["album_subtitle"] = al.Artist, ["track_index"] = index,
        ["title"] = t.Title, ["subtitle"] = t.Artist.Length > 0 ? t.Artist : al.Artist, ["image_key"] = al.ImageKey, ["track_no"] = t.No
    };

    /* library.relocate: an album by title and artist, as a speaker or a history row names it. */
    private static Album? Relocate(Snapshot s, string? title, string? artist)
    {
        static string Fold2(string? x) => Names.Fold(x) is { Length: > 0 } f ? f : Spaces().Replace(Names.JsTrim(x ?? "").ToLowerInvariant(), " ");
        var t = Fold2(title);
        if (t.Length == 0) return null;
        var a = Names.Fold(artist ?? "");
        Album? best = null;
        foreach (var al in s.Albums)
        {
            bool titled = Fold2(al.Title) == t || (al.Edited && Fold2(al.ScannedTitle) == t);
            if (!titled) continue;
            if (a.Length == 0 || al.NArtist == a || al.ArtistNames.Any(n => n.N == a) || (al.Edited && Names.Fold(al.ScannedArtist) == a)) return al;
            best ??= al;
        }
        return best;
    }

    /* An entry as the page sends it is kept as it is; one with less is completed from the library. */
    private static (JsonObject? Track, string? Reason) CompleteEntry(SqliteConnection c, Snapshot s, JsonNode? tn)
    {
        if (TrackRecord(tn) is { } one) return (one, null);
        // An array is an object to JavaScript: no album of its own, rather than not a track.
        if (tn is JsonArray) return (null, "album not in the library");
        if (tn is not JsonObject t) return (null, "not a track");
        var al = t.ContainsKey("album_offset") ? s.Find(JsNumber(t["album_offset"])) : null;
        if (al == null && ShareText(t["album_title"]) is { Length: > 0 } at)
            al = Relocate(s, at, ShareText(t["album_subtitle"]) is { Length: > 0 } sub ? sub : null);
        if (al == null) return (null, "album not in the library");
        var tracks = Tracks(c, s, al);
        var title = ShareText(t["title"]);
        var ti = t["track_index"] is JsonValue iv && iv.GetValueKind() == System.Text.Json.JsonValueKind.Number ? JsNumber(iv) : double.NaN;
        int i = ti == Math.Floor(ti) && Math.Abs(ti) < int.MaxValue ? (int)ti : -1;
        if (!(i >= 0 && i < tracks.Count) || (title.Length > 0 && Names.Fold(tracks[i].Title) != Names.Fold(title)))
            i = title.Length > 0 ? tracks.FindIndex(x => Names.Fold(x.Title) == Names.Fold(title)) : -1;
        if (i < 0) return (null, "track not on that album");
        return (RecordFor(al, tracks[i], i), null);
    }

    private static JsonObject Append(SqliteConnection c, Snapshot s, JsonObject p, IEnumerable<JsonNode?> incoming)
    {
        int added = 0, skipped = 0;
        bool full = false;
        var reasons = new List<(string Reason, int N)>();
        if (p["tracks"] is not JsonArray tracks) p["tracks"] = tracks = [];
        foreach (var t in incoming)
        {
            if (tracks.Count >= PlTracksMax) { full = true; break; }
            var r = CompleteEntry(c, s, t);
            if (r.Track != null) { tracks.Add(r.Track); added++; }
            else
            {
                skipped++;
                int k = reasons.FindIndex(x => x.Reason == r.Reason);
                if (k < 0) reasons.Add((r.Reason!, 1)); else reasons[k] = (r.Reason!, reasons[k].N + 1);
            }
        }
        p["updated_at"] = Now;
        var reason = string.Join(", ", Sorted(reasons, (a, b) => b.N - a.N).Select(x => $"{x.N} {x.Reason}"));
        return new JsonObject { ["added"] = added, ["skipped"] = skipped, ["full"] = full, ["reason"] = reason.Length > 0 ? reason : null };
    }

    private static string NewId() => Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant();

    /* The playlist a request names (id), or a new one (name). */
    private static (JsonObject? P, string? Error, int Status) Target(List<JsonObject> list, JsonObject body)
    {
        var id = ShareText(body["id"], 64);
        if (id.Length > 0)
        {
            var p = list.FirstOrDefault(x => x["id"] is JsonValue v && v.TryGetValue<string>(out var xs) && xs == id);
            return p != null ? (p, null, 200) : (null, "No such playlist", 404);
        }
        var name = ShareText(body["name"], PlNameMax);
        if (name.Length == 0) return (null, "id or name required", 400);
        if (list.Count >= PlMax) return (null, $"That's {PlMax} playlists — delete one first", 400);
        var made = new JsonObject { ["id"] = NewId(), ["name"] = name, ["tracks"] = new JsonArray(), ["created_at"] = Now, ["updated_at"] = Now };
        list.Add(made);
        return (made, null, 200);
    }

    // JavaScript's === between two JSON values (strings, numbers, booleans; never objects).
    private static bool Same(JsonNode? a, JsonNode? b) => a is JsonValue x && b is JsonValue y && x.GetValueKind() == y.GetValueKind() && x.ToJsonString() == y.ToJsonString();

    // ------------------------------------------------------ the routes

    private static Task<bool> UserPlaylists(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        return Send(ctx, new JsonObject { ["playlists"] = Summaries(LoadPlaylists(c)) });
    }

    private static Task<bool> UserPlaylist(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        var id = Q(ctx, "id") ?? "";
        var p = LoadPlaylists(c).FirstOrDefault(x => x["id"] is JsonValue v && v.TryGetValue<string>(out var xs) && xs == id);
        if (p == null) return Send(ctx, new JsonObject { ["error"] = "No such playlist" }, 404);
        return Send(ctx, new JsonObject { ["id"] = p["id"]?.DeepClone(), ["name"] = p["name"]?.DeepClone(), ["tracks"] = p["tracks"]?.DeepClone(), ["track_total"] = TracksOf(p).Count });
    }

    // One change at a time, as one transaction: read, change, write.
    private static readonly SemaphoreSlim Saving = new(1, 1);
    private static async Task<bool> Change(HttpContext ctx, Func<SqliteConnection, JsonObject, (JsonObject Body, int Status)> change)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        JsonObject outBody;
        int status;
        await Saving.WaitAsync();
        try
        {
            using var c = Db.Open();
            using var tx = c.BeginTransaction(System.Data.IsolationLevel.Serializable, deferred: false);
            (outBody, status) = change(c, b);
            tx.Commit();
        }
        finally { Saving.Release(); }
        return await Send(ctx, outBody, status);
    }
    private static (JsonObject, int) Fail(string error, int status) => (new JsonObject { ["error"] = error }, status);

    private static Task<bool> SavePlaylist(HttpContext ctx, Snapshot s, LibState st) => Change(ctx, (c, b) =>
    {
        var list = LoadPlaylists(c);
        var name = ShareText(b["name"], PlNameMax);
        if (name.Length == 0) return Fail("name required", 400);
        if (Js.Truthy(b["id"]))
        {
            var p = list.FirstOrDefault(x => Same(x["id"], b["id"]));
            if (p == null) return Fail("No such playlist", 404);
            p["name"] = name;
            p["updated_at"] = Now;
        }
        else
        {
            if (list.Count >= PlMax) return Fail($"That's {PlMax} playlists — delete one first", 400);
            list.Add(new JsonObject { ["id"] = NewId(), ["name"] = name, ["tracks"] = new JsonArray(), ["created_at"] = Now, ["updated_at"] = Now });
        }
        SavePlaylists(c, list);
        return (new JsonObject { ["ok"] = true, ["playlists"] = Summaries(list) }, 200);
    });

    private static Task<bool> DeletePlaylist(HttpContext ctx, Snapshot s, LibState st) => Change(ctx, (c, b) =>
    {
        var list = LoadPlaylists(c);
        var at = list.FindIndex(x => Same(x["id"], b["id"]));
        if (at == -1) return Fail("No such playlist", 404);
        list.RemoveAt(at);
        SavePlaylists(c, list);
        return (new JsonObject { ["ok"] = true, ["playlists"] = Summaries(list) }, 200);
    });

    private static Task<bool> AddToPlaylist(HttpContext ctx, Snapshot s, LibState st) => Change(ctx, (c, b) =>
    {
        var incoming = b["tracks"] as JsonArray ?? [];
        if (incoming.Count == 0) return Fail("tracks required", 400);
        if (incoming.Count > PlAddMax) return Fail($"Too many at once — {PlAddMax} maximum", 400);
        var list = LoadPlaylists(c);
        var (p, error, status) = Target(list, b);
        if (p == null) return Fail(error!, status);
        var r = Append(c, s, p, incoming.ToList());
        SavePlaylists(c, list);
        var o = new JsonObject { ["ok"] = true, ["id"] = p["id"]?.DeepClone(), ["name"] = p["name"]?.DeepClone(), ["track_total"] = TracksOf(p).Count };
        foreach (var (k, v) in r.ToList()) { r.Remove(k); o[k] = v; }
        return (o, 200);
    });

    private static Task<bool> AddAlbumsToPlaylist(HttpContext ctx, Snapshot s, LibState st) => Change(ctx, (c, b) =>
    {
        var albums = b["albums"] as JsonArray ?? [];
        if (albums.Count == 0) return Fail("albums required", 400);
        if (albums.Count > PlAlbumAddMax) return Fail($"Too many albums at once — {PlAlbumAddMax} maximum", 400);
        var list = LoadPlaylists(c);
        var (p, error, status) = Target(list, b);
        if (p == null) return Fail(error!, status);
        var tracks = new List<JsonNode?>();
        var failed = new JsonArray();
        foreach (var a in albums)
        {
            var ao = a as JsonObject;
            var al = ao != null && ao.ContainsKey("offset") ? s.Find(JsNumber(ao["offset"])) : null;
            if (al == null) { failed.Add(ao != null && Js.Truthy(ao["title"]) ? JsStr(ao["title"]) : "?"); continue; }
            var list2 = Tracks(c, s, al);
            for (int i = 0; i < list2.Count; i++) tracks.Add(RecordFor(al, list2[i], i));
        }
        var r = Append(c, s, p, tracks);
        SavePlaylists(c, list);
        var o = new JsonObject
        {
            ["ok"] = true, ["id"] = p["id"]?.DeepClone(), ["name"] = p["name"]?.DeepClone(),
            ["albums_read"] = albums.Count - failed.Count, ["albums_failed"] = failed, ["track_total"] = TracksOf(p).Count
        };
        foreach (var (k, v) in r.ToList()) { r.Remove(k); o[k] = v; }
        return (o, 200);
    });

    // Roon's own playlists: there is no second system to read them from.
    private static Task<bool> NoPlaylists(HttpContext ctx, Snapshot s, LibState st) => Send(ctx, new JsonObject { ["playlists"] = new JsonArray() });
    private static Task<bool> NoSuchPlaylist(HttpContext ctx, Snapshot s, LibState st) => Send(ctx, new JsonObject { ["error"] = "No such playlist" }, 404);
    private static Task<bool> NoPlaylistArt(HttpContext ctx, Snapshot s, LibState st)
    {
        ctx.Response.StatusCode = 404;
        ctx.Response.Headers["X-Mandarin-Answered"] = "C#";
        return Task.FromResult(true);
    }
}
