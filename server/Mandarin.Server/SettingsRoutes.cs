// SettingsRoutes.cs — settings that are only kept and read (v0.8.7): the wall
// display, Smart Picks' switch and hour, and Home's rows. From
// lib/server/api-library.js, rule for rule. Each is a setting in the database,
// read afresh when it is needed, so a change takes at once.
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Library
{
    // db.setting(key, fallback): the stored JSON, or the fallback when there's none.
    private static JsonNode? Setting(SqliteConnection c, string key, JsonNode? fallback)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
        cmd.Parameters.AddWithValue("$k", key);
        if (cmd.ExecuteScalar() is not string v) return fallback;
        try { return JsonNode.Parse(v); } catch (JsonException) { return fallback; }
    }
    private static void SetSetting(SqliteConnection c, string key, JsonNode? value)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", value == null ? "null" : value.ToJsonString(Out));
        cmd.ExecuteNonQuery();
    }
    private static JsonNode? Copy(JsonNode? n) => n?.DeepClone();

    // ------------------------------------------------------- wall display

    private static JsonObject Display(SqliteConnection c) => new()
    {
        ["enabled"] = Copy(Setting(c, "displayEnabled", true)),
        ["seconds"] = Copy(Setting(c, "displaySeconds", 20))
    };
    private static Task<bool> DisplaySettings(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        return Send(ctx, Display(c));
    }
    private static async Task<bool> SaveDisplaySettings(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;   // "Bad JSON", answered
        using var c = Db.Open();
        if (b["enabled"] is JsonValue ev && ev.TryGetValue<bool>(out var en)) SetSetting(c, "displayEnabled", en);
        if (b["seconds"] is { } sec)
        {
            var n = Js.ParseInt(sec);
            if (n != int.MinValue && n >= 5 && n <= 60) SetSetting(c, "displaySeconds", n);
        }
        var o = Display(c);
        return await Send(ctx, new JsonObject { ["ok"] = true, ["enabled"] = o["enabled"]?.DeepClone(), ["seconds"] = o["seconds"]?.DeepClone() });
    }

    // -------------------------------------------------------- Smart Picks

    private static JsonObject SmartSettings(SqliteConnection c) => new()
    {
        ["enabled"] = Copy(Setting(c, "smartPicksEnabled", true)),
        ["hour"] = Copy(Setting(c, "smartPicksHour", 4)),
        ["auto_add"] = false,
        ["service_ready"] = true
    };
    private static Task<bool> SmartPicksSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        return Send(ctx, SmartSettings(c));
    }
    private static async Task<bool> SaveSmartPicksSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        using var c = Db.Open();
        if (b.ContainsKey("hour"))
        {
            var h = JsNumber(b["hour"]);
            if (double.IsNaN(h) || double.IsInfinity(h) || h < 0 || h > 23) return await Send(ctx, new JsonObject { ["error"] = "hour must be 0-23" }, 400);
            SetSetting(c, "smartPicksHour", (long)Math.Truncate(h));
        }
        if (b.ContainsKey("enabled")) SetSetting(c, "smartPicksEnabled", Js.Truthy(b["enabled"]));
        var o = new JsonObject { ["ok"] = true };
        foreach (var (k, v) in SmartSettings(c).ToList()) o[k] = v?.DeepClone();
        return await Send(ctx, o);
    }

    // Number(x) for a JSON value.
    private static double JsNumber(JsonNode? n) => n switch
    {
        null => 0,
        // Whatever .NET type holds it (int, long, double, a parsed number): its value.
        JsonValue v when v.GetValueKind() == JsonValueKind.Number => double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture),
        JsonValue v when v.TryGetValue<bool>(out var b) => b ? 1 : 0,
        JsonValue v when v.TryGetValue<string>(out var str) => Num(str),
        JsonArray a when a.Count == 0 => 0,
        JsonArray a when a.Count == 1 => JsNumber(a[0]) is var x && a[0] is not JsonObject ? x : double.NaN,
        _ => double.NaN
    };

    // ---------------------------------------------------------- Home rows

    // "downloads" and "phone" are the Android app's own rows (at the top, the
    // first off until the app turns it on); "lotw" needs Record labels on. A
    // saved row no longer here ("playlists", the playlists taken out) is passed over.
    private static readonly string[] HomeRowIds = ["phone", "downloads", "later", "unplayed", "favourites", "history", "picks", "lotw", "random", "library", "genres"];

    private static List<(string Id, bool On)> CleanRows(JsonNode? stored)
    {
        var out_ = new List<(string, bool)>();
        var seen = new HashSet<string>();
        if (stored is JsonArray arr)
            foreach (var r in arr)
            {
                if (r is not JsonObject ro || ro["id"] is not JsonValue iv || !iv.TryGetValue<string>(out var id) || !HomeRowIds.Contains(id) || !seen.Add(id)) continue;
                out_.Add((id, !(ro["on"] is JsonValue ov && ov.TryGetValue<bool>(out var on) && !on)));
            }
        return out_;
    }
    private static List<(string Id, bool On)> HomeRows(SqliteConnection c)
    {
        var rows = CleanRows(Setting(c, "homeRows", null));
        var seen = rows.Select(r => r.Id).ToHashSet();
        foreach (var id in HomeRowIds)
        {
            if (seen.Contains(id)) continue;
            if (id is "downloads" or "phone") rows.Insert(0, (id, id != "downloads")); else rows.Add((id, id != "downloads"));
        }
        return rows;
    }
    private static JsonArray RowsJson(IEnumerable<(string Id, bool On)> rows, Func<string, string?>? unavailable = null) =>
        new(rows.Select(r =>
        {
            var o = new JsonObject { ["id"] = r.Id, ["on"] = r.On };
            if (unavailable != null) o["unavailable"] = unavailable(r.Id);
            return (JsonNode)o;
        }).ToArray());

    private static Task<bool> HomeRowsSettings(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        var picksOn = Js.Truthy(Setting(c, "smartPicksEnabled", true));
        return Send(ctx, new JsonObject
        {
            ["rows"] = RowsJson(HomeRows(c), id => id == "picks" && !picksOn ? "Smart Picks is off in Settings"
                : id == "lotw" && !st.LabelsOn ? "Record labels is off in Settings" : null)
        });
    }
    private static async Task<bool> SaveHomeRows(HttpContext ctx, Snapshot s, LibState st)
    {
        var b = await Auth.Body(ctx);
        if (b == null) return true;
        if (b["rows"] is not JsonArray) return await Send(ctx, new JsonObject { ["error"] = "rows array required" }, 400);
        var clean = CleanRows(b["rows"]);
        if (clean.Count == 0) return await Send(ctx, new JsonObject { ["error"] = "no recognisable rows" }, 400);
        using var c = Db.Open();
        SetSetting(c, "homeRows", RowsJson(clean));
        return await Send(ctx, new JsonObject { ["ok"] = true, ["rows"] = RowsJson(HomeRows(c)) });
    }

    /* GET /api/filters/tags: none (the Library's tag facet is the genres'). */
    private static Task<bool> TagFilters(HttpContext ctx, Snapshot s, LibState st) => Send(ctx, new JsonObject { ["tags"] = new JsonArray() });
}
