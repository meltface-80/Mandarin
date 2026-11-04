using System.Buffers.Binary;

namespace Mandarin.Tests;

/// <summary>
/// A WAV's length in its header (bug list item 270): PCM upsampled ×16 to 705.6 kHz goes as WAV, and ffmpeg's, written
/// to be read as it grows, said 4 GB of data even once whole, so that a renderer (the FiiO SR11) didn't know where a
/// track ended and paused at the end of each. Made as it plays (minimum phase), the WAV is sent with the length its
/// header says from its first byte, the track's own, ×16; made by ffmpeg (the standard filter), its header says its
/// length once it is whole, as the next track and every later play have it.
/// </summary>
public sealed class WavLengthTests
{
    // The RIFF's size, the data chunk's (where it starts), and the file's length.
    private static (uint Riff, uint Data, int DataAt, int Length) Sizes(byte[] wav)
    {
        Assert.True(wav.Length > 44 && wav.AsSpan(0, 4).SequenceEqual("RIFF"u8) && wav.AsSpan(8, 4).SequenceEqual("WAVE"u8), "a WAV");
        for (var at = 12; at + 8 <= wav.Length;)
        {
            var size = BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(at + 4));
            if (wav.AsSpan(at, 4).SequenceEqual("data"u8)) return (BinaryPrimitives.ReadUInt32LittleEndian(wav.AsSpan(4)), size, at + 8, wav.Length);
            at += 8 + (int)(size + (size & 1));
        }
        Assert.Fail("no data chunk");
        return default;
    }

    [Test]
    public async Task A_WAV_upsampled_x16_says_its_own_length_made_as_it_plays_from_its_first_byte_and_made_by_ffmpeg_once_whole()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        await Session.Until(async () => (await s.Api("library-stats")).J.Num("albums") == 3, 30000, "the library");
        Dictionary<string, object?> Row(string title) => s.Server.Rows("SELECT * FROM tracks WHERE title = $1", title)[0];

        // Made as it plays, in minimum phase: sent with its length, the header saying the same, the track's frames ×16.
        var song = Row("Song 1");   // 3 s at 44.1 kHz
        var made = await Bytes.Get(s.Base + $"/stream/t{song["id"]}.705600-24.wav?f=min", s.H);
        Assert.Equal(200, made.Status);
        var frames = (long)Math.Round(Convert.ToDouble(song["duration"], System.Globalization.CultureInfo.InvariantCulture) * 44100);
        var want = 68 + frames * 16 * 2 * 3;
        Assert.Equal(want.ToString(System.Globalization.CultureInfo.InvariantCulture), made.Header("content-length"));
        var (riff, data, at, length) = Sizes(made.Body);
        Assert.Equal((want, want - 8, want - at), ((long)length, (long)riff, (long)data));

        // Made by ffmpeg (the standard filter): once whole, its header says its length.
        var other = Row("Song 2");
        var first = await Bytes.Get(s.Base + $"/stream/t{other["id"]}.705600-24.wav", s.H);
        Assert.Equal(200, first.Status);
        Bytes.Answer? again = null;
        await Session.Until(async () => (again = await Bytes.Get(s.Base + $"/stream/t{other["id"]}.705600-24.wav", s.H)).Header("content-length") != null, 15000, "the whole file sent");
        var (riff2, data2, at2, length2) = Sizes(again!.Body);
        Assert.Equal(((long)length2 - 8, (long)length2 - at2), ((long)riff2, (long)data2));
        Assert.True(length2 > 1_000_000, "the track's samples: " + length2);
    }
}
