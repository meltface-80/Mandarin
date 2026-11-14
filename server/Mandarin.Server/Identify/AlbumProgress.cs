// AlbumProgress.cs — how far the Album Scanner (AlbumScanner.cs, bug list item 411) has got, for Settings → Library
// Scanner's one Progress readout: the library's albums with every step done, and what it is doing now.
//
// An album's steps are done when
//   - identification has its verdict: applied, proposed, unidentified or declined (or the album is one it never looks
//     at: too few tracks, Qobuz or Tidal, edited by hand), and nothing waits to be asked again (Identifier.Waits);
//   - ReplayGain is known for each of its tracks: tagged, measured, failed, or streamed (Loudness.Waiting);
//   - its cover is settled: its own, one found, or no sure match (AutoCovers.Left).
// Counted again at most every ten seconds (the page asks every five), or at once after a change of the switch.
using System.Text.Json.Nodes;
using Mandarin.Server.Extras;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal static class AlbumProgress
{
    /* The counts: albums with every step done, the library's albums, and those identification couldn't place or proposes. */
    public readonly record struct Counts(int Done, int Albums, int Unidentified, int Proposed);

    private static readonly object gate = new();
    private static Counts? counted;
    private static long countedAt;

    /* Counted again next time (the switch moved). */
    public static void Forget() { lock (gate) counted = null; }

    /* The library's albums ([lib]), counted. */
    public static Counts Count(Snapshot lib)
    {
        lock (gate) if (counted is { } kept && Environment.TickCount64 - countedAt < 10000) return kept;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        Dictionary<string, MatchRow> rows;
        var unmeasured = new HashSet<long>();
        using (var c = Db.Open())
        {
            rows = Identifier.AllRows(c);
            using var cmd = c.CreateCommand();
            cmd.CommandText = $"SELECT DISTINCT t.album_id FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id WHERE {Loudness.Waiting} AND t.album_id IS NOT NULL";
            using var r = cmd.ExecuteReader();
            while (r.Read()) unmeasured.Add(r.GetInt64(0));
        }
        var eligible = new HashSet<string>(Identifier.Eligible(lib).Select(a => a.Key), StringComparer.Ordinal);
        var ask = Jobs.Identify?.AsksITunes ?? false;
        var art = AutoCoverStore.All();
        var marks = AutoCoverStore.Tracks();
        var folders = AutoCovers.FolderArt();
        int done = 0, albums = 0;
        foreach (var al in lib.Albums)
        {
            if (al.Transient) continue;
            albums++;
            rows.TryGetValue(al.Key, out var row);
            if (eligible.Contains(al.Key) && Identifier.Waits(al, row, now, ask)) continue;
            if (unmeasured.Contains(al.Id) || AutoCovers.Left(al, art, marks, folders, now)) continue;
            done++;
        }
        var p = Identifier.Progress(lib, rows);
        var counts = new Counts(done, albums, (int)Js.ToNumber(p["unidentified"]), (int)Js.ToNumber(p["proposed"]));
        lock (gate) { counted = counts; countedAt = Environment.TickCount64; }
        return counts;
    }

    /*
     * GET /api/album-scanner's answer: { on, schedule: { on, start, end }, albums, done, unidentified, proposed,
     * now: { reason, step, album }, unreachable? }. now.reason: off; waiting (outside the schedule's hours); scanning
     * (the library); playing; working (step: identifying, measuring loudness or finding a cover, of album
     * { offset, artist, title }; neither between two albums); unreachable (MusicBrainz); done; later (what is left is
     * looked at again after the next scan, or at night).
     */
    public static JsonObject Status(Snapshot lib, LibState st)
    {
        var on = AlbumScanner.On();
        var s = Identifier.Stored();
        var n = Count(lib);
        var o = new JsonObject
        {
            ["on"] = on,
            ["schedule"] = new JsonObject { ["on"] = Js.Truthy(s["schedule"]), ["start"] = Js.Str(s["start"]), ["end"] = Js.Str(s["end"]) },
            ["albums"] = n.Albums,
            ["done"] = n.Done,
            ["unidentified"] = n.Unidentified,
            ["proposed"] = n.Proposed,
            ["now"] = Now(on, lib, st, n)
        };
        AutoCovers.Current?.SayReach(o);   // the music folders the cover finder can't reach (item 410)
        return o;
    }

    private static JsonObject Now(bool on, Snapshot lib, LibState st, Counts n)
    {
        var id = Jobs.Identify;
        var idState = id?.State(lib, st);
        var idReason = idState != null ? Js.Str(idState["reason"]) : "";
        string reason = "working";
        string? step = null;
        JsonObject? album = null;
        JsonObject Of(object? offset, object? artist, object? title) =>
            new() { ["offset"] = offset is double d ? d : offset is long l ? l : null, ["artist"] = Js.IsNullish(artist) ? "" : Js.Str(artist), ["title"] = Js.IsNullish(title) ? "" : Js.Str(title) };
        if (!on) reason = "off";
        else if (!AlbumScanner.InHours()) reason = "waiting";
        else if (st.Scanning) reason = "scanning";
        else if (AlbumScanner.Playing()) reason = "playing";
        else if (id is { Running: true } && idState?["current"] is JsObj cur) { step = "identifying"; album = Of(cur["id"], cur["artist"], cur["title"]); }
        else if (Jobs.Loudness?.Measuring is { } m) { step = "measuring loudness"; album = Of(m["offset"], m["subtitle"], m["title"]); }
        else if (AutoCovers.Current?.Now is { } c) { step = "finding a cover"; album = (JsonObject)c.DeepClone(); }
        else if (n.Done >= n.Albums) reason = "done";
        else if (idReason == "unreachable") reason = "unreachable";
        else if (!(id is { Running: true } && idReason is "starting" or "pack") && Jobs.Loudness is not { Busy: true } && AutoCovers.Current is not { Running: true }) reason = "later";
        return new JsonObject { ["reason"] = reason, ["step"] = step, ["album"] = album };
    }
}
