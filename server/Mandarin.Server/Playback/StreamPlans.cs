// StreamPlans.cs — what a device is handed for each track (v0.8.38), from
// lib/stream.js (plan, rendererPlan, rendererMime, nativeMime, mimeForExt,
// family, repack, withDsp, withGain, ffmpegArgs, the Transcoder's keyFor) and
// lib/server/playback.js (planFor), rule for rule.
//
// Sonos plays up to 24-bit/48 kHz: anything within that, in a container it
// reads, goes as the stored file; anything above is brought down to 24/48,
// and what it cannot read at all is FLAC within that ceiling. A streamer has
// its own ceiling (the rates and depth it takes, the containers it names, its
// upsampling and depth settings, its DSD), and the same idea applied to it.
// A zone's DSP (Dsp.cs) and a ReplayGain (Gain.cs) can only be applied by
// converting, so they make a conversion of what would have gone as it is.
//
// A plan is the object the Node server made, key for key and in the same
// order ({ transcode, mime, ext, rate, bits, … }), since the stream address,
// the DIDL and the cache name are all made from it; the cache name (KeyFor)
// carries the DSP's fingerprint (-d…) and the gain (-g…) written as
// JavaScript writes the number. Transcoder.cs and Streams.cs already make and
// send the conversions without DSP or gain; their rules are held to these
// (test/streams-csharp.test.js).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal static class StreamPlans
{
    public const double MaxRate = 48000, MaxBits = 24;

    // The extension a stream address ends in → the MIME it is served as.
    private static readonly Dictionary<string, string> ExtMime = new(StringComparer.Ordinal)
    {
        ["flac"] = "audio/flac", ["fla"] = "audio/flac", ["mp3"] = "audio/mpeg", ["m4a"] = "audio/mp4", ["mp4"] = "audio/mp4", ["alac"] = "audio/mp4",
        ["m4b"] = "audio/mp4", ["aac"] = "audio/aac", ["ogg"] = "audio/ogg", ["oga"] = "audio/ogg", ["opus"] = "audio/ogg",
        ["wav"] = "audio/wav", ["wave"] = "audio/wav", ["aif"] = "audio/aiff", ["aiff"] = "audio/aiff", ["aifc"] = "audio/aiff",
        ["wma"] = "audio/x-ms-wma", ["dsf"] = "audio/x-dsf", ["dff"] = "audio/x-dff"
    };

    // What most renderers take when theirs could not be read.
    public static readonly string[] UsualContainers = ["flac", "mp3", "aac", "alac", "wav", "aiff", "ogg"];

    // ---------------------------------------------------------------- reading a track

    private static string Codec(object? t) => Js.Lower(Jv.Str(Jv.Or(Jv.Get(t, "codec"), "")));
    private static string ExtOf(object? t) => Js.Lower(Jv.Extname(Jv.Or(Jv.Get(t, "path"), "")));
    // RegExp.prototype.test reads its argument with String().
    private static string PathText(object? t) => Jv.Str(Jv.Or(Jv.Get(t, "path"), ""));
    private static bool Uncompressed(string path) =>
        Jv.EndsCI(path, ".wav") || Jv.EndsCI(path, ".wave") || Jv.EndsCI(path, ".aif") || Jv.EndsCI(path, ".aiff") || Jv.EndsCI(path, ".aifc");
    private static bool DsdFile(string path) => Jv.EndsCI(path, ".dsf") || Jv.EndsCI(path, ".dff");
    // /dsd|dsf|dff/i on the codec as it is, or a .dsf/.dff file.
    private static bool IsDsd(object? t)
    {
        var codec = Jv.Str(Jv.Or(Jv.Get(t, "codec"), ""));
        return Jv.HasCI(codec, "dsd") || Jv.HasCI(codec, "dsf") || Jv.HasCI(codec, "dff") || DsdFile(PathText(t));
    }
    private static bool Pcm(string codec) => Jv.Has(codec, "pcm") || Jv.Has(codec, "65534") || codec.Length == 0;
    private static bool AacCodec(string codec) => codec.StartsWith("aac", StringComparison.Ordinal) || Jv.Has(codec, "mpeg-4/aac") || codec.StartsWith("mp4a", StringComparison.Ordinal);
    private static bool Mpeg(string codec) => Jv.Has(codec, "mpeg") || Jv.Has(codec, "mp3");
    private static bool WavExt(string ext) => ext is ".wav" or ".wave";
    private static bool AiffExt(string ext) => ext is ".aif" or ".aiff" or ".aifc";
    // The extension of the file itself, as the plan names it: "flac".
    private static string OwnExt(object? t) => Js.Lower(Jv.Extname(Jv.Get(t, "path")) is { Length: > 0 } e ? e[1..] : "");

    /* nativeMime(t): the type Sonos matches on, when it reads the file as it is; null when it doesn't. */
    public static string? NativeMime(object? t)
    {
        var codec = Codec(t);
        var ext = ExtOf(t);
        if (codec == "flac" && ext is ".flac" or ".fla") return "audio/flac";
        if (ext == ".mp3" && (codec.Length == 0 || Mpeg(codec))) return "audio/mpeg";
        if (codec == "alac" && ext is ".m4a" or ".mp4" or ".alac") return "audio/mp4";
        if (AacCodec(codec) && ext is ".m4a" or ".mp4" or ".m4b") return "audio/mp4";
        if (codec.StartsWith("aac", StringComparison.Ordinal) && ext == ".aac") return "audio/aac";
        if (codec == "vorbis" && ext is ".ogg" or ".oga") return "audio/ogg";
        // Uncompressed PCM at 16 bits; deeper goes as FLAC, sample for sample.
        var pcm = Pcm(codec);
        var bits = Jv.Num(Jv.Or(Jv.Get(t, "bitsPerSample"), 16.0));
        if (pcm && WavExt(ext) && bits <= 16) return "audio/wav";
        if (pcm && AiffExt(ext) && bits <= 16) return "audio/aiff";
        return null;
    }

    /* mimeForExt(ext). (A name a plain object has on its prototype is not given what JavaScript would find.) */
    public static string MimeForExt(object? ext) =>
        ExtMime.TryGetValue(Js.Lower(Jv.Str(Jv.Or(ext, ""))), out var m) ? m : "application/octet-stream";

    /* family(hz): 44.1 kHz and its multiples, or 48 kHz and its. */
    public static double Family(double hz) => hz % 44100 == 0 ? 44100 : 48000;

    /* rendererMime(t, accepts): the file's own container, if the renderer takes it. */
    public static string? RendererMime(object? t, Func<string, bool> accepts)
    {
        var codec = Codec(t);
        var ext = ExtOf(t);
        if (codec == "flac" && ext is ".flac" or ".fla") return accepts("flac") ? "audio/flac" : null;
        if (ext == ".mp3" && (codec.Length == 0 || Mpeg(codec))) return accepts("mp3") ? "audio/mpeg" : null;
        if (codec == "alac" && ext is ".m4a" or ".mp4" or ".alac") return accepts("alac") ? "audio/mp4" : null;
        if (AacCodec(codec) && ext is ".m4a" or ".mp4" or ".m4b") return accepts("aac") ? "audio/mp4" : null;
        if (codec.StartsWith("aac", StringComparison.Ordinal) && ext == ".aac") return accepts("aac") ? "audio/aac" : null;
        if (codec == "vorbis" && ext is ".ogg" or ".oga") return accepts("ogg") ? "audio/ogg" : null;
        if (codec == "opus" && ext is ".opus" or ".ogg") return accepts("opus") ? "audio/ogg" : null;
        var pcm = Pcm(codec);
        if (pcm && WavExt(ext)) return accepts("wav") ? "audio/wav" : null;
        if (pcm && AiffExt(ext)) return accepts("aiff") ? "audio/aiff" : null;
        return null;
    }

    /* Sonos's rule (no target), or a streamer's own. */
    public static JsObj Plan(object? t, object? target)
    {
        if (Jv.T(target)) return RendererPlan(t, target);
        var rate = Jv.Or(Jv.Num(Jv.Get(t, "sampleRate")), 0);
        var bits = Jv.Or(Jv.Num(Jv.Get(t, "bitsPerSample")), 0);
        var channels = Jv.Or(Jv.Num(Jv.Get(t, "channels")), 2);
        var mime = NativeMime(t);
        var tooHigh = rate > MaxRate || bits > MaxBits;
        var dsd = IsDsd(t);
        if (mime != null && !tooHigh && channels <= 2 && !dsd)
            return Jv.Obj(("transcode", false), ("mime", mime), ("ext", OwnExt(t)), ("reason", "bit-perfect"));
        string reason;
        if (dsd) reason = "DSD, which Sonos does not play";
        else if (tooHigh) reason = $"{(bits != 0 ? Js.Num(bits) : "?")}-bit/{(rate != 0 ? Js.Num(rate / 1000) : "?")} kHz is above what Sonos takes";
        else if (channels > 2) reason = $"{Js.Num(channels)} channels, folded down to stereo";
        else if (Uncompressed(PathText(t))) reason = $"{(bits != 0 ? Js.Num(bits) : "?")}-bit uncompressed, repacked as FLAC with the same samples";
        else reason = $"a {Jv.Str(Jv.Or(Jv.Get(t, "codec"), "file"))} Sonos cannot read";
        // Anything resampled, or decoded from DSD or float, goes out at 24 bits;
        // a native-rate 16-bit source in an unreadable container stays 16.
        var outRate = dsd ? MaxRate : (rate > MaxRate || rate == 0 ? MaxRate : rate);
        var outBits = dsd || rate > MaxRate || bits > 16 || bits == 0 ? 24.0 : 16.0;
        return (JsObj)Repack(Jv.Obj(("transcode", true), ("mime", "audio/flac"), ("ext", "flac"), ("rate", outRate), ("bits", outBits), ("reason", reason)), t)!;
    }

    /*
     * repack(p, t): a conversion that changes only the container (v0.7.6) —
     * the file's own rate and depth, integer samples to begin with — is marked
     * exact, and gets no dither.
     */
    public static object? Repack(object? p, object? t)
    {
        var rate = Jv.Or(Jv.Num(Jv.Get(t, "sampleRate")), 0);
        var bits = Jv.Or(Jv.Num(Jv.Get(t, "bitsPerSample")), 0);
        var channels = Jv.Or(Jv.Num(Jv.Get(t, "channels")), 2);
        var codec = Codec(t);
        if (!Jv.T(p) || !Jv.T(Jv.Get(p, "transcode")) || Jv.T(Jv.Get(p, "dsd")) || Jv.T(Jv.Get(p, "dsp")) || Jv.T(Jv.Get(p, "gain")) || Jv.T(Jv.Get(p, "upsampled"))) return p;
        if (rate == 0 || bits == 0 || !Jv.Same(Jv.Get(p, "rate"), rate) || Jv.Num(Jv.Get(p, "bits")) < bits || channels > 2) return p;
        var integer = Jv.Has(codec, "flac") || Jv.Has(codec, "alac") || Jv.Has(codec, "pcm") || Jv.Has(codec, "65534") || Jv.Has(codec, "monkey")
            || Jv.HasWord(codec, "ape") || Jv.Has(codec, "wavpack") || Jv.HasWord(codec, "wv") || Jv.HasWord(codec, "tta") || Jv.HasWord(codec, "tak")
            || Jv.Has(codec, "shorten") || Jv.HasWord(codec, "shn")
            || (codec.Length == 0 && Uncompressed(PathText(t)));
        if (!integer) return p;
        var o = (JsObj)p!;
        o["exact"] = true;
        if (Uncompressed(PathText(t))) o["reason"] = $"{Js.Num(bits)}-bit uncompressed, repacked as FLAC with the same samples";
        return o;
    }

    private static double? Top(List<double> list) => list.Count > 0 ? list[^1] : null;

    /* The depth after processing: 24, or 32 where the device takes it and its setting allows. */
    private static (double MaxBits, double Processed) Depths(object? target)
    {
        var mb = Jv.Num(Jv.Get(target, "maxBits"));
        var maxBits = mb is 16 or 24 or 32 ? mb : 24;
        var bitsSetting = Jv.Get(target, "bits");
        var want32 = maxBits >= 32 && (Jv.Same(bitsSetting, 32.0) || Jv.Same(bitsSetting, "auto") || Jv.Nullish(bitsSetting));
        return (maxBits, want32 ? 32 : Math.Min(maxBits, 24));
    }

    // target.dsd.includes(n): an array's elements, or a string's text.
    private static bool DsdIncludes(object? list, double n) => list switch
    {
        List<object?> l => l.Exists(x => Jv.SameZero(x, n)),
        string s => s.Contains(Js.Num(n), StringComparison.Ordinal),
        _ when !Jv.T(list) => false,
        _ => throw new JsError("(target.dsd || []).includes is not a function")
    };

    /*
     * rendererPlan(t, target): Original — the file itself within the device's
     * rates, depth and containers, else FLAC at the best rate it takes in the
     * file's family; Upsample ×2/×4/Max — to that rung of its ladder; with
     * DSP on, every track converted.
     */
    public static JsObj RendererPlan(object? t, object? target)
    {
        var rate = Jv.Or(Jv.Num(Jv.Get(t, "sampleRate")), 0);
        var bits = Jv.Or(Jv.Num(Jv.Get(t, "bitsPerSample")), 0);
        var channels = Jv.Or(Jv.Num(Jv.Get(t, "channels")), 2);
        var listed = Jv.Or(Jv.Get(target, "rates"), new List<object?>());
        if (listed is not List<object?> given) throw new JsError("(target.rates || []).map is not a function");
        var rates = new List<double>();
        foreach (var x in given)
        {
            var r = Jv.Num(x);
            if (r > 0 && !rates.Contains(r)) rates.Add(r);
        }
        rates.Sort();
        if (rates.Count == 0) { rates.Add(44100); rates.Add(48000); }
        var (maxBits, processedBits) = Depths(target);
        var named = Jv.Get(target, "containers");
        var containers = named is List<object?> { Count: > 0 } cl ? cl : UsualContainers.Select(c => (object?)c).ToList();
        bool Accepts(string c) => containers.Exists(x => x is string s && s == c);
        var who = Jv.Str(Jv.Or(Jv.Get(target, "name"), "this device"));
        var modeSetting = Jv.Get(target, "mode");
        var mode = Jv.OneOf(modeSetting, "x2", "x4", "max") ? (string)modeSetting! : "original";
        var dsd = IsDsd(t);
        // Native DSD (Stage 9.3): a DSF or DFF as it is, at a multiple of 44.1 kHz the device takes as DSD.
        if (dsd && DsdFile(PathText(t)) && rate > 0 && DsdIncludes(Jv.Or(Jv.Get(target, "dsd"), new List<object?>()), Js.Round(rate / 44100)))
        {
            var ext = OwnExt(t);
            var mimes = Jv.Get(target, "dsdMimes");
            var own = Jv.T(mimes) ? Jv.Get(mimes, ext) : mimes;
            var n = Js.Round(rate / 44100);
            return Jv.Obj(("transcode", false), ("mime", Jv.T(own) ? own : MimeForExt(ext)), ("ext", ext), ("dsd", n), ("reason", $"DSD{Js.Num(n)} as it is"));
        }
        var mime = RendererMime(t, Accepts);
        var rateOk = rate > 0 && rates.Contains(rate);
        var bitsOk = bits == 0 || bits <= maxBits;

        // Upsampling: only from a readable rate, within the file's family.
        if (mode != "original" && rate > 0 && !dsd)
        {
            var ladder = rates.Where(r => Family(r) == Family(rate)).ToList();
            double? up;
            if (mode == "max") up = Top(ladder);
            else
            {
                var wanted = rate * (mode == "x2" ? 2 : 4);
                up = Top(ladder.Where(r => r <= wanted).ToList());
            }
            if (up is { } u && u != 0 && u > rate)
            {
                var factor = Js.Round(u / rate);
                return WithDsp(Jv.Obj(("transcode", true), ("hq", true), ("mime", "audio/flac"), ("ext", "flac"), ("rate", u), ("bits", processedBits),
                    ("upsampled", factor), ("reason", $"upsampled ×{Js.Num(factor)} to {Js.Num(u / 1000)} kHz for {who}")), target, rate);
            }
        }

        var dspOn = Biquad.Active(Jv.Get(target, "dsp"));
        if (mime != null && rateOk && bitsOk && channels <= 2 && !dsd && !dspOn)
            return Jv.Obj(("transcode", false), ("mime", mime), ("ext", OwnExt(t)), ("reason", "bit-perfect"));
        if (dspOn && mime != null && rateOk && bitsOk && channels <= 2 && !dsd)
            return WithDsp(Jv.Obj(("transcode", true), ("hq", true), ("mime", "audio/flac"), ("ext", "flac"), ("rate", rate), ("bits", processedBits), ("reason", "DSP")), target, rate);
        double outRate;
        string reason;
        if (dsd)
        {
            // Until native DSD: PCM at the top of the 44.1 ladder, up to 176.4 kHz.
            outRate = Top(rates.Where(r => Family(r) == 44100 && r <= 176400).ToList()) is { } d && d != 0 ? d : Top(rates)!.Value;
            reason = $"DSD, played as PCM for {who}";
        }
        else if (rate == 0)
        {
            outRate = rates.Contains(44100) ? 44100 : rates[0];
            reason = $"a {Jv.Str(Jv.Or(Jv.Get(t, "codec"), "file"))} {who} cannot read";
        }
        else if (rateOk)
        {
            outRate = rate;
            reason = !bitsOk ? $"{Js.Num(bits)}-bit is above what {who} takes"
                : channels > 2 ? $"{Js.Num(channels)} channels, folded down to stereo"
                : $"a {Jv.Str(Jv.Or(Jv.Get(t, "codec"), "file"))} {who} cannot read";
        }
        else
        {
            outRate = Top(rates.Where(r => Family(r) == Family(rate) && r <= rate).ToList()) is { } a && a != 0 ? a
                : Top(rates.Where(r => r <= rate).ToList()) is { } b && b != 0 ? b : rates[0];
            reason = $"{Js.Num(rate / 1000)} kHz is not a rate {who} takes";
        }
        var changed = outRate != rate;
        var outBits = dspOn ? processedBits : Math.Min(maxBits, dsd || changed || bits > 16 || bits == 0 ? 24 : 16);
        return (JsObj)Repack(WithDsp(Jv.Obj(("transcode", true), ("hq", true), ("mime", "audio/flac"), ("ext", "flac"), ("rate", outRate), ("bits", outBits), ("reason", reason)), target, rate), t)!;
    }

    /* withDsp(p, target, inRate): the zone's DSP attached (when on), and the file's rate for the resample. */
    public static JsObj WithDsp(JsObj p, object? target, object? inRate)
    {
        var part = Dsp.PlanPart(Jv.Get(target, "dsp"), p["rate"]);
        if (part != null) { p["dsp"] = part; p["inRate"] = Jv.Or(inRate, 0.0); }
        return p;
    }

    /*
     * withGain(p, t, target, gain): a ReplayGain can only be applied by
     * converting — FLAC at the file's own rate, 24 bits (32 where a renderer
     * takes it and allows it); DSD sent as DSD is left alone.
     */
    public static object? WithGain(object? p, object? t, object? target, object? gain)
    {
        var g = Jv.Num(gain);
        if (!Jv.T(p) || !double.IsFinite(g) || Math.Abs(g) < 0.05 || Jv.T(Jv.Get(p, "dsd"))) return p;
        if (Jv.T(Jv.Get(p, "transcode")))
        {
            // A gain is applied: no longer sample for sample.
            var o = Jv.CopyWithout((JsObj)p!, "exact");
            o["gain"] = Js.Round(g * 10) / 10;
            if (Jv.Same(o["bits"], 16.0)) o["bits"] = 24.0;
            return o;
        }
        var rate = Jv.Or(Jv.Num(Jv.Get(t, "sampleRate")), 44100);
        double bits = 24;
        if (Jv.T(target)) bits = Depths(target).Processed;
        var out_ = Jv.Obj(("transcode", true), ("mime", "audio/flac"), ("ext", "flac"), ("rate", rate), ("bits", bits), ("gain", Js.Round(g * 10) / 10), ("reason", "ReplayGain"));
        if (Jv.T(target)) out_["hq"] = true;
        return out_;
    }

    /*
     * ffmpegArgs(src, p, dest): the Sonos conversion runs SoX at 28 bits, a
     * renderer's (hq) at 33 with 64-bit float throughout; dither once, at the
     * end (none for a repack or 32-bit out); the gain first; DSP before the
     * requantise. soxr: whether this ffmpeg has libsoxr.
     */
    public static List<object?> FfmpegArgs(object? src, object? p, object? dest, bool soxr)
    {
        if (Jv.T(Jv.Get(p, "copy")))
            return ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", src, "-map", "0:a:0", "-vn", "-c:a", "copy", "-f", "flac", dest];
        var hq = Jv.T(Jv.Get(p, "hq"));
        var resampler = soxr ? (hq ? "resampler=soxr:precision=33:" : "resampler=soxr:precision=28:") : "";
        var internalFmt = hq ? "internal_sample_fmt=dblp:" : "";
        var bits = Jv.Get(p, "bits");
        var dither = Jv.T(Jv.Get(p, "exact")) || Jv.Same(bits, 32.0) ? "dither_method=0" : Jv.Same(bits, 16.0) ? "dither_method=triangular_hp" : "dither_method=triangular";
        var rate = Jv.Get(p, "rate");
        var dsp = Jv.Get(p, "dsp");
        var graph = Jv.T(dsp)
            ? string.Join(",", Dsp.Filters(Jv.Get(dsp, "dsp"), Jv.Get(p, "inRate"), rate, soxr).Append($"aresample=osr={Jv.Str(rate)}:{dither}"))
            : $"aresample={resampler}{internalFmt}osr={Jv.Str(rate)}:{dither}";
        // ReplayGain first, in 64-bit float, before anything else is done.
        var gain = Jv.Get(p, "gain");
        if (Jv.T(gain)) graph = $"volume=volume={Jv.Str(gain)}dB:precision=double," + graph;
        return
        [
            "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
            "-i", src,
            "-map", "0:a:0",
            "-vn",
            "-af", graph,
            "-ar", Jv.Str(rate),
            "-ac", "2",
            "-sample_fmt", Jv.Same(bits, 16.0) ? "s16" : "s32",
            "-bits_per_raw_sample", Jv.Str(bits),
            "-map_metadata", "0",
            "-c:a", "flac", "-compression_level", "5",
            "-f", "flac",
            dest
        ];
    }

    /*
     * The Transcoder's keyFor(track, p): the cache file's name — track, file
     * time, rate, depth, -hq for a streamer's, -d and the DSP's fingerprint,
     * -g and the gain, -x for a repack.
     */
    public static string KeyFor(object? track, object? p)
    {
        var mtime = Math.Floor(Jv.Or(Jv.Num(Jv.Get(track, "mtime")), 0));
        var dsp = Jv.Get(p, "dsp");
        var gain = Jv.Get(p, "gain");
        return $"{Jv.Str(Jv.Get(track, "id"))}-{Js.Num(mtime)}-{Jv.Str(Jv.Get(p, "rate"))}-{Jv.Str(Jv.Get(p, "bits"))}"
            + (Jv.T(Jv.Get(p, "hq")) ? "-hq" : "")
            + (Jv.T(dsp) ? "-d" + Jv.Str(Jv.Get(dsp, "hash")) : "")
            + (Jv.T(gain) ? "-g" + Jv.Str(gain) : "")
            + (Jv.T(Jv.Get(p, "exact")) ? "-x" : "");
    }

    // ---------------------------------------------------------------- playback.js

    private static readonly (string Id, string Name)[] Services = [("qobuz", "Qobuz"), ("tidal", "Tidal")];

    /* services.ofPath(p): "qobuz" or "tidal" for a streamed track's path, else null. */
    public static string? ServiceOf(object? path)
    {
        var s = Jv.Str(Jv.Or(path, ""));
        foreach (var (id, _) in Services) if (s.StartsWith(id + "://track/", StringComparison.Ordinal)) return id;
        return null;
    }

    /*
     * planFor(t, target, gain): a library row (path, codec, sample_rate,
     * bits, channels) planned for a device, with its ReplayGain in it. A
     * streamed track always goes through the transcode folder, as it comes.
     */
    public static object? PlanFor(object? t, object? target, object? gain)
    {
        var path = Jv.Get(t, "path");
        var svc = ServiceOf(path);
        var info = Jv.Obj(("path", svc != null ? Jv.Str(path) + ".flac" : path), ("codec", Jv.Get(t, "codec")), ("sampleRate", Jv.Get(t, "sample_rate")),
            ("bitsPerSample", Jv.Get(t, "bits")), ("channels", Jv.Get(t, "channels")));
        var tgt = Jv.T(target) ? target : null;
        object? p = Plan(info, tgt);
        if (svc != null && !Jv.T(Jv.Get(p, "transcode")))
        {
            var name = Services.First(s => s.Id == svc).Name;
            p = Jv.Obj(("transcode", true), ("mime", "audio/flac"), ("ext", "flac"), ("rate", Jv.Or(Jv.Num(Jv.Get(t, "sample_rate")), 44100)),
                ("bits", Jv.Or(Jv.Num(Jv.Get(t, "bits")), 16)), ("reason", "from " + name + ", as it comes"), ("streamed", true));
        }
        return Jv.T(gain) ? WithGain(p, info, tgt, gain) : p;
    }
}
