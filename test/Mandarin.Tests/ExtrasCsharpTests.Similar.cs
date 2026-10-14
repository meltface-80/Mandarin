using System.Globalization;
using System.Text.Json.Nodes;
using static Mandarin.Tests.JsGen;

namespace Mandarin.Tests;

public sealed partial class ExtrasCsharpTests
{
    // Deezer's answers, generated: rows of every shape the readers must take.
    private static JsonArray DeezerRows(Func<double> r, int n)
    {
        object?[] names = [.. Names, "Artist A", "Artist A Tribute", "The Artist A", "Artist B"];
        var rows = new JsonArray();
        for (int i = 0; i < n; i++)
        {
            var x = r();
            if (x < 0.04) { rows.Add(null); continue; }
            if (x < 0.06) { rows.Add("not a row"); continue; }
            var row = new JsonObject();
            var id = r();
            Set(row, "id", id < 0.05 ? Undefined : id < 0.1 ? 0 : id < 0.15 ? "" : id < 0.5 ? Floor(r() * 30) : Floor(r() * 30).ToString(CultureInfo.InvariantCulture));
            var nm = r();
            Set(row, "name", nm < 0.05 ? 7 : nm < 0.1 ? Undefined : names[Floor(r() * names.Length)]);
            var f = r();
            Set(row, "nb_fan", f < 0.2 ? Undefined : f < 0.3 ? null : f < 0.4 ? Floor(r() * 5000).ToString(CultureInfo.InvariantCulture) : f < 0.45 ? "lots" : Floor(r() * 200000));
            if (r() < 0.6) Set(row, "picture_medium", r() < 0.2 ? "" : "pm" + i);
            if (r() < 0.6) Set(row, "picture", "p" + i);
            rows.Add(row);
        }
        return rows;
    }

    private static string S(double v) => JsJson.Number(v);

    // An object key as JavaScript makes one of a value: a string as it is, a number as written, null "null", none "undefined".
    private static string JsKey(JsonObject o, string field) =>
        !o.ContainsKey(field) ? "undefined" : o[field] is JsonValue v ? (v.TryGetValue<string>(out var s) ? s : JsJson.Stringify(v)) : o[field] == null ? "null" : o[field]!.ToJsonString();

    [Test]
    public async Task The_suggestions_Deezer_read_the_taste_graph_the_ranking_the_draw_the_record_and_the_reason()
    {
        Needs.Server();
        var r = Rng(20261008);
        var overlaps = new JsonArray();
        foreach (var a in Names) foreach (var b in new[] { "Prince", "The Beatles", "Sting", "the", "Artist A", "", "Beatles" }) overlaps.Add(new JsonArray(Node(a), b));
        overlaps.Add(new JsonArray(null, "x")); overlaps.Add(new JsonArray(null, null)); overlaps.Add(new JsonArray(0.0, "0"));
        JsonArray artists = [], related = [], pools = [];
        object?[] artistNames = ["Artist A", "The Beatles", "Sting", "Beatles", "", null];
        object?[] wanted = [Undefined, 0, 1, 2, 3, 25];
        for (int i = 0; i < 300; i++)
        {
            JsonNode? json = r() < 0.05 ? (r() < 0.5 ? null : Obj(("data", "nope"))) : Obj(("data", DeezerRows(r, Floor(r() * 30))));
            artists.Add(Obj(("json", json), ("artist", Pick(r, artistNames))));
            related.Add(Obj(("json", json), ("wanted", Pick(r, wanted))));
            pools.Add(json?.DeepClone());
        }
        int year = DateTime.Now.Year;
        object?[] years = ["2020-01-01", "0000-00-00", "1899-12-31", "1900", " 2001-05", "20201", "abcd", "", null, Undefined, 2015, 1999.5,
            $"{year + 1}-01-01", $"{year + 2}-01-01", "２０２０", "1987-xx"];
        JsonArray tops = [], albumLists = [];
        for (int i = 0; i < 200; i++)
        {
            var tracks = new JsonArray();
            for (int k = Floor(r() * 12); k > 0; k--)
            {
                var y = r();
                if (y < 0.05) { tracks.Add(null); continue; }
                JsonObject? al = null;
                if (y >= 0.1)
                {
                    object? id = r() < 0.1 ? Undefined : r() < 0.5 ? Floor(r() * 5) : Floor(r() * 5).ToString(CultureInfo.InvariantCulture);
                    object? title = r() < 0.1 ? 3 : r() < 0.15 ? "  " : new[] { "Big One", " Big One ", "Other", "Debut" }[Floor(r() * 4)];
                    al = Obj(("id", id), ("title", title));
                }
                if (al != null && r() < 0.5) Set(al, "cover_medium", r() < 0.2 ? "" : "cm" + k);
                if (al != null && r() < 0.5) Set(al, "cover", "c" + k);
                tracks.Add(Obj(("album", al)));
            }
            tops.Add(r() < 0.05 ? null : Obj(("data", tracks)));
            var list = new JsonArray();
            for (int k = Floor(r() * 10); k > 0; k--)
            {
                if (r() < 0.05) { list.Add(null); continue; }
                object? id = r() < 0.05 ? null : Floor(r() * 100);
                var title = r() < 0.1 ? "" : "T" + Floor(r() * 6);
                var type = Pick(r, ["album", "single", "ALBUM", "ep", Undefined, "compile"]);
                var date = Pick(r, years);
                object? cm = r() < 0.5 ? "cm" + k : Undefined;
                object? c = r() < 0.5 ? "c" + k : Undefined;
                list.Add(Obj(("id", id), ("title", title), ("record_type", type), ("release_date", date), ("cover_medium", cm), ("cover", c)));
            }
            albumLists.Add(r() < 0.05 ? new JsonObject() : Obj(("data", list)));
        }
        // The taste graph: seeds as playedArtists lists them, their related lists cached.
        double now = DateTimeOffset.Parse("2026-10-08T12:00:00Z", CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();
        string[] actNames = ["New Act", "Another Act", "The New Act", "Kids Choir", "Seed One", "Seed Two", "Artist B", ""];
        var tastes = new JsonArray();
        for (int i = 0; i < 100; i++)
        {
            JsonArray seeds = [];
            var rel = new JsonObject();
            for (int k = Floor(r() * 8); k > 0; k--)
            {
                var name = new[] { "Seed One", "Seed Two", "Seed Three", "Artist B", "Heavy Act" }[Floor(r() * 5)] + (r() < 0.3 ? " " + k : "");
                var days = Floor(r() * 12);
                var last = now - Floor(r() * 200) * 86400000.0;
                seeds.Add(Obj(("name", name), ("days", days), ("last", last)));
                if (r() < 0.9)
                    rel[name] = new JsonArray([.. Enumerable.Range(0, Floor(r() * 6)).Select(_ => r() < 0.05 ? null
                        : (JsonNode)Obj(("name", actNames[Floor(r() * actNames.Length)]), ("id", S(Floor(r() * 9)))))]);
            }
            tastes.Add(Obj(("seeds", seeds), ("related", rel), ("now", now)));
        }
        // The ranking and the draw over real pools: Deezer's rows, each from its own seed, read as held just below.
        var rankRows = new JsonArray([.. Enumerable.Range(0, 200).Select(i => { var g = Rng((uint)(4000 + i)); return (JsonNode?)Obj(("data", DeezerRows(g, Floor(g() * 25)))); })]);
        var allPools = new JsonArray([.. pools.Select(p => p?.DeepClone()), .. rankRows.Select(p => p?.DeepClone())]);
        object?[] names = [.. Names, .. Values];
        var first = await Csharp(new JsonObject
        {
            ["fn"] = "similar", ["names"] = Arr(names), ["overlaps"] = overlaps.DeepClone(), ["artists"] = artists.DeepClone(), ["related"] = related.DeepClone(),
            ["pools"] = allPools.DeepClone(), ["years"] = Arr(years), ["tops"] = tops.DeepClone(), ["album_lists"] = albumLists.DeepClone(), ["tastes"] = tastes.DeepClone()
        });
        var rankPools = first["pools"]!.AsArray().Skip(pools.Count).ToList();
        var rankNames = new JsonArray([.. rankPools.SelectMany(p => p!.AsArray()).Select(a => a?["name"]?.DeepClone())]);
        var normals = (await Csharp(new JsonObject { ["fn"] = "similar", ["names"] = rankNames.DeepClone() }))["normalize"]!.AsArray();
        Same("normalize", Arr(names), first["normalize"]);
        Same("normalize (the ranking's)", rankNames, normals);
        Same("namesOverlap", overlaps, first["overlap"]);
        Same("readDeezerArtists", artists, first["artists"]);
        Same("readDeezerRelated", related, first["related"]);
        Same("readDeezerPool", allPools, first["pools"]);
        Same("yearOf", Arr(years), Rel(first["years"]));
        Same("readDeezerTop", tops, first["tops"]);
        Same("readDeezerAlbumList", albumLists, Rel(first["album_lists"]));
        Same("tasteGraph", tastes, first["tastes"]);

        // Ranked over the pools with the taste graphs read above, then drawn from as ranked.
        var ranks = new JsonArray();
        var rnds = new List<JsonArray>();
        int at = 0;
        var firstTastes = first["tastes"]!.AsArray();
        for (int i = 0; i < 200; i++)
        {
            var pool = rankPools[i]!.AsArray();
            var normal = normals.Skip(at).Take(pool.Count).ToList();
            at += pool.Count;
            var known = new JsonObject();
            foreach (var a in pool) if (r() < 0.3) known[JsKey(a!.AsObject(), "name")] = r() < 0.5 ? "library" : "played";
            var heavy = new JsonArray([.. normal.Where(_ => r() < 0.1).Select(n => n?.DeepClone())]);
            var shown = new JsonArray([.. pool.Where(_ => r() < 0.2).Select(a => a?["id"]?.DeepClone())]);
            object? playing = r() < 0.2 ? null : pool.Count > 0 && r() < 0.3 ? (pool[0]!.AsObject().ContainsKey("name") ? pool[0]!["name"]?.DeepClone() : Undefined) : "Artist A";
            ranks.Add(Obj(("pool", pool.DeepClone()), ("playing", playing), ("taste", firstTastes[i % tastes.Count]?.DeepClone()), ("known", JsJson.Ordered(known)), ("heavy", heavy), ("shown", shown)));
            rnds.Add(new JsonArray([.. Enumerable.Range(0, 5).Select(_ => (JsonNode?)JsonValue.Create(r()))]));
        }
        JsonArray reasons = [], records = [];
        var lists = first["album_lists"]!.AsArray();
        var topsRead = first["tops"]!.AsArray();
        for (int i = 0; i < 200; i++)
        {
            var knownAs = Pick(r, [null, "library", "played"]);
            var via = new JsonArray([.. new[] { "Seed One", "Artist A", "Seed Two", "artist a" }.Where(_ => r() < 0.5).Select(v => (JsonNode?)v)]);
            var act = Obj(("id", "1"), ("name", "Act"), ("known", knownAs), ("via", via));
            reasons.Add(Obj(("act", act), ("playing", r() < 0.2 ? null : r() < 0.5 ? "" : "Artist A")));
            var albums = lists[i % albumLists.Count]!.AsArray();
            var top = topsRead[i % tops.Count];
            var owned = new JsonArray([.. albums.Where(_ => r() < 0.4).Select(a => a?["title"]?.DeepClone())]);
            if (r() < 0.3 && top != null) owned.Add(top["title"]?.DeepClone());
            records.Add(Obj(("act", act), ("top", top), ("albums", albums), ("owned", owned)));
        }
        object?[] playedArtists = [.. Names.Take(20), "Various Artists", "VA", "", null, "A feat. B", "A / B", "Hall & Oates"];
        var played = new JsonArray();
        for (int i = 0; i < 100; i++)
        {
            var rows = new JsonArray([.. Enumerable.Range(0, Floor(r() * 40)).Select(_ =>
            {
                var artist = Pick(r, playedArtists);
                object? ts = r() < 0.05 ? null : r() < 0.1 ? S(now - Floor(r() * 50) * 86400000.0) : now - Math.Floor(r() * 100 * 86400000.0);
                return (JsonNode?)Obj(("artist", artist), ("ts", ts));
            })]);
            played.Add(Obj(("rows", rows), ("limit", Pick(r, [8, 40, 1, 0, 3]))));
        }

        var second = await Csharp(new JsonObject { ["fn"] = "similar", ["ranks"] = ranks.DeepClone(), ["reasons"] = reasons.DeepClone(), ["records"] = records.DeepClone(), ["played"] = played.DeepClone() });
        Same("rankActs", ranks, second["ranks"]);
        Same("reasonFor", reasons, second["reasons"]);
        Same("recordFor", records, Rel(second["records"]));
        Same("playedArtists", played, second["played"]);
        var chooses = new JsonArray([.. second["ranks"]!.AsArray().Select((ranked, i) => (JsonNode?)Obj(("ranked", ranked), ("rnd", rnds[i])))]);
        Same("choose", chooses, (await Csharp(new JsonObject { ["fn"] = "similar", ["chooses"] = chooses.DeepClone() }))["chooses"]);
    }
}
