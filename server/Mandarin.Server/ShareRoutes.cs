// ShareRoutes.cs — sharing a playlist as text (v0.8.21), from
// lib/server/api-playlists.js: /api/share/encode makes the MDRP1 blob from the
// tracks the page sends, /api/share/import reads one back and finds each track
// in the library by its own names — the album and artist first, then the same
// title by that artist on any album, reported as a substitution. The blob
// itself is Extras/ShareBlob.cs.
//
// The body is read as the Node server's express.json() reads it, into
// JavaScript's shapes (a lone surrogate in a title survives, as it does
// there); one past that parser's 2 MB, or of no stated length, is passed on
// unread for the Node server to refuse.
using System.Text;
using Mandarin.Server.Extras;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static partial class Library
{
    private const long JsonLimit = 2 * 1024 * 1024;   // express.json({ limit: "2mb" })
    private static readonly string AppVersion = (typeof(Library).Assembly.GetName().Version ?? new Version(0, 0, 0)).ToString(3);

    private static bool IsJsonBody(HttpContext ctx) => (ctx.Request.ContentType ?? "").Contains("json", StringComparison.OrdinalIgnoreCase);
    private static bool BodyFits(HttpContext ctx) => !IsJsonBody(ctx) || ctx.Request.ContentLength is long n && n <= JsonLimit;

    /* req.body: a JSON body as JSON.parse makes it (its byte-order mark dropped, empty as {}), {} for any other; Bad JSON a 400 (Answered). */
    private static async Task<(object? Body, bool Answered)> JsBody(HttpContext ctx)
    {
        if (!IsJsonBody(ctx)) return (new JsObj(), false);
        using var ms = new MemoryStream();
        await ctx.Request.Body.CopyToAsync(ms);
        var text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
        if (text.StartsWith('﻿')) text = text[1..];
        if (text.Length == 0) return (new JsObj(), false);
        // Strict, as the parser is: an object or an array, nothing else.
        var first = text.TrimStart(' ', '\t', '\n', '\r');
        try
        {
            if (first.Length == 0 || first[0] is not ('{' or '[')) throw new Tags.JsError("not an object");
            return (JsJson.Parse(text), false);
        }
        catch (Tags.JsError)
        {
            await JsError(ctx, 400, "Bad JSON");
            return (null, true);
        }
    }

    /* After the body is read the request can't be passed on (its body is gone): an error is answered here, a 500 as the Node server's would be. */
    private static async Task<bool> AfterBody(HttpContext ctx, Func<Task<bool>> work)
    {
        try { return await work(); }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            Front.Log($"[library] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}");
            return await JsError(ctx, 500, e.Message);
        }
    }

    /* x.k for a JSON value: an object's own field, else undefined. */
    private static object? Prop(object? o, string k) => o is JsObj j ? j[k] : Undef.V;

    private static Task<bool> ShareEncode(HttpContext ctx, Snapshot s, LibState st) => !BodyFits(ctx) ? Task.FromResult(false) : ShareEncodeRead(ctx);
    private static async Task<bool> ShareEncodeRead(HttpContext ctx)
    {
        var (b, answered) = await JsBody(ctx);
        return answered || await AfterBody(ctx, () => ShareEncodeBody(ctx, b));
    }
    private static async Task<bool> ShareEncodeBody(HttpContext ctx, object? b)
    {
        if (Prop(b, "tracks") is not List<object?> { Count: > 0 } tracks) return await JsError(ctx, 400, "tracks required");
        if (tracks.Count > ShareBlob.InputMax) return await JsError(ctx, 400, $"Too many entries — {ShareBlob.InputMax} at most");
        var built = ShareBlob.BuildDoc(Prop(b, "name"), Prop(b, "annotation"), tracks, ShareBlob.IsoNow(), AppVersion);
        if (built.TrackCount == 0) return await JsError(ctx, 400, "None of those tracks had a title to share");
        var blob = ShareBlob.Encode(built.Doc);
        var o = new JsObj();
        o["blob"] = blob;
        o["bytes"] = (double)Encoding.UTF8.GetByteCount(blob);
        o["track_count"] = (double)built.TrackCount;
        o["skipped"] = (double)built.Skipped;
        o["truncated"] = built.Truncated;
        return await SendJs(ctx, o);
    }

    private static Task<bool> ShareImport(HttpContext ctx, Snapshot s, LibState st) => !BodyFits(ctx) ? Task.FromResult(false) : ShareImportRead(ctx, s);
    private static async Task<bool> ShareImportRead(HttpContext ctx, Snapshot s)
    {
        var (b, answered) = await JsBody(ctx);
        return answered || await AfterBody(ctx, () => ShareImportBody(ctx, s, b));
    }
    private static async Task<bool> ShareImportBody(HttpContext ctx, Snapshot s, object? b)
    {
        if (Prop(b, "blob") is not string blob || TJs.Trim(blob).Length == 0) return await JsError(ctx, 400, "blob required");
        JsObj doc;
        try { doc = ShareBlob.Decode(blob); }
        catch (ShareBlob.Refused e) { return await JsError(ctx, 400, e.Message); }
        var playlist = (JsObj)doc["playlist"]!;
        var all = (List<object?>)playlist["track"]!;
        List<object?> resolved = [], missing = [], substituted = [];
        using (var c = Db.Open())
        {
            foreach (var e in all.Take(PlTracksMax))
            {
                if (ResolveShared(c, s, e) is { } f)
                {
                    resolved.Add(f.Track);
                    if (f.ViaAlbum) continue;
                    var x = new JsObj();
                    x["title"] = ShareBlob.Text(Prop(e, "title"), 200);
                    x["artist"] = ShareBlob.Text(Prop(e, "creator"), 200);
                    x["shared_album"] = ShareBlob.Text(Prop(e, "album"), 200);
                    x["found_album"] = f.Album.Title;
                    substituted.Add(x);
                }
                else
                {
                    var m = new JsObj();
                    m["title"] = ShareBlob.Text(Prop(e, "title"), 200);
                    m["artist"] = ShareBlob.Text(Prop(e, "creator"), 200);
                    m["album"] = ShareBlob.Text(Prop(e, "album"), 200);
                    missing.Add(m);
                }
            }
        }
        var o = new JsObj();
        o["ok"] = true;
        var name = ShareBlob.Text(playlist["title"], PlNameMax);
        o["name"] = name.Length > 0 ? name : "Shared playlist";
        o["total"] = (double)all.Count;
        o["truncated"] = all.Count > PlTracksMax;
        o["resolved"] = resolved;
        o["missing"] = missing;
        o["substituted"] = substituted;
        o["deep_available"] = false;
        return await SendJs(ctx, o);
    }

    /* A playlist entry as the page keeps it (recordFor), in JavaScript's shapes. */
    private static JsObj EntryJs(Album al, object? title, string artist, long? no, int index)
    {
        var o = new JsObj();
        o["album_offset"] = (double)al.Id;
        o["album_title"] = al.Title;
        o["album_subtitle"] = al.Artist;
        o["track_index"] = (double)index;
        o["title"] = title;
        o["subtitle"] = artist.Length > 0 ? artist : al.Artist;
        o["image_key"] = al.ImageKey;
        o["track_no"] = no is long n ? (double)n : null;
        return o;
    }

    /* A shared entry found by its own names: album and artist first, then that title by that artist on any album. */
    private static (JsObj Track, bool ViaAlbum, Album Album)? ResolveShared(SqliteConnection c, Snapshot s, object? e)
    {
        var title = ShareBlob.Text(Prop(e, "title"));
        if (title.Length == 0) return null;
        var album = ShareBlob.Text(Prop(e, "album"));
        var artist = ShareBlob.Text(Prop(e, "creator"));
        var want = Names.Fold(title);
        var al = album.Length > 0 ? Relocate(s, album, artist) ?? Relocate(s, album, null) : null;
        if (al != null)
        {
            var tracks = Tracks(c, s, al);
            var i = tracks.FindIndex(t => Names.Fold(t.Title) == want);
            if (i >= 0) return (EntryJs(al, tracks[i].Title, tracks[i].Artist, tracks[i].No, i), true, al);
        }
        // SQLite's lower() (ASCII only), as the Node server asks it; a track whose album isn't in the library passed over.
        const string sql = "SELECT * FROM tracks WHERE lower(title) = lower($1) LIMIT 20";
        var col = Columns(c, sql, title);
        object? F(object?[] r, string n) => col.TryGetValue(n, out var i) ? r[i] : null;
        var rows = Rows(c, sql, title).Where(r => F(r, "album_id") is long a && s.ById.ContainsKey(a)).ToList();
        var hit = artist.Length > 0 ? rows.FirstOrDefault(r => Names.Fold(F(r, "artist") as string ?? "") == Names.Fold(artist)) : rows.FirstOrDefault();
        if (hit == null) return null;
        var a2 = s.ById[(long)F(hit, "album_id")!];
        var id = F(hit, "id") as long?;
        var index = Tracks(c, s, a2).FindIndex(t => t.Id == id);
        var rawTitle = F(hit, "title") switch { long l => (double)l, double d => d, var v => v };
        return (EntryJs(a2, rawTitle, F(hit, "artist") as string ?? "", Long(F(hit, "track_no")), index), false, a2);
    }
}
