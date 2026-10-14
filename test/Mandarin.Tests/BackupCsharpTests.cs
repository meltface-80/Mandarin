using System.IO.Compression;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Backup &amp; restore's file (v0.8.22): the server's (Admin/Backup.cs) held to lib/backup.js — a backup
/// written by either read by the other, the parts and the database copy the same; damaged files refused
/// in the same words; the versions compared, the parts asked for read, and the JSON written one space a
/// level, as JSON.stringify writes it. Through `mandarin-server score`; the routes run in BackupTests.
/// The Node server's side is kept (test/golden/backup-csharp.json): the backups it wrote (and the
/// damaged files made from them) whole, and its readings of every file (test/backup-csharp.test.js, in C#).
/// </summary>
public sealed class BackupCsharpTests(BackupCsharpTests.Book book) : IClassFixture<BackupCsharpTests.Book>
{
    /// <summary>test/golden/backup-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("backup-csharp");

    private static async Task<JsonNode> Csharp(JsonObject job)
    {
        job["fn"] = "backup";
        var r = await ServerCommand.Run(["score"], stdin: JsJson.Stringify(JsJson.Ordered(job), markNegativeZero: false) + "\n");
        Assert.True(r.Code == 0, r.Err);
        var o = JsJson.Parse(r.Out.Split('\n')[0])!;
        Assert.True(o["error"] == null, o.Str("error"));
        return o;
    }

    private static List<JsonNode?> List(JsonNode? a) => [.. a!.AsArray()];

    // Files the Node server wrote, kept whole and laid down in dir as they were: name → file.
    private Dictionary<string, string> NodeFiles(string label, string dir)
    {
        var files = new Dictionary<string, string>();
        foreach (var (name, v) in book.Kept.Input(label)!.AsObject())
        {
            var f = Path.Combine(dir, name);
            File.WriteAllBytes(f, Convert.FromBase64String((string)v!));
            files[name] = f;
        }
        return files;
    }

    private static readonly JsonObject Manifest = JsJson.Parse("""
        { "app": "mandarin", "format": 1, "version": "0.8.22", "created": 1760000000000, "from": { "name": "iPhone · Safari", "kind": "browser" }, "phone": null, "parts": ["settings", "database"] }
        """)!.AsObject();

    // As the JavaScript literal made it: "\ud800" a lone surrogate, the -0 a −0.
    private static readonly JsonNode Server = JsJson.Ordered(JsJson.Parse("""
        { "settings": { "homeRows": [{ "id": "later", "on": true }], "smartPicksHour": 7, "music_folders": ["/music", "/mnt/ünïcode"] },
          "collection": { "settings": { "userPlaylists": [] }, "tables": { "favourites": [{ "key": "album-a", "added_at": 1 }], "album_edits": [{ "key": "k", "art": { "$b64": "AAEC" } }] } },
          "odd": { "2": "b", "1": "a", "": null, "\ud800": "lone", "emoji": "😀", "nested": [[], {}, [1, [2]]], "n": [0, -0, 1e21, 1.5e-7] } }
        """))!;

    private static JsonObject Entry(string name, JsonNode? data = null, string? file = null)
    {
        var o = new JsonObject { ["name"] = name };
        if (file != null) o["file"] = file; else o["data"] = data?.DeepClone();
        return o;
    }

    private static byte[] Gunzip(string file)
    {
        using var z = new GZipStream(File.OpenRead(file), CompressionMode.Decompress);
        using var o = new MemoryStream();
        z.CopyTo(o);
        return o.ToArray();
    }

    // The tar with the times written left out: each header's mtime and checksum.
    private static byte[] Strip(byte[] buf)
    {
        var c = (byte[])buf.Clone();
        for (int o = 0; o + 512 <= c.Length; o += 512)
            if (c[o + 257] == 0x75) { Array.Fill(c, (byte)0x30, o + 136, 11); Array.Fill(c, (byte)0x20, o + 148, 8); }
        return c;
    }

    [Test]
    public async Task A_backup_written_by_either_is_read_by_the_other_its_parts_and_the_database_copy()
    {
        var dir = Directory.CreateTempSubdirectory("musicd-bk-").FullName;
        var db = Path.Combine(dir, "x.db");
        await File.WriteAllBytesAsync(db, [.. Enumerable.Range(0, 70001).Select(i => (byte)((i * 7) & 0xff))]);
        var empty = Path.Combine(dir, "empty.db");
        await File.WriteAllTextAsync(empty, "");
        var withNoParts = (JsonObject)Manifest.DeepClone();
        withNoParts["parts"] = new JsonArray();
        JsonArray[] sets =
        [
            [Entry("manifest.json", Manifest), Entry("server.json", Server), Entry("page.json", JsonNode.Parse("""{"rra-ui-text":"1.25"}""")), Entry("musicd.db", file: db)],
            [Entry("manifest.json", withNoParts)],
            [Entry("manifest.json", Manifest), Entry("musicd.db", file: empty), Entry("other.txt", JsonValue.Create("ignored")), Entry(new string('x', 120) + ".json", JsonNode.Parse("""{"long":true}"""))]
        ];
        // Its backups of the same three sets.
        var written = NodeFiles("the Node server's backups", dir);
        var byNode = Enumerable.Range(0, sets.Length).Select(i => written[$"node-{i}.tar.gz"]).ToList();
        var byCs = Enumerable.Range(0, sets.Length).Select(i => Path.Combine(dir, $"cs-{i}.tar.gz")).ToList();
        await Csharp(new JsonObject { ["writes"] = new JsonArray([.. sets.Select((e, i) => (JsonNode?)new JsonObject { ["to"] = byCs[i], ["entries"] = e.DeepClone() })]) });
        var files = byNode.Concat(byCs).ToList();
        var output = await Csharp(new JsonObject { ["reads"] = new JsonArray([.. files.Select((f, i) => (JsonNode?)new JsonObject { ["file"] = f, ["db"] = Path.Combine(dir, $"cs-read-{i}.db") })]) });
        var names = files.Select(f => (JsonNode?)JsonValue.Create(Path.GetFileName(f))).ToList();
        book.Kept.Same("read", [.. names.Select(n => (object?)(string?)n)], names, List(output["read"]));
        Assert.True(output["read"]!.AsArray().All(w => w?["parts"]?["manifest"] != null), string.Join(", ", output["read"]!.AsArray().Select(w => w.Str("error"))));
        Assert.True(output["read"]![0].Str("db") == Convert.ToBase64String(await File.ReadAllBytesAsync(db)), "the database copy, byte for byte");
        // The same tar, header for header: only the gzip around it differs.
        for (int i = 0; i < sets.Length; i++)
            Assert.True(Strip(Gunzip(byNode[i])).AsSpan().SequenceEqual(Strip(Gunzip(byCs[i]))), $"set {i}: the same tar but for the times written");
    }

    [Test]
    public async Task Damaged_and_foreign_files_are_refused_in_the_same_words()
    {
        var dir = Directory.CreateTempSubdirectory("musicd-bk-").FullName;
        // A good backup of the Node server's, and files made from it (kept whole).
        var made = NodeFiles("the damaged and foreign files", dir);
        var names = made.Keys.Select(n => n.EndsWith(".bin", StringComparison.Ordinal) ? n[..^4] : n).ToList();
        var reads = new JsonArray([.. names.Select(n => (JsonNode?)(n == "withdb"
            ? new JsonObject { ["file"] = made[n + ".bin"] }
            : new JsonObject { ["file"] = made[n + ".bin"], ["db"] = Path.Combine(dir, n + ".cs.db") }))]);
        var output = await Csharp(new JsonObject { ["reads"] = reads });
        var labels = names.Select(n => (JsonNode?)JsonValue.Create(n)).ToList();
        book.Kept.Same("refused", [.. names.Cast<object?>()], labels, List(output["read"]));
        var said = names.Select((n, i) => (n, output["read"]![i].Str("error") ?? "ok")).ToDictionary(x => x.n, x => x.Item2);
        Assert.Equal(["ok", "ok", "incorrect header check", "unexpected end of file", "That isn't a Mandarin backup", "The backup's manifest.json is unreadable", "A database copy wasn't expected here"],
            new[] { "good", "zeroPadded", "notGzip", "cutHalf", "notOurs", "badJson", "withdb" }.Select(k => said[k]));
    }

    [Test]
    public async Task Versions_compared_parts_read_JSON_written_as_JSON_stringify_v_null_1()
    {
        var pairs = JsJson.Parse("""
            [["0.6.14", "0.6.9"], ["0.6.9", "0.6.14"], ["0.6.14", "0.6.14"], ["0.6.0", "0.6.0-RC4"], ["0.6.0-RC4", "0.6.0"], ["0.6.0-RC10", "0.6.0-RC9"],
             ["1", "0.9.9"], ["", "0.1"], [null, "0.0.1"], [0.8, "0.8"], ["0.8.22", "0.8.21"], ["0.8.21", "0.8.22"], ["9.9.9", "0.8.22"], ["0.8.22.1", "0.8.22"], ["0.8", "0.8.0"],
             ["a.b", "a.c"], ["1.a", "1.1"], ["1.1", "1.a"], ["01.2", "1.2"], ["1..2", "1.2"], ["-1", "1"]]
            """)!.AsArray();
        var values = JsJson.Ordered(JsJson.Parse("""
            ["settings,keys,bogus", "settings, keys ,page,app", "", "database", ["settings", 5, null, "keys", ["devices"]], { "database": 1, "page": true, "devices": false, "nope": true },
             { "2": true, "settings": "yes", "keys": 0 }, null, 5, true, ["app", "app", "page"]]
            """))!.AsArray();
        // { u: undefined, f: [undefined, 1] } as JSON carries it: { f: [null, 1] }.
        var docs = JsJson.Ordered(new JsonArray(Manifest.DeepClone(), Server.DeepClone(), new JsonObject(), new JsonArray(), new JsonArray(new JsonArray()),
            JsonNode.Parse("""{"a":{}}"""), JsonNode.Parse("""{"a":[]}"""), "text", 5, null, JsonNode.Parse("""{"f":[null,1]}"""), JsonNode.Parse("""{"1":1,"0":0,"b":2,"a":1}""")))!.AsArray();
        // As JSON carried them (−0 a 0).
        var plainDocs = JsJson.Parse(JsJson.Stringify(docs, markNegativeZero: false))!.AsArray();
        var output = await Csharp(new JsonObject { ["newer"] = pairs.DeepClone(), ["parts_of"] = values.DeepClone(), ["pretty"] = plainDocs.DeepClone() });
        book.Kept.Same("newer", [.. pairs.Select(_ => (object?)"pair")], List(pairs), List(output["newer"]));
        book.Kept.Same("partsOf", [.. values.Select(_ => (object?)"value")], List(values), List(output["parts_of"]));
        var pretty = output["pretty"]!.AsArray().Select(x => (string?)x).ToList();
        Assert.Equal(plainDocs.Select(d => JsJson.Pretty(d)), pretty);
    }
}
