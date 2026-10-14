namespace Mandarin.Tests;

/// <summary>
/// Sonos's household as the C# server reads it (Playback/Topology.cs, Didl.cs, Phones.Commands.cs;
/// test/topology.test.js, in C#).
/// </summary>
public sealed class TopologyTests
{
    private const string Zgs = """
        <ZoneGroupState><ZoneGroups>
        <ZoneGroup Coordinator="RINCON_A" ID="RINCON_A:1">
         <ZoneGroupMember UUID="RINCON_A" ZoneName="Kitchen" Location="http://10.0.0.5:1400/xml/device_description.xml"/>
         <ZoneGroupMember UUID="RINCON_B" ZoneName="Dining" Location="http://10.0.0.6:1400/xml/device_description.xml"/>
        </ZoneGroup>
        <ZoneGroup Coordinator="RINCON_C" ID="RINCON_C:2">
         <ZoneGroupMember UUID="RINCON_C" ZoneName="Lounge" Location="http://10.0.0.7:1400/xml/device_description.xml" ChannelMapSet="RINCON_C:LF,LF;RINCON_D:RF,RF"/>
         <ZoneGroupMember UUID="RINCON_SUB" ZoneName="Lounge" Invisible="1" Location="http://10.0.0.8:1400/xml/device_description.xml"/>
        </ZoneGroup>
        </ZoneGroups></ZoneGroupState>
        """;

    [Test]
    public async Task ZoneGroupState_rooms_groups_satellites_and_stereo_pairs()
    {
        var z = (await Score.Run(new { fn = "topology", states = new[] { Zgs } }))["zones"]![0].Items().ToList();
        Assert.Equal(4, z.Count);
        var dining = z.First(m => m.Str("name") == "Dining");
        Assert.Equal("RINCON_A", dining.Str("coordinatorUid"));
        Assert.Equal("10.0.0.6", dining.Str("ip"));
        Assert.True(z.First(m => m.Str("uid") == "RINCON_SUB").Bool("invisible"));
        Assert.True(z.First(m => m.Str("uid") == "RINCON_C").Bool("stereoPair"));
    }

    [Test]
    public async Task DIDL_carries_the_descriptor_Sonos_insists_on_and_parses_back()
    {
        var d = (string)(await Score.Run(new { fn = "didl", builds = new[] { new { uri = "http://h:1/stream/t5.flac", meta = new { title = "A & B", artist = "X", album = "Y", duration = 125, mime = "audio/flac" } } } }))["built"]![0]!;
        Assert.Matches("RINCON_AssociatedZPUDN", d);
        Assert.Matches(@"http-get:\*:audio/flac:\*", d);
        var it = (await Score.Run(new { fn = "didl", docs = new[] { d } }))["items"]![0]![0];
        Assert.Equal("A & B", it.Str("title"));
        Assert.Equal(125, it.Num("duration"));
        Assert.Equal("http://h:1/stream/t5.flac", it.Str("uri"));
    }

    [Test]
    public async Task A_queued_URL_says_which_library_track_it_is()
    {
        JsonAssert.Same("[42,null]", (await Score.Run(new { fn = "uris", uris = new[] { "http://10.0.0.2:3500/stream/t42.flac", "x-sonos-spotify:abc" } }))["tracks"]);
    }
}
