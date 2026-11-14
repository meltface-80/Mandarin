// AutoCoverRoutes.cs — Settings → Library Scanner → Find covers (item 409):
// the cover finder's switch and its one line (Extras/AutoCovers.cs).
//
//   GET  /api/covers/auto        { on, running, found, left, none, unreachable? }: the last, the
//                                music folders that can't be reached, when there are (item 410)
//   POST /api/covers/auto { on } the switch (since item 411 the Album Scanner's: Identify/AlbumScanner.cs), and the same answer
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;

namespace Mandarin.Server;

internal static partial class Library
{
    /* GET /api/covers/auto: the switch and how far the finder has got. */
    private static async Task<bool> AutoCoversState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || AutoCovers.Current is not { } finder) return false;
        return await Send(ctx, await finder.Status());
    }

    /* POST /api/covers/auto { on } */
    private static async Task<bool> SaveAutoCovers(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held || AutoCovers.Current is not { } finder) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        if (b["on"] is not JsonValue v || !v.TryGetValue<bool>(out var on)) return await Send(ctx, new JsonObject { ["error"] = "on (true or false) required" }, 400);
        AutoCovers.Set(on);   // an older page's or app's Find covers: the Album Scanner switched (item 411)
        return await Send(ctx, await finder.Status());
    }
}
