// AlbumScannerRoutes.cs — Settings → Library Scanner's Album Scanner (bug list item 411): its one switch, Scheduling's
// switch and hours, and its one Progress readout (Identify/AlbumScanner.cs, Identify/AlbumProgress.cs).
//
//   GET  /api/album-scanner   { on, schedule: { on, start, end }, albums, done, unidentified, proposed,
//                               now: { reason, step, album }, unreachable? }
//   POST /api/album-scanner { on?, schedule?, start?, end? }   the switches and the hours, and the same answer
//
// The older page's and app's own requests still do what they did, the four switches being this one now:
// POST /api/identify/settings { enabled, schedule, start, end, itunes }, /api/loudness { measure }, /api/covers/auto { on }.
using System.Text.Json.Nodes;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    /* GET /api/album-scanner */
    private static Task<bool> AlbumScannerState(HttpContext ctx, Snapshot s, LibState st)
    {
        if (!Jobs.Held) return Task.FromResult(false);
        return Send(ctx, AlbumProgress.Status(s, st));
    }

    /* POST /api/album-scanner { on?, schedule?, start?, end? } */
    private static async Task<bool> SaveAlbumScanner(HttpContext ctx, Snapshot s, LibState st)
    {
        if (HeldIdentify is not { } id) return false;
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        static bool? Flag(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var x) ? x : null;
        foreach (var k in new[] { "on", "schedule" })
            if (b.ContainsKey(k) && Flag(b[k]) == null) return await Send(ctx, new JsonObject { ["error"] = k + " must be true or false" }, 400);
        var patch = new JsObj();
        foreach (var k in new[] { "start", "end" })
        {
            if (!b.ContainsKey(k)) continue;
            var t = b[k] is JsonValue tv && tv.TryGetValue<string>(out var ts) ? ts : "";
            if (!TimeShape().IsMatch(t) || Identifier.Minutes(t, null) == null) return await Send(ctx, new JsonObject { ["error"] = k + " must be a time like 01:00" }, 400);
            patch[k] = t;
        }
        if (Flag(b["schedule"]) is bool sched) patch["schedule"] = sched;
        if (patch.Count > 0) id.SetSettings(patch);
        if (Flag(b["on"]) is bool on) AlbumScanner.Set(on);
        return await Send(ctx, AlbumProgress.Status(s, st));
    }
}
