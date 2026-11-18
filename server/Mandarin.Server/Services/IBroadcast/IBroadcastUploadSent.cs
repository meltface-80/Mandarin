// IBroadcastUploadSent.cs — what an upload to iBroadcast sent (item 446), kept in the cache's "ibroadcast-upload": a
// file here → its size and time, the MD5 sent, whether it was made FLAC, and (item 477) how many times running
// iBroadcast took it without keeping it, and what iBroadcast said as it took it last.
// iBroadcast can take a file (its answer not "result": false) and still not keep it: it isn't among the MD5s it says it
// has afterwards, nor in its library. Such a file was sent again on every upload, without end (a real one's 46
// files, each Upload now). Taken twice and still not kept, an unchanged file isn't sent again: it is left, said with
// iBroadcast's own words. Changed (its size or time), or kept by iBroadcast after all, it is as any other.
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastUploadSent
{
    /// <summary>The cache's namespace for what was sent.</summary>
    public const string Ns = "ibroadcast-upload";
    /// <summary>How many times iBroadcast takes a file without keeping it before it is left.</summary>
    public const int TakenMost = 2;

    /// <summary>A file as it was sent: its size and time, the MD5 sent, times taken and not kept, iBroadcast's words then, and when.</summary>
    public sealed record Was(long Size, long Mtime, string Md5, int Taken, string? Said, double At);

    /// <summary>Everything sent, by file.</summary>
    public static Dictionary<string, Was> All()
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT key, value, ts FROM cache WHERE ns = $ns";
        cmd.Parameters.AddWithValue("$ns", Ns);
        using var r = cmd.ExecuteReader();
        var d = new Dictionary<string, Was>(StringComparer.Ordinal);
        while (r.Read())
            if (JsonNode.Parse(r.GetString(1)) is JsonObject o && IBroadcastApi.Str(o["md5"]) is { } md5)
                d[r.GetString(0)] = new((long?)o["size"] ?? -1, (long?)o["mtime"] ?? -1, md5,
                    // One sent before item 477 kept no count: taken once.
                    (int?)o["taken"] ?? 1, IBroadcastApi.Str(o["said"]), r.IsDBNull(2) ? 0 : r.GetInt64(2));
        return d;
    }

    /// <summary>Whether [w] is [f] as it is now.</summary>
    public static bool Same(Was w, LocalFile f) => w.Size == f.Size && w.Mtime == f.Mtime;

    /// <summary>[f] sent as [md5]: taken [taken] times without being kept, iBroadcast saying [said] (0 and null: it has it).</summary>
    public static void Note(LocalFile f, string md5, bool flac, int taken, string? said)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
        cmd.Parameters.AddWithValue("$ns", Ns);
        cmd.Parameters.AddWithValue("$k", f.Path);
        cmd.Parameters.AddWithValue("$v", new JsonObject { ["size"] = f.Size, ["mtime"] = f.Mtime, ["md5"] = md5, ["flac"] = flac, ["taken"] = taken, ["said"] = said }.ToJsonString());
        cmd.Parameters.AddWithValue("$ts", (long)IBroadcastApi.Now());
        cmd.ExecuteNonQuery();
    }

    /// <summary>Why [w], taken and not kept as often as is tried, is left: in words, with iBroadcast's.</summary>
    public static string Why(Was w) =>
        $"iBroadcast took it {w.Taken} times but didn't keep it{(string.IsNullOrWhiteSpace(w.Said) ? "" : $" (it said: \"{w.Said}\")")}; not sent again unless the file changes";
}
