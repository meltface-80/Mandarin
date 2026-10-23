using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Spotify's rules (bug list item 142), asked of the server directly (`mandarin-server score`, fn "spotify";
/// server/Mandarin.Server/Spotify/SpotifyCommand.cs): what the room does as Spotify plays, pauses and stops; what the
/// samples prove; when a Soloist build runs out and what is done about it; lossless asked for in an account's prefs;
/// a track as Soloist says it; the key taken out of what Soloist says.
/// </summary>
public sealed class SpotifyRulesTests
{
    private static Task<JsonNode> Ask(object job)
    {
        var o = System.Text.Json.JsonSerializer.SerializeToNode(job)!.AsObject();
        o["fn"] = "spotify";
        return Score.Run(o);
    }

    private static object Follow(string playback, string last, string want, string? playingIn, bool? live, string state = "playing", bool starting = false) =>
        new { playback, last, want, playing_in = playingIn, room = live is { } l ? new { live = l, state } : null, starting };

    [Test]
    public async Task The_room_follows_Spotify_and_Spotify_follows_the_room()
    {
        var cases = new (object Job, string Want)[]
        {
            (Follow("playing", "idle", "", null, null), "no-room"),
            (Follow("playing", "idle", "lounge", null, null), "start"),
            (Follow("playing", "playing", "lounge", "study", true), "start"),                          // another room chosen since
            (Follow("playing", "playing", "lounge", "lounge", false, "stopped", starting: true), "wait"), // the room still starting the stream
            (Follow("playing", "playing", "lounge", "lounge", true, "stopped", starting: true), "wait"),
            (Follow("playing", "playing", "lounge", "lounge", true), "none"),
            (Follow("playing", "playing", "lounge", "lounge", false), "moved-on"),                    // an album played in the room meanwhile
            (Follow("playing", "paused", "lounge", "lounge", false), "start"),                        // Spotify played again after the room moved on
            (Follow("playing", "paused", "lounge", "lounge", true, "paused"), "resume-room"),
            (Follow("playing", "playing", "lounge", "lounge", true, "paused"), "room-paused"),         // paused in the Sonos app
            (Follow("paused", "playing", "lounge", "lounge", true), "pause-room"),
            (Follow("paused", "paused", "lounge", "lounge", true, "paused"), "none"),
            (Follow("paused", "playing", "lounge", null, null), "none"),
            (Follow("idle", "playing", "lounge", "lounge", true), "stop-room"),
            (Follow("idle", "playing", "lounge", "lounge", false), "forget"),
            (Follow("idle", "idle", "lounge", null, null), "none"),
        };
        var got = (await Ask(new { follows = cases.Select(c => c.Job).ToArray() }))["follows"]!.AsArray();
        for (int i = 0; i < cases.Length; i++) Assert.True(cases[i].Want == (string?)got[i], $"case {i}: {cases[i].Want} wanted, {got[i]} said");
    }

    [Test]
    public async Task The_samples_prove_lossless_24_or_16_bit_or_lossy()
    {
        int[] Tone(int shift, int n = 44100) => [.. Enumerable.Range(0, n).Select(i => ((i % 1000) + 1) << shift)];
        var lossy = Tone(8);
        lossy[^1] |= 1;   // one sample off the 24-bit grid
        var said = (await Ask(new { proofs = new[] { Tone(8), Tone(16), lossy, Tone(8, 1000), new int[44100] } }))["proofs"]!.AsArray();
        Assert.Equal("lossless 24-bit", (string?)said[0]);
        Assert.Equal("lossless 16-bit", (string?)said[1]);
        Assert.Equal("lossy", (string?)said[2]);
        Assert.Equal("", (string?)said[3]);     // not heard enough yet
        Assert.Equal("", (string?)said[4]);     // silence proves nothing
    }

    [Test]
    public async Task A_build_runs_out_90_days_from_its_date_and_is_replaced_in_its_last_30()
    {
        const string V = "soloist 1.3.9 (20261010)";
        var b = (await Ask(new
        {
            builds = new object[]
            {
                new { version = V, exists = true, today = "2026-10-23" },
                new { version = V, exists = true, today = "2026-12-20" },
                new { version = V, exists = true, today = "2027-01-08" },
                new { version = "", exists = false, today = "2026-10-23" },
                new { version = "soloist 1.3.9", exists = true, today = "2026-10-23" },
            }
        }))["builds"]!.AsArray();
        Assert.Equal("2027-01-08", (string?)b[0]!["expires"]);
        Assert.Equal("use refresh download download use", string.Join(" ", b.Select(x => (string?)x!["plan"])));
        Assert.Null(b[4]!["expires"]);
    }

    [Test]
    public async Task Lossless_is_asked_for_in_an_accounts_prefs_and_only_a_change_counts()
    {
        var p = (await Ask(new
        {
            prefs = new object?[]
            {
                null,
                "ui.theme=dark\naudio.play_bitrate_enumeration=2\naudio.normalize_v2=true\n",
                "audio.normalize_v2=false\naudio.play_bitrate_non_metered_enumeration=5\naudio.play_bitrate_enumeration=5\n",
            }
        }))["prefs"]!.AsArray();
        var lossless = "audio.play_bitrate_enumeration=5\naudio.play_bitrate_non_metered_enumeration=5\naudio.normalize_v2=false\n";
        Assert.True(p[0]!["changed"]!.GetValue<bool>());
        Assert.Equal(lossless, (string?)p[0]!["text"]);
        Assert.True(p[1]!["changed"]!.GetValue<bool>());
        Assert.Equal("ui.theme=dark\n" + lossless, (string?)p[1]!["text"]);
        Assert.False(p[2]!["changed"]!.GetValue<bool>(), "the same values in another order are no change (no restart)");
    }

    [Test]
    public async Task A_track_as_Soloist_says_it_and_the_key_taken_out_of_what_it_says()
    {
        const string Track = """
            { "uri": "spotify:track:1", "entity": { "decorations": {
                "identity": { "name": "So What" },
                "creators": [ { "entity": { "decorations": { "identity": { "name": "Miles Davis" } } } }, { "entity": { "decorations": { "identity": { "name": "John Coltrane" } } } } ],
                "parent": { "entity": { "decorations": { "identity": { "name": "Kind of Blue" } } } },
                "visual_identity": { "cover": [ { "size": "small", "url": "https://i/s" }, { "size": "large", "url": "https://i/l" } ] },
                "playback": { "duration_ms": 562000 } } } }
            """;
        var o = await Ask(new { entities = new[] { Track, """{ "uri": "x" }""" }, cleans = new[] { new[] { "key sk-abcd1234 said", "sk-abcd1234" }, new[] { "abc said", "abc" } } });
        var t = o["entities"]![0]!;
        Assert.Equal(("So What", "Miles Davis, John Coltrane", "Kind of Blue", "https://i/l", 562.0, "spotify:track:1"),
            ((string?)t["title"], (string?)t["artists"], (string?)t["album"], (string?)t["cover"], t["duration"]!.GetValue<double>(), (string?)t["uri"]));
        Assert.Null(o["entities"]![1]);
        Assert.Equal("key [key] said", (string?)o["cleans"]![0]);
        Assert.Equal("abc said", (string?)o["cleans"]![1]);   // too short to be a key
    }

    [Test]
    public async Task What_Soloist_is_asked_to_play_an_album_at_its_track_or_a_window_of_songs()
    {
        var songs = Enumerable.Range(0, 250).Select(i => "spotify:track:s" + i).ToArray();
        var b = (await Ask(new
        {
            bodies = new object[]
            {
                new { uris = songs[..12], album = "spotify:album:a1", start = 3, seconds = 0 },
                new { uris = songs, album = (string?)null, start = 200, seconds = 61.5 },
                new { uris = songs[..5], album = (string?)null, start = 2, seconds = 0 },
            }
        }))["bodies"]!.AsArray();
        Assert.Equal("spotify:album:a1", (string?)b[0]!["context_uri"]);
        Assert.Equal("spotify:track:s3", (string?)b[0]!["offset"]!["uri"]);
        Assert.Null(b[0]!["position_ms"]);
        // 100 songs at most, the one asked for in the middle of them, where it was.
        Assert.Equal(100, b[1]!["uris"]!.AsArray().Count);
        Assert.Equal("spotify:track:s150", (string?)b[1]!["uris"]![0]);
        Assert.Equal(50, b[1]!["offset"]!["position"]!.GetValue<int>());
        Assert.Equal(61500, b[1]!["position_ms"]!.GetValue<int>());
        Assert.Equal(5, b[2]!["uris"]!.AsArray().Count);
        Assert.Equal(2, b[2]!["offset"]!["position"]!.GetValue<int>());
    }

    [Test]
    public async Task A_list_mixing_Spotify_with_other_music_plays_the_part_its_first_track_is_in()
    {
        string[] mixed = ["/music/a.flac", "spotify://track/x", "/music/b.flac", "spotify://track/y"];
        var p = (await Ask(new { parts = new object[] { new { paths = mixed, start = 3 }, new { paths = mixed, start = 2 } } }))["parts"]!.AsArray();
        Assert.True(p[0]!["spotify"]!.GetValue<bool>());
        Assert.Equal("spotify://track/x spotify://track/y", string.Join(" ", p[0]!["paths"]!.AsArray().Select(x => (string?)x)));
        Assert.Equal(1, p[0]!["start"]!.GetValue<int>());
        Assert.False(p[1]!["spotify"]!.GetValue<bool>());
        Assert.Equal("/music/a.flac /music/b.flac", string.Join(" ", p[1]!["paths"]!.AsArray().Select(x => (string?)x)));
        Assert.Equal(1, p[1]!["start"]!.GetValue<int>());
    }

    [Test]
    public async Task The_quality_chosen_is_asked_of_Spotify_in_its_own_numbers()
    {
        var p = (await Ask(new { prefs = new object?[] { null, null, null, null }, prefs_quality = new[] { "very_high", "high", "normal", "nonsense" } }))["prefs"]!.AsArray();
        string Rate(JsonNode? x) => ((string)x!["text"]!).Split('\n').First(l => l.StartsWith("audio.play_bitrate_enumeration=", StringComparison.Ordinal));
        Assert.Equal("audio.play_bitrate_enumeration=4", Rate(p[0]));
        Assert.Equal("audio.play_bitrate_enumeration=3", Rate(p[1]));
        Assert.Equal("audio.play_bitrate_enumeration=2", Rate(p[2]));
        Assert.Equal("audio.play_bitrate_enumeration=5", Rate(p[3]));   // one not known: lossless
        Assert.Contains("audio.play_bitrate_non_metered_enumeration=4", (string)p[0]!["text"]!);
        Assert.Contains("audio.normalize_v2=false", (string)p[2]!["text"]!);
    }
}
