// AlbumEditRoutes.cs — an album's corrections (v0.8.22): the album edit routes
// of lib/server/api-library.js with library.saveEdit and clearEdits, rule for
// rule.
//
// The music folders are mounted read-only, so corrections are kept in the
// database (album_edits) and laid over what the scan found: a title, an
// artist, a year, and a cover found on the web — downloaded here, turned
// upright, brought to 1500 pixels at most and laid on black with ffmpeg, as
// sharp does it there. The Node server is told of each change (its copy read
// again, and the edits kept beside the database too, album-edits.json), and
// the sizes drawn for the album's old cover go.
//
// A cover in a form only sharp reads (Covers.cs) is left to the Node server:
// the request is passed to it as it came.
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;
using Mandarin.Server.Identify;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private const string BrowserUa = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private static readonly HttpClient ArtWeb = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = true, MaxAutomaticRedirections = 20,
        AutomaticDecompression = System.Net.DecompressionMethods.All,
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30)
    }) { Timeout = Timeout.InfiniteTimeSpan };
    // A search kept ten minutes after it ends: the editor opened again asks again.
    private static readonly ConcurrentDictionary<string, Lazy<Task<JsObj>>> ArtSearches = new();

    private static Task<bool> NoAlbum(HttpContext ctx) => Send(ctx, new JsonObject { ["error"] = "That album is no longer in the library" }, 404);

    /*
     * Where the album's files are, as you'd find them (v0.6.3): the folder its
     * tracks share, from the music folder's own name down.
     */
    private static string? AlbumFolder(Album al, LibState st)
    {
        var dirs = new List<string>();
        using (var c = Db.Open())
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT path FROM tracks WHERE album_id = $id ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path";
            cmd.Parameters.AddWithValue("$id", al.Id);
            using var r = cmd.ExecuteReader();
            while (r.Read()) if (r.GetValue(0) is string p && p.Length > 0) dirs.Add(NodePath.Dirname(p));
        }
        if (dirs.Count == 0) return string.IsNullOrEmpty(al.Dir) ? null : al.Dir;
        var common = dirs[0].Split('/').ToList();
        foreach (var d in dirs.Skip(1))
        {
            var parts = d.Split('/');
            int i = 0;
            while (i < common.Count && i < parts.Length && common[i] == parts[i]) i++;
            common = common.Take(i).ToList();
        }
        var dir = string.Join("/", common);
        if (dir.Length == 0) dir = "/";
        var root = st.Roots.FirstOrDefault(r => dir == r || dir.StartsWith(r.EndsWith('/') ? r : r + "/", StringComparison.Ordinal));
        return root != null ? NodePath.Join(NodePath.Basename(root), NodePath.Relative(root, dir)) : dir;
    }

    private static async Task<JsonObject> EditState(Album al, LibState st)
    {
        var folder = AlbumFolder(al, st);
        var own = await Covers.HasOwn(al);
        return new JsonObject
        {
            ["offset"] = al.Id,
            ["folder"] = folder,
            ["box"] = al.Box != null ? new JsonObject { ["name"] = al.Box.Name, ["disc"] = al.Box.Disc, ["of"] = al.Box.Of } : null,
            ["title"] = al.Title, ["artist"] = al.Artist, ["year"] = al.Year,
            ["scanned"] = new JsonObject { ["title"] = al.ScannedTitle, ["artist"] = al.ScannedArtist, ["year"] = al.ScannedYear },
            ["edited"] = al.Edited,
            ["image_key"] = al.ImageKey,
            ["art"] = new JsonObject { ["own"] = own, ["found"] = al.CustomArt, ["source"] = al.ArtSource }
        };
    }

    /* GET /api/album/edit?offset= : the editor's view of an album. */
    private static async Task<bool> AlbumEditState(HttpContext ctx, Snapshot s, LibState st)
    {
        // Whether its tracks carry a picture is read with ffprobe: without it, the Node server's.
        if (!Covers.ProbeOk) return false;
        var al = s.Find(Num(Q(ctx, "offset")));
        if (al == null) return await NoAlbum(ctx);
        return await Send(ctx, await EditState(al, st));
    }

    /* GET /api/album/art-search?offset= : covers found on the web, best first (Extras/ArtFind.cs). */
    private static async Task<bool> AlbumArtSearch(HttpContext ctx, Snapshot s, LibState st)
    {
        var al = s.Find(Num(Q(ctx, "offset")));
        if (al == null) return await NoAlbum(ctx);
        // Searched by the scanned names too when they differ: a corrected title
        // is usually the better query, but the tags are what's on the files.
        var key = al.Id + "|" + al.Title + "|" + al.Artist;
        List<object?> titles;
        using (var c = Db.Open()) titles = Tracks(c, s, al).Select(t => (object?)t.Title).ToList();
        var search = ArtSearches.GetOrAdd(key, k => new Lazy<Task<JsObj>>(() =>
        {
            var job = ArtFind.Find(al.Title, al.Artist, titles, ArtFind.Web($"Mandarin/{AppVersion} ( https://github.com/meltface-80/Mandarin )"), Front.Log);
            _ = job.ContinueWith(async _ => { await Task.Delay(TimeSpan.FromMinutes(10)); ArtSearches.TryRemove(k, out var _); }, TaskScheduler.Default);
            return job;
        }));
        return await SendJs(ctx, await search.Value);
    }

    // ------------------------------------------------------------- the edits

    private sealed class EditFields
    {
        public bool HasTitle, HasArtist, HasYear, HasArt;
        public object? Title, Artist, Year;
        public byte[]? Art;
        public string? ArtSource;
    }

    /*
     * library.saveEdit: corrections laid over an album. Title, artist and year
     * (an empty one puts back what was scanned), and a cover with its source,
     * or none to drop a found one. Nothing left to lay over: the row goes.
     */
    private static void SaveEdit(Album al, EditFields f)
    {
        using var c = Db.Open();
        string? title = null, artist = null, artHash = null, artSource = null;
        object? year = null;
        byte[]? art = null;
        using (var cur = c.CreateCommand())
        {
            cur.CommandText = "SELECT title, artist, year, art, art_hash, art_source FROM album_edits WHERE key = $k";
            cur.Parameters.AddWithValue("$k", al.Key);
            using var r = cur.ExecuteReader();
            if (r.Read())
            {
                title = Text(r.GetValue(0)); artist = Text(r.GetValue(1));
                year = r.GetValue(2) switch { long l when l != 0 => l, double d when d != 0 && !double.IsNaN(d) => d, string s when s.Length > 0 => s, _ => null };
                art = r.GetValue(3) as byte[];
                artHash = Text(r.GetValue(4)); artSource = Text(r.GetValue(5));
            }
        }
        static string? AsText(object? v, string scanned)
        {
            var t = TJs.Trim(TJs.IsNullish(v) ? "" : TJs.Str(v));
            return t.Length > 0 && t != scanned ? t : null;
        }
        if (f.HasTitle) title = AsText(f.Title, al.ScannedTitle);
        if (f.HasArtist) artist = AsText(f.Artist, al.ScannedArtist);
        if (f.HasYear)
        {
            var y = TJs.ParseInt(f.Year);
            year = y >= 1000 && y <= 2999 && (al.ScannedYear == null || y != al.ScannedYear.Value) ? (long)y : null;
        }
        if (f.HasArt)
        {
            art = f.Art;
            artHash = f.Art != null ? Convert.ToHexStringLower(SHA1.HashData(f.Art))[..12] : null;
            artSource = f.Art != null && !string.IsNullOrEmpty(f.ArtSource) ? f.ArtSource : null;
        }
        using var w = c.CreateCommand();
        w.Parameters.AddWithValue("$key", al.Key);
        if (title == null && artist == null && year == null && art == null)
            w.CommandText = "DELETE FROM album_edits WHERE key = $key";
        else
        {
            w.CommandText = @"INSERT INTO album_edits(key, title, artist, year, art, art_hash, art_source, updated_at)
                              VALUES($key, $title, $artist, $year, $art, $art_hash, $art_source, $updated_at)
                              ON CONFLICT(key) DO UPDATE SET title=excluded.title, artist=excluded.artist, year=excluded.year,
                                art=excluded.art, art_hash=excluded.art_hash, art_source=excluded.art_source,
                                updated_at=excluded.updated_at";
            w.Parameters.AddWithValue("$title", (object?)title ?? DBNull.Value);
            w.Parameters.AddWithValue("$artist", (object?)artist ?? DBNull.Value);
            w.Parameters.AddWithValue("$year", year ?? DBNull.Value);
            w.Parameters.Add("$art", SqliteType.Blob).Value = (object?)art ?? DBNull.Value;
            w.Parameters.AddWithValue("$art_hash", (object?)artHash ?? DBNull.Value);
            w.Parameters.AddWithValue("$art_source", (object?)artSource ?? DBNull.Value);
            w.Parameters.AddWithValue("$updated_at", NowMs());
        }
        w.ExecuteNonQuery();
    }

    /* After a change: the Node server told, the copy here read again, the old cover's sizes gone, and the editor's view with the album's. */
    private static async Task<bool> EditDone(HttpContext ctx, long id, string keyBefore)
    {
        await Tell(new JsonObject { ["edits"] = true });
        if (await Current() is not var (s, st)) return await JsError(ctx, 500, "The library couldn't be read again");
        var al = s.Find(id);
        if (al == null) return await JsError(ctx, 500, "Cannot read properties of null (reading 'image_key')");
        if (al.ImageKey != keyBefore) Covers.Forget(Images.ArtDir, al.Id, al.ImageKey);
        var o = await EditState(al, st);
        o["album"] = AlbumJson(s, al, new JsonObject { ["year"] = al.Year });
        return await Send(ctx, o);
    }

    /* POST /api/album/edit { offset, title?, artist?, year?, art_url?, art_source?, art? } */
    private static Task<bool> SaveAlbumEdit(HttpContext ctx, Snapshot s, LibState st) =>
        !BodyFits(ctx) || !Covers.ProbeOk ? Task.FromResult(false) : SaveAlbumEditRead(ctx, s, st);
    private static async Task<bool> SaveAlbumEditRead(HttpContext ctx, Snapshot s, LibState st)
    {
        // Kept, so the request can still go on as it came (a cover only sharp reads).
        ctx.Request.EnableBuffering();
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
        bool PassOn() { ctx.Request.Body.Position = 0; return false; }

        var al = s.Find(TJs.ToNumber(Prop(b, "offset")));
        if (al == null) return await NoAlbum(ctx);
        var f = new EditFields();
        if (b is JsObj o)
        {
            if (f.HasTitle = o.Has("title")) f.Title = o["title"];
            if (f.HasArtist = o.Has("artist")) f.Artist = o["artist"];
            if (f.HasYear = o.Has("year")) f.Year = o["year"];
        }
        var artUrl = Prop(b, "art_url");
        if (TJs.Truthy(artUrl))
        {
            var url = TJs.Trim(TJs.Str(artUrl));
            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return await JsError(ctx, 400, "That isn't a web address");
            byte[]? got;
            try
            {
                var (buf, error, pass) = await FetchArt(url);
                if (pass) return PassOn();
                if (error != null) return await JsError(ctx, 502, "Couldn't download that image (" + error + ")");
                var turn = Covers.Look(buf!);
                if (turn == null) return Covers.LooksLikeImage(buf!) ? PassOn() : await JsError(ctx, 422, "That address isn't an image");
                got = await Covers.Normalise(buf!, turn);
                if (got == null) return PassOn();
            }
            catch (Exception e) when (!ctx.Response.HasStarted)
            {
                Front.Log($"[library] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}; passed to the Node server");
                return PassOn();
            }
            var src = TJs.Str(TJs.Truthy(Prop(b, "art_source")) ? Prop(b, "art_source") : artUrl);
            f.HasArt = true;
            f.Art = got;
            f.ArtSource = src.Length > 500 ? src[..500] : src;
        }
        else if (Prop(b, "art") is null or "remove")
        {
            f.HasArt = true;
        }
        return await AfterBody(ctx, async () =>
        {
            var keyBefore = al.ImageKey;
            SaveEdit(al, f);
            return await EditDone(ctx, al.Id, keyBefore);
        });
    }

    /* POST /api/album/edit/reset { offset }: every correction dropped (library.clearEdits). */
    private static Task<bool> ResetAlbumEdit(HttpContext ctx, Snapshot s, LibState st) =>
        !BodyFits(ctx) || !Covers.ProbeOk ? Task.FromResult(false) : ResetAlbumEditRead(ctx, s);
    private static async Task<bool> ResetAlbumEditRead(HttpContext ctx, Snapshot s)
    {
        var (b, answered) = await JsBody(ctx);
        if (answered) return true;
        var al = s.Find(TJs.ToNumber(Prop(b, "offset")));
        if (al == null) return await NoAlbum(ctx);
        return await AfterBody(ctx, async () =>
        {
            var keyBefore = al.ImageKey;
            using (var c = Db.Open())
            using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "DELETE FROM album_edits WHERE key = $k";
                cmd.Parameters.AddWithValue("$k", al.Key);
                cmd.ExecuteNonQuery();
            }
            return await EditDone(ctx, al.Id, keyBefore);
        });
    }

    /*
     * Artwork.download's fetch: the picture, or why not in the Node server's
     * words; or that it's the Node server's to try (an address a browser's
     * parser might read otherwise, a redirect not followed here, a very big
     * one).
     */
    private static async Task<(byte[]? Buf, string? Error, bool PassOn)> FetchArt(string url)
    {
        if (!url.All(ch => ch > 0x20 && ch < 0x7F && ch != '\\') || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            return (null, null, true);
        try { Lookups.Allowed(url); }
        catch (LookupError e) { return (null, e.Message, false); }
        using var cts = new CancellationTokenSource(15000);
        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        // Some image hosts turn away a request that doesn't look like a browser's.
        req.Headers.TryAddWithoutValidation("User-Agent", BrowserUa);
        req.Headers.TryAddWithoutValidation("Accept", "image/*,*/*;q=0.8");
        try
        {
            using var res = await ArtWeb.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            var code = (int)res.StatusCode;
            if (code is >= 300 and < 400) return (null, null, true);
            if (!res.IsSuccessStatusCode) return (null, "HTTP " + code, false);
            if (res.Content.Headers.ContentLength is long len && len > 25 * 1024 * 1024) return (null, "too large", false);
            await using var body = await res.Content.ReadAsStreamAsync(cts.Token);
            using var ms = new MemoryStream();
            var buf = new byte[81920];
            int n;
            while ((n = await body.ReadAsync(buf, cts.Token)) > 0)
            {
                ms.Write(buf, 0, n);
                if (ms.Length > 64L << 20) return (null, null, true);
            }
            return (ms.ToArray(), null, false);
        }
        catch (OperationCanceledException) { return (null, "timed out", false); }
        catch (HttpRequestException) { return (null, "fetch failed", false); }
        catch (IOException) { return (null, "terminated", false); }
    }
}
