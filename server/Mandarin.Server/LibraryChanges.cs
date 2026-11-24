// LibraryChanges.cs — changes to the library made here (v0.8.16), from
// lib/server/api-library.js and lib/library/index.js, rule for rule: a heart
// and Listen later. Each is written to the
// database as the Node server wrote it, and the change then told (Told,
// Library.State.cs: what libraryChanged did), so the library's version moves
// and the copy here is read again on the next request.
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Library
{
    /* A change made here told (index.js /internal/library/changed): the copy read again, and what follows it. */
    public static async Task Tell(JsonObject what) => await Told(what);

    /* The same, with its answer. */
    public static Task<JsonObject> Told(JsonObject what) => LocalTold(what);

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /* A heart on (INSERT, kept if already there) or off, by the album's key. */
    private static void Mark(SqliteConnection c, string table, string key, bool on)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = on
            ? $"INSERT INTO {table}(key, added_at) VALUES($k, $t) ON CONFLICT(key) DO NOTHING"
            : $"DELETE FROM {table} WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        if (on) cmd.Parameters.AddWithValue("$t", NowMs());
        cmd.ExecuteNonQuery();
    }

    private static Task<bool> Gone(HttpContext ctx) => Send(ctx, new JsonObject { ["error"] = "That album is no longer in the library" }, 404);

    /* POST /api/favourites { offset, on }: the heart. */
    private static async Task<bool> SaveFavourite(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var al = s.Find(JsNumber(b["offset"]));
        if (al == null) return await Gone(ctx);
        var on = Js.Truthy(b["on"]);
        using (var c = Db.Open()) Mark(c, "favourites", al.Key, on);
        await Tell(new JsonObject { ["marks"] = true });
        return await Send(ctx, new JsonObject { ["ok"] = true, ["offset"] = al.Id, ["favourite"] = on });
    }

    /* POST /api/listen-later { offset | offsets, on }: on or off the list, one album or several. */
    private static async Task<bool> SaveLater(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        var ids = b["offsets"] is JsonArray a ? a.ToList() : [b["offset"]];
        var on = Js.Truthy(b["on"]);
        Album? last = null;
        int n = 0;
        using (var c = Db.Open())
        {
            foreach (var id in ids)
            {
                var al = s.Find(JsNumber(id));
                if (al == null) continue;
                Mark(c, "listen_later", al.Key, on);
                last = al;
                n++;
            }
        }
        if (last == null) return await Gone(ctx);
        await Tell(new JsonObject { ["marks"] = true });
        return await Send(ctx, new JsonObject { ["ok"] = true, ["offset"] = last.Id, ["later"] = on, ["count"] = n });
    }

    private static int Exec(SqliteConnection c, SqliteTransaction tx, string sql, params (string Name, object Value)[] ps)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var (n, v) in ps) cmd.Parameters.AddWithValue(n, v);
        return cmd.ExecuteNonQuery();
    }
}
