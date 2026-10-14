using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// Playlists: a user playlist made from tracks or whole albums, a Dynamic Playlist saved from a Library
/// view, and sharing — the MDRP1 blob MusicD Remote writes and reads, so a playlist goes either way
/// between the two (test/playlists.test.js, in C#: its steps, in order, in one test).
/// </summary>
public sealed partial class PlaylistsTests
{
    [GeneratedRegex(@"^(share|user-playlists?|smart-playlists?)\b")] private static partial Regex Ours();

    [Test]
    public async Task The_share_blob_is_MusicD_Remotes_MDRP1_gzip_JSPF()
    {
        // The C# server's (Extras/ShareBlob.cs).
        var made = (await Score.Run(new { fn = "blob", docs = new[] { new { name = "Mine", tracks = new object[] { new { title = "Song 1", artist = "Artist A", album = "Album One", track_no = 1 }, new { title = "" } } } } }))["doc"]![0]!;
        Assert.Equal((1.0, 1.0), (made.Num("track_count"), made.Num("skipped")));
        var blob = (string)(await Score.Run(new { fn = "blob", encodes = new[] { made["doc"] } }))["encoded"]![0]!;
        Assert.Matches("^MDRP1:[A-Za-z0-9_-]+$", blob);
        // Pasted with words around it, wrapped, and the marker lower-cased by a phone.
        var wrapped = "Here you go:\n" + Regex.Replace(blob.Replace("MDRP1", "mdrp1", StringComparison.Ordinal), "(.{40})", "$1\n") + "\nEnjoy";
        var decoded = (await Score.Run(new { fn = "blob", decodes = new[] { wrapped, "nothing here" } }))["decoded"]!;
        Assert.Equal("Mine", decoded[0]!["doc"]?["playlist"].Str("title"));
        JsonAssert.Same("""{"title":"Song 1","creator":"Artist A","album":"Album One","trackNum":1}""", decoded[0]!["doc"]?["playlist"]?["track"]?[0]);
        Assert.Matches("MusicD Remote playlist", decoded[1].Str("error"));
    }

    // A playlist's id as an address carries it.
    private static string IdOf(JsonNode p) => p.Str("id") ?? p["id"]!.ToJsonString();

    [Test]
    public async Task Playlists()
    {
        await using var s = await Session.Started();
        async Task<JsonNode> Api(string p, object? body = null)
        {
            var r = body == null ? await s.Api(p) : await s.Api(p, body);
            if (Ours().IsMatch(p)) Assert.True(r.Header("x-mandarin-answered") == "C#", p + ": made by the C# server");
            var o = r.Json as JsonObject ?? [];
            o["status"] = r.Status;
            return o;
        }
        await Session.Until(async () => (await Api("status")).Num("index_count") == 3, 10000, "the library");
        var albums = (await Api("library/albums?sort=album"))["albums"].Items().ToList();
        var one = albums.First(a => a.Str("title") == "Album One")!; var hi = albums.First(a => a.Str("title") == "Hi Res")!;
        var oneOffset = one.Num("offset");

        // A new playlist from chosen tracks, then whole albums into it.
        var tracks = (await Api("album?offset=" + oneOffset))["tracks"].Items().ToList();
        var entries = tracks.Take(2).Select((tr, i) => new { album_offset = oneOffset, album_title = one.Str("title"), album_subtitle = one.Str("subtitle"), track_index = i,
            title = tr.Str("title"), subtitle = tr.Str("subtitle"), image_key = one.Str("image_key"), track_no = i + 1 }).ToArray();
        var r = await Api("user-playlists/add", new { name = "Road trip", tracks = entries });
        Assert.True(r.Num("status") == 200, r.ToJsonString());
        Assert.Equal((2.0, 2.0), (r.Num("added"), r.Num("track_total")));
        var list = (await Api("user-playlists"))["playlists"].Items().ToList();
        Assert.Equal([("Road trip", 2.0)], list.Select(p => (p.Str("name"), p.Num("track_total") ?? -1)));
        var listId = IdOf(list[0]!);
        Assert.Equal(4, (await Api("user-playlists/add-albums", new { id = list[0]!["id"]!.DeepClone(), albums = new[] { new { offset = hi.Num("offset") } } })).Num("track_total"));
        Assert.Equal(["Song 1", "Song 2", "Hi 1", "Hi 2"], (await Api("user-playlist?id=" + listId))["tracks"].Items().Select(x => x.Str("title")));
        // Thin entries are completed from the library: by the album's id and the track's place, or by
        // names alone; a bogus one is skipped with a reason.
        var thin = await Api("user-playlists/add", new
        {
            id = list[0]!["id"]!.DeepClone(),
            tracks = new object[]
            {
                new { album_offset = oneOffset, track_index = 2 },
                new { album_title = "Hi Res", album_subtitle = "Artist B", title = "hi 2" },
                new { album_offset = oneOffset, track_index = 0, title = "Song 3" },
                new { album_title = "Nothing", title = "Nope" },
                new { album_offset = oneOffset, title = "Not there" }
            }
        });
        Assert.True(thin.Num("added") == 3, thin.ToJsonString());
        Assert.Equal(2, thin.Num("skipped"));
        Assert.Equal("1 album not in the library, 1 track not on that album", thin.Str("reason"));
        var after = (await Api("user-playlist?id=" + listId))["tracks"].Items().Skip(4).Select(x => (x.Str("title"), x.Str("album_title"), x.Num("track_index") ?? -1));
        Assert.True(after.SequenceEqual([("Song 3", "Album One", 2.0), ("Hi 2", "Hi Res", 1.0), ("Song 3", "Album One", 2.0)]), "the title wins over a wrong place");
        Assert.Equal(400, (await Api("user-playlists/add", new { name = "", tracks = entries })).Num("status"));
        Assert.True((await Api("user-playlists/add", new { name = "Empty" })).Num("status") == 400, "tracks required");

        // A Dynamic Playlist from a Library view.
        r = await Api("smart-playlists", new { name = "Rock, shuffled", view = new { sort = "album", genre = new[] { "Rock" } }, order = "random", limit = 25 });
        Assert.True(r.Num("status") == 200, r.ToJsonString());
        Assert.Equal("random", r["playlist"].Str("order"));
        var smart = (await Api("smart-playlists"))["playlists"].Items().ToList();
        Assert.Single(smart);
        Assert.True(smart[0].Num("matched") == 1, "Album One is the Rock album");
        Assert.Equal(["Album One"], (await Api("smart-playlist/albums?id=" + IdOf(smart[0]!)))["albums"].Items().Select(a => a.Str("title")));
        Assert.True((await Api("smart-playlists", new { view = new { } })).Num("status") == 400, "a name is needed");
        Assert.True((await Api("settings/home-rows"))["rows"].Items().Any(x => x.Str("id") == "playlists"), "a Home row for playlists, yours and the Dynamic ones");

        // Shared out and imported back; a playlist from MusicD Remote reads the same.
        var pl = await Api("user-playlist?id=" + listId);
        var enc = await Api("share/encode", new { name = pl.Str("name"), tracks = pl["tracks"].Items().Select(x => new { title = x.Str("title"), artist = x.Str("subtitle"), album = x.Str("album_title"), track_no = x.Num("track_no") }).ToArray() });
        Assert.Equal(7, enc.Num("track_count"));
        Assert.Matches("^MDRP1:", enc.Str("blob"));
        var imp = await Api("share/import", new { blob = enc.Str("blob") });
        Assert.True(imp.Bool("ok"));
        Assert.Equal("Road trip", imp.Str("name"));
        Assert.Equal(7, imp["resolved"].Items().Count());
        Assert.Empty(imp["missing"].Items());
        Assert.True(imp["resolved"]![0].Num("album_offset") == oneOffset, "placed on the album it names");
        // Saved from the import report: a playlist like any other.
        Assert.Equal(7, (await Api("user-playlists/add", new { name = imp.Str("name") + " (shared)", tracks = imp["resolved"]!.DeepClone() })).Num("track_total"));
        // What MusicD Remote writes: the same document, its own generator stamp, and a track whose album
        // this library doesn't have under that name.
        var theirs = (await Score.Run(new { fn = "blob", docs = new[] { new { name = "From Roon", tracks = new object[]
        {
            new { title = "Song 3", artist = "Artist A", album = "Album One (Deluxe)", track_no = 3 },
            new { title = "Never Heard", artist = "Nobody", album = "Nothing" }
        } } } }))["doc"]![0]!["doc"]!;
        theirs["playlist"]!["extension"]!["https://musicbrainz.org/doc/jspf#playlist"]!["additional_metadata"]!["generator"] = "MusicD Remote";
        var theirBlob = (string)(await Score.Run(new { fn = "blob", encodes = new[] { theirs } }))["encoded"]![0]!;
        var imp2 = await Api("share/import", new { blob = theirBlob });
        Assert.Equal("From Roon", imp2.Str("name"));
        Assert.Single(imp2["resolved"].Items());
        Assert.True(imp2["substituted"].Items().Select(x => (x.Str("title"), x.Str("found_album"))).SequenceEqual([("Song 3", "Album One")]), "found by title and artist, the album substitution reported");
        Assert.Equal(["Never Heard"], imp2["missing"].Items().Select(m => m.Str("title")));
        Assert.Equal(400, (await Api("share/import", new { blob = "hello" })).Num("status"));
        // Past the body parser's 2 MB: refused, the rest left unread, as the Node server's express.json refused it.
        var huge = await s.Api("share/import", new { blob = "MDRP1:" + new string('A', 2200000) });
        Assert.Equal(413, huge.Status);
        Assert.Equal("C#", huge.Header("x-mandarin-answered"));
    }
}
