using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// An album's tracks as one stream (bug list item 300, Upsample/AlbumRun.cs, Streams.Runs.cs): a signal cut in two at a
/// frame that is no DSF block's, the two parts an album's tracks, and the whole an album of its own. The run of the
/// two, made as one, is the whole made alone, to the bit: as DSD, the same DSF; as PCM upsampled in a filter of
/// Mandarin's own, the same samples. Begun some way into its first track, it is the run from there, its length the rest.
/// </summary>
public sealed class AlbumRunTests
{
    private const int Rate = 44100;
    private const int Cut = 44177;
    private const int Whole = 110250;

    private static void Ff(params string[] args)
    {
        var psi = new ProcessStartInfo("ffmpeg") { RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in new[] { "-hide_banner", "-loglevel", "error", "-y" }.Concat(args)) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit();
        Assert.True(p.ExitCode == 0, err);
    }

    // [flac]'s samples as 32-bit stereo, decoded.
    private static byte[] Samples(byte[] flac, string dir)
    {
        var f = Path.Combine(dir, Guid.NewGuid() + ".flac");
        var raw = Path.Combine(dir, Guid.NewGuid() + ".raw");
        File.WriteAllBytes(f, flac);
        Ff("-i", f, "-f", "s32le", "-c:a", "pcm_s32le", raw);
        return File.ReadAllBytes(raw);
    }

    private static async Task<List<double>> Ids(Session s, string album, int n)
    {
        var ids = new List<double>();
        await Session.Until(async () =>
        {
            var albums = (await Http.Get(s.Base + "/api/library/albums?sort=album", s.H)).J["albums"].Items().ToList();
            if (albums.FirstOrDefault(a => a.Str("title") == album) is not { } al) return false;
            var page = (await Http.Get(s.Base + "/api/album?offset=" + al.Num("offset"), s.H)).J;
            ids = [.. page["tracks"]!.AsArray().Select(t => t.Num("track_id") ?? 0)];
            return ids.Count == n;
        }, 60000, album + " read");
        return ids;
    }

    [Test]
    public async Task An_albums_tracks_as_one_stream_are_the_whole_made_alone_to_the_bit()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        var tmp = Directory.CreateTempSubdirectory("musicd-test-").FullName;
        try
        {
            // The whole (two tones on the left, one on the right, 24-bit), an album of its own; its two parts, cut at a frame, another's two tracks.
            var src = Path.Combine(tmp, "src.flac");
            Ff("-f", "lavfi", "-i", $"aevalsrc=0.45*sin(2*PI*997*t)+0.2*sin(2*PI*5003*t+0.3)|0.3*sin(2*PI*1500*t):s={Rate}:d=2.5", "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", src);
            string Tagged(string dir, string name, string album, int track, string? af)
            {
                var path = Path.Combine(s.Lib.Music, "Artist R", dir, name);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var args = new List<string> { "-i", src };
                if (af != null) { args.Add("-af"); args.Add(af); }
                args.AddRange(["-metadata", $"title={name}", "-metadata", "artist=Artist R", "-metadata", $"album={album}", "-metadata", $"track={track}",
                    "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", path]);
                Ff([.. args]);
                return path;
            }
            Tagged("Whole", "01 Whole.flac", "The Whole", 1, null);
            Tagged("Parts", "01 Part A.flac", "In Two", 1, $"atrim=end_sample={Cut}");
            Tagged("Parts", "02 Part B.flac", "In Two", 2, $"atrim=start_sample={Cut},asetpts=N/SR/TB");
            Assert.Equal(200, (await Http.Post(s.Base + "/api/library/rescan", new { force = true }, s.H)).Status);
            var whole = (await Ids(s, "The Whole", 1))[0];
            var parts = await Ids(s, "In Two", 2);
            var run = $"a{parts[0]}_{parts[1]}";

            // As DSD64: the run's DSF is the whole's, header and all.
            var alone = await Bytes.Get($"{s.Base}/stream/t{whole}.d64.dsf", s.H);
            var asOne = await Bytes.Get($"{s.Base}/stream/{run}.d64.dsf", s.H);
            Assert.Equal((200, 200), (alone.Status, asOne.Status));
            Assert.Equal(Whole * 64L / 8 * 2 / 8192 * 8192 + 8192 + 92, asOne.Body.Length);
            Assert.True(alone.Body.AsSpan().SequenceEqual(asOne.Body), $"the run made as one is the whole made alone ({asOne.Body.Length} bytes, {alone.Body.Length} alone)");
            // Asked again: the file kept, the same.
            Assert.True((await Bytes.Get($"{s.Base}/stream/{run}.d64.dsf", s.H)).Body.AsSpan().SequenceEqual(asOne.Body), "kept");

            // As PCM ×2 in Gaussian: the same samples.
            var pcmAlone = await Bytes.Get($"{s.Base}/stream/t{whole}.88200-24.flac?f=gauss", s.H);
            var pcmOne = await Bytes.Get($"{s.Base}/stream/{run}.88200-24.flac?f=gauss", s.H);
            Assert.Equal((200, 200), (pcmAlone.Status, pcmOne.Status));
            var a = Samples(pcmAlone.Body, tmp);
            var b = Samples(pcmOne.Body, tmp);
            Assert.Equal(Whole * 2L * 2 * 4, b.Length);
            Assert.True(a.AsSpan().SequenceEqual(b), "the run's samples are the whole's");

            // As PCM ×16 to 705.6 kHz, above FLAC's rates: a WAV, its length said in its header (item 305: a Chord Poly
            // played nothing of it), the same samples as the whole's WAV.
            var wavAlone = await Bytes.Get($"{s.Base}/stream/t{whole}.705600-32.wav?f=gauss", s.H);
            var wavOne = await Bytes.Get($"{s.Base}/stream/{run}.705600-32.wav?f=gauss", s.H);
            Assert.Equal((200, 200), (wavAlone.Status, wavOne.Status));
            Assert.Equal(wavAlone.Body.Length, wavOne.Body.Length);
            Assert.True(wavAlone.Body.AsSpan().SequenceEqual(wavOne.Body), $"the run's WAV is the whole's ({wavOne.Body.Length} bytes)");

            // Begun 0.5 s into its first track: the rest of the run, to the frame.
            var later = await Bytes.Get($"{s.Base}/stream/{run}.88200-24.flac?f=gauss&ss=0.5", s.H);
            Assert.Equal(200, later.Status);
            Assert.Equal((Whole - (long)(0.5 * Rate)) * 2 * 2 * 4, Samples(later.Body, tmp).Length);

            // Only the plans Mandarin makes: never the files as stored, nor a track that isn't there.
            Assert.Equal(400, (await Bytes.Get($"{s.Base}/stream/{run}.orig.flac", s.H)).Status);
            Assert.Equal(404, (await Bytes.Get($"{s.Base}/stream/a{parts[0]}_99999999.d64.dsf", s.H)).Status);
        }
        finally { Directory.Delete(tmp, true); }
    }
}
