// ProtocolInfo.cs — what a renderer says it accepts (v0.8.37, stage 2a of
// docs/specs/csharp-migration.md): lib/renderers/protocolinfo.js's parseSink
// and containerOf, rule for rule. Not used by anything that runs yet.
//
// ConnectionManager.GetProtocolInfo answers with a Sink list:
//   http-get:*:audio/flac:*,http-get:*:audio/L16;rate=48000;channels=2:DLNA.ORG_PN=LPCM,…
// It names containers and codecs. It almost never names a sample rate — only
// the raw-PCM entries carry one — so the rates a device takes come from its
// profile, from you, or from what it was seen to play (Profiles.cs).
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

using Js = Mandarin.Server.Tags.Js;

internal static class ProtocolInfo
{
    private static Regex Rx(string p) => new("^" + p + @"\z", RegexOptions.CultureInvariant);

    // MIME → the word shown on the page. Anything not here is shown as its MIME.
    private static readonly (string Name, Regex Re)[] Containers =
    [
        ("flac", Rx(@"audio/(x-)?flac")),
        ("wav", Rx(@"audio/(x-)?wave?")),
        ("aiff", Rx(@"audio/(x-)?aiff")),
        ("alac", Rx(@"audio/(x-)?(m4a|mp4|alac)")),
        ("mp3", Rx(@"audio/(mpeg|mp3|x-mp3|mpeg3|x-mpeg)")),
        ("aac", Rx(@"audio/(aac|aacp|x-aac|3gpp|vnd\.dlna\.adts)")),
        ("ogg", Rx(@"(audio|application)/(x-)?ogg")),
        ("opus", Rx(@"audio/opus")),
        ("wma", Rx(@"audio/x-ms-wma")),
        ("dsd", Rx(@"audio/(x-)?(dsf|dff|dsd)")),
        ("pcm", Rx(@"audio/l(16|24|32)"))
    ];

    private static readonly Regex Audio = new(@"^(audio/|application/(x-)?(ogg|flac))", RegexOptions.CultureInvariant);
    private static readonly Regex Pcm = Rx(@"audio/l(16|24|32)");

    /* The word for a MIME type, or null. */
    public static string? ContainerOf(object? mime)
    {
        var m = Js.Str(mime);
        foreach (var (name, re) in Containers) if (re.IsMatch(m)) return name;
        return null;
    }

    // /^rate=(\d+)$/i: the rate a raw-PCM entry names.
    private static double? Rate(string p)
    {
        if (p.Length < 6 || !Prop.AsciiAt(p, 0, "rate=")) return null;
        for (var i = 5; i < p.Length; i++) if (p[i] is < '0' or > '9') return null;
        return Js.StringToNumber(p[5..]);
    }

    /* The Sink string → { mimes, containers, rates, raw }. Never throws. */
    public static JsObj ParseSink(object? sink)
    {
        var raw = Js.Truthy(sink) ? Js.Str(sink) : "";
        var mimes = new List<string>();
        var rates = new List<double>();
        foreach (var entry in raw.Split(','))
        {
            var parts = Js.Trim(entry).Split(':');
            if (parts.Length < 3) continue;
            var format = Js.Trim(parts[2]);
            if (format.Length == 0 || format == "*") continue;
            var pieces = format.Split(';').Select(Js.Trim).ToArray();
            var m = Js.Lower(pieces[0]);
            if (!Audio.IsMatch(m)) continue;
            if (!mimes.Contains(m)) mimes.Add(m);
            if (!Pcm.IsMatch(m)) continue;
            foreach (var p in pieces.Skip(1))
                if (Rate(p) is { } r && !rates.Contains(r)) rates.Add(r);
        }
        var containers = mimes.Select(ContainerOf).Where(c => c != null).Distinct().ToList();
        var sorted = mimes.ToList();
        sorted.Sort(string.CompareOrdinal);
        rates.Sort();
        var o = new JsObj();
        o["mimes"] = sorted.Select(x => (object?)x).ToList();
        o["containers"] = containers.Select(x => (object?)x).ToList();
        o["rates"] = rates.Select(x => (object?)x).ToList();
        o["raw"] = raw;
        return o;
    }
}
