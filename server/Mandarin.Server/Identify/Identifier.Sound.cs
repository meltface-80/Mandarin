// Identifier.Sound.cs — an album matched by sound (bug list item 414c), joined to the steps before it: only an album
// still unsure once what its files carry, its tracks' lengths, the search by name and the edition have had their say
// (left unidentified, or proposed below the apply threshold), and before iTunes is asked. Never an album matched or
// edited by hand, nor one already applied (they are never looked at again); a release you turned down stays turned
// down (Judge).
//
//   - each track's Chromaprint fingerprint, made one at a time while the Album Scanner may run, or the one kept for
//     the file as it is (Fingerprints.cs);
//   - each asked of AcoustID with your key (AcoustId.cs): the recordings it is, the releases those are on; each track
//     votes once for every release its recordings are on (the matches 50 % sure or better);
//   - the releases most tracks agree on, more than half of them, nearest the copy's track count first, fetched in
//     full the usual way (the pack, then MusicBrainz) and scored like any other, the record's other pressings with
//     them (Pressings); every one of them marked "matched by sound" and how many of the tracks agree ("sound_of");
//   - 90 % of the tracks or more agreeing, every one paired and every length agreeing: applied, whatever the names say
//     (Confidence.Strong, as for a barcode); else what the scorer and Judge say;
//   - the verdict kept when it is surer than the one by name.
// No key, a key AcoustID refuses, AcoustID busy or not reached: the step is skipped, quietly, and the readout says why
// (SoundSays). A key saved that works puts the unsure albums back in the queue (SoundKeyed).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    private const double SoundSure = 0.5;      // an AcoustID match counted from this score
    private const int SoundFetch = 3;          // releases fetched in full among those most tracks agree on
    public const double SoundStrong = 0.9;     // the share of the tracks that applies a match, every length agreeing

    /* AcoustID, when it is asked (Jobs.cs). */
    public AcoustId? Sound { get; init; }

    private volatile string? soundStep;
    /* "fingerprinting" or "matching by sound" while an album is matched by sound, for the readout's Now line. */
    public string? SoundStep => soundStep;

    /* Why albums aren't matched by sound now, for the readout: "needs-key", "refused", "limited", "unreachable"; null when they are. */
    public string? SoundSays()
    {
        if (Sound == null) return null;
        if (AcoustId.Key().Length == 0) return "needs-key";
        return Sound.State switch { "invalid" => "refused", "limited" or "unreachable" when Sound.Paused => Sound.State, _ => null };
    }

    /* The work may go on: the Album Scanner on, in its hours, the library not being scanned, no music playing. */
    private async Task<bool> MayGoOn()
    {
        if (stopped || !AlbumScanner.On() || !AlbumScanner.InHours() || AlbumScanner.Playing()) return false;
        return await Library.CurrentState() is not var (_, st) || !st.Scanning;
    }

    private sealed record SoundTrack(string Path, long Size, long Mtime, double Seconds);

    /* The album's tracks with a file of their own, in playing order; and, [streamed], its iBroadcast tracks (item 459). */
    private static List<SoundTrack> SoundTracks(Album al, bool streamed = false)
    {
        using var c = Db.Open();
        return Rows(c, "SELECT path, size, mtime, duration FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id)
            .Where(r => r[0] is string p && (!p.Contains("://", StringComparison.Ordinal) || (streamed && Services.IBroadcast.IBroadcastDownloads.Is(p))))
            .Select(r => new SoundTrack((string)r[0]!, (long)Js.ToNumber(r[1]), (long)Js.ToNumber(r[2]), Js.ToNumber(r[3]))).ToList();
    }

    /* [t]'s fingerprint: kept, or made now (null when it has none). Fingerprints.Stopped when the work may not go on. */
    private async Task<string?> PrintOf(SoundTrack t)
    {
        if (Fingerprints.Kept(t.Path, t.Size, t.Mtime) is { } kept) return kept.Fingerprint;
        // An album chosen to play (Identifier.Played.cs): whatever the hour, its own music the music playing.
        if (!PlayedNow && !await MayGoOn()) throw new Fingerprints.Stopped();
        soundStep = "fingerprinting";
        try
        {
            var fp = await Fingerprints.Make(await SourceOf(t.Path), PlayedNow ? () => stopped : () => stopped || !AlbumScanner.On() || AlbumScanner.Playing());
            Fingerprints.Keep(t.Path, t.Size, t.Mtime, fp, fp == null ? "no audio to fingerprint" : null);
            return fp;
        }
        catch (Exception e) when (e is not Fingerprints.Stopped)
        {
            // An iBroadcast track not read: not kept (asked again next time), nor said in ffmpeg's words (they name its address).
            if (Services.IBroadcast.IBroadcastDownloads.Is(t.Path)) { log($"[identify] iBroadcast track {t.Path["ibroadcast://track/".Length..]}: couldn't be read to fingerprint"); return null; }
            Fingerprints.Keep(t.Path, t.Size, t.Mtime, null, Scan.OfflineDrives.Failure(t.Path, e.Message));
            return null;
        }
    }

    private static List<object?> Ls(object? v) => v as List<object?> ?? [];

    /* The releases one AcoustID answer puts a track on, with what tells them apart: { id → (group, tracks) }. */
    private static Dictionary<string, (string Group, double Tracks)> ReleasesIn(List<JsObj> results)
    {
        var found = new Dictionary<string, (string, double)>(StringComparer.Ordinal);
        void Add(object? rel, string group)
        {
            if (rel is not JsObj r || !Js.Truthy(r["id"])) return;
            found.TryAdd(Js.Str(r["id"]), (group, r["track_count"] is double n ? n : 0));
        }
        foreach (var res in results.Where(x => x["score"] is double s && s >= SoundSure))
            foreach (var rec in Ls(res["recordings"]).OfType<JsObj>())
            {
                foreach (var rel in Ls(rec["releases"])) Add(rel, "");
                foreach (var g in Ls(rec["releasegroups"]).OfType<JsObj>())
                    foreach (var rel in Ls(g["releases"])) Add(rel, Js.Truthy(g["id"]) ? Js.Str(g["id"]) : "");
            }
        return found;
    }

    /* The candidate marked as found by sound, [n] of [of] tracks agreeing. */
    private static JsObj BySound(JsObj c, int n, int of) => With(With(c, "matched_by", "acoustid"), "sound_of", n + "/" + of);

    /*
     * The album matched by sound: its verdict, or null when the step is skipped (no key, AcoustID refusing, busy or
     * not reached, no release most tracks agree on). Fingerprints.Stopped when the work may not go on.
     */
    private async Task<Score.Verdict?> SoundResolve(Album al, JsObj input)
    {
        var key = AcoustId.Key();
        if (Sound is not { } sound || key.Length == 0 || sound.Paused || sound.State == "invalid" || al.Edited) return null;
        var tracks = SoundTracks(al, PlayedNow);
        if (tracks.Count < MinTracks) return null;
        try
        {
            var prints = new List<(SoundTrack T, string Fp)>();
            foreach (var t in tracks) if (await PrintOf(t) is { } fp) prints.Add((t, fp));
            soundStep = "matching by sound";
            var votes = new Dictionary<string, int>(StringComparer.Ordinal);
            var groupVotes = new Dictionary<string, int>(StringComparer.Ordinal);
            var info = new Dictionary<string, (string Group, double Tracks)>(StringComparer.Ordinal);
            foreach (var (t, fp) in prints)
            {
                List<JsObj> results;
                try { results = await sound.Lookup(key, fp, t.Seconds); }
                catch (AcoustIdError e)
                {
                    log($"[identify] matching by sound skipped: {e.Message}");
                    return null;
                }
                var on = ReleasesIn(results);
                foreach (var (id, i) in on) { votes[id] = votes.GetValueOrDefault(id) + 1; info.TryAdd(id, i); }
                foreach (var g in on.Values.Select(x => x.Group).Where(g => g.Length > 0).Distinct()) groupVotes[g] = groupVotes.GetValueOrDefault(g) + 1;
            }
            var of = tracks.Count;
            var most = votes.Count > 0 ? votes.Values.Max() : 0;
            if (most < 2 || most * 2 <= of) return null;
            var n = TracksIn(input);
            var top = votes.Where(v => v.Value == most).Select(v => v.Key)
                .OrderBy(id => Math.Abs(info[id].Tracks - n)).ThenBy(id => id, StringComparer.Ordinal).Take(SoundFetch).ToList();
            var cands = new List<JsObj>();
            foreach (var id in top)
            {
                JsObj? rel;
                try { rel = await Mb.Release(id); } catch (Exception) { rel = null; }
                if (rel != null) cands.Add(BySound(rel, most, of));
            }
            if (cands.Count == 0) return null;
            // The record's other pressings beside them, as by name (Identifier.Editions.cs); each marked as found by sound.
            var r = await Pressings(input, new Resolved(cands, Score.Decide(input, cands), null));
            int Agreeing(JsObj c) => votes.TryGetValue(Js.Str(c["mbid"]), out var k) ? k : Js.Truthy(c["group_mbid"]) ? groupVotes.GetValueOrDefault(Js.Str(c["group_mbid"])) : 0;
            Score.Scored Mark(Score.Scored s) => s with { Candidate = BySound(s.Candidate, Agreeing(s.Candidate), of) };
            var v = r.Verdict;
            var best = v.Best != null ? Mark(v.Best) : null;
            v = v with { Best = best, ScoredList = [.. v.ScoredList.Select(s => ReferenceEquals(s, v.Best) ? best! : Mark(s))] };
            if (best != null && Confidence.Strong(input, best, "acoustid")) v = Applied(v, "acoustid");
            return v;
        }
        finally { soundStep = null; }
    }

    private static (int Status, int Confidence) Sureness(JsObj input, Score.Verdict v)
    {
        var j = Judge(input, v);
        var c = j.Best?.Candidate["confidence"] is double d ? (int)d : 0;
        return (j.Status switch { "applied" => 2, "proposed" => 1, _ => 0 }, c);
    }

    /*
     * The verdict by name ([byName], unsure), or the one by sound when it is surer. Fingerprints.Stopped when the
     * work may not go on: the album is looked at again when it may.
     */
    private async Task<Score.Verdict> OrBySound(Album al, JsObj input, Score.Verdict byName)
    {
        if (Sureness(input, byName).Status == 2) return byName;
        var v = await SoundResolve(al, input);
        if (v?.Best == null || Sureness(input, v).CompareTo(Sureness(input, byName)) <= 0) return byName;
        log($"[identify] {al.Artist} — {al.Title}: matched by sound ({Js.Str(v.Best.Candidate["sound_of"]).Replace("/", " of ", StringComparison.Ordinal)} tracks) → {Js.Str(v.Best.Candidate["artist"])} — {Js.Str(v.Best.Candidate["title"])}");
        return v;
    }

    /*
     * An AcoustID key saved that works: the albums unidentified or proposed looked at again, as a new pack has them
     * (PackUpdated: never one declined, nor one matched by hand). → how many.
     */
    public Task<int> SoundKeyed() => Writing(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        var n = Exec(c, null, "UPDATE album_matches SET checked_at = 0 WHERE status IN ('unidentified', 'proposed')");
        AlbumProgress.Forget();
        if (n > 0) log($"[identify] an AcoustID key: {n} album{(n == 1 ? "" : "s")} to match by sound");
        return (n, false);
    });
}
