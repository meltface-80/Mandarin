// LibraryRoutes.Shared.cs — what the library's routes share: this program's version, a body read as the Node
// server's express.json() read it (Http.cs), into JavaScript's shapes (a lone surrogate in a title survives, as it
// did there), and an album found by its title and artist (library.relocate).
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    private static readonly string AppVersion = BuildVersion.Of(typeof(Library).Assembly);

    // Sent without a length (chunked), it fits until it's read past the limit (JsBody).
    private static bool BodyFits(HttpContext ctx) => Http.Fits(ctx);

    /* req.body: a JSON body as JSON.parse makes it (Http.ReadJs), {} for any other; one turned down answered (Answered). */
    private static async Task<(object? Body, bool Answered)> JsBody(HttpContext ctx)
    {
        var (b, read) = await Http.ReadJs(ctx);
        if (!read.Refused) return (b, false);
        await JsError(ctx, read.Status, read.Words);
        return (null, true);
    }

    /* After the body is read the request can't be passed on (its body is gone): an error is answered here, a 500 as the Node server's would be. */
    private static async Task<bool> AfterBody(HttpContext ctx, Func<Task<bool>> work)
    {
        try { return await work(); }
        catch (Exception e) when (!ctx.Response.HasStarted)
        {
            Server.Log($"[library] {ctx.Request.Path}: {e.GetType().Name}: {e.Message}");
            return await JsError(ctx, 500, e.Message);
        }
    }

    /* x.k for a JSON value: an object's own field, else undefined. */
    private static object? Prop(object? o, string k) => o is JsObj j ? j[k] : Undef.V;

    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();

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
}
