// Features.cs — the parts of Mandarin that switch off whole (v1.0.2): the wall
// display and Shelf, each with its switch in Settings → Setup (displayEnabled
// and shelfEnabled). The wall display is on unless set off. Shelf is off on a
// new install (NewInstall, written when the database is first made) and on
// for one from before v1.0.2, which has no setting. Off, a part is off entirely:
//   - its page (/display, /shelf) is a page saying it is turned off, with no
//     script, so nothing on a screen left open on it asks anything again;
//   - what only it asks for is refused: the wall display's content
//     (HousekeepingRoutes.cs) and Shelf's list (ShelfRoutes.cs), never made
//     while off, and Shelf's kept list let go when it is switched off;
//   - the page and the other part stop offering it (features.js, shelf.js,
//     display.js).
// Neither has work of its own in the background: what they cost is what their
// screens ask for, and off, nothing asks.
using System.Text.Json.Nodes;

namespace Mandarin.Server;

internal static class Features
{
    public const string Display = "displayEnabled", Shelf = "shelfEnabled";

    /// <summary>Whether a part is on: its setting; with none (an install from before v1.0.2), on.</summary>
    public static bool On(string key)
    {
        using var c = Db.Open();
        return Db.Setting(c, key) is { } v ? Js.Truthy(v) : true;
    }

    /// <summary>A new install (its database just made): Shelf starts off, until switched on in Setup.</summary>
    public static void NewInstall()
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT OR IGNORE INTO settings(key, value) VALUES($k, 'false')";
        cmd.Parameters.AddWithValue("$k", Shelf);
        cmd.ExecuteNonQuery();
    }

    /// <summary>The page for /display or /shelf: the part's own, or the page saying it is turned off.</summary>
    public static string Page(string key, string page) => On(key) ? page : page.Replace(".html", "-off.html", StringComparison.Ordinal);
}

internal static partial class Library
{
    // GET and POST /api/settings/shelf: { enabled }, as the wall display's switch.
    private static Task<bool> ShelfSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        return Send(ctx, new JsonObject { ["enabled"] = Copy(Setting(c, Features.Shelf, true)) });
    }
    private static async Task<bool> SaveShelfSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;   // "Bad JSON", answered
        using var c = Db.Open();
        if (b["enabled"] is JsonValue ev && ev.TryGetValue<bool>(out var en))
        {
            SetSetting(c, Features.Shelf, en);
            if (!en) ForgetShelf(s);
        }
        return await Send(ctx, new JsonObject { ["ok"] = true, ["enabled"] = Copy(Setting(c, Features.Shelf, true)) });
    }

    /* Switched off: the shelf's list, made and kept for this copy of the library, let go. */
    private static void ForgetShelf(Snapshot s)
    {
        s.Shelf = null;
        foreach (var key in Kept.Keys)
            if (key.StartsWith("/api/shelf/albums", StringComparison.Ordinal)) Kept.TryRemove(key, out _);
    }
}
