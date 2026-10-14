using System.Text;
using System.Text.Json.Nodes;
using static Mandarin.Tests.JsGen;

namespace Mandarin.Tests;

/// <summary>
/// The extras' rules (the share card's links, Smart Picks' suggestions, release days, the labels'
/// names and logos) held to the Node server's modules: generated cases, seeded, asked of
/// `mandarin-server score`, each answer the Node server's as kept (test/golden/extras-csharp.json). A
/// year after this one is "&lt;next year&gt;" wherever an answer holds a year: the limit moves with the
/// clock, both sides alike (test/extras-csharp.test.js, in C#; the suggestions in
/// ExtrasCsharpTests.Similar.cs).
/// </summary>
public sealed partial class ExtrasCsharpTests(ExtrasCsharpTests.Book book) : IClassFixture<ExtrasCsharpTests.Book>
{
    /// <summary>test/golden/extras-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("extras-csharp");

    private static readonly int Next = DateTime.Now.Year + 1;

    // A year after this one as "<next year>", wherever an answer holds a year.
    private static JsonNode? Rel(JsonNode? v) => v switch
    {
        JsonArray a => new JsonArray([.. a.Select(Rel)]),
        JsonObject o => new JsonObject(o.Select(kv => KeyValuePair.Create(kv.Key,
            kv.Key == "year" && kv.Value is JsonValue y && y.TryGetValue<double>(out var n) && n == Next ? JsonValue.Create("<next year>") : Rel(kv.Value)))),
        _ => v?.DeepClone()
    };

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
    public async Task The_share_cards_links_the_first_act_the_query_the_storefront_the_language_each_service_and_review()
    {
        Needs.Server();
        // Not a lone surrogate: encodeURIComponent throws on one (the C# server writes U+FFFD).
        object?[] artists = [.. Names.Where(n => !HasLoneSurrogate((string)n!)), .. Values];
        object?[] albums = ["Kid A", "Kid A / Amnesiac", "Back\\Slash", "OK Computer: OKNOTOK", "  ", "", "Ünïcode 😀", "Rock & Roll!", "100% (Live)", null, Undefined, 7];
        object?[] locales = ["en-GB", "en-gb", "EN-us", "fr", "de_CH", "pt-BR", "es-419", "zh-Hant-TW", "xx", "ja", "nb-NO", "", "  ", "-", "_gb", null, Undefined, 5];
        object?[] accepts = ["fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5", "da, en-gb;q=0.8, en;q=0.7", "en;q=abc", "*", "en-US;q=1.0;foo=bar", ";q=0.5",
            "de;q=0.5, fr;q=0.5", "es;Q = 0.9 , it", "en;q=1.5", "nl;q=0", "  ", "", null, Undefined, "en;q=1e3", "en;q=.5, de;q=0.6", "x;q=0.1.2"];
        object?[] enabled = [null, Undefined, Array.Empty<object>(), new object[] { "qobuz", "apple" }, new object[] { "nope", "bandcamp", 5 }, new object[] { "deezer" }];
        object?[] reviews = [null, Undefined, Array.Empty<object>(), new object[] { "wikipedia-artist", "allmusic-artist" }, new object[] { "pitchfork", "nope" }, new object[] { "wikipedia", "allmusic", "wikipedia-artist" }];
        object?[] ids = [null, Undefined, Array.Empty<object>(), "qobuz", new object[] { "qobuz", 5, "wikipedia", "allmusic-artist", "qobuz" }, new object[] { "bandcamp", "spotify", "pitchfork" }];
        var r = Rng(7);
        var cases = new JsonArray();
        for (int i = 0; i < 1500; i++)
        {
            // The object literal's fields in order, each pick drawn as JavaScript draws them.
            var artist = Pick(r, artists); var album = Pick(r, albums); var locale = Pick(r, locales); var accept = Pick(r, accepts);
            var en = Pick(r, enabled); var rv = Pick(r, reviews);
            var wikipedia = Pick(r, [null, "", "https://en.wikipedia.org/wiki/Kid_A"]); var pitchfork = Pick(r, [null, "https://pitchfork.com/reviews/albums/x"]);
            var wikiArtist = Pick(r, [null, "https://en.wikipedia.org/wiki/Radiohead"]); var id = Pick(r, ids);
            cases.Add(Obj(("artist", artist), ("album", album), ("locale", locale), ("accept", accept), ("enabled", en), ("reviews", rv),
                ("wikipedia", wikipedia), ("pitchfork", pitchfork), ("wikipedia_artist", wikiArtist), ("ids", id)));
        }
        var got = (await Csharp(new JsonObject { ["fn"] = "share", ["cases"] = cases.DeepClone() }))["share"];
        Same("share links", cases, got);
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
