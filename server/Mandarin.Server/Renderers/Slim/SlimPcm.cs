// SlimPcm.cs — what a track is as PCM, for the continuous stream a Mandarin Bridge is played (item 322: SlimRuns.cs):
// its rate, depth and channels, read from the DIDL the device is given with it (Playback/Items.cs says there what the
// stream carries: the file's own, or what Mandarin makes of it), and said to the player in strm as SlimProto's PCM
// ('p', its depth, rate, channels and byte order, as Squeezelite's pcm.c reads them). A DSD track (a DSF or DFF, as
// stored or made from PCM) is no PCM: it goes as the file. Also here, the WAV header ffmpeg writes ahead of a track's
// samples, read so that the samples alone go on into the stream, and only where they are what the stream is.
using System.Buffers.Binary;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Mandarin.Server.Renderers.Slim;

internal sealed partial record PcmFormat(int Rate, int Bits, int Channels)
{
    [GeneratedRegex("<res\\b([^>]*)>")]
    private static partial Regex Res();

    private static int Attr(string attrs, string name) =>
        Regex.Match(attrs, "\\b" + name + "=\"([0-9.]+)\"") is { Success: true } m && double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? (int)v : 0;

    /* What the track at [uri] is as PCM, by its DIDL [meta]; null for DSD, or where its rate isn't one strm can name.
       Its channels go as two (as the Bridge's engine plays them); a depth other than 16, 24 or 32 (a lossy file's), 24. */
    public static PcmFormat? Of(string uri, string meta)
    {
        var path = Uri.TryCreate(uri, UriKind.Absolute, out var u) ? u.AbsolutePath : uri;
        if (path.EndsWith(".dsf", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".dff", StringComparison.OrdinalIgnoreCase)) return null;
        if (Res().Match(meta) is not { Success: true } res) return null;
        var attrs = res.Groups[1].Value;
        var rate = Attr(attrs, "sampleFrequency");
        var bits = Attr(attrs, "bitsPerSample");
        if (bits == 1 || SlimFrames.RateCode(rate) == null) return null;
        return new PcmFormat(rate, bits is 16 or 24 or 32 ? bits : 24, 2);
    }

    /* As strm says it: PCM, its depth ('1' 16 bits, '2' 24, '3' 32), its rate, its channels, little-endian ('1'). */
    public SlimFrames.Format Strm => new('p', (char)('0' + Bits / 8 - 1), SlimFrames.RateCode(Rate)!.Value, (char)('0' + Channels), '1');

    /* ffmpeg's codec for these samples. */
    public string Codec => "pcm_s" + Bits.ToString(CultureInfo.InvariantCulture) + "le";

    public int FrameBytes => Bits / 8 * Channels;

    /* "24/96 kHz", as the log says it. */
    public override string ToString() => $"{Bits}/{(Rate / 1000.0).ToString(CultureInfo.InvariantCulture)} kHz";

    /* A WAV header at the start of [b]: what its samples are, and where they begin; null until there is all of it (or it is none). */
    public static (PcmFormat Format, int Start)? FromWav(ReadOnlySpan<byte> b)
    {
        if (b.Length < 12 || !b[..4].SequenceEqual("RIFF"u8) || !b[8..12].SequenceEqual("WAVE"u8)) return null;
        PcmFormat? f = null;
        for (var at = 12; at + 8 <= b.Length;)
        {
            var id = b.Slice(at, 4);
            var size = BinaryPrimitives.ReadUInt32LittleEndian(b[(at + 4)..]);
            if (id.SequenceEqual("data"u8)) return f is null ? null : (f, at + 8);
            if (at + 8 + size > b.Length) return null;
            if (id.SequenceEqual("fmt "u8) && size >= 16)
                f = new PcmFormat((int)BinaryPrimitives.ReadUInt32LittleEndian(b[(at + 12)..]), BinaryPrimitives.ReadUInt16LittleEndian(b[(at + 22)..]), BinaryPrimitives.ReadUInt16LittleEndian(b[(at + 10)..]));
            at += 8 + (int)size + (int)(size & 1);
        }
        return null;
    }
}
