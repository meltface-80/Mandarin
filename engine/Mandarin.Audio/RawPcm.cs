// RawPcm.cs — a stream of raw PCM (item 322): Mandarin's continuous stream to a Mandarin Bridge, the samples and
// nothing else, no header to say what they are. Its address carries what they are after "#pcm=": the sample format
// as ffmpeg names it (s16le, s24le, s32le, or their big-endian twins), the rate and the channels, as in
// "http://…/slim/SLIM_0A…/3.pcm?s=…#pcm=s24le:96000:2". ffmpeg is told them before it reads (it reads a WAV's from its
// header); the part after '#' never goes to the server. Any other address is read as ever.
using System.Globalization;

namespace Mandarin.Audio;

internal static class RawPcm
{
    private const string Mark = "#pcm=";
    private static readonly string[] Formats = ["s16le", "s24le", "s32le", "s16be", "s24be", "s32be"];

    /* What [uri] says its raw samples are (ffmpeg's format, the rate, the channels), and the address without it; null for any other. */
    public static (string Format, int Rate, int Channels, string Address)? Of(string uri)
    {
        var at = uri.LastIndexOf(Mark, StringComparison.Ordinal);
        if (at < 0) return null;
        var parts = uri[(at + Mark.Length)..].Split(':');
        if (parts.Length != 3 || !Formats.Contains(parts[0])) return null;
        if (!int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var rate) || rate is < 8000 or > 1536000) return null;
        if (!int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var channels) || channels is < 1 or > 8) return null;
        return (parts[0], rate, channels, uri[..at]);
    }

    /* ffmpeg's input for [uri]: a raw stream's format, rate and channels said first, then where it is. */
    public static string[] Input(string uri) => Of(uri) is { } r
        ? ["-f", r.Format, "-ar", r.Rate.ToString(CultureInfo.InvariantCulture), "-ac", r.Channels.ToString(CultureInfo.InvariantCulture), "-i", r.Address]
        : ["-i", uri];
}
