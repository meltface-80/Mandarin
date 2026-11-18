// IBroadcastUploadSpeed.cs — how much of the home's upload the upload to iBroadcast may use (item 479), as its Upload
// bandwidth page sets it (the setting "ibroadcastUploadSpeed"): the home's upload speed as its internet provider gives
// it (Mbps, entered by hand), and the share of it the upload may use: 25, 50, 75 or 100 %. An upload that fills the
// whole of it slows everything else on the connection (pages, calls, playing away from home over it), so less can be
// left free. The limit is on everything the upload sends at once, however many files, the allowance one for them all
// (IBroadcastUploadFiles' sending takes from it as it reads), and holds at once, an upload under way included. No
// speed given: no limit, as before. The fastest an upload has sent is kept beside it, to help say the speed.
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Mandarin.Server.Services.IBroadcast;

internal static class IBroadcastUploadSpeed
{
    /// <summary>{ speed_mbps, percent, fastest_bps }.</summary>
    public const string Key = "ibroadcastUploadSpeed";
    /// <summary>The shares of the speed the upload may use, in per cent.</summary>
    public static readonly int[] Shares = [25, 50, 75, 100];
    /// <summary>The fastest upload speed taken (Mbps): 100 Gbps.</summary>
    public const double MostMbps = 100_000;

    /// <summary>The home's upload speed ([Mbps]; null: not given, no limit), the share of it to use, and the fastest an upload has sent (bytes a second).</summary>
    public sealed record Choice(double? Mbps, int Percent, double FastestBps)
    {
        /// <summary>The most the upload may send (Mbps); 0: no limit.</summary>
        public double LimitMbps => Mbps is { } m ? m * Percent / 100.0 : 0;
        /// <summary>The same in bytes a second.</summary>
        public double LimitBytesPerSecond => LimitMbps * 1e6 / 8;
    }

    /// <summary>The choice as kept, defaulted: no speed, 100 %.</summary>
    public static Choice Stored()
    {
        using var c = Db.Open();
        var o = Db.Setting(c, Key) as JsonObject;
        var mbps = o?["speed_mbps"] is JsonValue v && v.TryGetValue<double>(out var m) && m > 0 ? m : (double?)null;
        var percent = o?["percent"] is JsonValue p && p.TryGetValue<double>(out var n) && Shares.Contains((int)n) && n == Math.Floor(n) ? (int)n : 100;
        var fastest = o?["fastest_bps"] is JsonValue f && f.TryGetValue<double>(out var b) && b > 0 ? b : 0;
        return new(mbps, percent, fastest);
    }

    /// <summary>The choice as the pages read it: { speed_mbps, percent, limit_mbps (null: no limit), fastest_mbps (null: none yet) }.</summary>
    public static JsonObject Json(Choice c) => new()
    {
        ["speed_mbps"] = c.Mbps, ["percent"] = c.Percent, ["limit_mbps"] = c.Mbps is null ? null : Math.Round(c.LimitMbps, 1),
        ["fastest_mbps"] = c.FastestBps > 0 ? Math.Round(c.FastestBps * 8 / 1e6, 1) : null,
    };

    /// <summary>Changed by [patch] ({ speed_mbps: a number, or null for none; percent: 25, 50, 75 or 100 }): kept, or why not.</summary>
    public static (Choice? Kept, string? Refused) Save(JsonObject patch)
    {
        var c = Stored();
        if (patch.ContainsKey("speed_mbps"))
        {
            if (patch["speed_mbps"] is null) c = c with { Mbps = null };
            else if (patch["speed_mbps"] is JsonValue v && v.TryGetValue<double>(out var m) && m > 0 && m <= MostMbps) c = c with { Mbps = Math.Round(m, 1) };
            else return (null, $"The upload speed must be a number of Mbps, more than 0 and at most {MostMbps:0}");
        }
        if (patch.ContainsKey("percent"))
        {
            if (patch["percent"] is not JsonValue v || !v.TryGetValue<double>(out var n) || n != Math.Floor(n) || !Shares.Contains((int)n))
                return (null, "The share to use must be 25, 50, 75 or 100 %");
            c = c with { Percent = (int)n };
        }
        Keep(c);
        lock (Gate) kept = null;   // in force at once, an upload under way included
        return (c, null);
    }

    /// <summary>An upload sent at [bytesPerSecond]: kept where it is the fastest yet.</summary>
    public static void Seen(double bytesPerSecond)
    {
        var c = Stored();
        if (bytesPerSecond > c.FastestBps) Keep(c with { FastestBps = Math.Round(bytesPerSecond) });
    }

    private static void Keep(Choice c)
    {
        using var db = Db.Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", Key);
        cmd.Parameters.AddWithValue("$v", new JsonObject { ["speed_mbps"] = c.Mbps, ["percent"] = c.Percent, ["fastest_bps"] = c.FastestBps }.ToJsonString());
        cmd.ExecuteNonQuery();
    }

    // ---------------------------------------------------------------- the allowance every file sending shares

    private static readonly object Gate = new();
    // The limit (bytes a second) as last read, and when: read again each second, or as soon as it is changed.
    private static (double Rate, long At)? kept;
    // What may be sent now (bytes; below 0: owed), at the rate it was counted at, and when it was last counted.
    private static double allowance;
    private static double countedAt;
    private static long last;

    /// <summary>
    /// [bytes] just read to be sent: waited for as long as the limit asks, every file sent at once taking from the one
    /// allowance (a quarter of a second's worth at most saved up, so it never sends in bursts much over the limit).
    /// </summary>
    public static async Task Take(long bytes, CancellationToken stop)
    {
        TimeSpan wait;
        lock (Gate)
        {
            var now = Stopwatch.GetTimestamp();
            if (kept is not { } k || Stopwatch.GetElapsedTime(k.At, now) > TimeSpan.FromSeconds(1)) kept = k = (Stored().LimitBytesPerSecond, now);
            var rate = k.Rate;
            if (rate <= 0) return;
            if (rate != countedAt) { allowance = 0; countedAt = rate; last = now; }
            allowance = Math.Min(allowance + Stopwatch.GetElapsedTime(last, now).TotalSeconds * rate, rate / 4) - bytes;
            last = now;
            wait = allowance < 0 ? TimeSpan.FromSeconds(-allowance / rate) : TimeSpan.Zero;
        }
        if (wait > TimeSpan.Zero) await Task.Delay(wait, stop);
    }
}
