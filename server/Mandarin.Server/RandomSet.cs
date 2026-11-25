// RandomSet.cs — Random albums as one set (item 537).
//
// Home's Random albums row and the Random albums wall each asked for a random handful of their own, the row again on
// every visit to Home, so the row the owner saw was never the wall it opened. The server now keeps one set: a seed
// and when it was picked (the setting random_albums). /api/random-albums without a filter answers that set, the
// library in the seed's order (Library.Seeded), so a shorter reading (Home's row) is the head of a longer (the wall),
// on the page, in the app and in Android Auto alike. A new seed is picked when asked (?refresh=1: the wall's Refresh,
// and Android Auto every ten minutes while in use) or once the set is 24 hours old. Kept through restarts.
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal static class RandomSet
{
    private const string Key = "random_albums";
    /// <summary>How long a set stands before a new one is picked by itself.</summary>
    public const long KeepMs = 24L * 60 * 60 * 1000;
    private static readonly Lock Gate = new();

    /// <summary>The set's seed: the one kept, or a new one where [refresh] asks, none is kept, or it is [KeepMs] old.</summary>
    public static uint Seed(bool refresh)
    {
        lock (Gate)
        {
            using var c = Db.Open();
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (!refresh && Db.Setting(c, Key) is JsonObject o && o["seed"] is JsonValue sv && sv.TryGetValue<long>(out var seed)
                && o["at"] is JsonValue av && av.TryGetValue<long>(out var at) && now - at < KeepMs && at <= now)
                return unchecked((uint)seed);
            var fresh = (uint)Random.Shared.NextInt64(1, uint.MaxValue);
            Save(c, new JsonObject { ["seed"] = fresh, ["at"] = now });
            return fresh;
        }
    }

    private static void Save(SqliteConnection c, JsonObject value)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", Key);
        cmd.Parameters.AddWithValue("$v", value.ToJsonString());
        cmd.ExecuteNonQuery();
    }

    /// <summary>Whether a reading asks for a new set (?refresh=1 or true).</summary>
    public static bool Asked(string? q) => q is "1" or "true";
}
