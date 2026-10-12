// ServiceStreams.cs — a Qobuz or Tidal track fetched for a device (v0.8.47,
// stage 4.5 of docs/specs/csharp-migration.md), from lib/qobuz/index.js,
// lib/tidal/index.js and index.js's transcoder.resolve, rule for rule:
//
//   - where a track's audio is, asked of the service when a device comes for
//     it (or the next is made ready behind it), for the format the device
//     takes and the account allows; copied into the transcode folder as it
//     comes where it is already what was planned (or less, for Sonos), else
//     converted like a file (Transcoder.cs);
//   - Qobuz: a signed ask (track/getFileUrl), and every play reported, Start
//     as a device starts fetching, End when the next starts, it has had time
//     to play through, or playback stops (the sign-out, this server's stop);
//   - Tidal: playbackinfo, one address (CD, or AAC on a lesser account) or
//     MPEG-DASH (its hi-res FLAC: an initialisation piece and numbered
//     segments, fetched one after another and fed to ffmpeg as one stream, no
//     address of this server's in between); an account Tidal answers a hi-res
//     ask with CD for is asked for CD from then on; and the rows corrected to
//     what Tidal really streams a track at.
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Services;

using static ServiceHttp;
using Js = Mandarin.Server.Tags.Js;

/* A streamed track's row, as resolve reads it (a number SQLite left out: 0, as Number(null) has it). */
internal sealed record StreamTrack(long Id, string Path, double SampleRate, double Bits, double Duration);

/* Where a track's audio is (resolve's answer): the address ffmpeg reads, or DASH's pieces in order (the initialisation first); its rate, depth and type. */
internal sealed record Resolved(string Src, double Rate, double Bits, string Mime, List<string>? Pieces = null);

internal abstract partial class Catalogue
{
    /* The stream quality setting as a number, for the transcode folder's names (streaming.js tier). */
    public double Tier() => Array.IndexOf(Qualities, Settings().Quality) + 1;

    /* resolve(t, p): where the track's audio is, for ffmpeg. */
    public abstract Task<Resolved> Resolve(StreamTrack t, JsObj p);
    /* played(t, p): a device started fetching it (Qobuz's reports). */
    public virtual void Played(StreamTrack t, JsObj p) { }
    /* stop(): playback stops (a sign-out, this server's stop). */
    public virtual Task Stop() => Task.CompletedTask;

    /* The service's own id of a track ("qobuz://track/123" → "123"), or null. */
    protected string? TrackIdOf(string path) => path.StartsWith(TrackPath, StringComparison.Ordinal) ? path[TrackPath.Length..] : null;

    /* services.ofPath(p): the service a streamed track's path is of, once it is this server's; null for a file. */
    public static Catalogue? Of(string path)
    {
        foreach (var s in new Catalogue?[] { Jobs.Qobuz, Jobs.Tidal })
            if (s != null && path.StartsWith(s.TrackPath, StringComparison.Ordinal)) return s;
        return null;
    }

    /* services.isStreamed(p) */
    public static bool IsStreamed(string path) => path.StartsWith("qobuz://track/", StringComparison.Ordinal) || path.StartsWith("tidal://track/", StringComparison.Ordinal);

    /* The track's row, read now (a conversion handed over carries only its id). */
    public static StreamTrack? Row(long id)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT path, sample_rate, bits, duration FROM tracks WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        if (!r.Read() || r.IsDBNull(0)) return null;
        double N(int i) => r.IsDBNull(i) ? 0 : Convert.ToDouble(r.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
        return new StreamTrack(id, r.GetString(0), N(1), N(2), N(3));
    }

    /*
     * index.js transcoder.resolve.get: where a streamed track's audio is, and
     * the plan it is made with. FLAC at the rate and depth wanted, nothing
     * else to do: copied as it comes. Below what was planned (a track listed
     * as hi-res that the account gets at CD), copied too, at what it is —
     * never upsampled — unless a streamer was promised a rate (hq), or DSP or
     * a gain is in it. [p] is the plan the file is named by.
     */
    public static async Task<(string Src, ConvPlan Plan, List<string>? Pieces)> Source(ConvTrack ct, ConvPlan p)
    {
        var svc = Of(ct.Path) ?? throw new JsError("Cannot read properties of null (reading 'resolve')");
        var t = Row(ct.Id) ?? new StreamTrack(ct.Id, ct.Path, 0, 0, 0);
        var r = await svc.Resolve(t with { Path = ct.Path }, p.ToJs());
        var flac = (r.Mime.Length > 0 ? r.Mime : "audio/flac").Contains("flac", StringComparison.Ordinal);
        var same = r.Rate == p.Rate && r.Bits == p.Bits;
        var below = !p.Hq && r.Rate <= p.Rate && r.Bits <= p.Bits;
        var copy = p.Dsp == null && p.Gain == 0 && flac && (same || below);
        return (r.Src, copy ? p with { Copy = true, Rate = (long)r.Rate, Bits = (int)r.Bits } : p, r.Pieces);
    }

    /*
     * A DASH stream fed to ffmpeg (index.js /internal/dash/<key>, without the
     * address): each piece fetched in turn, a minute at most each, and
     * written on as it comes; then the end. A piece that can't be had ends it
     * early, said in the log as the Node server said it; ffmpeg gone (it
     * stopped reading), nothing more is fetched.
     */
    public static async Task FeedDash(StreamWriter into, List<string> pieces)
    {
        try
        {
            foreach (var url in pieces) await CopyTo(url, into.BaseStream, 60000);
        }
        catch (JsError e) { Front.Log($"[tidal] dash: {e.Message}"); }
        catch (Exception e) when (e is IOException or ObjectDisposedException) { /* ffmpeg gone */ }
        finally
        {
            try { into.Close(); } catch (Exception e) when (e is IOException or ObjectDisposedException) { /* gone */ }
        }
    }
}

internal sealed partial class QobuzCatalogue
{
    // Stream formats Qobuz knows, as the plugin names them (api.js FORMAT).
    private const double Flac = 6, HiRes96 = 7, HiRes192 = 27;

    /* The format to ask for (index.js formatFor): the device's ceiling, the account's setting, and the track's own. */
    private double FormatFor(StreamTrack t, JsObj p)
    {
        var s = Settings();
        var rate = P(p, "rate");
        var want = Js.Truthy(rate) ? Js.ToNumber(rate) : 48000;
        var trackRate = t.SampleRate != 0 ? t.SampleRate : 44100;
        var trackBits = t.Bits != 0 ? t.Bits : 16;
        var cd = trackRate <= 48000 && trackBits <= 16;
        if (cd || s.Quality == "cd") return Flac;
        // Above CD and wanted above CD: the hi-res tier the device's rate falls in.
        // A Sonos (24/48) gets the 96 kHz tier and the 24/48 rule from there.
        if (want > 96000 && s.Quality == "hires192") return HiRes192;
        return HiRes96;
    }

    /*
     * Where a track's audio is (index.js resolve): a signed ask, answered with
     * a short-lived address and what is at it. The play itself is reported by
     * Played, when a device fetches: the folder may already hold the track
     * from being made ready.
     */
    public override async Task<Resolved> Resolve(StreamTrack t, JsObj p)
    {
        var id = TrackIdOf(t.Path) ?? throw new JsError("not a Qobuz track");
        if (!Connected()) throw new ServiceError("Not signed in to Qobuz", 401);
        var j = await Api.FileUrl(id, FormatFor(t, p));
        if (!Js.Truthy(j) || !Js.Truthy(P(j, "url")))
            throw new ServiceError(Js.Truthy(j) && Js.Truthy(P(j, "sample")) ? "Qobuz offers only a sample of this track on this account" : "Qobuz gave no stream for this track", 502);
        var given = Js.ToNumber(P(j, "sampling_rate"));
        var rate = given != 0 && !double.IsNaN(given) ? Js.Round(given * 1000) : (t.SampleRate != 0 ? t.SampleRate : 44100);
        var bits = NumOr(P(j, "bit_depth"), t.Bits != 0 ? t.Bits : 16);
        return new Resolved(Js.Str(P(j, "url")), rate, bits, Js.Str(Or(P(j, "mime_type"), "audio/flac")));
    }

    // ------------------------------------------------------------ the reports

    /* A play reported: its event, when it started, the track's length, and its timer (index.js plays). */
    private sealed class Play
    {
        public required JsObj Event;
        public double At;
        public double Duration;
        public Timer? Timer;
    }
    private readonly object playsGate = new();
    private readonly Dictionary<string, Play> plays = new(StringComparer.Ordinal);
    // A start being reported: a second fetch of the same track meanwhile (a
    // speaker asking again) isn't reported as a second start.
    private readonly HashSet<string> starting = new(StringComparer.Ordinal);

    /* A device is fetching this track to play it: reported to Qobuz, once (index.js played). */
    public override void Played(StreamTrack t, JsObj p)
    {
        var id = TrackIdOf(t.Path);
        if (id == null || !Connected()) return;
        _ = Start(id, t, FormatFor(t, p)).ContinueWith(x =>
        {
            if (x.Exception?.InnerException is { } e) Front.Log($"[qobuz] report: {Said(e)}");
        }, TaskScheduler.Default);
    }

    /* track/reportStreamingStart (index.js start): the track before it over first, as far as Qobuz is concerned. */
    private async Task Start(string trackId, StreamTrack t, double formatId)
    {
        List<string> others;
        lock (playsGate)
        {
            if (plays.ContainsKey(trackId) || !starting.Add(trackId)) return;
            others = plays.Keys.ToList();
        }
        try { await StartNow(trackId, t, formatId, others); }
        finally { lock (playsGate) starting.Remove(trackId); }
    }

    private async Task StartNow(string trackId, StreamTrack t, double formatId, List<string> others)
    {
        foreach (var id in others) await End(id, "next track");
        var a = Or(Account(), new JsObj());
        var u = Or(P(a, "user"), new JsObj());
        var e = Obj(("user_id", P(u, "id")), ("duration", 0.0), ("date", Math.Floor(NowMs() / 1000)), ("online", true), ("intent", "streaming"), ("sample", false),
            ("device_id", Js.Truthy(P(u, "device")) ? P(P(u, "device"), "id") : DeviceId()), ("track_id", Js.ToNumber(trackId)), ("local", false),
            ("credential_id", Js.Truthy(P(u, "credential")) ? P(P(u, "credential"), "id") : Undef.V), ("format_id", formatId), ("purchase", false));
        var rec = new Play { Event = e, At = NowMs(), Duration = t.Duration };
        lock (playsGate) plays[trackId] = rec;
        // Over by itself once it has had time to play through (and a little more).
        rec.Timer = new Timer(_ => _ = End(trackId, "played through").ContinueWith(_ => { }, TaskScheduler.Default), null,
            TimeSpan.FromMilliseconds((rec.Duration != 0 ? rec.Duration : 600) * 1000 + 30000), Timeout.InfiniteTimeSpan);
        await Api.Report("start", e);
    }

    /* track/reportStreamingEnd (index.js end): once, with how long it was on (no longer than the track). */
    private async Task End(string trackId, string why)
    {
        Play? rec;
        lock (playsGate)
        {
            if (!plays.Remove(trackId, out rec)) return;
        }
        rec.Timer?.Dispose();
        var seconds = Js.Round((NowMs() - rec.At) / 1000);
        var e = new JsObj();
        foreach (var k in rec.Event.Keys) e[k] = rec.Event[k];
        e["date"] = Math.Floor(NowMs() / 1000);
        e["duration"] = rec.Duration != 0 ? Math.Min(rec.Duration, seconds) : seconds;
        await Api.Report("end", e);
        Front.Log($"[qobuz] track {trackId}: {Js.Num((double)e["duration"]!)}s ({why})");
    }

    /* Playback stops (index.js stop): every play reported over. */
    public override async Task Stop()
    {
        List<string> ids;
        lock (playsGate) ids = plays.Keys.ToList();
        foreach (var id in ids)
        {
            try { await End(id, "stopped"); } catch (Exception) { /* as .catch(() => {}) */ }
        }
    }
}

internal sealed partial class TidalCatalogue
{
    private const string Lossless = "LOSSLESS", HiResLossless = "HI_RES_LOSSLESS";

    // Tidal answered a hi-res ask with CD: this account gets CD (index.js hiresDenied).
    public volatile bool HiresDenied;
    private readonly object learnGate = new();
    private Timer? learnTimer;

    /* Any setting written: hi-res asked for again, in case the account changed (index.js setSettings). */
    protected override void SettingsChanged() => HiresDenied = false;

    /*
     * The quality to ask for (index.js qualityFor): the setting's ceiling, the
     * track's, and the account's — a subscription without hi-res, or one Tidal
     * has already answered a hi-res ask with CD for, is asked for CD straight
     * away, not twice for every track.
     */
    private string QualityFor(StreamTrack t)
    {
        var hires = (t.Bits != 0 ? t.Bits : 16) > 16 || (t.SampleRate != 0 ? t.SampleRate : 44100) > 48000;
        if (Settings().Quality != "hires" || !hires || HiresDenied) return Lossless;
        var sub = P(Or(Account(), new JsObj()), "subscription");
        if (Js.Truthy(sub) && Js.Truthy(P(sub, "highestSoundQuality")) && !Js.Str(P(sub, "highestSoundQuality")).Contains("HI_RES", StringComparison.Ordinal)) return Lossless;
        return HiResLossless;
    }

    /*
     * Where a track's audio is (index.js resolve). A hi-res ask Tidal answers
     * with something other than hi-res (an account without it) is asked again
     * at CD quality, as the plugin does, and the account asked for CD from
     * then on.
     */
    public override async Task<Resolved> Resolve(StreamTrack t, JsObj p)
    {
        var id = TrackIdOf(t.Path) ?? throw new JsError("not a Tidal track");
        if (!Connected()) throw new ServiceError("Not signed in to Tidal", 401);
        var quality = QualityFor(t);
        var j = await Api.PlaybackInfo(id, quality);
        var m = DecodeManifest(j);
        if (quality == HiResLossless && (m == null || !HiRes().IsMatch(Js.Str(Or(P(j, "audioQuality"), "")))))
        {
            // Not hi-res from this account: CD from now on, without asking twice.
            if (!HiresDenied) Front.Log($"[tidal] hi-res asked for, {(Js.Truthy(j) && Js.Truthy(P(j, "audioQuality")) ? Js.Str(P(j, "audioQuality")) : "nothing")} given: CD quality from here on");
            HiresDenied = true;
            if (m == null) { quality = Lossless; j = await Api.PlaybackInfo(id, quality); m = DecodeManifest(j); }
        }
        if (m == null) throw new ServiceError("Tidal gave no stream for this track (" + Js.Str(Or(AndP(j, "manifestMimeType"), "no manifest")) + ")", 502);
        var hi = HiRes().IsMatch(Js.Str(Or(P(j, "audioQuality"), "")));
        var given = NumOr(P(j, "sampleRate"), 0);
        var rate = given != 0 ? given : m.Rate != 0 ? m.Rate : hi ? 96000 : 44100;
        var bits = NumOr(P(j, "bitDepth"), hi ? 24 : 16);
        Learn(t, rate, bits);
        return m.Pieces == null ? new Resolved(m.Url, rate, bits, m.Mime) : new Resolved("pipe:0", rate, bits, m.Mime, m.Pieces);
    }

    /*
     * What Tidal really streams a track at, learnt the first time it is asked
     * for (its lists say only "hi-res"): the rows corrected so the plans that
     * follow ask for the right conversion and the badges are right; the
     * library read again once things have settled, not for every track of an
     * album being made ready.
     */
    private void Learn(StreamTrack t, double rate, double bits)
    {
        if (rate == 0 || bits == 0 || double.IsNaN(rate) || double.IsNaN(bits)) return;
        if (t.SampleRate == rate && t.Bits == bits) return;
        try
        {
            using (var c = Db.Open())
            {
                Run(c, "UPDATE tracks SET sample_rate = $r, bits = $b WHERE path = $p", ("$r", rate), ("$b", bits), ("$p", t.Path));
                Run(c, "UPDATE albums SET max_rate = MAX(max_rate, $r), max_bits = MAX(max_bits, $b) WHERE id = (SELECT album_id FROM tracks WHERE path = $p)",
                    ("$r", rate), ("$b", bits), ("$p", t.Path));
            }
            lock (learnGate)
            {
                learnTimer?.Dispose();
                learnTimer = new Timer(_ => _ = Changed().ContinueWith(_ => { }, TaskScheduler.Default), null, 20000, Timeout.Infinite);
            }
        }
        catch (Exception e) when (e is SqliteException or JsError) { Front.Log($"[tidal] learn {t.Path}: {Said(e)}"); }
    }

    // ------------------------------------------------------------ the manifest

    /* A playbackinfo's manifest: one address ("bts"), or DASH's pieces in order, with what they are. */
    internal sealed record Manifest(string Url, List<string>? Pieces, string Mime, double Rate);

    [GeneratedRegex(@"vnd\.tidal\.bt")]
    private static partial Regex Bts();
    [GeneratedRegex(@"dash\+xml")]
    private static partial Regex Dash();

    /*
     * The manifest in a playbackinfo answer, decoded (index.js decodeManifest):
     * one unencrypted address, or MPEG-DASH; null for anything else (an
     * encrypted stream, a video).
     */
    internal static Manifest? DecodeManifest(object? j)
    {
        if (!Js.Truthy(j) || !Js.Truthy(P(j, "manifest"))) return null;
        var type = Js.Str(Or(P(j, "manifestMimeType"), ""));
        if (P(j, "manifest") is not string b64) return null;
        string text;
        try { text = Base64Text(b64); } catch (FormatException) { return null; }
        if (Bts().IsMatch(type))
        {
            object? m;
            try { m = JsJson.Parse(text); } catch (Exception) { return null; }
            if (!Js.Truthy(m) || P(m, "urls") is not List<object?> urls || urls.Count == 0) return null;
            var enc = P(m, "encryptionType");
            if (Js.Truthy(enc) && !(enc is "NONE")) return null;
            return new Manifest(Js.Str(urls[0]), null, Js.Str(Or(P(m, "mimeType"), "audio/flac")), 0);
        }
        if (Dash().IsMatch(type)) return ParseMpd(text);
        return null;
    }

    /* Buffer.from(s, "base64").toString("utf8"): what isn't base64 skipped, "-" and "_" read as "+" and "/", the padding as it comes. */
    private static string Base64Text(string s)
    {
        var sb = new StringBuilder();
        foreach (var c in s)
        {
            if (c == '=') break;
            if (char.IsAsciiLetterOrDigit(c) || c is '+' or '/') sb.Append(c);
            else if (c == '-') sb.Append('+');
            else if (c == '_') sb.Append('/');
        }
        if (sb.Length % 4 == 1) sb.Length--;
        while (sb.Length % 4 != 0) sb.Append('=');
        return Encoding.UTF8.GetString(Convert.FromBase64String(sb.ToString()));
    }

    [GeneratedRegex(@"<Representation\b[^>]*>")]
    private static partial Regex RepresentationTag();
    [GeneratedRegex(@"<SegmentTemplate\b[^>]*>")]
    private static partial Regex TemplateTag();
    [GeneratedRegex(@"<AdaptationSet\b[^>]*>")]
    private static partial Regex SetTag();
    [GeneratedRegex(@"<S\b([^>]*)\/?>")]
    private static partial Regex SegmentTag();
    [GeneratedRegex(@"\$Number(%0(\d+)d)?\$")]
    private static partial Regex NumberField();
    [GeneratedRegex(@"\$RepresentationID\$")]
    private static partial Regex IdField();

    private static string Unesc(string s) => s.Replace("&amp;", "&").Replace("&lt;", "<").Replace("&gt;", ">").Replace("&quot;", "\"").Replace("&#39;", "'");

    /* name="…" in a tag, unescaped; null when it isn't there. */
    private static string? Attr(string tag, string name)
    {
        var m = Regex.Match(tag, Regex.Escape(name) + "=\"([^\"]*)\"");
        return m.Success ? Unesc(m.Groups[1].Value) : null;
    }

    /*
     * The one audio Representation of a Tidal MPD (index.js parseMpd): its
     * initialisation address and the numbered segment addresses, from the
     * SegmentTemplate and its SegmentTimeline (each <S> is a segment, repeated
     * r more times).
     */
    internal static Manifest? ParseMpd(string xml)
    {
        var rep = RepresentationTag().Match(xml);
        var tpl = TemplateTag().Match(xml);
        if (!tpl.Success) return null;
        var init = Attr(tpl.Value, "initialization");
        var media = Attr(tpl.Value, "media");
        if (string.IsNullOrEmpty(init) || string.IsNullOrEmpty(media)) return null;
        var start = Js.ToNumber(Or(Attr(tpl.Value, "startNumber"), 1.0));
        double count = 0;
        foreach (Match s in SegmentTag().Matches(xml)) count += 1 + NumOr(Attr(s.Value, "r"), 0);
        if (count == 0 || double.IsNaN(count)) count = 1;
        var id = rep.Success ? Attr(rep.Value, "id") ?? "" : "";
        var pieces = new List<string> { init };
        for (double i = 0; i < count; i++)
        {
            var n = Js.Num(start + i);
            var named = NumberField().Replace(media, x => x.Groups[2].Success && x.Groups[2].Value.Length > 0 ? n.PadLeft(int.Parse(x.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture), '0') : n);
            pieces.Add(IdField().Replace(named, _ => id));
        }
        var set = SetTag().Match(xml);
        var mime = Js.Str(Or(Or(rep.Success ? Attr(rep.Value, "mimeType") : null, set.Success ? Attr(set.Value, "mimeType") : null), "audio/mp4"));
        var rate = NumOr(Or(rep.Success ? Attr(rep.Value, "audioSamplingRate") : null, set.Success ? Attr(set.Value, "audioSamplingRate") : null), 0);
        return new Manifest(init, pieces, mime, rate);
    }
}
