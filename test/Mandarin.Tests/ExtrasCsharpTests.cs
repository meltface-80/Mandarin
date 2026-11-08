using System.Text;
using System.Text.Json.Nodes;
using static Mandarin.Tests.JsGen;

namespace Mandarin.Tests;

/// <summary>
/// The extras' rules (the first credited act, Deezer's artists and related acts, the taste graph, release
/// days, the labels' names and logos) held to the Node server's modules: generated cases, seeded, asked of
/// `mandarin-server score`, each answer the Node server's as kept (test/golden/extras-csharp.json)
/// (test/extras-csharp.test.js, in C#; Deezer's and the taste graph's in ExtrasCsharpTests.Similar.cs).
/// </summary>
public sealed partial class ExtrasCsharpTests(ExtrasCsharpTests.Book book) : IClassFixture<ExtrasCsharpTests.Book>
{
    /// <summary>test/golden/extras-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("extras-csharp");

    private static Task<JsonNode> Csharp(JsonObject job) => Golden.Score(job);

    // Each answer the Node server's (kept), every case labelled with what is asked.
    private void Same(string what, IEnumerable<JsonNode?> cases, JsonNode? got)
    {
        var list = cases.ToList();
        book.Kept.Same(what, [.. list.Select(_ => (object?)what)], list, [.. got!.AsArray()]);
    }

    private static readonly object?[] Names =
    [
        "The Beatles", "Beatles", "the beatles", "The", "the the", "Thé Band", "Prince", "Prince & The Revolution", "Sting", "Sting Tribute Band",
        "Hall & Oates", "Simon & Garfunkel", "AC/DC", "Guns N' Roses", "Sigur Rós", "Björk", "Bjork", "Motörhead", "ΣΩΣ", "Ὀδυσσεύς", "Straße", "İstanbul",
        "ﬁne", "ＡＢＣ", "Ⅻ", "½", "e\u0301", "ǅungla", "Ünïcode 😀", "日本語", "Привет", "Ёлка", "  spaced   out  ", "Tab\tname", "new\nline",
        "Zero​width", " nbsp ", "\ud800lone", "lone\udc00", "Artist A feat. Artist B", "A / B", "A;B", "A ; B", "A/B", "Featuring X",
        "X ft. Y", "X Ft Y", "X FEAT Y", "X featuring Y", "X vs. Y", "Various Artists", "Various", "VA", "", " ", "-", "!!!", "123", "4AD"
    ];
    private static readonly object?[] Values = [null, Undefined, 0, 5, true];

    private static JsonArray Arr(IEnumerable<object?> items) => new([.. items.Select(Node)]);

    [Test]
    public async Task The_first_credited_act()
    {
        Needs.Server();
        // All that is left of the share card's links (item 336): the first act a credit names, as the taste graph and the
        // played acts take it. Not a lone surrogate, as before.
        var cases = new JsonArray([.. Names.Where(n => !HasLoneSurrogate((string)n!)).Concat(Values).Select(a => (JsonNode?)Obj(("artist", a)))]);
        var got = (await Csharp(new JsonObject { ["fn"] = "share", ["cases"] = cases.DeepClone() }))["share"];
        Same("the first credited act", cases, got);
    }

    [Test]
    public async Task The_release_days_a_groups_day_matched_to_an_album_only_by_its_title_artist_and_year()
    {
        Needs.Server();
        object?[] titles = ["Album (Deluxe Edition)", "Album [Remastered]", "Album (Live) (Deluxe)", "(Only Brackets)", "Album (unclosed", "Album ) odd (", "",
            null, Undefined, "Ünïcode (2020 Remaster)", "Title [Disc 1] ", "A (B) C", "Kid A", "KID A!", "Kid A (2000)", "[Kid A]", "Blue Rev\t(Bonus) "];
        var r = Rng(99);
        string[] words = ["Blue Rev", "Rumours", "Kid A", "Hail to the Thief", "OK Computer", "Ünïcode"];
        string[] acts = ["Alvvays", "Fleetwood Mac", "Radiohead", "The Radiohead", "Someone Else", "Mac"];
        var batches = new JsonArray();
        for (int i = 0; i < 300; i++)
        {
            var albums = new List<JsonObject>();
            for (int k = 1 + Floor(r() * 20); k > 0; k--)
            {
                int year = 1970 + Floor(r() * 50);
                var key = "k" + Floor(r() * 25);
                var title = words[Floor(r() * words.Length)] + (r() < 0.2 ? " (Deluxe)" : "");
                var artist = acts[Floor(r() * acts.Length)];
                object? date = r() < 0.5 ? year.ToString(System.Globalization.CultureInfo.InvariantCulture) : r() < 0.5 ? $"{year}-0{1 + Floor(r() * 9)}" : null;
                albums.Add(Obj(("key", key), ("title", title), ("artist", artist), ("year", year), ("date", date)));
            }
            var groups = new JsonArray();
            for (int k = Floor(r() * 25); k > 0; k--)
            {
                var a = albums[Floor(r() * albums.Count)];
                int ay = (int)a.Num("year")!.Value;
                int year = r() < 0.7 ? ay : ay + 1;
                string d = r() < 0.2 ? year.ToString(System.Globalization.CultureInfo.InvariantCulture) : r() < 0.4 ? $"{year}-0{1 + Floor(r() * 9)}" : $"{year}-0{1 + Floor(r() * 9)}-{10 + Floor(r() * 18)}";
                object? credit;
                if (r() < 0.1) credit = Undefined;
                else
                {
                    var first = Obj(("name", r() < 0.1 ? Undefined : acts[Floor(r() * acts.Length)]), ("artist", Obj(("name", "Fallback"))), ("joinphrase", r() < 0.3 ? " & " : ""));
                    credit = r() < 0.3 ? new JsonArray(first, Obj(("name", "Guest"))) : new JsonArray(first);
                }
                if (r() < 0.03) { groups.Add(new JsonObject()); continue; }
                var gt = r() < 0.8 ? a.Str("title") : a.Str("title") + " [Remastered]";
                var frd = r() < 0.05 ? Undefined : d;
                groups.Add(Obj(("title", gt), ("first-release-date", frd), ("artist-credit", credit)));
            }
            batches.Add(Obj(("albums", new JsonArray([.. albums])), ("groups", r() < 0.03 ? Undefined : groups)));
        }
        var got = await Csharp(new JsonObject { ["fn"] = "days", ["titles"] = Arr(titles), ["batches"] = batches.DeepClone() });
        Same("baseTitle", Arr(titles), got["base"]);
        Same("queryFor", batches, got["query"]);
        Same("matchDays", batches, got["days"]);
    }

    [Test]
    public async Task The_labels_rules_Discogs_numbered_names_an_images_kind_from_its_bytes()
    {
        Needs.Server();
        object?[] names = ["Blue Note (2)", "4AD", "Label (12) ", "Label(3)", "Label (2) (3)", " (5)", "Label (x)", "", null, Undefined, 5, "Nonesuch (2) "];
        static byte[] L(string s) => Encoding.Latin1.GetBytes(s);
        (byte[] B, string? T)[] bufs =
        [
            (Convert.FromHexString("89504e470d0a1a0a0000000d"), null), (Convert.FromHexString("ffd8ffe000104a46"), "image/jpeg"), (L("GIF89a\x01\x00\x01\x00"), null),
            ([0xc7, 0xc9, 0xc6, 0xb8, 0x39, 0x61, 1, 0], null), (L("RIFF\x10\x00\x00\x00WEBPVP8 "), null),
            (Encoding.UTF8.GetBytes("﻿  <?xml version='1.0'?><svg/>"), null), (Encoding.UTF8.GetBytes("<SVG xmlns='x'/>"), null), (Encoding.UTF8.GetBytes("<html>no</html>"), "text/html"),
            (Encoding.UTF8.GetBytes("<html>no</html>"), "image/svg+xml; charset=utf-8"), ([], null), (Convert.FromHexString("8950"), null), (Encoding.UTF8.GetBytes(" <svg/>"), null),
            (L("RIFF\x10\x00\x00\x00webp"), null), ([0xff, 0xd8, 0xff], null), ([0xff, 0xd8, 0xff, 0xdb], null)
        ];
        var images = new JsonArray([.. bufs.Select(x => (JsonNode?)Obj(("b64", Convert.ToBase64String(x.B)), ("type", x.T)))]);
        var got = await Csharp(new JsonObject { ["fn"] = "labels", ["plain"] = Arr(names), ["images"] = images.DeepClone() });
        Same("plainName", Arr(names), got["plain"]);
        Same("typeOf", images, got["types"]);
    }
}
