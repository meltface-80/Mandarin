// Scrobbles.cs — every room's and phone's listening to Last.fm, once the owner
// has connected an account (Extras/LastfmAccount.cs). What it hears (Hub):
//
//   "now playing" a track heard playing, named: Last.fm's now playing
//                (track.updateNowPlaying), said once, nothing kept if it fails;
//   "scrobble"   Last.fm's own point, a track over 30 s played half way or for
//                four minutes (Hub.ApplyState): the play kept in the scrobbles
//                table, stamped when it started, and sent; and marked in the
//                scrobbled table (its room or phone, artist, track and start),
//                so the same play heard past the point again — the server
//                started again with it still playing, item 422 — isn't sent
//                again, while the track played again (a repeat) is;
//   offline      a phone's plays from while it had no server
//                (DownloadListRoutes.cs), stamped when they were played.
//
// Kept plays go out fifty to a call (track.scrobble), oldest first, at once and
// every five minutes after, so a play made while Last.fm or the network is down
// goes when it is back; one older than Last.fm takes (14 days) is let go. Last.fm
// saying the session is no longer good (error 9) leaves them kept and asks the
// owner to connect again. Nothing is kept while no account is connected. The
// tables are made here, on first use (Schema.cs only shrinks).
using System.Globalization;
using Mandarin.Server.Extras;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Playback;

internal static class Scrobbles
{
    private const long MaxAgeMs = 14L * 86400000, FlushEveryMs = 5 * 60 * 1000;
    private const int Batch = 50;
    private static readonly SemaphoreSlim sending = new(1, 1);
    private static Timer? timer;
    private static volatile bool made;
    private static Action<string> log = _ => { };

    /* What went wrong at the last send, for Settings (null once one goes). */
    public static string? LastError { get; private set; }

    /* A play as Last.fm takes it: [Ts] when it started, ms. */
    public sealed record Play(string Artist, string Track, string Album, string AlbumArtist, long Ts, double Duration, long? TrackNo);

    public static void Wire(Hub hub)
    {
        log = hub.Log;
        hub.OnNowPlaying += (zone, st) => _ = NowPlaying(st).ContinueWith(t => hub.Log($"[lastfm] {t.Exception?.InnerException?.Message}"), TaskContinuationOptions.OnlyOnFaulted);
        hub.OnScrobble += (zone, st) => _ = Heard(zone, st).ContinueWith(t => hub.Log($"[lastfm] {t.Exception?.InnerException?.Message}"), TaskContinuationOptions.OnlyOnFaulted);
        timer ??= new Timer(_ => _ = Flush(), null, FlushEveryMs, FlushEveryMs);
    }

    /* The tables, made once: the plays waiting to go, and every room's and phone's plays kept to go (14 days of them). */
    private static void Made(SqliteConnection c)
    {
        if (made) return;
        using var cmd = c.CreateCommand();
        cmd.CommandText = @"CREATE TABLE IF NOT EXISTS scrobbles (id INTEGER PRIMARY KEY AUTOINCREMENT, artist TEXT NOT NULL, track TEXT NOT NULL,
            album TEXT, album_artist TEXT, ts INTEGER NOT NULL, duration REAL, track_no INTEGER);
            CREATE TABLE IF NOT EXISTS scrobbled (zone TEXT NOT NULL, artist TEXT NOT NULL, track TEXT NOT NULL, ts INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS scrobbled_zone ON scrobbled(zone, artist, track)";
        cmd.ExecuteNonQuery();
        made = true;
    }

    /* How many plays wait to go. */
    public static long Queued()
    {
        using var c = Db.Open();
        Made(c);
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM scrobbles";
        return Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    /* The play a zone's state is: the library's names for its track where it knows it (as History has them), else what the zone said. */
    private static async Task<Play?> PlayOf(ZoneState e, long startedMs)
    {
        var s = await Library.CurrentCopy();
        using var c = Db.Open();
        var t = e.TrackId != null && s != null ? Tracks.Of(c, s, e.TrackId.Value) : null;
        var al = t != null && s != null ? s.Find(t.AlbumId) : null;
        var artist = t?.Artist is { Length: > 0 } ta ? ta : e.Artist;
        var track = t?.Title is { Length: > 0 } tt ? tt : e.Title;
        if (artist.Length == 0 || track.Length == 0) return null;
        return new Play(artist, track, al?.Title is { Length: > 0 } at ? at : e.Album, al?.Artist ?? t?.AlbumArtist ?? "", startedMs,
            e.Duration > 0 ? e.Duration : t?.Duration ?? 0, t?.TrackNo);
    }

    /* A track heard playing: Last.fm's now playing, when connected. */
    private static async Task NowPlaying(ZoneState st)
    {
        if (LastfmAccount.Current() is not { } session || await PlayOf(st, (long)Hub.Now()) is not { } p) return;
        var ps = Fields(p, "");
        ps["sk"] = session.Key;
        ps.Remove("timestamp");
        try { await LastfmAccount.Call("track.updateNowPlaying", ps, true); }
        catch (Exception e) when (e is LastfmError or HttpRequestException or TaskCanceledException) { Failed(e); }
    }

    /* Last.fm's point passed in [zone]: the play, stamped when it started, kept and sent, unless it was already. */
    private static async Task Heard(string zone, ZoneState st)
    {
        if (LastfmAccount.Current() == null) return;
        var started = (long)Hub.Now() - (long)(Math.Max(0, Hub.PositionNow(st)) * 1000);
        if (await PlayOf(st, started) is not { } p) return;
        using (var c = Db.Open())
        {
            Made(c);
            using var tx = c.BeginTransaction();
            // Already kept: not again, but anything still waiting to go (Last.fm down before a restart) goes now.
            if (Already(c, tx, zone, p)) log($"[lastfm] {p.Artist} — {p.Track} already scrobbled in {zone} (its play from {LastfmAccount.Seconds(p.Ts)})");
            else
            {
                Marked(c, tx, zone, p);
                Keep(c, tx, p);
                tx.Commit();
            }
        }
        await Flush();
    }

    /*
     * The same play already kept in [zone]: its track, started within half Last.fm's point of [p]. Its start is worked
     * out again at each hearing (now less the position), so it moves by a second or two; the track played again starts
     * once the first play has passed the point at least (skipped there; a repeat, a whole length on), and is a new play.
     */
    private static bool Already(SqliteConnection c, SqliteTransaction tx, string zone, Play p)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT 1 FROM scrobbled WHERE zone = $z AND artist = $ar AND track = $tr AND ts > $from AND ts < $to LIMIT 1";
        var half = (long)(Math.Min(240, Math.Max(0, p.Duration) / 2) * 500);
        cmd.Parameters.AddWithValue("$z", zone);
        cmd.Parameters.AddWithValue("$ar", p.Artist);
        cmd.Parameters.AddWithValue("$tr", p.Track);
        cmd.Parameters.AddWithValue("$from", p.Ts - half);
        cmd.Parameters.AddWithValue("$to", p.Ts + half);
        return cmd.ExecuteScalar() != null;
    }

    /* [p] marked as kept in [zone], for the next hearing of it; those older than Last.fm takes let go. */
    private static void Marked(SqliteConnection c, SqliteTransaction tx, string zone, Play p)
    {
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "DELETE FROM scrobbled WHERE ts < $old; INSERT INTO scrobbled(zone, artist, track, ts) VALUES($z, $ar, $tr, $ts)";
        cmd.Parameters.AddWithValue("$old", (long)Hub.Now() - MaxAgeMs);
        cmd.Parameters.AddWithValue("$z", zone);
        cmd.Parameters.AddWithValue("$ar", p.Artist);
        cmd.Parameters.AddWithValue("$tr", p.Track);
        cmd.Parameters.AddWithValue("$ts", p.Ts);
        cmd.ExecuteNonQuery();
    }

    /* A phone's offline play ([tx] its upload's), kept to be sent when an account is connected and it is Last.fm's kind of play. */
    public static void Offline(SqliteConnection c, SqliteTransaction? tx, Play p)
    {
        if (LastfmAccount.Current() == null || (p.Duration > 0 && p.Duration <= 30)) return;
        Keep(c, tx, p);
    }

    /* Sent in the background after an upload of offline plays. */
    public static void Soon() => _ = Flush();

    private static void Keep(SqliteConnection c, SqliteTransaction? tx, Play p)
    {
        Made(c);
        using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT INTO scrobbles(artist, track, album, album_artist, ts, duration, track_no) VALUES($ar, $tr, $al, $aa, $ts, $du, $no)";
        cmd.Parameters.AddWithValue("$ar", p.Artist);
        cmd.Parameters.AddWithValue("$tr", p.Track);
        cmd.Parameters.AddWithValue("$al", p.Album);
        cmd.Parameters.AddWithValue("$aa", p.AlbumArtist);
        cmd.Parameters.AddWithValue("$ts", p.Ts);
        cmd.Parameters.AddWithValue("$du", p.Duration);
        cmd.Parameters.AddWithValue("$no", p.TrackNo is long n ? n : DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    /* A play's fields as Last.fm names them, [i] the place in a batch ("[0]") or "" for one. */
    private static Dictionary<string, string> Fields(Play p, string i)
    {
        var f = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["artist" + i] = p.Artist, ["track" + i] = p.Track, ["timestamp" + i] = LastfmAccount.Seconds(p.Ts),
        };
        if (p.Album.Length > 0) f["album" + i] = p.Album;
        if (p.AlbumArtist.Length > 0 && p.AlbumArtist != p.Artist) f["albumArtist" + i] = p.AlbumArtist;
        if (p.Duration > 0) f["duration" + i] = ((long)Math.Round(p.Duration)).ToString(CultureInfo.InvariantCulture);
        if (p.TrackNo is long n && n > 0) f["trackNumber" + i] = n.ToString(CultureInfo.InvariantCulture);
        return f;
    }

    /* The kept plays sent, fifty a call, oldest first, until none are left or Last.fm can't take them now. */
    public static async Task Flush()
    {
        if (!await sending.WaitAsync(0)) return;
        try
        {
            while (LastfmAccount.Current() is { } session)
            {
                List<(long Id, Play P)> batch = [];
                using (var c = Db.Open())
                {
                    Made(c);
                    using (var old = c.CreateCommand()) { old.CommandText = "DELETE FROM scrobbles WHERE ts < $t"; old.Parameters.AddWithValue("$t", (long)Hub.Now() - MaxAgeMs); old.ExecuteNonQuery(); }
                    foreach (var r in Library.Rows(c, "SELECT id, artist, track, album, album_artist, ts, duration, track_no FROM scrobbles ORDER BY ts, id LIMIT " + Batch))
                        batch.Add(((long)r[0]!, new Play((string)r[1]!, (string)r[2]!, r[3] as string ?? "", r[4] as string ?? "", (long)r[5]!,
                            r[6] is double d ? d : r[6] is long l ? l : 0, r[7] as long?)));
                }
                if (batch.Count == 0) return;
                var ps = new Dictionary<string, string>(StringComparer.Ordinal) { ["sk"] = session.Key };
                for (var i = 0; i < batch.Count; i++) foreach (var kv in Fields(batch[i].P, "[" + i + "]")) ps[kv.Key] = kv.Value;
                try { await LastfmAccount.Call("track.scrobble", ps, true); }
                catch (Exception e) when (e is LastfmError or HttpRequestException or TaskCanceledException) { Failed(e); return; }
                // Taken or ignored by Last.fm, either way done with: one it ignored would be ignored again.
                using (var c = Db.Open())
                {
                    using var del = c.CreateCommand();
                    del.CommandText = "DELETE FROM scrobbles WHERE id IN (" + string.Join(",", batch.Select(b => b.Id.ToString(CultureInfo.InvariantCulture))) + ")";
                    del.ExecuteNonQuery();
                }
                LastError = null;
                log($"[lastfm] scrobbled {batch.Count}");
            }
        }
        finally { sending.Release(); }
    }

    /* A failure: the session gone (9) leaves Mandarin disconnected; anything else is tried again later. */
    private static void Failed(Exception e)
    {
        if (e is LastfmError { Code: 9 }) LastfmAccount.Revoked();
        LastError = e is LastfmError { Code: 13 } ? "Last.fm refused the shared secret" : e.Message;
        log("[lastfm] " + e.Message);
    }
}
