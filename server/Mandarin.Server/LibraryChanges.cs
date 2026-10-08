// LibraryChanges.cs — changes to the library made here (v0.8.16), from
// lib/server/api-library.js and lib/library/index.js, rule for rule: a heart,
// Listen later, label merges and the label settings. Each is written to the
// database as the Node server wrote it, and the Node server is then told
// (POST /internal/library/changed), so its own copy — which playback, Smart
// Picks and the label lookups still use — reads it again and does what
// follows (a label's logo looked for, the label rules applied). Its library
// version moves with that, and this server's copy follows on the next request.
//
// A request in a shape the Node server would have answered with an error of
// its own making (a TypeError on a list that isn't one) is passed to it as it
// came, rather than guessed at.
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Library
{
    /* The Node server told of a change made here, to read it again (index.js /internal/library/changed). */
    private static async Task Tell(JsonObject what)
    {
        if (upstream == null) return;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(upstream, "/internal/library/changed"))
            {
                Content = new StringContent(what.ToJsonString(), Encoding.UTF8, "application/json")
            };
            req.Headers.Add("X-Mandarin-Front-Key", frontKey);
            using var res = await Http.SendAsync(req);
            if (!res.IsSuccessStatusCode) Front.Log($"[library] the Node server wasn't told of a change (HTTP {(int)res.StatusCode})");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            Front.Log($"[library] the Node server wasn't told of a change ({e.Message})");
        }
    }

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

    [GeneratedRegex("^[a-z0-9]+$")] private static partial Regex LabelKeyShape();

    /* POST /api/labels/merge { items: [{ key, display }, …] }: the others folded into the first. */
    private static async Task<bool> MergeLabels(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        // What the Node server would choke on (a list that isn't one, a name that isn't text): its own answer.
        if (b.ContainsKey("items") && b["items"] is not JsonArray && Js.Truthy(b["items"])) return false;
        var items = new List<(string Key, string Display)>();
        foreach (var it in b["items"] as JsonArray ?? [])
        {
            if (it is not JsonObject o || o["key"] is not JsonValue kv || !kv.TryGetValue<string>(out var key) || !LabelKeyShape().IsMatch(key)) continue;
            string display;
            if (o["display"] is JsonValue dv && dv.TryGetValue<string>(out var d) && d.Length > 0) display = d;
            else if (o["display"] == null || !Js.Truthy(o["display"])) display = key;
            else return false;
            if (display.Length > 200) display = display[..200];
            items.Add((key, display));
        }
        if (items.Count < 2) return await Send(ctx, new JsonObject { ["error"] = "Two or more labels are needed" }, 400);
        var target = items[0].Key;
        var now = NowMs();
        using (var c = Db.Open())
        {
            using var tx = c.BeginTransaction();
            foreach (var (key, display) in items.Skip(1))
            {
                if (key == target) continue;
                Exec(c, tx, "DELETE FROM label_merges WHERE source_key = $a", ("$a", target));
                Exec(c, tx, @"INSERT INTO label_merges(source_key, source_name, target_key, merged_at) VALUES($a, $b, $c, $d)
                              ON CONFLICT(source_key) DO UPDATE SET source_name=excluded.source_name, target_key=excluded.target_key, merged_at=excluded.merged_at",
                    ("$a", key), ("$b", display), ("$c", target), ("$d", now));
                Exec(c, tx, "UPDATE label_merges SET target_key = $a WHERE target_key = $b", ("$a", target), ("$b", key));
            }
            tx.Commit();
        }
        await Tell(new JsonObject { ["merges"] = true });
        return await Send(ctx, new JsonObject { ["ok"] = true, ["target"] = target, ["merged"] = new JsonArray(items.Skip(1).Select(i => (JsonNode)i.Key).ToArray()) });
    }

    private static int Exec(SqliteConnection c, SqliteTransaction tx, string sql, params (string Name, object Value)[] ps)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var (n, v) in ps) cmd.Parameters.AddWithValue(n, v);
        return cmd.ExecuteNonQuery();
    }

    /* DELETE /api/labels/merge/<source>: one merged label let go. */
    private static async Task<bool> UnmergeLabel(HttpContext ctx, string source)
    {
        int n;
        using (var c = Db.Open())
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "DELETE FROM label_merges WHERE source_key = $k";
            cmd.Parameters.AddWithValue("$k", source);
            n = cmd.ExecuteNonQuery();
        }
        // Read again by the Node server either way, as it did.
        await Tell(new JsonObject { ["merges"] = true, ["unmerged"] = true });
        if (n == 0) return await Send(ctx, new JsonObject { ["error"] = "Not a merged label" }, 404);
        return await Send(ctx, new JsonObject { ["ok"] = true });
    }

    /* POST /api/settings/labels { enabled }: Record labels on or off. */
    private static async Task<bool> SaveLabelsOn(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        if (!b.ContainsKey("enabled")) return await Send(ctx, new JsonObject { ["error"] = "enabled required" }, 400);
        var on = Js.Truthy(b["enabled"]);
        using (var c = Db.Open()) SetSetting(c, "labelsEnabled", on);
        await Tell(new JsonObject { ["labels"] = true });
        return await Send(ctx, new JsonObject { ["ok"] = true, ["enabled"] = on });
    }

    /* POST /api/settings/label-folder-depth { depth }: the folder a label is read from, 0 for the tags. */
    private static async Task<bool> SaveLabelDepth(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        long depth = b.ContainsKey("depth") ? Js.ParseInt(b["depth"]) : int.MinValue;
        if (depth == int.MinValue || depth < 0 || depth > 6) return await Send(ctx, new JsonObject { ["ok"] = false, ["error"] = "depth must be 0–6" }, 400);
        using (var c = Db.Open()) SetSetting(c, "labelFolderDepth", depth);
        await Tell(new JsonObject { ["labels"] = true });
        return await Send(ctx, new JsonObject { ["ok"] = true, ["depth"] = depth, ["rescanning"] = false });
    }

    /* DELETE /api/labels/merge/<one segment>, as Express's route takes it; anything else is the Node server's. */
    private static bool UnmergeAddress(HttpContext ctx, out string source)
    {
        source = "";
        var p = ctx.Request.Path.Value ?? "";
        const string Prefix = "/api/labels/merge/";
        if (!HttpMethods.IsDelete(ctx.Request.Method) || !p.StartsWith(Prefix, StringComparison.Ordinal)) return false;
        // A label's key is letters and digits only: anything else is the Node server's to turn away.
        var seg = p[Prefix.Length..];
        if (!LabelKeyShape().IsMatch(seg)) return false;
        source = seg;
        return true;
    }
}
