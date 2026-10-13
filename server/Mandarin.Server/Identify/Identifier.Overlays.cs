// Identifier.Overlays.cs — what a match writes over an album, and your say on
// it (v0.8.19; out of Identifier.cs in v0.9.2): the album's edit and track
// titles kept for undo, put back on a reject, accepted, or forgotten so the
// scan looks again.
using Microsoft.Data.Sqlite;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class Identifier
{
    // ------------------------------------------------------------ the album's overlays (lib/library/index.js)

    /* The album's edit and track titles as they are, for undo. */
    private static JsObj Snapshot(SqliteConnection c, SqliteTransaction? tx, Album al)
    {
        var cur = RowsTx(c, tx, "SELECT title, artist, year FROM album_edits WHERE key = $1", al.Key).FirstOrDefault() ?? new object?[3];
        var edit = new JsObj();
        edit["title"] = Js.Truthy(cur[0]) ? cur[0] : null;
        edit["artist"] = Js.Truthy(cur[1]) ? cur[1] : null;
        edit["year"] = Js.Truthy(cur[2]) ? cur[2] : null;
        var tracks = new JsObj();
        foreach (var r in RowsTx(c, tx, "SELECT pos, title FROM track_edits WHERE key = $1 AND title IS NOT NULL ORDER BY rowid", al.Key)) tracks[Js.Str(r[0])] = r[1];
        var o = new JsObj();
        o["edit"] = edit;
        o["tracks"] = tracks;
        return o;
    }

    private static List<object?[]> RowsTx(SqliteConnection c, SqliteTransaction? tx, string sql, params object?[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), Bind(args[i]));
        using var r = cmd.ExecuteReader();
        var rows = new List<object?[]>();
        while (r.Read())
        {
            var row = new object?[r.FieldCount];
            for (var i = 0; i < r.FieldCount; i++) row[i] = Value(r.IsDBNull(i) ? null : r.GetValue(i));
            rows.Add(row);
        }
        return rows;
    }

    /* library.saveEdit(id, { title, artist, year }): laid over the album; an empty value puts back what was scanned. */
    private static void SaveEdit(SqliteConnection c, SqliteTransaction tx, Album al, object? title, object? artist, object? year)
    {
        var cur = RowsTx(c, tx, "SELECT title, artist, year, art, art_hash, art_source FROM album_edits WHERE key = $1", al.Key).FirstOrDefault() ?? new object?[6];
        object? Or(object? v) => Js.Truthy(v) ? v : null;
        string? Text(object? v, string scanned)
        {
            var t = Js.Trim(Js.IsNullish(v) ? "" : Js.Str(v));
            return t.Length > 0 && t != scanned ? t : null;
        }
        var nTitle = Text(title, al.ScannedTitle);
        var nArtist = Text(artist, al.ScannedArtist);
        var y = Js.ParseInt(year);
        object? nYear = y >= 1000 && y <= 2999 && !(al.ScannedYear is long sy && sy == y) ? y : null;
        object? art = Or(cur[3]), artHash = Or(cur[4]), artSource = Or(cur[5]);
        if (nTitle == null && nArtist == null && nYear == null && art == null)
            Exec(c, tx, "DELETE FROM album_edits WHERE key = $1", al.Key);
        else
            Exec(c, tx, @"INSERT INTO album_edits(key, title, artist, year, art, art_hash, art_source, updated_at)
                          VALUES($1, $2, $3, $4, $5, $6, $7, $8)
                          ON CONFLICT(key) DO UPDATE SET title=excluded.title, artist=excluded.artist, year=excluded.year,
                            art=excluded.art, art_hash=excluded.art_hash, art_source=excluded.art_source,
                            updated_at=excluded.updated_at",
                al.Key, nTitle, nArtist, nYear, art, artHash, artSource, (double)Now);
    }

    /* library.saveTrackEdits(id, titles): each position's title, or the tagged one put back. */
    private static void SaveTrackEdits(SqliteConnection c, SqliteTransaction tx, Album al, JsObj titles)
    {
        var rows = RowsTx(c, tx, "SELECT disc_no, track_no, title FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id);
        foreach (var pos in titles.Keys)
        {
            var title = titles[pos];
            var t = Js.Trim(Js.IsNullish(title) ? "" : Js.Str(title));
            var i = -1;
            for (var k = 0; k < rows.Count && i < 0; k++) if (TrackPos(rows[k][0], rows[k][1], k) == pos) i = k;
            var tagged = i >= 0 ? (Js.Truthy(rows[i][2]) ? Js.Str(rows[i][2]) : "") : null;
            if (t.Length == 0 || t == tagged) Exec(c, tx, "DELETE FROM track_edits WHERE key = $1 AND pos = $2", al.Key, pos);
            else Exec(c, tx, "INSERT INTO track_edits(key, pos, title) VALUES($1, $2, $3) ON CONFLICT(key, pos) DO UPDATE SET title = excluded.title", al.Key, pos, t);
        }
    }

    /*
     * Write a candidate's names over the album: the album's name and the year
     * it first came out (the group's), never the pressing's; each track the
     * name of the release track it was paired with (by position only for a
     * candidate kept without its pairs); one paired with nothing keeps its tag.
     */
    private static void Apply(SqliteConnection c, SqliteTransaction tx, Album al, JsObj cand)
    {
        SaveEdit(c, tx, al, Score.Clean(cand["title"]), cand["artist"], Js.Truthy(cand["year"]) ? cand["year"] : "");
        var rows = RowsTx(c, tx, "SELECT disc_no, track_no FROM tracks WHERE album_id = $1 ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", (double)al.Id);
        var pairs = cand["pairs"] as List<object?>;
        var tracks = L(cand["tracks"]);
        var titles = new JsObj();
        for (var i = 0; i < rows.Count; i++)
        {
            var p = pairs != null ? (i < pairs.Count ? pairs[i] : Undef.V) : (double)i;
            JsObj? r = null;
            if (!Js.IsNullish(p))
            {
                var j = Js.ToNumber(p);
                if (j >= 0 && j == Math.Floor(j) && j < tracks.Count) r = tracks[(int)j] as JsObj;
            }
            if (r != null && Js.Truthy(r["title"])) titles[TrackPos(rows[i][0], rows[i][1], i)] = Score.Clean(r["title"]);
        }
        SaveTrackEdits(c, tx, al, titles);
    }

    /* Put back what the album had before the match was applied (undo's writes). */
    private static void Undo(SqliteConnection c, SqliteTransaction tx, Album al, MatchRow r)
    {
        object? before = null;
        try { before = JsJson.Parse(Js.Truthy(r.Before) ? Js.Str(r.Before) : "null"); } catch (Exception) { /* none */ }
        var b = before as JsObj;
        var e = (b != null && Js.Truthy(b["edit"]) ? b["edit"] as JsObj : null) ?? new JsObj();
        SaveEdit(c, tx, al, Js.Truthy(e["title"]) ? e["title"] : "", Js.Truthy(e["artist"]) ? e["artist"] : "", Js.Truthy(e["year"]) ? e["year"] : "");
        Exec(c, tx, "DELETE FROM track_edits WHERE key = $1", al.Key);
        if (b != null && b["tracks"] is JsObj t && t.Count > 0) SaveTrackEdits(c, tx, al, t);
        var next = r.Copy();
        next.Status = "rejected";
        next.Before = null;
        next.AppliedAt = null;
        Put(c, tx, next);
    }

    /* Forget every verdict that wasn't applied, so the scan looks at those albums again. Declined ones stay declined. */
    public Task<int> RecheckAll() => Writing(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        return (Exec(c, null, "DELETE FROM album_matches WHERE status IN ('unidentified', 'proposed')"), false);
    });

    // ------------------------------------------------------------ your say

    public Task<MatchRow?> Accept(Album al) => Writing<MatchRow?>(async () => { await Task.CompletedTask; var r = AcceptNow(al); return (r, r != null); });

    private MatchRow? AcceptNow(Album al)
    {
        using var c = Db.Open();
        var r = Row(c, al.Key);
        if (r == null || !Js.Truthy(r.Candidate)) return null;
        var cand = JsJson.Parse(Js.Str(r.Candidate)) as JsObj ?? new JsObj();
        using var tx = c.BeginTransaction();
        var next = r.Copy();
        next.Status = "applied";
        next.Before = Js.Json(Snapshot(c, tx, al));
        next.AppliedAt = (double)Now;
        Put(c, tx, next);
        Apply(c, tx, al, cand);
        tx.Commit();
        return Row(c, al.Key);
    }

    /* listed: the album is on the walls (albumFor finds it); undo needs it, declining a proposal doesn't. */
    public Task<MatchRow?> Reject(Album al, bool listed) => Writing<MatchRow?>(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        var r = Row(c, al.Key);
        if (r == null || (r.Status == "applied" && !listed)) return (null, false);
        using var tx = c.BeginTransaction();
        var undone = r.Status == "applied";
        if (undone) Undo(c, tx, al, r);
        else
        {
            var next = r.Copy();
            next.Status = "rejected";
            next.AppliedAt = null;
            Put(c, tx, next);
        }
        tx.Commit();
        return (Row(c, al.Key), undone);
    });

    /* Put back what the album had before the match was applied. */
    public Task<MatchRow?> UndoIt(Album al) => Writing<MatchRow?>(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        var r = Row(c, al.Key);
        if (r == null || r.Status != "applied") return (null, false);
        using var tx = c.BeginTransaction();
        Undo(c, tx, al, r);
        tx.Commit();
        return (Row(c, al.Key), true);
    });

    /* Forget the verdict: the scan looks at the album again (from the pack too, while musicbrainz.org is away). */
    public Task<bool> Recheck(Album al, bool listed) => Writing(async () =>
    {
        await Task.CompletedTask;
        using var c = Db.Open();
        var r = Row(c, al.Key);
        using var tx = c.BeginTransaction();
        var undone = r != null && r.Status == "applied" && listed;
        if (undone) Undo(c, tx, al, r!);
        Exec(c, tx, "DELETE FROM album_matches WHERE key = $1", al.Key);
        tx.Commit();
        lock (state) packTried.Remove(al.Key);
        return (true, undone);
    });
}
