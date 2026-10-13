// LibraryRoutes.Kept.cs — the library's lists kept once made (v0.9.3, the
// audit's P1, docs/specs/audit-b4-main.md). A list made from the library's
// copy alone (the wall and its facets, the Shelf, the artists and an
// artist's albums, genres and decades, hearts and Listen later) was made,
// written out and hashed for its ETag every time it was asked for, even when
// the page's copy was current and the answer a 304: the Shelf, every album in
// the library, each time the Shelf opened. Each is now kept, its bytes and
// its tag, by its address (path and query), for the copy it was made from and
// the hearts it shows. Asked again, it is sent as kept (a 304 for a copy still
// current), nothing made. A new copy (a scan, an edit) or a heart changed
// leaves it behind, and while the library is being built every list is made
// as before (each says so). At most 64 are kept.
using System.Collections.Concurrent;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The routes whose answer is the copy's and the query's alone. */
    private static readonly HashSet<string> Keepable = new(StringComparer.Ordinal)
    {
        "/api/library/albums", "/api/library/facets", "/api/shelf/albums", "/api/artists", "/api/artist-albums",
        "/api/filters/genres", "/api/filters/decades", "/api/home/genre-groups", "/api/favourites", "/api/listen-later",
    };
    private const int KeptMost = 64;

    private sealed record KeptAnswer(Snapshot Of, long Marks, byte[] Bytes, string Tag);
    private sealed record KeepFor(string Key, Snapshot Of, long Marks);
    private static readonly ConcurrentDictionary<string, KeptAnswer> Kept = new(StringComparer.Ordinal);
    private static readonly object KeepAsk = new();

    /*
     * Before a route makes its answer: one kept for this address, this copy and
     * these hearts is sent (true), marked X-Mandarin-Kept; otherwise the
     * request is marked for its answer to be kept.
     */
    private static async Task<bool> SendKept(HttpContext ctx, string path, Snapshot s, LibState st)
    {
        if (st.Building || !Keepable.Contains(path) || !(HttpMethods.IsGet(ctx.Request.Method) || HttpMethods.IsHead(ctx.Request.Method))) return false;
        var key = path + ctx.Request.QueryString.Value;
        var marks = s.Marks.N;
        if (Kept.TryGetValue(key, out var k) && ReferenceEquals(k.Of, s) && k.Marks == marks)
        {
            ctx.Response.Headers["X-Mandarin-Kept"] = "1";
            return await Http.Send(ctx, k.Bytes, Http.JsonType, 200, k.Tag);
        }
        ctx.Items[KeepAsk] = new KeepFor(key, s, marks);
        return false;
    }

    /* An answer sent: kept, when its request was marked for it and it is a 200. Those of an older copy go. */
    private static void Keep(HttpContext ctx, byte[] bytes, string tag, int status)
    {
        if (status != 200 || !ctx.Items.TryGetValue(KeepAsk, out var ask) || ask is not KeepFor f) return;
        foreach (var (key, old) in Kept)
            if (!ReferenceEquals(old.Of, f.Of)) Kept.TryRemove(key, out _);
        if (Kept.Count >= KeptMost) Kept.Clear();
        Kept[f.Key] = new KeptAnswer(f.Of, f.Marks, bytes, tag);
    }
}
