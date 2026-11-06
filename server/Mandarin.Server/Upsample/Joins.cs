// Joins.cs — a track made as it plays, joined to the tracks either side of it on its album (bug list item 262).
//
// Each track was upsampled and made DSD on its own: its filter saw silence before its first sample and after its
// last, its modulator started from rest, and its DSF's last block was filled out with silence. Played one after the
// other, an album that runs on from track to track (a live album, Dark Side of the Moon) dipped and clicked at every
// join, and a player that plays a DSF's padding paused there.
//
// Now a track whose neighbour on its album is a lossless file of the library at the same rate is made with it: the
// upsampler and the modulator start on the last of the track before ([History] frames of it, decoded with the same
// gain, made and thrown away), and the filter's last outputs are worked out from the first of the track after; so
// that the two files, played one after the other, are the one stream the two tracks make. And a DSF of a joined
// album ends on a whole block: the frames short of one are left for the next track's file, which starts with them
// (at most 4096 bytes' worth, 2.9 ms at DSD256). Where each block falls is the album's running sum of frames up to
// the track, so that each track's making, begun on its own, agrees with its neighbours' on what each file holds.
//
// A track is made the same whatever is played before or after it: its neighbours are its album's, not the queue's,
// so the file kept is the one to play however the album is reached. Played out of order, a joined track begins with
// the few ms its album's track before leaves it, and its own last few are the next one's.
namespace Mandarin.Server.Upsample;

internal static class Joins
{
    /* What a made file's name says it was made so: those made before (each on its own) are not mixed with those after. */
    public const string Mark = "j";

    /* The frames of a neighbour each making in [kind] starts on, and of the next one it looks ahead to: twice the filter's length (item 317: the long ones' theirs). */
    public static int History(Shape.Kind kind) => 2 * StreamUpsample.TapsFor(kind);

    /*
     * The frames of the next track a making in [kind] that goes on into it takes in before its own file is done: past
     * all the upsampler holds back (a block of three times the filter's length and its half) and the most a file leaves
     * for the next (4096): eight times the filter's length, 16384 frames for the standard one.
     */
    public static int Ahead(Shape.Kind kind) => 8 * StreamUpsample.TapsFor(kind);

    /*
     * A track's neighbours as its making uses them: their files (null: none joined), the frames it starts with from
     * the one before, and the frames it leaves for the one after; the one after's id and time, which name its file.
     */
    public sealed record Join(string? Before, string? After, long Carry, long Cut, long AfterId = 0, long AfterMtime = 0);

    public static readonly Join None = new(null, null, 0, 0);

    /*
     * Track [id]'s join at [rate] for a DSF whose blocks are [block] of its frames (0: PCM, no blocks): the tracks
     * either side of it on its album, lossless, at its rate, a second long at least, where each is; the frames it
     * starts with (the album's running sum before it, past its last whole block) and leaves (its own past its last).
     */
    public static Join For(long id, long rate, long block)
    {
        if (rate <= 0) return None;
        List<(long Id, string Path, long Frames, bool Ok, long Mtime)> album;
        try { album = Album(id, rate); }
        catch (Exception) { return None; }
        var i = album.FindIndex(x => x.Id == id);
        if (i < 0 || !album[i].Ok) return None;
        bool Joined(int k) => k >= 0 && k < album.Count && album[k].Ok;
        // The album's running sum of frames, over the run of joined tracks this one ends.
        long carry = 0;
        if (block > 0)
        {
            var from = i;
            while (Joined(from - 1)) from--;
            for (var k = from; k < i; k++) carry = (carry + album[k].Frames) % block;
        }
        var before = Joined(i - 1) ? album[i - 1].Path : null;
        var after = Joined(i + 1) ? album[i + 1].Path : null;
        var cut = block > 0 && after != null ? (carry + album[i].Frames) % block : 0;
        return new Join(before, after, before != null ? carry : 0, cut, after != null ? album[i + 1].Id : 0, after != null ? album[i + 1].Mtime : 0);
    }

    /* The frames of a track [seconds] long at [rate], as its making reads it. */
    public static long Frames(double seconds, long rate) => (long)Math.Round(seconds * rate);

    // Track [id]'s album in its order: each track's id, file, frames, and whether it can be joined (lossless, a
    // file of the library that is there, at [rate], a second long at least, not DSD).
    private static List<(long, string, long, bool, long)> Album(long id, long rate)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT t.id, t.path, t.duration, t.sample_rate, t.lossless, t.codec, t.mtime FROM tracks t WHERE t.album_id = (SELECT album_id FROM tracks WHERE id = $id) "
            + "ORDER BY COALESCE(t.disc_no, 1), COALESCE(t.track_no, 0), t.path";
        cmd.Parameters.AddWithValue("$id", id);
        using var r = cmd.ExecuteReader();
        var o = new List<(long, string, long, bool, long)>();
        while (r.Read())
        {
            var path = r.GetString(1);
            var seconds = r.IsDBNull(2) ? 0 : r.GetDouble(2);
            var at = r.IsDBNull(3) ? 0 : r.GetInt64(3);
            var lossless = !r.IsDBNull(4) && r.GetInt64(4) != 0;
            var codec = r.IsDBNull(5) ? "" : r.GetString(5);
            var ok = lossless && at == rate && seconds >= 1 && Playback.StreamPlans.ServiceOf(path) == null
                && !Playback.StreamPlans.IsDsd(Playback.Jv.Obj(("codec", codec), ("path", path))) && File.Exists(path);
            o.Add((r.GetInt64(0), path, Frames(seconds, rate), ok, r.GetInt64(6)));
        }
        return o;
    }

    /* [join] put into a making's [job] (UpsampleCommand.cs): the neighbours' decodes, made as the track's [decode] of [src] at [rate] is, and its carry and cut. */
    public static void Into(System.Text.Json.Nodes.JsonObject job, Join? join, System.Text.Json.Nodes.JsonArray decode, string src, long rate)
    {
        if (join == null) return;
        var kind = Shape.Of((string?)job["shape"]);   // the job's filter: its length is what the neighbours are decoded for
        if (join.Before != null) { job["before"] = Decode(decode, src, join.Before, join.Carry + History(kind), rate, tail: true); job["carry"] = join.Carry; }
        if (join.After != null) { job["after"] = Decode(decode, src, join.After, Ahead(kind), rate, tail: false); job["cut"] = join.Cut; }
    }

    /* A neighbour's decode of its start ([args], as Decode makes it) as its own decode is: without the length it was held to. */
    public static List<string> Whole(List<string> args)
    {
        var o = new List<string>(args);
        var i = o.IndexOf("-t");
        if (i >= 0 && i + 2 < o.Count && o[i + 2] == "-i") o.RemoveRange(i, 2);
        return o;
    }

    /*
     * The decode of a neighbour [path] as the track's own [decode] is (its gain, its rate, 64-bit float stereo): of the
     * last [frames] and some more of it ([tail]), or of its first [frames] and some more.
     */
    public static System.Text.Json.Nodes.JsonArray Decode(System.Text.Json.Nodes.JsonArray decode, string src, string path, long frames, long rate, bool tail)
    {
        var o = new System.Text.Json.Nodes.JsonArray();
        var seconds = (frames / (double)rate + 0.25).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
        foreach (var a in decode)
        {
            var s = (string?)a;
            if (s == "-i") { if (tail) { o.Add("-sseof"); o.Add("-" + seconds); } else { o.Add("-t"); o.Add(seconds); } o.Add("-i"); }
            else o.Add(s == src ? path : s);
        }
        return o;
    }
}
