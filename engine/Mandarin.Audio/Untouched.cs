// Untouched.cs — a track the server sends untouched (bug list item 418): an MQA track to a DAC that decodes MQA, its
// stream address saying so (?mqa=1, the server's Mqa/MqaPlan.cs). Its samples are given the DAC as they are: no
// volume of the engine's on them (Engine.cs), whatever the gain asked, as DSD's never are. The 16- and 24-bit words
// still go out padded to the device's 32 (lossless: the same values, MQA's signalling in its bits as it came).
namespace Mandarin.Audio;

internal static class Untouched
{
    /* Whether [uri]'s query says mqa=1. */
    public static bool Of(string uri)
    {
        var q = uri.IndexOf('?', StringComparison.Ordinal);
        if (q < 0) return false;
        var end = uri.IndexOf('#', q);
        foreach (var part in (end < 0 ? uri[(q + 1)..] : uri[(q + 1)..end]).Split('&'))
            if (part == "mqa=1") return true;
        return false;
    }
}
