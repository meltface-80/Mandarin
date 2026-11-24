// IBroadcastDeleted.cs — the iBroadcast tracks deleted from Mandarin's selection menu (bug list items 527, 528), kept a
// day. iBroadcast goes on listing a track it was just asked to delete for a while, so a reading straight after (or
// minutes after) wrote the album again, and the albums deleted stayed on the walls until a whole rescan. A reading now
// leaves out every track kept here (IBroadcastLibrary.Write), whatever iBroadcast lists, so a deleted album goes at
// once and doesn't come back; and the library is read again a few seconds, then half a minute, after a delete
// (IBroadcastDeleteRoutes.cs), for what iBroadcast says by then. In the cache's "ibroadcast-deleted", by track id.
namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastDeleted
{
    public const string Ns = "ibroadcast-deleted";
    public const double KeptMs = 24 * 3600 * 1000.0;

    /* [ids] deleted now. */
    public static void Keep(IEnumerable<long> ids)
    {
        using var c = Db.Open();
        using var tx = c.BeginTransaction();
        var now = IBroadcastApi.Now();
        foreach (var id in ids)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, 'deleted', $ts) ON CONFLICT(ns, key) DO UPDATE SET ts = excluded.ts";
            cmd.Parameters.AddWithValue("$ns", Ns);
            cmd.Parameters.AddWithValue("$k", id.ToString(System.Globalization.CultureInfo.InvariantCulture));
            cmd.Parameters.AddWithValue("$ts", now);
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    /* The tracks deleted within the day, by iBroadcast's id as its library writes it; those older let go. */
    public static HashSet<string> Set(Microsoft.Data.Sqlite.SqliteConnection c)
    {
        using (var purge = c.CreateCommand())
        {
            purge.CommandText = "DELETE FROM cache WHERE ns = $ns AND ts < $old";
            purge.Parameters.AddWithValue("$ns", Ns);
            purge.Parameters.AddWithValue("$old", IBroadcastApi.Now() - KeptMs);
            purge.ExecuteNonQuery();
        }
        return [.. Library.Rows(c, "SELECT key FROM cache WHERE ns = $1", Ns).Select(r => (string)r[0]!)];
    }
}
