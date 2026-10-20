using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// The answers the Android app's typed client reads (stage N1 of old/plan-android-native.md),
/// as this server gives them on the suite's own library: test/golden/android-api.json, each with the
/// path it was asked by, which the app's own tests answer its client with (android/core, LibraryTest). A change to any of them fails here until the file is
/// written again, so the app is told: MANDARIN_GOLDEN_WRITE=1 writes it (then this passes), never CI.
/// What changes from run to run is kept as a placeholder: the cover keys (made from the files' times)
/// and the day; the album of the day, the day's pick of the library's, as the list's first.
/// </summary>
public sealed partial class AndroidApiTests
{
    private static readonly string FilePath = Path.Combine(ServerProcess.Root, "test", "golden", "android-api.json");

    /// <summary>Each answer by name, as asked.</summary>
    private static readonly (string Name, string Path)[] Asked =
    [
        ("albums", "/api/library/albums?count=60"),
        ("album", "/api/album?offset={first}"),
        ("artists", "/api/artists"),
        ("artist_albums", "/api/artist-albums?artist=Artist%20A"),
        ("search", "/api/search?q=album"),
        ("home_rows", "/api/settings/home-rows"),
        ("home_history", "/api/home/history"),
        ("home_unplayed", "/api/home/unplayed"),
        ("home_album_of_the_day", "/api/home/album-of-the-day"),
        // Home's other rows (bug list item 57).
        ("smart_picks", "/api/smart-picks"),
        ("genres", "/api/filters/genres"),
        ("genre_groups", "/api/home/genre-groups"),
        ("label_of_the_week", "/api/home/label-of-the-week"),
        ("user_playlists", "/api/user-playlists"),
        ("smart_playlists", "/api/smart-playlists"),
        ("favourites", "/api/favourites"),
        ("listen_later", "/api/listen-later"),
        ("pick_unheard", "/api/pick-unheard"),
    ];

    [GeneratedRegex("^al-\\d+-[0-9a-f]+$")]
    private static partial Regex ImageKey();

    [GeneratedRegex("^\\d{4}-\\d{2}-\\d{2}$")]
    private static partial Regex Day();

    [GeneratedRegex("^/api/image/al-\\d+-[0-9a-f]+\\?size=\\d+$")]
    private static partial Regex ImageUrl();

    // What differs from run to run, made the same.
    private static JsonNode? Steady(JsonNode? n, string? key = null)
    {
        switch (n)
        {
            case JsonObject o:
                var c = new JsonObject();
                foreach (var (k, v) in o) c[k] = Steady(v, k);
                return c;
            case JsonArray a:
                return new JsonArray(a.Select(v => Steady(v)).ToArray());
            case JsonValue v when v.TryGetValue<string>(out var s):
                if (key == "image_key" && ImageKey().IsMatch(s)) return "<image_key>";
                if (key == "day" && Day().IsMatch(s)) return "<day>";
                if (key == "image" && ImageUrl().IsMatch(s)) return "<image>";
                return s;
            default:
                return n?.DeepClone();
        }
    }

    [Test]
    public async Task The_answers_the_Android_app_reads_are_as_it_was_told()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await LibraryServer.Start(Fixtures.MakeLibrary());
        var first = (await s.Albums()).First(a => a.Str("title") == "Album One")["offset"]!.ToJsonString();
        // Smart Picks are made in the background after the scan: waited for, so the recording holds the day's set.
        for (var i = 0; i < 150 && (await s.GetJ("/api/smart-picks"))!["picks"]!.AsArray().Count == 0; i++) await Task.Delay(200);
        var got = new JsonObject();
        foreach (var (name, asked) in Asked)
        {
            var path = asked.Replace("{first}", first, StringComparison.Ordinal);
            got[name] = new JsonObject { ["path"] = path, ["answer"] = Steady(await s.GetJ(path)) };
        }
        // The album of the day is the day's pick: one of the library's albums, as the list has it, kept as its first.
        var list = got["albums"]!["answer"]!["albums"]!.AsArray();
        var day = got["home_album_of_the_day"]!["answer"]!.AsObject();
        Assert.True(list.Any(a => JsonNode.DeepEquals(a, day["album"])), "the album of the day is one of the library's, as the list has it");
        day["album"] = list[0]!.DeepClone();
        // Random Album's choice likewise: any of the library's, kept as its first.
        var picked = got["pick_unheard"]!["answer"]!.AsObject();
        Assert.True(list.Any(a => JsonNode.DeepEquals(a, picked["album"])), "Random Album's choice is one of the library's, as the list has it");
        picked["album"] = list[0]!.DeepClone();
        // Smart Picks come in no fixed order (the least played, all alike here): kept by album name.
        var picks = got["smart_picks"]!["answer"]!["picks"]!.AsArray();
        var sorted = picks.OrderBy(p => p!["album"]!.GetValue<string>(), StringComparer.Ordinal).Select(p => p!.DeepClone()).ToArray();
        got["smart_picks"]!["answer"]!["picks"] = new JsonArray(sorted);
        var text = got.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
        if (Environment.GetEnvironmentVariable("MANDARIN_GOLDEN_WRITE") == "1")
        {
            File.WriteAllText(FilePath, text);
            return;
        }
        Assert.True(File.Exists(FilePath), "test/golden/android-api.json: written with MANDARIN_GOLDEN_WRITE=1");
        var want = JsonNode.Parse(File.ReadAllText(FilePath))!.AsObject();
        foreach (var (name, _) in Asked)
            Assert.True(JsonNode.DeepEquals(want[name], got[name]),
                $"{name} has changed: the Android app reads it (android/core). Write the file again (MANDARIN_GOLDEN_WRITE=1) and see LibraryTest.\nnow: {got[name]?.ToJsonString()}\nwas: {want[name]?.ToJsonString()}");
    }
}
