// Auth.Seen.cs — when each signed-in device was last seen, and from where:
// kept here and written to the database in the background, a device at most
// once a minute as before, never on a request's way.
//
// Written by the gate, it was a write on the request itself: with a scan or a
// job holding the database's write lock, every request of a burst waited its
// turn for seconds, holding a thread each, and with the thread pool taken even
// a request that reads nothing waited. A write here that finds the database
// busy isn't waited for: it is tried again at the next turn. Settings →
// Devices reads through what is kept here, so it is never behind.
using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static partial class Auth
{
    private sealed record Seen(long At, string Ip);

    // Device id → when it was last seen and from where; and the last_seen the database has.
    private static readonly ConcurrentDictionary<string, Seen> seen = new();
    private static readonly ConcurrentDictionary<string, long> written = new();
    private static readonly object writingSeen = new();
    private static Timer? seenTimer;

    /* How often what is kept here is written (ten seconds). */
    private const int SeenEveryMs = 10000;

    /*
     * A device seen now from ip; stored: the last_seen its row has (read just
     * before a write here lands, at worst one write more). Moved once a minute,
     * as the row was: the devices' list stays the same answer in between.
     */
    private static void Saw(string id, long stored, string ip)
    {
        written[id] = stored;
        var last = seen.TryGetValue(id, out var s) ? Math.Max(s.At, stored) : stored;
        if (Now - last > 60000) seen[id] = new Seen(Now, ip);
    }

    /* A device signed out: nothing kept for it. */
    private static void Unseen(string id)
    {
        seen.TryRemove(id, out _);
        written.TryRemove(id, out _);
    }

    /* The writing started (Program.cs), every ten seconds. */
    public static void KeepSeen() => seenTimer ??= new Timer(_ => WriteSeen(), null, SeenEveryMs, SeenEveryMs);

    /*
     * Each device the database is a minute or more behind on, written in one
     * short transaction; the database busy, nothing waits and the next turn
     * tries again. Also as the server stops (Program.cs).
     */
    public static void WriteSeen()
    {
        lock (writingSeen)
        {
            var due = seen.Where(kv => kv.Value.At - written.GetValueOrDefault(kv.Key) > 60000).ToList();
            if (due.Count == 0) return;
            try
            {
                using var c = Db.Open();
                using (var nowait = c.CreateCommand()) { nowait.CommandText = "PRAGMA busy_timeout = 0"; nowait.ExecuteNonQuery(); }
                using (var tx = c.BeginTransaction())
                {
                    foreach (var (id, s) in due)
                    {
                        using var up = c.CreateCommand();
                        up.Transaction = tx;
                        up.CommandText = "UPDATE devices SET last_seen = $t, last_ip = $ip WHERE id = $id";
                        up.Parameters.AddWithValue("$t", s.At); up.Parameters.AddWithValue("$ip", s.Ip); up.Parameters.AddWithValue("$id", id);
                        up.ExecuteNonQuery();
                    }
                    tx.Commit();
                }
                foreach (var (id, s) in due) written.AddOrUpdate(id, s.At, (_, w) => Math.Max(w, s.At));
            }
            catch (SqliteException e) when (e.SqliteErrorCode is 5 or 6) { /* busy or locked: the next turn */ }
            catch (SqliteException e) { Server.Log($"[auth] devices' last seen not written: {e.Message}"); }
        }
    }

    /* Settings → Devices: every signed-in device, the latest seen first, last seen as kept here where that is newer. */
    private static JsonArray DeviceList(SqliteConnection c, string current)
    {
        var list = new List<JsonObject>();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT id, name, kind, created_at, last_seen, last_ip FROM devices ORDER BY last_seen DESC";
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var id = r.GetString(0);
                long at = r.GetInt64(4);
                string? ip = r.IsDBNull(5) ? null : r.GetString(5);
                if (seen.TryGetValue(id, out var s) && s.At > at) (at, ip) = (s.At, s.Ip);
                list.Add(new JsonObject
                {
                    ["id"] = id, ["name"] = r.GetString(1), ["kind"] = r.GetString(2),
                    ["created_at"] = r.GetInt64(3), ["last_seen"] = at, ["last_ip"] = ip, ["current"] = id == current
                });
            }
        }
        return new JsonArray(list.OrderByDescending(o => (long)o["last_seen"]!).Select(o => (JsonNode?)o).ToArray());
    }
}
