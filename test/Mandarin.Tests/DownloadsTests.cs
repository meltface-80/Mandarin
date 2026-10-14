using System.Diagnostics;
using System.Text;

namespace Mandarin.Tests;

/// <summary>
/// Downloads for the Android app: an album's list, each track as it is on disk or as Opus 256, current
/// titles for albums already on the phone, and plays made offline joining the history
/// (test/downloads.test.js, in C#: its steps, in order, in one test).
/// </summary>
public sealed class DownloadsTests
{
    [Test]
    public async Task What_a_phone_can_play_as_it_is()
    {
        // The C# server's (Downloads.cs).
        static async Task<bool> PhonePlays(object t) => (await Score.Run(new { fn = "phoneplays", tracks = new[] { t } }))["plays"]![0]!.GetValue<bool>();
        Assert.True(await PhonePlays(new { path = "/m/a.flac", codec = "FLAC", channels = 2 }));
        Assert.True(await PhonePlays(new { path = "/m/a.mp3", codec = "MPEG 1 Layer 3" }));
        Assert.True(await PhonePlays(new { path = "/m/a.m4a", codec = "AAC" }));
        Assert.False(await PhonePlays(new { path = "/m/a.m4a", codec = "ALAC" }));
        Assert.False(await PhonePlays(new { path = "/m/a.dsf", codec = "DSD" }));
        Assert.False(await PhonePlays(new { path = "/m/a.ape", codec = "Monkey's Audio" }));
        Assert.False(await PhonePlays(new { path = "/m/a.flac", codec = "FLAC", channels = 6 }));
    }

    [Test]
    public async Task Albums_download_to_the_phone()
    {
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("status")).J.Num("index_count") >= 3, 10000, "the library");
        var cd = (await s.Album("Album One"))!;
        var hires = (await s.Album("Hi Res"))!;
        var cdOffset = cd.Num("offset");

        // An album lists its tracks, sizes and where to fetch them.
        {
            var a = (await s.Api($"download/album?offset={cdOffset}&quality=original")).J;
            Assert.Equal("Album One", a.Str("title"));
            var tracks = a["tracks"].Items().ToList();
            Assert.Equal(3, tracks.Count);
            Assert.Equal("flac", tracks[0].Str("ext"));
            Assert.True(tracks[0].Num("size") > 1000);
            Assert.Matches(@"^/api/download/t\d+\?quality=original$", tracks[0].Str("path"));
            Assert.Matches(@"/api/image/.*[?&]s=", a.Str("art_url"));
            Assert.Equal("opus", (await s.Api($"download/album?offset={cdOffset}&quality=opus")).J["tracks"]![0].Str("ext"));
        }

        // Original is the file itself — hi-res stays hi-res.
        {
            var a = (await s.Api($"download/album?offset={hires.Num("offset")}&quality=original")).J;
            var t = a["tracks"]![0]!;
            var r = await Bytes.Get(s.Base + t.Str("path"), s.H);
            Assert.Equal(200, r.Status);
            var onDisk = await File.ReadAllBytesAsync((string)s.Server.Scalar("SELECT path FROM tracks WHERE id = $1", (long)t.Num("id")!.Value)!);
            Assert.True(r.Body.AsSpan().SequenceEqual(onDisk), "byte for byte");
            Assert.Equal((96000, 2, 24), Fixtures.Probe(r.Body));
            var part = await Bytes.Get(s.Base + t.Str("path"), new Dictionary<string, string>(s.H) { ["Range"] = "bytes=0-99" });
            Assert.True(part.Status == 206, "a download can resume");
        }

        // Opus 256 is made once and kept.
        {
            var a = (await s.Api($"download/album?offset={cdOffset}&quality=opus")).J;
            var path = s.Base + a["tracks"]![0].Str("path");
            var t0 = Stopwatch.StartNew();
            var r = await Bytes.Get(path, s.H);
            Assert.Equal(200, r.Status);
            Assert.Equal("audio/ogg", r.Header("content-type"));
            Assert.Equal("OggS", Encoding.ASCII.GetString(r.Body, 0, 4));
            int head = r.Body.AsSpan().IndexOf("OpusHead"u8);
            Assert.True(head >= 0);
            // 24/48: the encoder is fed 64-bit float resampled to 48 kHz (SoX's resampler where ffmpeg has it,
            // swr where it hasn't: Downloads.cs), and the Opus stream says 48 kHz.
            Assert.True(BitConverter.ToUInt32(r.Body, head + 12) == 48000, "OpusHead input sample rate");
            var first = t0.ElapsedMilliseconds;
            var t1 = Stopwatch.StartNew();
            var again = await Bytes.Get(path, s.H);
            Assert.True(again.Body.AsSpan().SequenceEqual(r.Body), "the same file the second time");
            Assert.True(t1.ElapsedMilliseconds <= first + 50, "from the cache");
        }

        // The phone refreshes its albums' titles and covers.
        {
            await s.Api("album/edit", new { offset = cdOffset, title = "Album One (fixed)" });
            var r = (await s.Api("download/albums", new { ids = new[] { cdOffset, 999999 } })).J;
            Assert.Equal("Album One (fixed)", r["albums"]![0].Str("title"));
            Assert.False(r["albums"]![1].Bool("exists"));
            // The album as the Home row draws it.
            Assert.Equal(cdOffset, r["albums"]![0]!["album"].Num("offset"));
            Assert.Equal("Album One (fixed)", r["albums"]![0]!["album"].Str("title"));
        }

        // Automatic downloads: the albums the phone keeps by itself.
        {
            Assert.Empty((await s.Api("download/auto")).J["albums"].Items());
            var recent = (await s.Api("download/auto?recent=2&aotd=1")).J;
            var albums = recent["albums"].Items().ToList();
            Assert.True(albums.Count is >= 2 and <= 3, recent.ToJsonString());
            Assert.Equal(2, albums.Count(a => a!["sources"].Items().Any(x => (string?)x == "recent")));
            Assert.Equal(1, albums.Count(a => a!["sources"].Items().Any(x => (string?)x == "aotd")));
            foreach (var a in albums) Assert.True(a.Num("id") is double id && id == Math.Floor(id) && !string.IsNullOrEmpty(a.Str("title")));
        }

        // Plays made offline join the history.
        {
            var a = (await s.Api($"download/album?offset={cdOffset}")).J;
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var r = (await s.Api("phone/plays", new { plays = new object[] { new { track_id = a["tracks"]![0].Num("id"), ts = now - 3600000 }, new { track_id = 999999, ts = 1 } } })).J;
            Assert.Equal(1, r.Num("recorded"));
            var row = s.Server.Rows("SELECT * FROM plays ORDER BY id DESC LIMIT 1")[0];
            Assert.Equal("Song 1", row["title"]);
            Assert.Matches("^PHONE_", (string?)row["zone"]);
        }
    }
}
