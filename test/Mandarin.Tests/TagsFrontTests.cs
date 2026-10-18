using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The tag reader in C# (v0.8.13, server/Mandarin.Server/Tags/) reads every file as the Node server's
/// scanner read it (scanner.js readTags over music-metadata 11.16.0), to the byte, as JSON: every format
/// and tag layout (Harness/TagFixtures.cs) and each of them damaged, where a file one reader can't read
/// must be one the other can't either. The Node reader's readings of these files are kept
/// (test/golden/tags-front.json, as a sum of each run of 32), so the files must be the ones they were
/// made from: ffmpeg's are kept as it made them, and their names are kept too (test/tags-front.test.js,
/// in C#).
/// </summary>
public sealed class TagsFrontTests(TagsFrontTests.Book book) : IClassFixture<TagsFrontTests.Book>
{
    /// <summary>test/golden/tags-front.json.</summary>
    public sealed class Book() : KeptBook("tags-front");

    [Test]
    public async Task The_CSharp_tag_reader_reads_every_file_as_music_metadata_does()
    {
        Needs.Server();
        var dir = Directory.CreateTempSubdirectory("musicd-tags-").FullName;
        try
        {
            var files = TagFixtures.Build(dir);
            Assert.True(files.Count > 400, "the files made: " + files.Count);
            var names = new JsonArray([.. files.Select(f => (JsonNode?)Path.GetFileName(f))]);
            book.Kept.Same("the files made", ["names"], [null], [names]);
            var r = await ServerCommand.Run(["tags"], stdin: string.Join("\n", files));
            Assert.True(r.Code == 0, r.Err);
            var cs = r.Out.Trim().Split('\n').Select(l => JsJson.Parse(l)!).ToDictionary(x => x.Str("path")!);
            // Each file's reading as JSON.stringify writes the tags, or null where it can't be read.
            var got = files.Select(f =>
            {
                Assert.True(cs.TryGetValue(f, out var c), "read " + f);
                return (JsonNode?)(c.Bool("ok") == true ? JsonValue.Create(JsJson.Stringify(c["tags"], markNegativeZero: false)) : null);
            }).ToList();
            book.Kept.Same("readings", [.. files.Select(f => (object?)Path.GetFileName(f))], [.. files.Select(f => (JsonNode?)Path.GetFileName(f))], got);
            Assert.True(got.Count(x => x != null) > 300, "read: " + got.Count(x => x != null));
            // The clean files themselves were read, not just failed alike.
            foreach (var name in new[] { "rich_v23.mp3", "rich_v24.mp3", "vorbis_rich.flac", "aac.m4a", "plain.dsf", "plain.dff", "monkey.ape", "renamed.aiff" })
                if (cs.TryGetValue(Path.Combine(dir, name), out var c)) Assert.True(c.Bool("ok") == true, name + " read: " + c.Str("error"));
            if (cs.TryGetValue(Path.Combine(dir, "rich_v23.mp3"), out var rich))
            {
                Assert.Equal("Rich Title ü", rich["tags"].Str("title"));
                Assert.Equal("9ab1c2d3-e4f5-6789-abcd-ef0123456789", rich["tags"].Str("mb_recording"));
                Assert.Equal(-7.21, rich["tags"].Num("rg_track_gain"));
            }
        }
        finally { Directory.Delete(dir, true); }
    }
}
