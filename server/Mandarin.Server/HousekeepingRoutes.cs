// HousekeepingRoutes.cs — the library's housekeeping (v0.8.48, stage 5 part 2
// of docs/specs/csharp-migration.md), from lib/server/api-library.js, in the
// same shapes and words, once the scans are made here (Scans.cs):
//
//   GET  /api/status            the library's part from here (the scan's state, the
//                               music folders, the count, the data folder kept or not),
//                               the rooms' part as the Node server says it with its state
//   GET  /api/library/cleanup   what Clean up could remove: the albums whose files are
//                               gone, and each service's (Services/Rows.cs)
//   POST /api/library/cleanup   { kind: "files" }: the missing folders' albums removed,
//                               their edits, hearts and Listen later with them; a
//                               service's kind stays ServiceRoutes.cs's
//   GET  /api/display/content   the wall display's: the zone's track asked of the Node
//                               server (POST /internal/playback/now), the artist's photos
//                               (MusicBrainz, then FanArt.tv, kept a week), the album's
//                               write-up, the artists' stories and more by the artist
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mandarin.Server.Extras;
using Mandarin.Server.Identify;
using Mandarin.Server.Playback;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private static readonly string[] ServiceIds = ["qobuz", "tidal"];
    private static readonly string[] AlbumMarkTables = ["album_edits", "favourites", "listen_later", "track_edits"];
    private const double SevenDays = 7.0 * 86400000;

    /* The housekeeping routes: true when answered here. */
    private static async Task<bool> HousekeepingRoute(HttpContext ctx)
    {
        var m = ctx.Request.Method;
        var p = ctx.Request.Path.Value ?? "";
        bool get = HttpMethods.IsGet(m) || HttpMethods.IsHead(m), post = HttpMethods.IsPost(m);
        try
        {
            if (get && p == "/api/display/content") return await DisplayContent(ctx);
            if (!Scans.On) return false;
            return get && p == "/api/status" ? await Status(ctx)
                : get && p == "/api/library/cleanup" ? await CleanUpCounts(ctx)
                : post && p == "/api/library/cleanup" && await CleanUpFiles(ctx);
        }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            // As the Node server's wrap() answers what throws.
            Server.Log($"[library] {p}: {e.GetType().Name}: {e.Message}");
            return await JsError(ctx, 500, e.Message);
        }
    }

    // ------------------------------------------------------------------ /api/status

    [GeneratedRegex(@"/volumes/[0-9a-f]{64}/_data$")] private static partial Regex DockerVolume();

    /*
     * db.persistent (lib/library/db.js onOwnMount): in Docker, whether the data
     * folder is a named volume (false: the library goes with the container);
     * null where it can't be told, and outside Docker.
     */
    private static bool? DataPersistent()
    {
        if (Environment.GetEnvironmentVariable("DOCKER") != "1") return null;
        try
        {
            var real = PosixFs.RealPathOf(Scans.DataDir) ?? throw new IOException("no such folder");
            var line = File.ReadAllText("/proc/self/mountinfo").Split('\n').FirstOrDefault(l => (l.Split(' ').ElementAtOrDefault(4) ?? "") == real);
            if (line == null) return false;
            return !DockerVolume().IsMatch(line.Split(' ').ElementAtOrDefault(3) ?? "");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    private static async Task<bool> Status(HttpContext ctx)
    {
        if (await Current() is not var (s, st)) return false;
        // The rooms' part, the hub's (v0.8.49).
        if (Playback.Hub.Current is not { } hub) return false;
        JsonNode zones; JsonObject sonos;
        using (var c = Db.Open()) zones = hub.Zones().Count(z => PlaybackRoutes.Shown(c, z));
        sonos = new JsonObject { ["rooms"] = hub.RoomCount, ["discovered"] = hub.Discovered, ["searching"] = hub.Searching, ["error"] = hub.LastError };
        var away = Auth.IsAway(ctx);
        var state = Scans.State;
        var roots = Scans.Roots();
        return await Send(ctx, new JsonObject
        {
            ["away"] = away,
            ["paired"] = true,
            ["core_id"] = "musicd-server",
            ["core_name"] = "Mandarin",
            ["zone_count"] = away ? 0 : zones,
            ["library_importing"] = Js.Truthy(state["running"]),
            ["library_recheck_pending"] = false,
            ["index_built_at"] = st.BuiltAt is { } built ? built : null,
            ["index_count"] = s.Count,
            ["sonos"] = sonos,
            ["music_dir"] = Scans.MusicDir,
            ["music_dir_exists"] = roots.Any(PosixFs.Exists),
            ["music_dirs"] = new JsonArray(roots.Select(r => (JsonNode)r).ToArray()),
            ["data_persistent"] = DataPersistent() is { } kept ? kept : null,
            ["scan"] = new JsonObject
            {
                ["running"] = Js.Truthy(state["running"]),
                ["progress"] = state["progress"]?.DeepClone(),
                ["files_seen"] = state["files"]?.DeepClone(),
                ["last"] = state["lastResult"]?.DeepClone()
            },
            ["version"] = AppVersion,
            ["server"] = true
        });
    }

    // ------------------------------------------------------------------ Clean up

    /* staleFiles: the folders the last scan kept as missing, the tracks under them, and the albums every track of which is. */
    private sealed record StaleFiles(List<string> Dirs, List<long> Albums, int Tracks);

    private static StaleFiles StaleFilesNow()
    {
        var last = Scans.State["lastResult"] as JsonObject;
        var dirs = (last?["offline_dirs"] as JsonArray ?? []).Select(d => NodePath.Resolve(Js.Str(d?["dir"]))).ToList();
        if (dirs.Count == 0) return new([], [], 0);
        bool Under(string p) => dirs.Any(d => p == d || p.StartsWith(d + "/", StringComparison.Ordinal));
        using var c = Db.Open();
        var rows = Rows(c, "SELECT id, album_id, path FROM tracks").Where(r => r[2] is string p && !p.Contains("://") && Under(p)).ToList();
        var byAlbum = new Dictionary<long, int>();
        var order = new List<long>();
        foreach (var r in rows)
        {
            var id = (long)r[1]!;
            if (byAlbum.TryGetValue(id, out var n)) byAlbum[id] = n + 1; else { byAlbum[id] = 1; order.Add(id); }
        }
        var albums = new List<long>();
        foreach (var id in order)
        {
            var total = (long)Rows(c, "SELECT COUNT(*) AS n FROM tracks WHERE album_id = $1", id)[0][0]!;
            if (byAlbum[id] == total) albums.Add(id);
        }
        return new(dirs, albums, rows.Count);
    }

    private static Task<bool> CleanUpCounts(HttpContext ctx)
    {
        var f = StaleFilesNow();
        var o = new JsonObject { ["files"] = new JsonObject { ["albums"] = f.Albums.Count, ["tracks"] = f.Tracks, ["folders"] = f.Dirs.Count } };
        foreach (var id in ServiceIds)
        {
            var svc = CatalogueOf(id);
            o[id] = new JsonObject { ["albums"] = svc?.Stale() ?? 0, ["signed_in"] = svc?.Connected() ?? false };
        }
        return Send(ctx, o);
    }

    /* POST /api/library/cleanup { kind }: the music folders' kind here; a service's is ServiceRoutes.cs's (the body put back for it). */
    private static async Task<bool> CleanUpFiles(HttpContext ctx)
    {
        if (!BodyFits(ctx)) return false;
        var (ok, b) = await ServiceBody(ctx);
        if (!ok) return false;
        var kind = Prop(b, "kind");
        if (Scans.Running) return await JsError(ctx, 409, ScanUnderWay);
        if (kind is string k && ServiceIds.Contains(k)) return false;
        if (!TJs.StrictEq(kind, "files")) return await JsError(ctx, 400, "kind must be files, " + string.Join(" or ", ServiceIds));
        if (await Current() is not var (s, _)) return false;
        var f = StaleFilesNow();
        var keys = f.Albums.Select(id => s.Find(id)?.Key).Where(key => !string.IsNullOrEmpty(key)).ToList();
        var removed = 0;
        var made = Scans.WhileNoScan(() =>
        {
            using var db = Scans.OpenDb();
            var sc = Scans.Scanner(db);
            foreach (var d in f.Dirs) removed += sc.RemoveUnder(d);
            using var tx = db.BeginTransaction();
            foreach (var key in keys) foreach (var t in AlbumMarkTables) Exec(db, tx, $"DELETE FROM {t} WHERE key = $a", ("$a", key!));
            tx.Commit();
        });
        if (!made) return await JsError(ctx, 409, ScanUnderWay);
        var count = await Scans.Changed(cleaned: true);
        return await Send(ctx, new JsonObject { ["ok"] = true, ["kind"] = "files", ["removed"] = removed, ["albums"] = f.Albums.Count, ["count"] = count ?? await CountNow() });
    }

    // ------------------------------------------------------------------ the wall display

    /*
     * artistPhotos(name): FanArt.tv's pictures of the act (four at most), the
     * act found on MusicBrainz by name; kept a week, a miss too. Nothing
     * without a FanArt.tv key (Settings → Record labels).
     */
    private static async Task<List<object?>> ArtistPhotos(string name)
    {
        var key = LabelLogos.FanartKey();
        if (key.Length == 0 || name.Length == 0) return [];
        var ck = Names.Fold(name);
        if (Taste.CacheGet("fanart", ck, SevenDays) is List<object?> hit) return hit;
        var photos = new List<object?>();
        try
        {
            if (Jobs.Mb is { } mb && await mb.Get("artist/", ("query", $"artist:\"{name.Replace("\"", "")}\""), ("limit", 5)) is JsObj found)
            {
                var act = (found["artists"] as List<object?> ?? []).OfType<JsObj>().FirstOrDefault(x => WriteUps.NamesEqualLoose(x["name"], name));
                if (act != null && TJs.Truthy(act["id"]))
                {
                    var j = await Lookups.Json($"{Jobs.FanartBase}/v3/music/{Lookups.Encode(TJs.Str(act["id"]))}?api_key={Lookups.Encode(key)}", [], 15000);
                    var all = new List<object?>();
                    foreach (var k in new[] { "artistbackground", "artistthumb" })
                    {
                        var v = Jv.Get(j, k);
                        if (v is List<object?> l) all.AddRange(l); else if (TJs.Truthy(v)) all.Add(v);
                    }
                    photos = all.Select(x => TJs.Truthy(x) ? Jv.Get(x, "url") : x).Where(TJs.Truthy).Take(4).ToList();
                }
            }
        }
        catch (Exception) { photos = []; }
        Taste.CachePut("fanart", ck, photos);
        return photos;
    }

    private static async Task<bool> DisplayContent(HttpContext ctx)
    {
        if (HeldWriteUps is not { } w) return false;
        if (await Current() is not var (s, _)) return false;
        bool on;
        using (var c = Db.Open()) on = Db.Setting(c, "displayEnabled") is { } v ? Js.Truthy(v) : true;
        if (!on) return await JsError(ctx, 403, "Wall display is turned off in Settings");
        // The zone's track, the hub's (v0.8.49).
        if (Playback.Hub.Current is not { } hub) return false;
        var zs = hub.Zone(Q(ctx, "zone") ?? "")?.State;
        var now = new JsonObject { ["state"] = zs == null ? null : new JsonObject { ["title"] = zs.Title, ["trackId"] = zs.TrackId, ["artist"] = zs.Artist, ["album"] = zs.Album } };
        if (now["state"] is not JsonObject st || (!Js.Truthy(st["title"]) && !Js.Truthy(st["trackId"])))
            return await SendJs(ctx, Jv.Obj(("artistPhotos", new List<object?>()), ("review", null), ("video", null)));
        (long AlbumId, string Artist)? t = null;
        if (st["trackId"] is JsonValue tv && tv.TryGetValue<double>(out var trackId) && Js.Truthy(st["trackId"]))
        {
            using var c = Db.Open();
            if (Rows(c, "SELECT album_id, artist FROM tracks WHERE id = $1", trackId == Math.Floor(trackId) ? (long)trackId : trackId).FirstOrDefault() is { } r)
                t = ((long)r[0]!, r[1] as string ?? "");
        }
        var al = t is { } tt ? s.Find(tt.AlbumId) : null;
        var artist = al is { Artist.Length: > 0 } ? al.Artist : t is { Artist.Length: > 0 } ? t.Value.Artist : Js.Truthy(st["artist"]) ? Js.Str(st["artist"]) : "";
        var album = al is { Title.Length: > 0 } ? al.Title : Js.Truthy(st["album"]) ? Js.Str(st["album"]) : "";
        var primary = ShareLinks.PrimaryArtist(artist);
        var photosTask = ArtistPhotos(primary);
        var extrasTask = album.Length > 0 ? AlbumExtrasOf(w, album, artist) : null;
        var photos = await photosTask;
        JsObj? ex = null;
        if (extrasTask != null) { try { ex = await extrasTask; } catch (Exception) { ex = null; } }
        var bios = ex?["bios"];
        var albumBio = TJs.Truthy(bios) ? Field(bios, "album") : null;
        object? review = null;
        if (TJs.Truthy(albumBio) && TJs.Truthy(Field(albumBio, "description")))
            review = Jv.Obj(("text", Field(albumBio, "description")),
                ("attribution", "About this album — " + TJs.Str(Jv.Or(Field(albumBio, "description_source"), Jv.Or(Field(albumBio, "source"), "")))));
        var names = al is { Compilation: true }
            ? (t is { Artist.Length: > 0 } ? [t.Value.Artist] : new List<string>())
            : Names.SplitArtists(artist).Take(4).ToList();
        var bioList = new List<object?>();
        foreach (var n in names)
        {
            var bio = await ArtistBioOf(w, n, album);
            if (!TJs.Truthy(bio) || !TJs.Truthy(Field(bio, "description"))) continue;
            var nm = TJs.Truthy(Field(bio, "name")) ? Field(bio, "name") : n;
            bioList.Add(Jv.Obj(("name", nm), ("text", Field(bio, "description")),
                ("attribution", "About " + TJs.Str(nm) + " — " + TJs.Str(Jv.Or(Field(bio, "source"), "Wikipedia")))));
        }
        var more = ArtistAlbumsOf(s, primary).Primary.Where(a => al == null || a.Id != al.Id).Take(12).ToList();
        var o = Jv.Obj(
            ("artistPhotos", photos), ("review", review),
            ("bio", bioList.Count > 0 ? bioList[0] : null), ("bios", bioList),
            ("moreAlbums", Jv.Obj(
                ("artist", more.Count >= 3 ? Jv.Obj(("name", primary), ("albums", more.Select(a => FromNode(AlbumJson(s, a))).ToList())) : null),
                ("label", null))));
        return await SendJs(ctx, o);
    }
}
