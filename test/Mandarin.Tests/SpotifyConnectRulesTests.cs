using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Spotify Connect's rules (bug list items 142, 501), asked of the server directly (`mandarin-server score`, fn
/// "spotify"; server/Mandarin.Server/Connect/SpotifyCommand.cs): what the room does as Spotify plays, pauses and
/// stops; what the room is sent (upsampled as its library tracks are); what the samples prove; when a Soloist build
/// runs out and what is done about it; lossless asked for in an account's prefs; a track as Soloist says it; the key
/// taken out of what Soloist says.
/// </summary>
public sealed class SpotifyConnectRulesTests
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
    public async Task Each_room_is_sent_Spotify_as_its_library_tracks_are_upsampled_in_its_filter()
    {
        var dac = new { rates = new[] { 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 }, maxBits = 24, name = "DAC" };
        var o = await Ask(new
        {
            rooms = new object?[]
            {
                null,                                                                           // Sonos: as it comes
                new { dac.rates, dac.maxBits, dac.name, mode = "original" },                    // a streamer at its own rate
                new { dac.rates, dac.maxBits, dac.name, mode = "x4", filter = "minphase" },     // ×4 in its filter
                new { dac.rates, dac.maxBits, dac.name, mode = "max" },                         // to the top of its ladder
                new { rates = new[] { 48000, 96000 }, maxBits = 24, name = "Old DAC", mode = "original" },   // no 44.1 kHz
            },
            reads = new[] { "", "?r=176400&b=24&u=4&f=min", "?r=176400&b=24&u=3", "?bits=16", "?r=99&b=7" }
        });
        string Of(JsonNode? x) => $"{x!["rate"]} {x["bits"]} {x["factor"]} {(string?)x["shape"] ?? "-"} {x["query"]}";
        var rooms = o["rooms"]!.AsArray();
        Assert.Equal("44100 24 1 - ", Of(rooms[0]));
        Assert.Equal("44100 24 1 - ", Of(rooms[1]));
        Assert.Equal("176400 24 4 min ?r=176400&b=24&u=4&f=min", Of(rooms[2]));
        Assert.Equal("upsampled ×4 to 176.4 kHz, 24-bit (minimum phase)", (string?)rooms[2]!["words"]);
        Assert.Equal("352800 24 8 - ?r=352800&b=24&u=8", Of(rooms[3]));
        Assert.Equal("48000 24 1 - ?r=48000&b=24", Of(rooms[4]));
        var reads = o["reads"]!.AsArray();
        Assert.Equal("44100 24 1 - ", Of(reads[0]));
        Assert.Equal("176400 24 4 min ?r=176400&b=24&u=4&f=min", Of(reads[1]));
        Assert.Equal("176400 24 1 - ?r=176400&b=24", Of(reads[2]));   // ×3 isn't the upsampler's: ffmpeg's resampler
        Assert.Equal("44100 16 1 - ?r=44100&b=16", Of(reads[3]));
        Assert.Equal("44100 24 1 - ", Of(reads[4]));                  // nonsense: as it comes
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

    [Test]
    public async Task Spotifys_sound_is_let_out_at_the_speed_it_plays_with_a_lead_while_a_stream_is_open()
    {
        var p = (await Ask(new
        {
            paces = new[]
            {
                // No stream open: a second read waits out its second; after a stall, counted afresh rather than raced.
                new[] { new long[] { 44100, 0, 0 }, [44100, 1000, 0], [44100, 10_000, 0] },
                // A stream open: three seconds may go out at once, the fourth waits its second.
                [[44100, 0, 3000], [88200, 0, 3000], [44100, 0, 3000]],
            }
        }))["paces"]!.AsArray();
        Assert.Equal("1000 1000 1000", string.Join(" ", p[0]!.AsArray().Select(x => x!.GetValue<double>())));
        Assert.Equal("0 0 1000", string.Join(" ", p[1]!.AsArray().Select(x => x!.GetValue<double>())));
    }
}
