// DeviceRoutes.Refused.cs — a change to a device the server didn't make (item 390), answered as before ({error}, with
// away: true for one refused away from home) and written to the log with why: a Mandarin Bridge switched on from the
// app went back to off with nothing said anywhere, the app showing no reason and the log none either.
using Mandarin.Server.Tags;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The change to [id] refused: [status] and [message] answered, and logged. */
    private static Task<bool> DeviceRefused(HttpContext ctx, string id, int status, string message, bool away = false)
    {
        Server.Log($"[devices] {id}: a change refused ({status}): {message}");
        var o = new JsObj();
        o["error"] = message;
        if (away) o["away"] = true;
        return SendJs(ctx, o, status);
    }
}
