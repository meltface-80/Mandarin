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

    [Test]
    public async Task Deezers_artists_and_related_acts_the_taste_graph_and_the_acts_you_play()
    {
        Needs.Server();
        var r = Rng(20261008);
        var overlaps = new JsonArray();
        foreach (var a in Names) foreach (var b in new[] { "Prince", "The Beatles", "Sting", "the", "Artist A", "", "Beatles" }) overlaps.Add(new JsonArray(Node(a), b));
        overlaps.Add(new JsonArray(null, "x")); overlaps.Add(new JsonArray(null, null)); overlaps.Add(new JsonArray(0.0, "0"));
        JsonArray artists = [], related = [];
        object?[] artistNames = ["Artist A", "The Beatles", "Sting", "Beatles", "", null];
        object?[] wanted = [Undefined, 0, 1, 2, 3, 25];
        for (int i = 0; i < 300; i++)
        {
            JsonNode? json = r() < 0.05 ? (r() < 0.5 ? null : Obj(("data", "nope"))) : Obj(("data", DeezerRows(r, Floor(r() * 30))));
            artists.Add(Obj(("json", json), ("artist", Pick(r, artistNames))));
            related.Add(Obj(("json", json?.DeepClone()), ("wanted", Pick(r, wanted))));
        }
        // The taste graph: seeds as playedArtists lists them, their related lists cached; drawn from a seed of their own
        // since the share card's suggestions, drawn before them, went (item 336).
        var rt = Rng(20261108);
        double now = DateTimeOffset.Parse("2026-10-08T12:00:00Z", CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();
        string[] actNames = ["New Act", "Another Act", "The New Act", "Kids Choir", "Seed One", "Seed Two", "Artist B", ""];
        var tastes = new JsonArray();
        for (int i = 0; i < 100; i++)
        {
            JsonArray seeds = [];
            var rel = new JsonObject();
            for (int k = Floor(rt() * 8); k > 0; k--)
            {
                var name = new[] { "Seed One", "Seed Two", "Seed Three", "Artist B", "Heavy Act" }[Floor(rt() * 5)] + (rt() < 0.3 ? " " + k : "");
                var days = Floor(rt() * 12);
                var last = now - Floor(rt() * 200) * 86400000.0;
                seeds.Add(Obj(("name", name), ("days", days), ("last", last)));
                if (rt() < 0.9)
                    rel[name] = new JsonArray([.. Enumerable.Range(0, Floor(rt() * 6)).Select(_ => rt() < 0.05 ? null
                        : (JsonNode)Obj(("name", actNames[Floor(rt() * actNames.Length)]), ("id", S(Floor(rt() * 9)))))]);
            }
            tastes.Add(Obj(("seeds", seeds), ("related", rel), ("now", now)));
        }
        object?[] playedArtists = [.. Names.Take(20), "Various Artists", "VA", "", null, "A feat. B", "A / B", "Hall & Oates"];
        var played = new JsonArray();
        for (int i = 0; i < 100; i++)
        {
            var rows = new JsonArray([.. Enumerable.Range(0, Floor(rt() * 40)).Select(_ =>
            {
                var artist = Pick(rt, playedArtists);
                object? ts = rt() < 0.05 ? null : rt() < 0.1 ? S(now - Floor(rt() * 50) * 86400000.0) : now - Math.Floor(rt() * 100 * 86400000.0);
                return (JsonNode?)Obj(("artist", artist), ("ts", ts));
            })]);
            played.Add(Obj(("rows", rows), ("limit", Pick(rt, [8, 40, 1, 0, 3]))));
        }
        object?[] names = [.. Names, .. Values];
        var got = await Csharp(new JsonObject
        {
            ["fn"] = "similar", ["names"] = Arr(names), ["overlaps"] = overlaps.DeepClone(), ["artists"] = artists.DeepClone(), ["related"] = related.DeepClone(),
            ["tastes"] = tastes.DeepClone(), ["played"] = played.DeepClone()
        });
        Same("normalize", Arr(names), got["normalize"]);
        Same("namesOverlap", overlaps, got["overlap"]);
        Same("readDeezerArtists", artists, got["artists"]);
        Same("readDeezerRelated", related, got["related"]);
        Same("tasteGraph", tastes, got["tastes"]);
        Same("playedArtists", played, got["played"]);
    }
}
