using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// A playlist shared as text (v0.8.21): the server's MDRP1 blob (Extras/ShareBlob.cs) held to
/// lib/server/share.js — the fields, a track's entry and the whole document made the same; each side's
/// blob read by the other; and pastes read the same, passing and failing alike. Through
/// `mandarin-server score`; the routes run in PlaylistsTests. The Node server's answers are kept
/// (test/golden/share-csharp.json) with the blobs it wrote and the pastes, and its own blobs are read
/// as MusicD Remote reads them (test/share-csharp.test.js, in C#).
/// </summary>
public sealed class ShareCsharpTests(ShareCsharpTests.Book book) : IClassFixture<ShareCsharpTests.Book>
{
    /// <summary>test/golden/share-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("share-csharp");

    // The version and date a document carries, as recorded (the Node server wrote its own version).
    private const string Version = "0.8.50";
    private const string Date = "2026-10-08T12:34:56.789Z";

    private static async Task<JsonNode> Csharp(JsonObject job)
    {
        job["fn"] = "blob";
        var r = await ServerCommand.Run(["score"], stdin: JsJson.Stringify(job, markNegativeZero: false) + "\n");
        Assert.True(r.Code == 0, r.Err);
        var o = JsJson.Parse(r.Out.Split('\n')[0])!;
        Assert.True(o["error"] == null, o.Str("error"));
        return o;
    }

    private static List<JsonNode?> List(JsonNode? a) => [.. a!.AsArray()];

    // Each answer the Node server's (kept), the first that isn't shown with its case.
    private void Same(string what, IReadOnlyList<JsonNode?> cases, JsonNode? got) =>
        book.Kept.Same(what, [.. cases.Select((_, i) => (object?)(what + " " + i))], cases, List(got));

    // Documents made by the C# server (held to the Node server's in the test below), for the blobs and pastes.
    private static async Task<JsonNode> DocOf(string name, JsonArray tracks) =>
        (await Csharp(new JsonObject { ["docs"] = new JsonArray(new JsonObject { ["name"] = name, ["tracks"] = tracks }), ["date"] = Date, ["version"] = Version }))["doc"]![0]!["doc"]!.DeepClone();

    // An MDRP1 blob read as MusicD Remote reads one: base64url, gunzip, JSON.
    private static JsonNode? ReadBlob(string blob)
    {
        var b64 = blob[6..].Replace('-', '+').Replace('_', '/');
        b64 += new string('=', (4 - b64.Length % 4) % 4);
        using var z = new GZipStream(new MemoryStream(Convert.FromBase64String(b64)), CompressionMode.Decompress);
        using var o = new MemoryStream();
        z.CopyTo(o);
        return JsJson.Parse(Encoding.UTF8.GetString(o.ToArray()));
    }

    private static readonly object?[] Strings = ["Song 1", "  spaced   out  ", "Tab\tname\nline", "\u00a0nbsp\u3000", "\ufeffbom\ufeff", "\u0085nel\u0085", "\u2028ls\u2029", new string('a', 600),
        new string(' ', 10) + new string('x', 498) + "  y", "Ünïcode 😀", string.Concat(Enumerable.Repeat("😀", 300)), "\ud800lone", "lone\udc00", "", " ", "\u180e", "\u200b x \u200b"];
    private static readonly object?[] Values = [null, 0, 5, true, new object[] { "a" }, JsonNode.Parse("""{"x":1}""")];

    [Test]
    public async Task The_fields_text_numbers_and_addresses_as_share_js_keeps_them()
    {
        var texts = new JsonArray();
        foreach (var v in Strings.Concat(Values)) foreach (var max in new[] { 500, 200, 32, 3 }) texts.Add(new JsonArray(JsJson.Of(v), max));
        object?[] nums = ["7", " 12abc", "-3", "1e3", 3.9, "0x1F", "", null, true, new object[] { 5 }, new object[] { "5", "6" }, "999", "1000", "2999", "3000", 1e21, 1e-7, -0.0, " \u00a0 42",
            "\ufeff42", "\u008542", "+8", "08", "１２", 86400000, "86400001", JsonNode.Parse("""{"a":1}""")];
        var ints = new JsonArray();
        foreach (var v in nums) foreach (var (min, max) in new[] { (1, 999), (1000, 2999), (1, 99), (1, 86400000), (0, 50000000) }) ints.Add(new JsonArray(JsJson.Of(v), min, max));
        var uris = JsJson.Of(new object?[] { null, "spotify:x", Array.Empty<object>(),
            new object?[] { "https://a", " spotify:track:1 ", "nope", "1http:x", "x:y", "x:y", 5, null, "kK:x", "ſ:x", new string('a', 499) + ":", new string('a', 500) + ":", "mailto:a", "urn:x", "e:5" },
            new object[] { "a:1", "b:2", "a:1", "c:3", "d:4", "e:5" }, new object[] { " A+.-9:zz ", "+a:x", "a b:x", "é:x", "ab" } })!.AsArray();
        var output = await Csharp(new JsonObject { ["texts"] = texts.DeepClone(), ["ints"] = ints.DeepClone(), ["uris"] = uris.DeepClone() });
        // As JSON carried them (−0 a 0).
        static List<JsonNode?> Plain(JsonArray a) => List(JsJson.Parse(JsJson.Stringify(a, markNegativeZero: false)));
        Same("shareText", Plain(texts), output["text"]);
        Same("shareInt", Plain(ints), output["int"]);
        Same("shareUriList", Plain(uris), output["uris"]);
    }

    private static JsonArray Many(int n) => new([.. Enumerable.Range(0, n).Select(i => (JsonNode?)(i % 3 == 0
        ? new JsonObject { ["artist"] = "untitled " + i }
        : new JsonObject { ["title"] = "T" + i, ["artist"] = "A" + (i % 7), ["album"] = "B" + (i % 5), ["track_no"] = (i % 30) + 1 }))]);

    [Test]
    public async Task A_tracks_entry_and_the_whole_document_made_the_same()
    {
        var entries = JsonNode.Parse("""
            [
              { "title": "Song 1", "artist": "Artist A", "album": "Album One", "track_no": 1 },
              { "title": "  Song   2 ", "artist": " A ", "album": "", "track_no": "02", "duration_ms": "215000", "isrc": "GBAYE0601498", "upc": " 0886 ", "year": "1997", "disc": 2,
                "qobuz_album_id": "abc123", "tidal_album_id": 42, "identifier": ["https://musicbrainz.org/recording/x", "nope", "isrc:GB1"], "location": ["file:///x.flac"] },
              { "title": "" }, { "title": "   " }, { "artist": "No title" }, null, "Song", 5, ["title"], { "title": 5 }, { "title": ["x"] },
              { "title": "Edge", "track_no": 0, "duration_ms": 0, "year": 999, "disc": 100, "isrc": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "identifier": "https://x" },
              { "title": "Years", "year": "2999.9", "disc": "1e2", "track_no": 999.5, "duration_ms": 86400000 },
              { "title": "Order", "extension": { "evil": true }, "creator": "ignored", "trackNum": 9 }
            ]
            """)!.AsArray();
        entries.Add(new JsonObject { ["title"] = "\ud800lone", ["artist"] = " ", ["album"] = string.Concat(Enumerable.Repeat("😀", 260)) });
        JsonArray Slice(int from, int to) => new([.. entries.Skip(from).Take(to - from).Select(e => e?.DeepClone())]);
        var exactly = new JsonArray([.. Many(3000).Where(t => t!["title"] != null).Take(2000).Select(t => t?.DeepClone()), new JsonObject { ["title"] = "one more" }]);
        var docs = new JsonArray(
            new JsonObject { ["name"] = "Mine", ["tracks"] = entries.DeepClone() },
            new JsonObject { ["name"] = "  Road\ttrip  ", ["annotation"] = " for the car ", ["tracks"] = Slice(0, 2) },
            new JsonObject { ["name"] = "", ["annotation"] = "", ["tracks"] = Slice(0, 1) },
            new JsonObject { ["name"] = 5, ["annotation"] = new JsonArray("x"), ["tracks"] = new JsonArray() },
            new JsonObject { ["name"] = new string('x', 300), ["annotation"] = new string('y', 700), ["tracks"] = "not a list" },
            new JsonObject { ["tracks"] = Many(3100) },
            new JsonObject { ["name"] = "Exactly", ["tracks"] = exactly });
        var output = await Csharp(new JsonObject { ["entries"] = entries.DeepClone(), ["docs"] = docs.DeepClone(), ["date"] = Date, ["version"] = Version });
        Same("a track's entry", List(entries), output["entry"]);
        Same("the document", List(docs), output["doc"]);
        JsonAssert.Same("[[6,9,false],[2,0,false],[1,0,false],[0,0,false],[0,0,false],[2000,1000,true],[2000,0,true]]",
            new JsonArray([.. output["doc"]!.AsArray().Select(w => (JsonNode?)new JsonArray(w!["track_count"]?.DeepClone(), w["skipped"]?.DeepClone(), w["truncated"]?.DeepClone()))]));
    }

    [Test]
    public async Task Each_sides_blob_read_by_the_other()
    {
        var docs = new JsonArray(
            await DocOf("Mine", JsonNode.Parse("""[{ "title": "Song 1", "artist": "Artist A", "album": "Album One", "track_no": 1 }]""")!.AsArray()),
            await DocOf("Ünïcode 😀", new JsonArray([.. Enumerable.Range(0, 400).Select(i => (JsonNode?)new JsonObject
                { ["title"] = "Track " + i + " " + new string('é', i % 23), ["artist"] = "Artist " + (i % 9), ["album"] = "Album " + (i % 17), ["track_no"] = (i % 25) + 1 })])),
            new JsonObject { ["playlist"] = new JsonObject { ["title"] = "\ud800 lone", ["track"] = new JsonArray() } });
        var encoded = (await Csharp(new JsonObject { ["encodes"] = docs.DeepClone() }))["encoded"]!.AsArray();
        Assert.Equal(docs.Count, encoded.Count);
        for (int i = 0; i < encoded.Count; i++)
        {
            Assert.Matches("^MDRP1:[A-Za-z0-9_-]+$", (string?)encoded[i]);
            Assert.True(JsJson.DeepEqual(docs[i], ReadBlob((string)encoded[i]!)), "the C# server's blob read as MusicD Remote reads it");
        }
        var nodeBlobs = book.Kept.Input("the Node server's blobs")!.AsArray();
        var both = new JsonArray([.. encoded.Select(e => e?.DeepClone()), .. nodeBlobs.Select(e => e?.DeepClone())]);
        var decoded = (await Csharp(new JsonObject { ["decodes"] = both.DeepClone() }))["decoded"]!.AsArray();
        for (int i = 0; i < encoded.Count; i++) Assert.True(JsJson.DeepEqual(new JsonObject { ["doc"] = docs[i]!.DeepClone() }, decoded[i]), "the C# server reads its own: " + i);
        Same("each side's blob read", List(both), decoded);
        Assert.True(decoded.All(d => d!["doc"] != null), "all read");
    }

    [Test]
    public async Task Pastes_read_the_same_passing_and_failing_alike()
    {
        // Kept as made, but for the large stored one, written here by hand the same everywhere.
        var big = await BigStored();
        var pastes = new JsonArray([.. book.Kept.Input("the pastes")!.AsArray().Select(p => (JsonNode?)JsonValue.Create((string?)p == BigStoredMark ? big : (string?)p))]);
        var decoded = (await Csharp(new JsonObject { ["decodes"] = pastes.DeepClone() }))["decoded"]!.AsArray();
        Assert.Equal(pastes.Count, decoded.Count);
        Same("pastes", [.. pastes.Select(p => (JsonNode?)JsonValue.Create(Cut60((string)p!)))], decoded);
        // The cases meant: read, and refused for each reason.
        var said = decoded.Select(d => d!["doc"] != null ? "ok" : d.Str("error")!.Split(" — ")[0]).ToList();
        Assert.Equal(["ok", "ok", "ok", "That playlist is damaged", "ok", "ok", "ok", "That playlist is damaged", "That playlist is damaged"], said.Take(9));
        Assert.True(said.Contains("That doesn't look like a MusicD Remote playlist") && said.Contains("That playlist is empty") &&
            said.Contains("That playlist has no tracks in it") && said.Count(x => x == "ok") > 15, string.Join(" | ", said));
    }

    // JavaScript's slice(0, 60): sixty UTF-16 units.
    private static string Cut60(string s) => s.Length > 60 ? s[..60] : s;

    // A large playlist, as a gzip member of stored deflate blocks (written by hand: no zlib's choices in it).
    private const string BigStoredMark = "<the large playlist, stored>";

    private static async Task<string> BigStored()
    {
        var doc = await DocOf("Big", new JsonArray([.. Enumerable.Range(0, 900).Select(i => (JsonNode?)new JsonObject
            { ["title"] = "Track " + i, ["artist"] = "Artist " + (i % 11), ["album"] = "Album " + (i % 31), ["track_no"] = (i % 20) + 1, ["isrc"] = "GB" + (1000000 + i * 7919) })]));
        var data = Encoding.UTF8.GetBytes(JsJson.Stringify(doc, markNegativeZero: false));
        using var o = new MemoryStream();
        o.Write([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]);
        for (int at = 0; at < data.Length; at += 65535)
        {
            int n = Math.Min(65535, data.Length - at);
            o.WriteByte((byte)(at + 65535 >= data.Length ? 1 : 0));
            o.Write(BitConverter.GetBytes((ushort)n));
            o.Write(BitConverter.GetBytes((ushort)~n));
            o.Write(data, at, n);
        }
        o.Write(BitConverter.GetBytes(Crc32(data)));
        o.Write(BitConverter.GetBytes((uint)data.Length));
        return "MDRP1:" + Convert.ToBase64String(o.ToArray()).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    // zlib's CRC-32.
    private static uint Crc32(byte[] data)
    {
        uint c = 0xffffffff;
        foreach (var b in data)
        {
            c ^= b;
            for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xedb88320 ^ (c >> 1) : c >> 1;
        }
        return ~c;
    }
}
