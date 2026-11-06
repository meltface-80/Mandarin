// Players.Albums.cs — an album played to a renderer as one stream (bug list item 300: Upsample/AlbumRun.cs).
//
// With the device's "Albums as one stream" on, the queue's run of one album's tracks (each made by Mandarin, in one
// plan) is given the device as one URI, /stream/a<id>_<id>…, from the track jumped to: it opens one file, and plays
// it start to end. The room shows each track as it comes, from where the device is in the stream; a jump, a seek or
// Previous starts the stream again there (its ?ss= the seconds into its first track). Nothing is armed as the next
// while a run plays: at its end what follows is started by hand, as a new album is.
using System.Globalization;
using System.Text.RegularExpressions;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Renderers;

/* A run of the queue as one stream: its tracks, the URI and DIDL the device is given, each track's start in the stream (s), its making's name. */
internal sealed record AlbumStream(IReadOnlyList<UpnpItem> Items, string Uri, string Meta, IReadOnlyList<double> Starts, string? Key)
{
    /* The track [rel] s into the stream, and how far into it. */
    public (UpnpItem Item, double At) At(double rel)
    {
        var j = 0;
        while (j + 1 < Starts.Count && rel >= Starts[j + 1]) j++;
        return (Items[j], Math.Max(0, rel - Starts[j]));
    }
}

internal sealed partial class Players
{
    [GeneratedRegex(@"/stream/t([0-9]+)(?=[.?])")] private static partial Regex TrackPath();
    [GeneratedRegex(@"[?&]s=[^&]*")] private static partial Regex SigParam();
    [GeneratedRegex(@"duration=""[^""]*""")] private static partial Regex DidlDuration();

    /* The run of [p]'s queue from [index], begun [seconds] into it, where its device plays albums as one stream; else null. */
    private static AlbumStream? RunFrom(Player p, int index, double seconds)
    {
        // Not through its own player (item 306): MPD plays one track into the next itself.
        var target = TargetFor(p.Id);
        if (index < 0 || index >= p.Queue.Count || p.Shuffle || p.Loop == "loop_one" || !Jv.T(target?["album_stream"]) || Jv.Same(target?["player"], "mpd")) return null;
        var first = p.Queue[index];
        if (Pattern(first) is not { } plan || first.Track is not { } t0) return null;
        var items = new List<UpnpItem> { first };
        for (var i = index + 1; i < p.Queue.Count; i++)
        {
            var it = p.Queue[i];
            if (it.Track is not { } t || t.AlbumId != t0.AlbumId || Pattern(it) != plan) break;
            items.Add(it);
        }
        if (items.Count < 2) return null;
        string secret;
        using (var c = Db.Open()) secret = Db.Setting(c, "authSecret") is { } sv && Mandarin.Server.Js.Str(sv) is { Length: > 0 } s ? s : "";   // as Hub.Secret reads it
        var unsigned = SigParam().Replace(TrackPath().Replace(first.Uri, "/stream/a" + string.Join("_", items.Select(x => x.Track!.Id.ToString(CultureInfo.InvariantCulture))), 1), "");
        if (unsigned.Contains('&') && !unsigned.Contains('?')) unsigned = unsigned[..unsigned.IndexOf('&')] + "?" + unsigned[(unsigned.IndexOf('&') + 1)..];
        if (seconds > 0) unsigned += (unsigned.Contains('?') ? "&" : "?") + "ss=" + Math.Round(seconds, 3).ToString(CultureInfo.InvariantCulture);
        var uri = Signing.SignUrl(secret, unsigned);
        var starts = new List<double>();
        var at = -seconds;
        foreach (var it in items) { starts.Add(at); at += it.Duration; }
        // The DIDL the first track's, its address and length the run's.
        var meta = DidlDuration().Replace(first.Meta.Replace(Xml.Escape(first.Uri), Xml.Escape(uri), StringComparison.Ordinal), $"duration=\"{Didl.Hms(at)}\"", 1);
        var key = first.Plan != null ? Upsample.AlbumRun.Takes(ConvPlan.Of(first.Plan))
            ? new Upsample.AlbumRun([.. items.Select(x => new ConvTrack(x.Track!.Id, x.Track.Path, Hub.TierOrMtime(x.Track)))], [.. items.Select(x => x.Duration)], seconds).KeyFor(ConvPlan.Of(first.Plan)) : null : null;
        return new AlbumStream(items, uri, meta, starts, key);
    }

    // [it]'s plan as its address says it (all but its track and signature), where Mandarin makes it so a run can be made of it; else null.
    private static string? Pattern(UpnpItem it)
    {
        if (it.Plan == null || it.Track is not { Lossless: true } t || t.Path.Contains("://", StringComparison.Ordinal) || !Jv.T(it.Plan["transcode"])) return null;
        var plan = ConvPlan.Of(it.Plan) with { InRate = Jv.T(it.Plan["inRate"]) ? Jv.Num(it.Plan["inRate"]) : t.SampleRate ?? 0 };
        if (!Upsample.AlbumRun.Takes(plan) || !TrackPath().IsMatch(it.Uri)) return null;
        return SigParam().Replace(TrackPath().Replace(it.Uri, "/stream/t", 1), "");
    }

    /* The track [p]'s device is in, [rel] s into what it plays ([uri]), where that is its run: the track's place in the queue and how far into it; else null. */
    private static (int Index, double At)? InRun(Player p, string uri, double rel)
    {
        if (p.Run is not { } run || !Names(uri, run)) return null;
        var (item, at) = run.At(rel);
        // By its track, the queue's items made again when the settings change (Replan): from the one playing on.
        var from = Math.Max(0, p.Index);
        var i = p.Queue.FindIndex(from, q => q.TrackId == item.TrackId);
        if (i < 0) i = p.Queue.FindIndex(q => q.TrackId == item.TrackId);
        return i >= 0 ? (i, at) : null;
    }

    /*
     * Whether [uri], as a device names what it plays, is [run]'s (item 305): its own address, or that address as the
     * device gives it back, its &s escaped or its characters percent-encoded.
     */
    internal static bool Names(string uri, AlbumStream run) =>
        uri == run.Uri || uri.Length > 0 && Plain(uri) == Plain(run.Uri);

    private static string Plain(string uri) => Uri.UnescapeDataString(uri.Replace("&amp;", "&", StringComparison.Ordinal));

    /*
     * Whether the device has gone on from [run] to another track of [p]'s queue ([index], -1 for none of it): a track
     * of its own, outside the run. Nothing else drops the run (item 305): a slow device names the track it was playing
     * before for a moment after the jump (item 150), and a Chord Poly so lost the run at its first read, and took the
     * album a track at a time, the next started by hand at each one's end.
     */
    private static bool Left(Player p, AlbumStream run, int index) => index >= 0 && !run.Items.Contains(p.Queue[index]);

    /*
     * What is armed as [p]'s next: nothing while a run plays, so that the device names the run's URI from start to end
     * (a Chord Poly names the URI it was set to all along: item 299; a FiiO SR11 names its next as soon as it has it:
     * item 233); at the run's end it stops, and what follows is started by hand, as a new album is.
     */
    private static int AfterRun(Player p) => p.Run != null ? -1 : NextIndex(p);
}
