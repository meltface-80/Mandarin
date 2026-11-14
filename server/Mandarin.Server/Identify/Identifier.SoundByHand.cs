// Identifier.SoundByHand.cs — Edit album's Match by sound (bug list item 419): the step of item 414c
// (Identifier.Sound.cs) run on one album when you ask, not when the Album Scanner's schedule comes round.
//
//   - each track's fingerprint: the one kept for the file as it is, or made now at the same low priority
//     (Fingerprints.Make: ffmpeg on the cores playback doesn't keep, nice 19), without waiting for the scanner's hours
//     or for the music to stop — you asked;
//   - each asked of AcoustID with your key, through its queue (three a second, AcoustId.cs): the releases each track's
//     recordings are on, each track voting once for each;
//   - the releases most tracks vote for, the few nearest the copy's track count among them, fetched in full (the pack,
//     then MusicBrainz in its slot, MbSlot.cs) and scored like any other, each with its confidence and reasons as item
//     414b words them, "matched by sound: n of m tracks" first.
// Nothing is written: one is applied by Find match's route (/api/identify/match, how "sound"), as any match chosen
// by hand (overlays, Undo, recorded as yours), marked with how many tracks voted for it (SoundMarked).
//
// One job at a time, the server's whole: another album asked while one is under way is told which. What it heard is
// kept for the last few albums asked, for the release chosen to be marked with it.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    private const int SoundListed = 5;     // releases fetched in full and offered
    private const int SoundHeardKept = 20; // albums whose votes are kept for the release chosen

    /* Match by sound's job: where it is ([Step], [Done] of [Of]) and what came of it ([Answer], [Releases]). */
    private sealed class SoundJob(string key, double offset, string title)
    {
        public readonly string Key = key;
        public readonly double Offset = offset;
        public readonly string Title = title;
        public volatile string Step = "fingerprinting";   // "fingerprinting", "asking", "fetching", then "done"
        public volatile int Done;
        public volatile int Of;
        /* Done: null with releases found; else "needs-key", "refused", "limited", "unreachable", "no-match", "no-files", "failed". */
        public volatile string? Answer;
        public volatile string? Error;
        public List<object?> Releases = [];
        public long EndedAt;
    }

    private SoundJob? soundJob;
    private readonly Dictionary<string, (Dictionary<string, int> Votes, Dictionary<string, int> Groups, int Of)> soundHeard = [];

    /* A job as the page reads it. */
    private static JsObj SoundSaid(SoundJob j)
    {
        var o = new JsObj();
        o["offset"] = j.Offset;
        o["title"] = j.Title;
        o["state"] = j.Step;
        o["done"] = (double)j.Done;
        o["of"] = (double)j.Of;
        o["answer"] = j.Answer;
        o["error"] = j.Error;
        o["releases"] = j.Step == "done" ? j.Releases : new List<object?>();
        return o;
    }

    /* The job for the album [key]: its state; { state: "busy", title } while another album's runs; { state: "none" }. */
    public JsObj SoundState(string key)
    {
        lock (state)
        {
            if (soundJob is { } j && j.Key == key) return SoundSaid(j);
            var o = new JsObj();
            o["state"] = soundJob is { Step: not "done" } other ? "busy" : "none";
            o["title"] = soundJob is { Step: not "done" } b ? b.Title : null;
            return o;
        }
    }

    /*
     * Match by sound started for [al] (at [offset]): its state. Already under way for it: the same job. Under way for
     * another album: null, and that album's title in [busy].
     */
    public JsObj? SoundStart(Album al, double offset, out string? busy)
    {
        busy = null;
        lock (state)
        {
            if (soundJob is { Step: not "done" } running)
            {
                if (running.Key == al.Key) return SoundSaid(running);
                busy = running.Title;
                return null;
            }
            var job = new SoundJob(al.Key, offset, al.Title);
            soundJob = job;
            _ = Task.Run(() => SoundRun(job, al));
            return SoundSaid(job);
        }
    }

    /* [t]'s fingerprint: kept, or made now whatever the hour or the music (you asked); null when it has none. */
    private static async Task<string?> PrintNow(SoundTrack t)
    {
        if (Fingerprints.Kept(t.Path, t.Size, t.Mtime) is { } kept) return kept.Fingerprint;
        try
        {
            var fp = await Fingerprints.Make(t.Path, () => false);
            Fingerprints.Keep(t.Path, t.Size, t.Mtime, fp, fp == null ? "no audio to fingerprint" : null);
            return fp;
        }
        catch (Exception e) when (e is not Fingerprints.Stopped)
        {
            Fingerprints.Keep(t.Path, t.Size, t.Mtime, null, Scan.OfflineDrives.Failure(t.Path, e.Message));
            return null;
        }
    }

    private async Task SoundRun(SoundJob job, Album al)
    {
        try { await SoundWork(job, al); }
        catch (Exception e)
        {
            job.Answer = "failed";
            job.Error = e.Message;
        }
        finally
        {
            job.EndedAt = Now;
            job.Step = "done";
            log($"[identify] {al.Artist} — {al.Title}: match by sound asked → " + (job.Answer ?? job.Releases.Count + " release" + (job.Releases.Count == 1 ? "" : "s")));
        }
    }

    private async Task SoundWork(SoundJob job, Album al)
    {
        var key = AcoustId.Key();
        if (key.Length == 0) { job.Answer = "needs-key"; return; }
        if (Sound is not { } sound || sound.State == "invalid") { job.Answer = "refused"; return; }
        var tracks = SoundTracks(al);
        job.Of = tracks.Count;
        if (tracks.Count == 0) { job.Answer = "no-files"; return; }
        var prints = new List<(SoundTrack T, string Fp)>();
        foreach (var t in tracks)
        {
            if (await PrintNow(t) is { } fp) prints.Add((t, fp));
            job.Done++;
        }
        job.Step = "asking";
        job.Done = 0;
        job.Of = prints.Count;
        var votes = new Dictionary<string, int>(StringComparer.Ordinal);
        var groups = new Dictionary<string, int>(StringComparer.Ordinal);
        var info = new Dictionary<string, (string Group, double Tracks)>(StringComparer.Ordinal);
        foreach (var (t, fp) in prints)
        {
            List<JsObj> results;
            try { results = await sound.Lookup(key, fp, t.Seconds); }
            catch (AcoustIdError e)
            {
                job.Answer = e.Kind switch { "invalid" => "refused", "limited" => "limited", "unreachable" => "unreachable", _ => "failed" };
                job.Error = e.Message;
                return;
            }
            var on = ReleasesIn(results);
            foreach (var (id, i) in on) { votes[id] = votes.GetValueOrDefault(id) + 1; info.TryAdd(id, i); }
            foreach (var g in on.Values.Select(x => x.Group).Where(g => g.Length > 0).Distinct()) groups[g] = groups.GetValueOrDefault(g) + 1;
            job.Done++;
        }
        var of = tracks.Count;
        lock (state)
        {
            soundHeard.Remove(al.Key);
            if (soundHeard.Count >= SoundHeardKept) soundHeard.Remove(soundHeard.Keys.First());
            soundHeard[al.Key] = (votes, groups, of);
        }
        if (votes.Count == 0) { job.Answer = "no-match"; return; }
        JsObj input;
        using (var c = Db.Open()) input = Input(c, al);
        var n = TracksIn(input);
        var top = votes.OrderByDescending(v => v.Value).ThenBy(v => Math.Abs(info[v.Key].Tracks - n)).ThenBy(v => v.Key, StringComparer.Ordinal)
            .Take(SoundListed).Select(v => v.Key).ToList();
        job.Step = "fetching";
        job.Done = 0;
        job.Of = top.Count;
        var cands = new List<JsObj>();
        foreach (var id in top)
        {
            JsObj? rel;
            try { rel = await Mb.Release(id); } catch (Exception) { rel = null; }
            if (rel != null) cands.Add(BySound(rel, votes[id], of));
            job.Done++;
        }
        if (cands.Count == 0) { job.Answer = "failed"; job.Error = "MusicBrainz didn't give those releases"; return; }
        var listed = Score.Decide(input, cands).ScoredList
            .Select(s => (S: s, Heard: votes.GetValueOrDefault(Js.Str(s.Candidate["mbid"])), Judged: Confidence.Of(input, s, false)))
            .OrderByDescending(x => x.Heard).ThenByDescending(x => x.Judged.Value).ThenBy(x => x.S.Distance);
        job.Releases = listed.Select(x => (object?)SoundRelease(x.S, x.Heard, of, x.Judged)).ToList();
    }

    /* A release offered: as Find match offers one (Suggest), with how many tracks voted for it and how sure, and why. */
    private static JsObj SoundRelease(Score.Scored s, int heard, int of, Confidence.Judged judged)
    {
        var c = s.Candidate;
        var x = new JsObj();
        x["mbid"] = c["mbid"];
        x["title"] = Score.Clean(c["title"]);
        x["artist"] = c["artist"];
        x["year"] = c["year"];
        foreach (var k in new[] { "release_title", "release_year", "edition", "country", "type" }) x[k] = Js.Truthy(c[k]) ? c[k] : null;
        x["track_count"] = c["track_count"];
        x["source"] = Js.Truthy(c["source"]) ? c["source"] : "musicbrainz";
        x["similarity"] = Js.Round((1 - s.Distance) * 100);
        x["missing_tracks"] = Js.Truthy(s.Parts["missing_tracks"]) ? s.Parts["missing_tracks"] : 0.0;
        x["extra_tracks"] = Js.Truthy(s.Parts["extra_tracks"]) ? s.Parts["extra_tracks"] : 0.0;
        x["heard"] = (double)heard;
        x["tracks_heard"] = (double)of;
        x["confidence"] = (double)judged.Value;
        x["reasons"] = judged.Reasons.Select(r => (object?)r).ToList();
        return x;
    }

    /*
     * The releases chosen after Match by sound ([cands], for the album [key]) marked with how many of its tracks voted
     * for each (the release's own votes, else its record's); null when nothing was heard for the album (the server
     * started again since).
     */
    private List<JsObj>? SoundMarked(string key, List<JsObj> cands)
    {
        (Dictionary<string, int> Votes, Dictionary<string, int> Groups, int Of) h;
        lock (state) { if (!soundHeard.TryGetValue(key, out h)) return null; }
        return cands.Select(c => BySound(c, h.Votes.TryGetValue(Js.Str(c["mbid"]), out var k) ? k
            : Js.Truthy(c["group_mbid"]) ? h.Groups.GetValueOrDefault(Js.Str(c["group_mbid"])) : 0, h.Of)).ToList();
    }

    /*
     * The automatic step's tally, for Settings → API Keys: the albums matched by sound so far (applied, by the scanner
     * or by you), those still to look at (unidentified or proposed, put back in the queue by a key saved, or not yet
     * looked at again), and why it isn't running now ("off": the Album Scanner off; "hours": outside its hours).
     */
    public static JsObj SoundTally()
    {
        using var c = Db.Open();
        double Count(string sql) => Rows(c, sql).Select(r => Js.ToNumber(r[0])).FirstOrDefault();
        var o = new JsObj();
        try
        {
            o["matched"] = Count("SELECT COUNT(*) FROM album_matches WHERE status = 'applied' AND json_valid(candidate) AND (json_extract(candidate, '$.matched_by') = 'acoustid' OR json_extract(candidate, '$.manual') = 'sound')");
            o["waiting"] = Count("SELECT COUNT(*) FROM album_matches WHERE status IN ('unidentified', 'proposed') AND checked_at = 0");
        }
        catch (Microsoft.Data.Sqlite.SqliteException) { o["matched"] = 0.0; o["waiting"] = 0.0; }   // no verdicts yet
        o["held"] = !AlbumScanner.On() ? "off" : !AlbumScanner.InHours() ? "hours" : null;
        return o;
    }
}
