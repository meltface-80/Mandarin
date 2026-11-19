// IBroadcastUploadSent.cs — what an upload to iBroadcast sent (item 446), kept in the cache's "ibroadcast-upload": a
// file here → its size and time, the MD5 sent, whether it was made FLAC, and (item 477) how many times running
// iBroadcast took it without keeping it, and what iBroadcast said as it took it last.
// iBroadcast can take a file (its answer not "result": false) and still not keep it: it isn't among the MD5s it says it
// has afterwards, nor in its library. Such a file was sent again on every upload, without end (a real one's 46
// files, each Upload now). Taken twice and still not kept, an unchanged file isn't sent again: it is left, said with
// iBroadcast's own words. Changed (its size or time), or kept by iBroadcast after all, it is as any other; and so is one
// that would now be sent under another name (item 480: the names sent shortened), tried again as it is sent now.
//
// And iBroadcast is given time (item 488). It lists a file within a minute of taking it, as a rule, and "not kept" was
// judged at the next upload's start, however soon: begun again a minute after a restart, the last few files were sent
// twice. The day iBroadcast stopped processing what it took (its upload servers down an afternoon), 2,129 files were
// sent a second time and 962 then left, for good, though nothing was wrong with them. A file sent in the last half hour
// is now waited for: not sent again, nor counted. And one left is tried again: after a day, then two, four, eight… a
// month at most, so a file iBroadcast will never keep costs an upload now and then, and one lost to a fault is sent.
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastUploadSent
{
    /// <summary>The cache's namespace for what was sent.</summary>
    public const string Ns = "ibroadcast-upload";
    /// <summary>How many times iBroadcast takes a file without keeping it before it is left.</summary>
    public const int TakenMost = 2;

    /// <summary>A file as it was sent: its size and time, the MD5 sent, times taken and not kept, iBroadcast's words then, when, and the name it went as (none: before item 480).</summary>
    public sealed record Was(long Size, long Mtime, string Md5, int Taken, string? Said, double At, string? SentAs = null);

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
                    (int?)o["taken"] ?? 1, IBroadcastApi.Str(o["said"]), r.IsDBNull(2) ? 0 : r.GetInt64(2), IBroadcastApi.Str(o["sent_as"]));
        return d;
    }

    /// <summary>Whether [w] is [f] as it is now.</summary>
    public static bool Same(Was w, LocalFile f) => w.Size == f.Size && w.Mtime == f.Mtime;

    /// <summary>[f] sent as [md5] under the name [sentAs]: taken [taken] times without being kept, iBroadcast saying [said] (0 and null: it has it).</summary>
    public static void Note(LocalFile f, string md5, bool flac, int taken, string? said, string? sentAs = null)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO cache(ns, key, value, ts) VALUES($ns, $k, $v, $ts) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, ts = excluded.ts";
        cmd.Parameters.AddWithValue("$ns", Ns);
        cmd.Parameters.AddWithValue("$k", f.Path);
        cmd.Parameters.AddWithValue("$v", new JsonObject { ["size"] = f.Size, ["mtime"] = f.Mtime, ["md5"] = md5, ["flac"] = flac, ["taken"] = taken, ["said"] = said, ["sent_as"] = sentAs }.ToJsonString());
        cmd.Parameters.AddWithValue("$ts", (long)IBroadcastApi.Now());
        cmd.ExecuteNonQuery();
    }

    /// <summary>What an upload does with a file sent before, as it is and under the name it goes as, that iBroadcast hasn't.</summary>
    public enum Next { Send, Wait, Leave }

    /// <summary>How long iBroadcast is given to list a file it took, and how long a file left waits to be tried again the first time.</summary>
    public const double WaitMs = 30 * 60 * 1000, AgainMs = 24 * 3600 * 1000.0;
    // The gap doubles at each try after the first, this many times at most: 32 days.
    private const int DoublesMost = 5;

    /// <summary>When [w], left, is tried again: [againMs] after it was last sent, doubled for each time it was tried since being left.</summary>
    public static double AgainAt(Was w, double againMs) => w.At + againMs * Math.Pow(2, Math.Clamp(w.Taken - TakenMost, 0, DoublesMost));

    /// <summary>
    /// What is done at [now] with [w], which iBroadcast hasn't: waited for while it was sent less than [waitMs] ago; sent
    /// again where it has been taken fewer than <see cref="TakenMost"/> times, or its time to be tried again has come; else left.
    /// </summary>
    public static Next NextFor(Was w, double now, double waitMs, double againMs) =>
        now - w.At < waitMs ? Next.Wait : w.Taken < TakenMost || now >= AgainAt(w, againMs) ? Next.Send : Next.Leave;

    /// <summary>Why [w], taken and not kept as often as is tried, is left at [now]: in words, with iBroadcast's, and when it is tried again.</summary>
    public static string Why(Was w, double now, double againMs) =>
        $"iBroadcast took it {w.Taken} times but didn't keep it{(string.IsNullOrWhiteSpace(w.Said) ? "" : $" (it said: \"{w.Said}\")")}; tried again after {About(AgainAt(w, againMs) - now)}";

    /// <summary>[ms], roughly: "under an hour", "about 5 hours", "about 3 days".</summary>
    public static string About(double ms)
    {
        var hours = ms / 3600000;
        if (hours < 1) return "under an hour";
        if (hours < 36) return $"about {Math.Round(hours)} hour{(Math.Round(hours) == 1 ? "" : "s")}";
        return $"about {Math.Round(hours / 24)} days";
    }
}
