// SettingsRoutes.cs — settings that are only kept and read (v0.8.7): the wall
// display, Smart Picks' switch and hour, Home's rows; and dynamic playlists
// (saved Library views), read through the same Library wall as Library.cs.
// From lib/server/api-library.js and lib/server/api-playlists.js, rule for
// rule. Each is a setting in the database the Node server reads afresh when it
// needs it, so a change made here is the Node server's at once too.
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
    // first off until the app turns it on); "lotw" needs Record labels on.
    private static readonly string[] HomeRowIds = ["phone", "downloads", "later", "playlists", "unplayed", "favourites", "history", "picks", "lotw", "random", "library", "genres"];

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

    // -------------------------------------------------- dynamic playlists

    private const int SmartLimitDefault = 100, SmartLimitMax = 400;

    private sealed record SmartList(string Id, string Name, JsonObject View, long Limit, string Mode, string Order);

    // String(x) for a JSON value.
    private static string JsStr(JsonNode? n) => n switch
    {
        null => "null",
        JsonValue v when v.TryGetValue<string>(out var str) => str,
        JsonValue v when v.TryGetValue<bool>(out var b) => b ? "true" : "false",
        JsonValue v when v.GetValueKind() == JsonValueKind.Number => JsNum(double.Parse(v.ToJsonString(), CultureInfo.InvariantCulture)),
        JsonArray a => string.Join(",", a.Select(x => x == null ? "" : JsStr(x))),
        _ => "[object Object]"
    };
    private static string JsNum(double d) => d == Math.Floor(d) && Math.Abs(d) < 1e21 ? ((decimal)d).ToString(CultureInfo.InvariantCulture) : d.ToString("R", CultureInfo.InvariantCulture);

    /* A saved Library view, as only the wall's own words. */
    private static JsonObject SanitizeView(JsonNode? vn, Snapshot s)
    {
        var v = vn as JsonObject ?? [];
        var seed = PInt(v["seed"] is { } sn ? JsStr(sn) : null);
        var sort = v.ContainsKey("sort") ? JsStr(v["sort"]) : "undefined";
        var played = v.ContainsKey("played") ? JsStr(v["played"]) : "undefined";
        var o = new JsonObject
        {
            ["sort"] = Sorts.Contains(sort) ? sort : "album",
            ["dir"] = v.ContainsKey("dir") && JsStr(v["dir"]) == "desc" ? "desc" : "asc",
            ["seed"] = seed is long sd && sd > 0 ? sd : 1,
            ["played"] = Played.Contains(played) ? played : "any"
        };
        foreach (var def in FacetDefs(s))
        {
            var raw = v[def.Id] switch { null => new List<JsonNode?>(), JsonArray a => a.ToList(), var one => [one] };
            var vals = new List<string>();
            foreach (var x in raw)
            {
                if (x == null || x is JsonObject || x is JsonArray) continue;
                var t = Names.JsTrim(JsStr(x));
                if (t.Length == 0) continue;
                if (t.Length > 120) t = t[..120];
                if (!vals.Contains(t)) vals.Add(t);
            }
            o[def.Id] = new JsonArray(vals.Take(40).Select(x => (JsonNode)x).ToArray());
        }
        return o;
    }
    private static SmartList? SmartRecord(JsonNode? pn, Snapshot s)
    {
        if (pn is not JsonObject p) return null;
        var name = Names.JsTrim(Js.Str(p["name"]));
        if (name.Length > 60) name = name[..60];
        var id = Names.JsTrim(Js.Str(p["id"]));
        if (name.Length == 0 || id.Length == 0) return null;
        var lim = PInt(p["limit"] is { } ln ? JsStr(ln) : null);
        return new SmartList(id, name, SanitizeView(p["view"], s),
            lim is long l && l > 0 ? Math.Min(l, SmartLimitMax) : SmartLimitDefault,
            p["mode"] is JsonValue mv && mv.TryGetValue<string>(out var mode) && mode == "tracks" ? "tracks" : "albums",
            p["order"] is JsonValue ov && ov.TryGetValue<string>(out var order) && order == "random" ? "random" : "album");
    }
    private static List<SmartList> LoadSmart(SqliteConnection c, Snapshot s) =>
        Setting(c, "smartPlaylists", new JsonArray()) is JsonArray a ? a.Select(x => SmartRecord(x, s)).Where(x => x != null).Select(x => x!).ToList() : [];

    private static JsonObject SmartJson(SmartList p) => new()
    {
        ["id"] = p.Id, ["name"] = p.Name, ["view"] = p.View.DeepClone(), ["limit"] = p.Limit, ["mode"] = p.Mode, ["order"] = p.Order
    };

    /* The playlist's albums: the saved view, shuffled by its seed when it says so. */
    private static List<Album> SmartAlbums(SmartList sp, Snapshot s)
    {
        List<string>? Ask(string name) => sp.View[name] switch
        {
            null => null,
            JsonArray a => a.Select(JsStr).ToList(),
            var one => [JsStr(one)]
        };
        var view = View(Ask, s);
        if (sp.Order != "random") return view;
        var seed = ToUint32((long)JsNumber(sp.View["seed"]));
        return Sorted(view, (a, b) => Math.Sign((long)SeededRank(a.NTitle + a.NArtist, seed) - SeededRank(b.NTitle + b.NArtist, seed)));
    }

    private static Task<bool> SmartPlaylists(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        var lists = new JsonArray();
        foreach (var p in LoadSmart(c, s))
        {
            var view = SmartAlbums(p, s);
            var o = SmartJson(p);
            o["count"] = Math.Min(view.Count, p.Limit);
            o["matched"] = view.Count;
            o["art_keys"] = new JsonArray(view.Take(4).Select(a => (JsonNode)a.ImageKey).ToArray());
            lists.Add(o);
        }
        return Send(ctx, new JsonObject
        {
            ["playlists"] = lists,
            ["limits"] = new JsonObject { ["default"] = SmartLimitDefault, ["max"] = SmartLimitMax, ["options"] = new JsonArray(25, 50, 100, 200, 400) },
            ["modes"] = new JsonArray("albums", "tracks"),
            ["orders"] = new JsonArray("album", "random")
        });
    }

    private static Task<bool> SmartPlaylist(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        var id = Q(ctx, "id") ?? "";
        var sp = LoadSmart(c, s).FirstOrDefault(p => p.Id == id);
        if (sp == null) return Send(ctx, new JsonObject { ["error"] = "No such dynamic playlist" }, 404);
        var offset = (int)Math.Min(int.MaxValue, Math.Max(0, IntOr(Q(ctx, "offset"), 0)));
        var count = (int)Math.Max(1, Math.Min(8, IntOr(Q(ctx, "count"), 8)));
        var view = SmartAlbums(sp, s).Take((int)sp.Limit).ToList();
        var slice = view.Skip(offset).Take(count).ToList();
        var tracks = new List<(JsonObject O, string Key)>();
        foreach (var al in slice)
        {
            var list = Tracks(c, s, al);
            for (int i = 0; i < list.Count; i++)
            {
                var t = list[i];
                tracks.Add((new JsonObject
                {
                    ["album_offset"] = al.Id, ["album_title"] = al.Title, ["album_artist"] = al.Artist, ["image_key"] = al.ImageKey,
                    ["track_index"] = i, ["title"] = t.Title, ["subtitle"] = t.Artist.Length > 0 ? t.Artist : al.Artist, ["track_no"] = t.No
                }, al.Title + "|" + t.Title + "|" + i));
            }
        }
        if (sp.Order == "random")
        {
            var seed = ToUint32((long)JsNumber(sp.View["seed"]));
            tracks = Sorted(tracks, (a, b) => Math.Sign((long)SeededRank(a.Key, seed) - SeededRank(b.Key, seed)));
        }
        return Send(ctx, new JsonObject
        {
            ["id"] = sp.Id, ["name"] = sp.Name, ["view"] = sp.View.DeepClone(),
            ["tracks"] = new JsonArray(tracks.Select(t => (JsonNode)t.O).ToArray()),
            ["album_offset"] = offset, ["albums_expanded"] = slice.Count, ["album_total"] = view.Count,
            ["done"] = offset + slice.Count >= view.Count
        });
    }

    private static Task<bool> SmartPlaylistAlbums(HttpContext ctx, Snapshot s, LibState st)
    {
        using var c = Db.Open();
        var id = Q(ctx, "id") ?? "";
        var sp = LoadSmart(c, s).FirstOrDefault(p => p.Id == id);
        if (sp == null) return Send(ctx, new JsonObject { ["error"] = "No such dynamic playlist" }, 404);
        var view = SmartAlbums(sp, s);
        var max = Math.Min(Math.Max(1, Math.Min(SmartLimitMax, IntOr(Q(ctx, "max"), SmartLimitDefault))), sp.Limit);
        return Send(ctx, new JsonObject
        {
            ["id"] = sp.Id, ["name"] = sp.Name,
            ["albums"] = new JsonArray(view.Take((int)max).Select(a => (JsonNode)new JsonObject { ["offset"] = a.Id, ["title"] = a.Title, ["subtitle"] = a.Artist, ["image_key"] = a.ImageKey }).ToArray()),
            ["total"] = Math.Min(view.Count, sp.Limit), ["matched"] = view.Count
        });
    }
}
